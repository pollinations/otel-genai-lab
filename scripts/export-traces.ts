import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";

import {
  createTracerProvider,
  GEN_AI_SCHEMA_URL,
  recordScenario,
} from "../src/telemetry.js";
import { loadScenarioFixtures } from "./scenarios.js";

const exporter = new OTLPTraceExporter({
  url:
    process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT ??
    "http://localhost:4318/v1/traces",
});
const provider = createTracerProvider(exporter);
const tracer = provider.getTracer("otel-genai-lab", "0.1.0", {
  schemaUrl: GEN_AI_SCHEMA_URL,
});

for (const fixture of loadScenarioFixtures()) {
  recordScenario(fixture, tracer, Date.now());
}

await provider.forceFlush();
await provider.shutdown();
console.log("exported all scenario traces through OTLP/HTTP");
