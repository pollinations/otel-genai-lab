import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadExtendedScenarioFixtures } from "./extended-scenarios.js";
import { captureExtendedCanonicalTrace } from "../src/extended-telemetry.js";

const checkOnly = process.argv.includes("--check");
const directory = fileURLToPath(
  new URL("../fixtures/traces/v0.2/", import.meta.url),
);
if (!checkOnly) fs.mkdirSync(directory, { recursive: true });

for (const fixture of loadExtendedScenarioFixtures()) {
  const destination = path.join(directory, `${fixture.id}.json`);
  const serialized = `${JSON.stringify(await captureExtendedCanonicalTrace(fixture), null, 2)}\n`;
  if (checkOnly) {
    if (
      !fs.existsSync(destination) ||
      fs.readFileSync(destination, "utf8") !== serialized
    ) {
      throw new Error(
        `Extended trace fixture drifted: ${path.basename(destination)}. Run npm run traces:generate.`,
      );
    }
  } else {
    fs.writeFileSync(destination, serialized);
    console.log(`wrote ${path.relative(process.cwd(), destination)}`);
  }
}
