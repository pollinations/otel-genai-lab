import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { loadScenarioFixtures } from "../scripts/scenarios.js";
import type { CanonicalTraceFixture } from "../src/telemetry.js";
import {
  validateCanonicalTrace,
  type ValidationCode,
} from "../src/validator.js";

const traceDirectory = fileURLToPath(
  new URL("../fixtures/traces/v0.1/", import.meta.url),
);
const invalidDirectory = fileURLToPath(
  new URL("../fixtures/traces/invalid/v0.1/", import.meta.url),
);
const scenarios = loadScenarioFixtures();

describe("canonical trace validator", () => {
  for (const scenario of scenarios) {
    it(`accepts ${scenario.id}`, () => {
      const trace = readTrace(path.join(traceDirectory, `${scenario.id}.json`));
      expect(validateCanonicalTrace(trace, scenario)).toEqual([]);
    });
  }

  const fallbackScenario = scenarios.find(
    ({ id }) => id === "s2-fallback-success",
  )!;
  const negativeCases: Array<{
    filename: string;
    code: ValidationCode;
    spanId: string;
    field: string;
  }> = [
    {
      filename: "relationship.json",
      code: "trace_relationship",
      spanId: "attempt-1",
      field: "parent",
    },
    {
      filename: "count.json",
      code: "span_count",
      spanId: "(trace)",
      field: "spans",
    },
    {
      filename: "usage.json",
      code: "usage_attribution",
      spanId: "attempt-1",
      field: "attributes.gen_ai.usage",
    },
    {
      filename: "privacy.json",
      code: "privacy",
      spanId: "gateway",
      field: "attributes.http.request.header.authorization",
    },
    {
      filename: "attribute-safety.json",
      code: "attribute_safety",
      spanId: "gateway",
      field: "attributes.gateway.correlation.id",
    },
    {
      filename: "metadata.json",
      code: "metadata",
      spanId: "(trace)",
      field: "semanticConventionSchemaUrl",
    },
    {
      filename: "experimental-attribute.json",
      code: "experimental_attribute",
      spanId: "gateway",
      field: "attributes.gen_ai.gateway.route",
    },
  ];

  for (const negative of negativeCases) {
    it(`identifies the field responsible in ${negative.filename}`, () => {
      const trace = readTrace(path.join(invalidDirectory, negative.filename));
      expect(validateCanonicalTrace(trace, fallbackScenario)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: negative.code,
            spanId: negative.spanId,
            field: negative.field,
          }),
        ]),
      );
    });
  }
});

function readTrace(filename: string): CanonicalTraceFixture {
  return JSON.parse(fs.readFileSync(filename, "utf8")) as CanonicalTraceFixture;
}
