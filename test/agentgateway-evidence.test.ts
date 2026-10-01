import fs from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const evidencePath = fileURLToPath(
  new URL("../fixtures/interop/agentgateway-v1.5.0.json", import.meta.url),
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
});
