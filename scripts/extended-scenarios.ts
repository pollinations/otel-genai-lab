import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Ajv2020 } from "ajv/dist/2020.js";

import type { ExtendedScenarioFixture } from "../src/extended-scenario.js";

export const extendedScenarioDirectory = fileURLToPath(
  new URL("../fixtures/scenarios/v0.2/", import.meta.url),
);

const schema = JSON.parse(
  fs.readFileSync(path.join(extendedScenarioDirectory, "schema.json"), "utf8"),
) as object;
const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema);

export function loadExtendedScenarioFixtures(): ExtendedScenarioFixture[] {
  return fs
    .readdirSync(extendedScenarioDirectory)
    .filter(
      (filename) => filename.endsWith(".json") && filename !== "schema.json",
    )
    .sort()
    .map((filename) => {
      const value: unknown = JSON.parse(
        fs.readFileSync(path.join(extendedScenarioDirectory, filename), "utf8"),
      );
      if (!validate(value)) {
        throw new Error(
          `${filename} does not match the extended scenario schema:\n${JSON.stringify(validate.errors, null, 2)}`,
        );
      }
      return value as ExtendedScenarioFixture;
    });
}
