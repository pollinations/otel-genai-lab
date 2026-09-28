import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadExtendedScenarioFixtures } from "./extended-scenarios.js";
import { loadScenarioFixtures } from "./scenarios.js";
import type { ExtendedCanonicalTraceFixture } from "../src/extended-telemetry.js";
import { validateExtendedCanonicalTrace } from "../src/extended-validator.js";
import type { CanonicalTraceFixture } from "../src/telemetry.js";
import {
  validateCanonicalTrace,
  type ValidationIssue,
} from "../src/validator.js";

const traceRoot = fileURLToPath(
  new URL("../fixtures/traces/", import.meta.url),
);
let issueCount = 0;

for (const scenario of loadScenarioFixtures()) {
  const filename = `${scenario.id}.json`;
  const trace = readTrace<CanonicalTraceFixture>("v0.1", filename);
  report(filename, validateCanonicalTrace(trace, scenario));
}

for (const scenario of loadExtendedScenarioFixtures()) {
  const filename = `${scenario.id}.json`;
  const trace = readTrace<ExtendedCanonicalTraceFixture>("v0.2", filename);
  report(filename, validateExtendedCanonicalTrace(trace, scenario));
}

if (issueCount > 0) {
  throw new Error(
    `canonical trace validation failed with ${issueCount} issue(s)`,
  );
}

console.log("validated all canonical trace fixtures");

function readTrace<T>(version: string, filename: string): T {
  return JSON.parse(
    fs.readFileSync(path.join(traceRoot, version, filename), "utf8"),
  ) as T;
}

function report(filename: string, issues: ValidationIssue[]): void {
  for (const { code, spanId, field, message } of issues) {
    console.error(`${filename}: [${code}] ${spanId}.${field}: ${message}`);
  }
  issueCount += issues.length;
}
