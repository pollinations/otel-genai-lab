import fs from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const evidencePath = fileURLToPath(
  new URL("../fixtures/interop/agentgateway-v1.5.0.json", import.meta.url),
);
const fallbackEvidencePath = fileURLToPath(
  new URL(
    "../fixtures/interop/agentgateway-v1.5.0-fallback.json",
    import.meta.url,
  ),
);

describe("agentgateway runtime evidence", () => {
  it("records bounded direct and failure topology without identifiers", () => {
    const source = fs.readFileSync(evidencePath, "utf8");
    const evidence = JSON.parse(source);

    expect(evidence.traffic).toEqual({ direct: 200, failure: 503 });
    expect(evidence.inspection.summary).toEqual({
      traces: 2,
      spans: 4,
      genAiSpans: 2,
      safetyIssues: 0,
    });

    const spans = evidence.inspection.traces.flatMap(
      (trace: { spans: unknown[] }) => trace.spans,
    );
    const servers = spans.filter(
      (span: { kind: string }) => span.kind === "SERVER",
    );
    const clients = spans.filter(
      (span: { kind: string }) => span.kind === "CLIENT",
    );
    expect(
      servers.map(
        (span: { outcome: { "http.status": number } }) =>
          span.outcome["http.status"],
      ),
    ).toEqual([503, 200]);
    expect(
      clients.every(
        (span: { genAi: Record<string, unknown> }) =>
          Object.keys(span.genAi).length === 0,
      ),
    ).toBe(true);
    expect(source).not.toMatch(/"(?:traceId|spanId|parentSpanId)"/);
    expect(source).not.toMatch(/authorization|synthetic test input/i);
  });

  it("records two ordered fallback attempts and one usage owner", () => {
    const source = fs.readFileSync(fallbackEvidencePath, "utf8");
    const evidence = JSON.parse(source);

    expect(evidence.traffic).toEqual({
      result: 200,
      attempts: [
        { model: "synthetic-primary", retryAttempt: null, status: 429 },
        { model: "synthetic-fallback", retryAttempt: "1", status: 200 },
      ],
    });
    expect(evidence.inspection.summary).toEqual({
      traces: 1,
      spans: 3,
      genAiSpans: 1,
      safetyIssues: 0,
    });

    const spans = evidence.inspection.traces[0].spans;
    expect(spans.map((span: { kind: string }) => span.kind)).toEqual([
      "SERVER",
      "CLIENT",
      "CLIENT",
    ]);
    expect(
      spans.map(
        (span: { outcome: { "http.status": number } }) =>
          span.outcome["http.status"],
      ),
    ).toEqual([200, 429, 200]);
    expect(spans[0].outcome["retry.attempt"]).toBe(1);
    expect(spans[0].genAi["gen_ai.request.model"]).toBe("synthetic-fallback");
    expect(
      spans.filter(
        (span: { genAi: Record<string, unknown> }) =>
          span.genAi["gen_ai.usage.input_tokens"] !== undefined,
      ),
    ).toHaveLength(1);
    expect(
      spans
        .slice(1)
        .map((span: { implementation: unknown }) => span.implementation),
    ).toEqual([
      {
        "agentgateway.outbound.kind": "Primary",
        "agentgateway.outbound.subtype": "Llm",
      },
      {
        "agentgateway.outbound.kind": "Primary",
        "agentgateway.outbound.subtype": "Llm",
      },
    ]);
    expect(source).not.toMatch(/"(?:traceId|spanId|parentSpanId)"/);
    expect(source).not.toMatch(/authorization|synthetic fallback test input/i);
  });
});
