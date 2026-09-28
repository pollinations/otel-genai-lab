import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";

import { loadExtendedScenarioFixtures } from "./extended-scenarios.js";
import { loadScenarioFixtures } from "./scenarios.js";
import { recordExtendedScenario } from "../src/extended-telemetry.js";
import {
  createTracerProvider,
  GEN_AI_SCHEMA_URL,
  recordScenario,
} from "../src/telemetry.js";

const exporter = new OTLPTraceExporter({
  url:
    process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT ??
    "http://localhost:4318/v1/traces",
});
const provider = createTracerProvider(exporter);
const synchronousTracer = provider.getTracer("otel-genai-lab", "0.1.0", {
  schemaUrl: GEN_AI_SCHEMA_URL,
});
const extendedTracer = provider.getTracer("otel-genai-lab", "0.2.0", {
  schemaUrl: GEN_AI_SCHEMA_URL,
});

for (const fixture of loadScenarioFixtures()) {
  recordScenario(fixture, synchronousTracer, Date.now());
}
for (const fixture of loadExtendedScenarioFixtures()) {
  recordExtendedScenario(fixture, extendedTracer, Date.now() - 1_000);
}

await provider.forceFlush();
await provider.shutdown();
console.log("exported all scenario traces through OTLP/HTTP");
