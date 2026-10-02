import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { runCli } from "../src/cli.js";
import { validateOtlpSpans } from "../src/conformance.js";
import { inspectOtlpSpans } from "../src/inspection.js";
import { readOtlpFile, type OtlpSpan } from "../src/otlp.js";

const root = fileURLToPath(new URL("../", import.meta.url));

describe("OTLP conformance validator", () => {
  it("validates the Collector export without exposing trace IDs", () => {
    const filename = path.join(root, "test/fixtures/otlp-traces.json");
    expect(fs.existsSync(filename)).toBe(true);
    const report = validateOtlpSpans(readOtlpFile(filename));
    expect(report.status).toBe("pass");
    expect(report.summary).toEqual({
      traces: 3,
      spans: 8,
      providerAttempts: 5,
      issues: 0,
    });
    expect(report.traces.map(({ trace }) => trace)).toEqual([
      "trace-1",
      "trace-2",
      "trace-3",
    ]);
    expect(JSON.stringify(report)).not.toMatch(/[a-f0-9]{32}/);
  });

  it("reports privacy, relationship, and usage violations", () => {
    const spans: OtlpSpan[] = [
      span({
        spanId: "server",
        kind: 2,
        attributes: { "gen_ai.usage.input_tokens": 3 },
      }),
      span({
        spanId: "attempt",
        parentSpanId: "wrong-parent",
        kind: 3,
        statusCode: 2,
        attributes: {
          "gen_ai.operation.name": "chat",
          "gen_ai.usage.input_tokens": 3,
          "gen_ai.usage.output_tokens": 2,
          "http.request.header.authorization": "Bearer abcdefghijklmnop",
        },
      }),
    ];
    const report = validateOtlpSpans(spans);
    expect(report.status).toBe("fail");
    expect(report.traces[0]?.issues.map(({ code }) => code)).toEqual(
      expect.arrayContaining([
        "privacy",
        "trace_relationship",
        "usage_attribution",
      ]),
    );
  });
});

describe("conformance CLI", () => {
  it("returns deterministic JSON and the documented exit codes", () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const filename = path.join(root, "test/fixtures/otlp-traces.json");
    expect(
      runCli(["validate", filename, "--format", "json"], {
        stdout: (message) => stdout.push(message),
        stderr: (message) => stderr.push(message),
      }),
    ).toBe(0);
    expect(JSON.parse(stdout[0] ?? "null")).toEqual(
      expect.objectContaining({
        input: "otlp-traces.json",
        status: "pass",
      }),
    );
    expect(stderr).toEqual([]);

    expect(
      runCli(["validate"], {
        stdout: () => undefined,
        stderr: (message) => stderr.push(message),
      }),
    ).toBe(2);
  });

  it("inspects cross-gateway traces without exposing identifiers", () => {
    const stdout: string[] = [];
    const filename = path.join(root, "test/fixtures/otlp-traces.json");
    expect(
      runCli(["inspect", filename, "--format", "json"], {
        stdout: (message) => stdout.push(message),
        stderr: () => undefined,
      }),
    ).toBe(0);
    const output = stdout[0] ?? "";
    const report = JSON.parse(output);
    expect(report.summary).toEqual({
      traces: 3,
      spans: 8,
      genAiSpans: 5,
      safetyIssues: 0,
    });
    expect(report.traces[0].spans[0]).toEqual(
      expect.objectContaining({
        span: "span-1",
        kind: expect.any(String),
        outcome: {},
        implementation: {},
      }),
    );
    expect(output).not.toMatch(/[a-f0-9]{32}/);
  });
});

describe("cross-gateway inspection", () => {
  it("reports safety issues without applying topology requirements", () => {
    const report = inspectOtlpSpans([
      span({
        kind: 3,
        attributes: {
          "gen_ai.operation.name": "chat",
          "http.status": 503,
          "agentgateway.outbound.kind": "Primary",
          "http.request.header.authorization": "Bearer abcdefghijklmnop",
        },
      }),
    ]);
    expect(report.status).toBe("fail");
    expect(report.summary).toEqual({
      traces: 1,
      spans: 1,
      genAiSpans: 1,
      safetyIssues: 2,
    });
    expect(report.safetyIssues.every(({ code }) => code === "privacy")).toBe(
      true,
    );
    expect(report.traces[0]?.spans[0]).toEqual(
      expect.objectContaining({
        outcome: { "http.status": 503 },
        implementation: { "agentgateway.outbound.kind": "Primary" },
        implementationAttributes: ["agentgateway.outbound.kind"],
      }),
    );
  });

  it("labels spans in observed start order without retaining timestamps", () => {
    const report = inspectOtlpSpans([
      span({
        spanId: "later",
        startTimeUnixNano: "200",
        name: "provider fallback",
      }),
      span({
        spanId: "earlier",
        startTimeUnixNano: "100",
        name: "provider primary",
      }),
    ]);
    expect(
      report.traces[0]?.spans.map(({ span, name }) => ({ span, name })),
    ).toEqual([
      { span: "span-1", name: "provider primary" },
      { span: "span-2", name: "provider fallback" },
    ]);
    expect(JSON.stringify(report)).not.toContain("startTimeUnixNano");
  });
});

function span(overrides: Partial<OtlpSpan>): OtlpSpan {
  return {
    traceId: "trace",
    spanId: "span",
    parentSpanId: null,
    startTimeUnixNano: null,
    name: "span",
    kind: 0,
    statusCode: 0,
    attributes: {},
    ...overrides,
  };
}
