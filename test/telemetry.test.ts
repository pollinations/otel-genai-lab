import { describe, expect, it } from "vitest";

import { loadScenarioFixtures } from "../scripts/scenarios.js";
import type { ScenarioFixture } from "../src/scenario.js";
import { captureCanonicalTrace } from "../src/telemetry.js";

const fixtures = loadScenarioFixtures();

describe("experimental gateway telemetry mapping", () => {
  for (const fixture of fixtures) {
    it(`captures ${fixture.id} as one logical operation with actual attempts`, async () => {
      const trace = await captureCanonicalTrace(fixture);
      const [gateway, ...attempts] = trace.spans;

      expect(trace.sourceScenario).toBe(fixture.id);
      expect(trace.mappingStatus).toBe("experimental");
      expect(gateway).toMatchObject({
        id: "gateway",
        parent: null,
        kind: "SERVER",
        startOffsetMs: 0,
      });
      expect(attempts).toHaveLength(fixture.expected.providerAttempts);
      expect(attempts.map(({ parent }) => parent)).toEqual(
        Array(fixture.expected.providerAttempts).fill("gateway"),
      );
      expect(
        attempts.map(({ attributes }) => attributes["gen_ai.provider.name"]),
      ).toEqual(fixture.expected.attemptOrder);
      expect(
        attempts.filter(
          ({ attributes }) =>
            attributes["gen_ai.usage.input_tokens"] !== undefined,
        ),
      ).toHaveLength(fixture.expected.usageObservations);
      const attributeNames = trace.spans.flatMap(({ attributes }) =>
        Object.keys(attributes),
      );
      expect(attributeNames).not.toEqual(
        expect.arrayContaining([
          "gen_ai.input.messages",
          "gen_ai.output.messages",
          "gen_ai.prompt",
          "gen_ai.completion",
        ]),
      );

      assertFailureStatus(fixture, gateway!, attempts);
    });
  }
});

function assertFailureStatus(
  fixture: ScenarioFixture,
  gateway: Awaited<ReturnType<typeof captureCanonicalTrace>>["spans"][number],
  attempts: Awaited<ReturnType<typeof captureCanonicalTrace>>["spans"],
): void {
  const failedAttempts = attempts.filter(
    ({ attributes }) => attributes["error.type"] !== undefined,
  );
  const expectedFailures = fixture.candidates.filter(
    ({ outcome }) => outcome.type === "failure",
  );

  expect(failedAttempts).toHaveLength(expectedFailures.length);
  expect(gateway.status).toBe(
    fixture.expected.result === "failure" ? "ERROR" : "UNSET",
  );
  expect(gateway.attributes["error.type"]).toBe(fixture.expected.errorType);
}
