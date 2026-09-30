import { DurableObject, tracing } from "cloudflare:workers";

import {
  attemptAttributes,
  providerPlan,
  scenarioFromPath,
  successAttributes,
  type ProviderStep,
} from "./policy.js";
import { previewResponse } from "./preview.js";

interface Env {
  GENERATION: DurableObjectNamespace<GenerationCoordinator>;
}

const jsonHeaders = { "content-type": "application/json" };

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/") {
      return previewResponse();
    }

    if (url.pathname.startsWith("/__provider/")) {
      return new Response(null, { status: 204 });
    }

    const scenario = scenarioFromPath(url.pathname);
    if (request.method !== "POST" || scenario === null) {
      return Response.json(
        { error: "use POST /scenario/direct, /fallback, or /detached" },
        { status: 404, headers: jsonHeaders },
      );
    }

    return tracing.enterSpan("genai.gateway.route", async (span) => {
      span.setAttributes({
        "gen_ai.operation.name": "chat",
        "gen_ai.request.model": "model-a",
        "otel_genai_lab.scenario": scenario,
      });

      if (scenario === "detached") {
        const coordinator = env.GENERATION.getByName("staging-singleton");
        await coordinator.fetch(
          new Request(`${url.origin}/schedule`, {
            method: "POST",
            headers: { "x-staging-origin": url.origin },
          }),
        );
        span.setAttribute("otel_genai_lab.route.outcome", "scheduled");
        return Response.json(
          { scenario, result: "scheduled" },
          { status: 202, headers: jsonHeaders },
        );
      }

      if (scenario === "direct") {
        span.setAttribute(
          "otel_genai_lab.cache.outcome",
          await exerciseStagingCache(url.origin),
        );
      }
      const attempts = await executeProviderPlan(scenario, url.origin);
      span.setAttributes({
        "otel_genai_lab.attempt.count": attempts,
        "otel_genai_lab.route.outcome":
          scenario === "fallback" ? "fallback_success" : "direct_success",
      });
      return Response.json(
        { scenario, result: "success", attempts },
        { headers: jsonHeaders },
      );
    });
  },
} satisfies ExportedHandler<Env>;

export class GenerationCoordinator extends DurableObject<Env> {
  override async fetch(request: Request): Promise<Response> {
    if (new URL(request.url).pathname !== "/schedule") {
      return new Response("not found", { status: 404 });
    }

    const origin = request.headers.get("x-staging-origin");
    if (origin === null || !origin.startsWith("https://")) {
      return new Response("invalid staging origin", { status: 400 });
    }
    await this.ctx.storage.put("staging-origin", origin);
    await this.ctx.storage.setAlarm(Date.now() + 1_000);
    return Response.json({ result: "scheduled" }, { status: 202 });
  }

  override async alarm(): Promise<void> {
    const origin = await this.ctx.storage.get<string>("staging-origin");
    if (origin === undefined) return;

    await tracing.enterSpan("genai.detached.generation", async (span) => {
      span.setAttributes({
        "otel_genai_lab.generation.execution": "detached",
        "otel_genai_lab.scenario": "detached",
      });
      await executeProviderPlan("detached-generation", origin);
      span.setAttribute("otel_genai_lab.route.outcome", "completed");
    });
  }
}

async function exerciseStagingCache(origin: string): Promise<"hit" | "miss"> {
  const key = new Request(`${origin}/__cache/staging-scalar`);
  const cached = await caches.default.match(key);
  if (cached !== undefined) return "hit";

  await caches.default.put(
    key,
    new Response("cached", {
      headers: { "cache-control": "public, max-age=60" },
    }),
  );
  return "miss";
}

async function executeProviderPlan(
  scenario: "direct" | "fallback" | "detached-generation",
  origin: string,
): Promise<number> {
  const plan = providerPlan(scenario);

  for (const [index, step] of plan.entries()) {
    const succeeded = await providerAttempt(step, index + 1, origin);
    if (succeeded) return index + 1;
  }
  throw new Error("scripted provider plan did not succeed");
}

async function providerAttempt(
  step: ProviderStep,
  index: number,
  origin: string,
): Promise<boolean> {
  return tracing.enterSpan(`chat ${step.resolvedModel}`, async (span) => {
    span.setAttributes(attemptAttributes(step, index));
    await fetch(`${origin}/__provider/${step.provider}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });

    if (step.outcome === "failure") {
      span.setAttribute("error.type", "upstream_unavailable");
      span.recordException({
        name: "UpstreamUnavailable",
        message: "scripted staging failure",
      });
      return false;
    }

    span.setAttributes(successAttributes(step));
    return true;
  });
}
