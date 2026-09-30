import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  attemptAttributes,
  providerPlan,
  scenarioFromPath,
  successAttributes,
} from "../staging/cloudflare/src/policy.js";

const root = fileURLToPath(new URL("../", import.meta.url));

describe("Cloudflare staging policy", () => {
  it("defines direct and fallback attempt order deterministically", () => {
    expect(providerPlan("direct").map(({ provider }) => provider)).toEqual([
      "alpha",
    ]);
    expect(providerPlan("fallback").map(({ provider }) => provider)).toEqual([
      "alpha",
      "beta",
    ]);
  });

  it("accepts only the three bounded scenario routes", () => {
    expect(scenarioFromPath("/scenario/direct")).toBe("direct");
    expect(scenarioFromPath("/scenario/fallback")).toBe("fallback");
    expect(scenarioFromPath("/scenario/detached")).toBe("detached");
    expect(scenarioFromPath("/scenario/arbitrary")).toBeNull();
  });

  it("emits scalar, bounded attributes without sensitive fields", () => {
    for (const step of providerPlan("fallback")) {
      const attributes = {
        ...attemptAttributes(step, 1),
        ...(step.outcome === "success" ? successAttributes(step) : {}),
      };
      expect(Object.keys(attributes).join(" ")).not.toMatch(
        /prompt|messages|authorization|credential|api[._-]?key|url\.query/i,
      );
      expect(
        Object.values(attributes).every(
          (value) =>
            typeof value === "number" ||
            typeof value === "boolean" ||
            (typeof value === "string" && value.length <= 64),
        ),
      ).toBe(true);
    }
  });

  it("does not read inbound request content", () => {
    const source = fs.readFileSync(
      path.join(root, "staging/cloudflare/src/index.ts"),
      "utf8",
    );
    expect(source).not.toMatch(
      /request\.(?:arrayBuffer|blob|body|formData|json|text)\b/,
    );
  });

  it("pins tracing to the staging worker with bounded sampling", () => {
    const configText = fs.readFileSync(
      path.join(root, "staging/cloudflare/wrangler.jsonc"),
      "utf8",
    );
    const config = JSON.parse(configText.replace(/,\s*([}\]])/g, "$1")) as {
      name: string;
      observability: {
        logs: { enabled: boolean };
        traces: { enabled: boolean; head_sampling_rate: number };
      };
    };
    expect(config.name).toMatch(/staging$/);
    expect(config.observability.logs.enabled).toBe(false);
    expect(config.observability.traces).toEqual(
      expect.objectContaining({ enabled: true, head_sampling_rate: 1 }),
    );
  });
});
