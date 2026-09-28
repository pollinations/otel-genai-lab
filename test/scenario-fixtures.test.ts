import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";

import {
  executeGatewayRequest,
  ScriptedProvider,
  type ProviderOutcome,
  type Usage,
} from "../src/gateway.js";

interface ScenarioFixture {
  schemaVersion: "0.1.0";
  id: string;
  summary: string;
  request: { requestedModel: string };
  candidates: Array<{
    provider: string;
    resolvedModel: string;
    outcome: ProviderOutcome;
  }>;
  expected: {
    result: "success" | "failure";
    logicalOperations: 1;
    generations: 1;
    providerAttempts: number;
    attemptOrder: string[];
    usageObservations: number;
    authoritativeUsage?: Usage;
    errorType?: string;
  };
}

const fixtureDirectory = fileURLToPath(
  new URL("../fixtures/scenarios/v0.1/", import.meta.url),
);
const schema = JSON.parse(
  fs.readFileSync(path.join(fixtureDirectory, "schema.json"), "utf8"),
) as object;
const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema);

const fixtureFiles = fs
  .readdirSync(fixtureDirectory)
  .filter(
    (filename) => filename.endsWith(".json") && filename !== "schema.json",
  )
  .sort();

describe("synchronous scenario fixtures", () => {
  it("has exactly the three shared v0.1 scenarios", () => {
    expect(fixtureFiles).toEqual([
      "s1-direct-success.json",
      "s2-fallback-success.json",
      "s3-terminal-failure.json",
    ]);
  });

  it("rejects content fields with an actionable schema path", () => {
    const invalid = {
      ...JSON.parse(
        fs.readFileSync(path.join(fixtureDirectory, fixtureFiles[0]!), "utf8"),
      ),
      request: { requestedModel: "model-a", prompt: "must not be accepted" },
    };

    expect(validate(invalid)).toBe(false);
    expect(validate.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          instancePath: "/request",
          keyword: "additionalProperties",
        }),
      ]),
    );
  });

  for (const filename of fixtureFiles) {
    it(`validates and executes ${filename}`, () => {
      const value: unknown = JSON.parse(
        fs.readFileSync(path.join(fixtureDirectory, filename), "utf8"),
      );

      expect(validate(value), JSON.stringify(validate.errors, null, 2)).toBe(
        true,
      );
      const fixture = value as ScenarioFixture;

      const candidates = fixture.candidates.map((candidate) => ({
        provider: new ScriptedProvider(candidate.provider, [candidate.outcome]),
        resolvedModel: candidate.resolvedModel,
      }));
      const result = executeGatewayRequest(fixture.request, candidates);

      expect(result.type).toBe(fixture.expected.result);
      expect(result.attempts).toHaveLength(fixture.expected.providerAttempts);
      expect(result.attempts.map(({ provider }) => provider)).toEqual(
        fixture.expected.attemptOrder,
      );

      if (result.type === "success") {
        expect(result.usage).toEqual(fixture.expected.authoritativeUsage);
        expect(fixture.expected.usageObservations).toBe(1);
      } else {
        expect(result.errorType).toBe(fixture.expected.errorType);
        expect(fixture.expected.usageObservations).toBe(0);
        expect(
          result.attempts.every(({ outcome }) => !("usage" in outcome)),
        ).toBe(true);
      }
    });
  }
});
