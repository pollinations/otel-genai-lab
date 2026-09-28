import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { captureCanonicalTrace } from "../src/telemetry.js";
import { loadScenarioFixtures } from "./scenarios.js";

const checkOnly = process.argv.includes("--check");
const traceDirectory = fileURLToPath(
  new URL("../fixtures/traces/v0.1/", import.meta.url),
);
const fixtures = loadScenarioFixtures();
const expectedFiles = new Set(fixtures.map(({ id }) => `${id}.json`));

if (!checkOnly) fs.mkdirSync(traceDirectory, { recursive: true });

for (const fixture of fixtures) {
  const trace = await captureCanonicalTrace(fixture);
  const filename = `${fixture.id}.json`;
  const destination = path.join(traceDirectory, filename);
  const serialized = `${JSON.stringify(trace, null, 2)}\n`;

  if (checkOnly) {
    if (!fs.existsSync(destination)) {
      throw new Error(`Missing canonical trace fixture: ${filename}`);
    }
    if (fs.readFileSync(destination, "utf8") !== serialized) {
      throw new Error(
        `Canonical trace fixture drifted: ${filename}. Run npm run traces:generate.`,
      );
    }
  } else {
    fs.writeFileSync(destination, serialized);
    console.log(`wrote ${path.relative(process.cwd(), destination)}`);
  }
}

if (fs.existsSync(traceDirectory)) {
  const unexpected = fs
    .readdirSync(traceDirectory)
    .filter((filename) => filename.endsWith(".json"))
    .filter((filename) => !expectedFiles.has(filename));
  if (unexpected.length > 0) {
    throw new Error(
      `Unexpected canonical trace fixtures: ${unexpected.join(", ")}`,
    );
  }
}
