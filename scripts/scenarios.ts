import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Ajv2020 } from "ajv/dist/2020.js";

import type { ScenarioFixture } from "../src/scenario.js";

export const scenarioDirectory = fileURLToPath(
  new URL("../fixtures/scenarios/v0.1/", import.meta.url),
);

const schema = JSON.parse(
  fs.readFileSync(path.join(scenarioDirectory, "schema.json"), "utf8"),
) as object;
const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema);

export function loadScenarioFixtures(): ScenarioFixture[] {
  return fs
    .readdirSync(scenarioDirectory)
    .filter(
      (filename) => filename.endsWith(".json") && filename !== "schema.json",
    )
    .sort()
    .map((filename) => {
      const value: unknown = JSON.parse(
        fs.readFileSync(path.join(scenarioDirectory, filename), "utf8"),
      );
      if (!validate(value)) {
        throw new Error(
          `${filename} does not match the scenario schema:\n${JSON.stringify(validate.errors, null, 2)}`,
        );
      }
      return value as ScenarioFixture;
    });
}
