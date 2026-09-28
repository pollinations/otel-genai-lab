import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { CanonicalTraceFixture } from "../src/telemetry.js";
import { validateCanonicalTrace } from "../src/validator.js";
import { loadScenarioFixtures } from "./scenarios.js";

const traceDirectory = fileURLToPath(
  new URL("../fixtures/traces/v0.1/", import.meta.url),
);
let issueCount = 0;

for (const scenario of loadScenarioFixtures()) {
  const filename = `${scenario.id}.json`;
  const trace = JSON.parse(
    fs.readFileSync(path.join(traceDirectory, filename), "utf8"),
  ) as CanonicalTraceFixture;
  const issues = validateCanonicalTrace(trace, scenario);

  for (const { code, spanId, field, message } of issues) {
    console.error(`${filename}: [${code}] ${spanId}.${field}: ${message}`);
  }
  issueCount += issues.length;
}

if (issueCount > 0) {
  throw new Error(
    `canonical trace validation failed with ${issueCount} issue(s)`,
  );
}

console.log("validated all canonical trace fixtures");
