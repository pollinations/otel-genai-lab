import type { Usage } from "./gateway.js";

export type ExtendedScenarioMode =
  "cache_hit" | "concurrent_deduplication" | "detached_execution";

export interface Observation {
  id: string;
  role: "request" | "result";
  outcome: "cache_hit" | "generated_result" | "scheduled";
  startOffsetMs: number;
  durationMs: number;
}

export interface Generation {
  execution: "shared" | "detached";
  startOffsetMs: number;
  durationMs: number;
  correlationId?: string;
  provider: string;
  resolvedModel: string;
  usage: Usage;
}

export interface ExtendedScenarioFixture {
  schemaVersion: "0.2.0";
  id: string;
  summary: string;
  mode: ExtendedScenarioMode;
  request: { requestedModel: string };
  observations: Observation[];
  generation?: Generation;
  expected: {
    logicalOperations: number;
    generations: number;
    providerAttempts: number;
    resultObservations: number;
    usageOwners: number;
    continuity: "none" | "trace_links" | "durable_correlation";
    metricAccountingGuarantee: "not_asserted";
  };
}
