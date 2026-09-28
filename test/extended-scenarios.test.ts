import { describe, expect, it } from "vitest";

import { loadExtendedScenarioFixtures } from "../scripts/extended-scenarios.js";
import { captureExtendedCanonicalTrace } from "../src/extended-telemetry.js";
import { validateExtendedCanonicalTrace } from "../src/extended-validator.js";

const fixtures = loadExtendedScenarioFixtures();

describe("cache, deduplication, and detached execution", () => {
  it("contains the three v0.2 scenarios", () => {
    expect(fixtures.map(({ id }) => id)).toEqual([
      "s4-cache-hit",
      "s5-concurrent-deduplication",
      "s6-detached-completion",
    ]);
  });

  for (const fixture of fixtures) {
    it(`captures and validates ${fixture.id}`, async () => {
      const trace = await captureExtendedCanonicalTrace(fixture);
      expect(validateExtendedCanonicalTrace(trace, fixture)).toEqual([]);
      expect(trace.metricAccountingGuarantee).toBe("not_asserted");

      const observations = trace.spans.filter(({ id }) =>
        id.startsWith("observation-"),
      );
      const usageOwners = trace.spans.filter(
        ({ attributes }) =>
          attributes["gen_ai.usage.input_tokens"] !== undefined,
      );
      expect(observations).toHaveLength(fixture.expected.resultObservations);
      expect(usageOwners).toHaveLength(fixture.expected.usageOwners);
      expect(
        observations.every(
          ({ attributes }) =>
            attributes["gen_ai.usage.input_tokens"] === undefined,
        ),
      ).toBe(true);
    });
  }

  it("uses a link for the joining caller in the deduplicated scenario", async () => {
    const fixture = fixtures.find(
      ({ mode }) => mode === "concurrent_deduplication",
    )!;
    const trace = await captureExtendedCanonicalTrace(fixture);
    expect(trace.spans.find(({ id }) => id === "observation-2")?.links).toEqual(
      ["generation"],
    );
  });

  it("keeps detached roots in separate traces with durable correlation", async () => {
    const fixture = fixtures.find(({ mode }) => mode === "detached_execution")!;
    const trace = await captureExtendedCanonicalTrace(fixture);
    const roots = trace.spans.filter(
      ({ id }) => id.startsWith("observation-") || id === "generation",
    );

    expect(new Set(roots.map(({ trace: traceId }) => traceId)).size).toBe(3);
    expect(
      roots.every(({ parent, links }) => parent === null && links.length === 0),
    ).toBe(true);
    expect(
      new Set(
        roots.map(
          ({ attributes }) => attributes["otel_genai_lab.correlation.id"],
        ),
      ),
    ).toEqual(new Set(["corr-detached-1"]));
  });

  it("rejects usage copied onto a repeated result observation", async () => {
    const fixture = fixtures.find(
      ({ mode }) => mode === "concurrent_deduplication",
    )!;
    const trace = await captureExtendedCanonicalTrace(fixture);
    const repeatedObservation = trace.spans.find(
      ({ id }) => id === "observation-2",
    )!;
    repeatedObservation.attributes["gen_ai.usage.input_tokens"] = 10;
    repeatedObservation.attributes["gen_ai.usage.output_tokens"] = 4;

    expect(validateExtendedCanonicalTrace(trace, fixture)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "usage_attribution",
          spanId: "observation-2",
          field: "attributes.gen_ai.usage",
        }),
      ]),
    );
  });
});
