import {
  executeGatewayRequest,
  ScriptedProvider,
  type GatewayResult,
  type ProviderOutcome,
  type Usage,
} from "./gateway.js";

export interface ScenarioFixture {
  schemaVersion: "0.1.0";
  id: string;
  summary: string;
  request: { requestedModel: string };
  candidates: Array<{
    provider: string;
    resolvedModel: string;
    outcome: ProviderOutcome;
  }>;
  expected: {
    result: "success" | "failure";
    logicalOperations: 1;
    generations: 1;
    providerAttempts: number;
    attemptOrder: string[];
    usageObservations: number;
    authoritativeUsage?: Usage;
    errorType?: string;
  };
}

export function executeScenarioFixture(
  fixture: ScenarioFixture,
): GatewayResult {
  const candidates = fixture.candidates.map((candidate) => ({
    provider: new ScriptedProvider(candidate.provider, [candidate.outcome]),
    resolvedModel: candidate.resolvedModel,
  }));

  return executeGatewayRequest(fixture.request, candidates);
}
