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
import {
  isPreviewRequest,
  previewDocument,
  previewHeadResponse,
  previewResponse,
} from "../staging/cloudflare/src/preview.js";

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

describe("Cloudflare staging preview", () => {
  it("serves the root for browser GET and HEAD requests only", () => {
    expect(isPreviewRequest("GET", "/")).toBe(true);
    expect(isPreviewRequest("HEAD", "/")).toBe(true);
    expect(isPreviewRequest("POST", "/")).toBe(false);
    expect(isPreviewRequest("GET", "/scenario/direct")).toBe(false);
    expect(previewHeadResponse().body).toBeNull();
  });

  it("offers only the three bounded synthetic scenarios", () => {
    expect(previewDocument).toContain(
      'const scenarios = ["direct", "fallback", "detached"]',
    );
    expect(previewDocument.match(/<button[^>]+data-run=/g)).toHaveLength(3);
    expect(previewDocument).toContain("No model is called");
  });

  it("does not collect content or load third-party resources", () => {
    expect(previewDocument).not.toMatch(/<(?:form|input|textarea)\b/i);
    expect(previewDocument).not.toMatch(/(?:src|href)=["']https?:\/\//i);
    expect(previewDocument).not.toMatch(/request\.(?:json|text|formData)/);
  });

  it("serves restrictive browser security headers", () => {
    const response = previewResponse();
    expect(response.headers.get("content-type")).toBe(
      "text/html; charset=utf-8",
    );
    expect(response.headers.get("content-security-policy")).toContain(
      "connect-src 'self'",
    );
    expect(response.headers.get("content-security-policy")).toContain(
      "frame-ancestors 'none'",
    );
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("x-robots-tag")).toBe(
      "noindex, nofollow, noarchive",
    );
  });
});
