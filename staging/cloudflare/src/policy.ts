export type StagingScenario = "direct" | "fallback" | "detached";

export interface ProviderStep {
  provider: "alpha" | "beta";
  resolvedModel: "alpha/model-a" | "beta/model-b";
  outcome: "success" | "failure";
}

export const SUCCESS_USAGE = {
  inputTokens: 10,
  outputTokens: 4,
} as const;

export function scenarioFromPath(pathname: string): StagingScenario | null {
  const value = pathname.match(/^\/scenario\/(direct|fallback|detached)$/)?.[1];
  return value === "direct" || value === "fallback" || value === "detached"
    ? value
    : null;
}

export function providerPlan(
  scenario: Exclude<StagingScenario, "detached"> | "detached-generation",
): ProviderStep[] {
  if (scenario === "fallback") {
    return [
      {
        provider: "alpha",
        resolvedModel: "alpha/model-a",
        outcome: "failure",
      },
      {
        provider: "beta",
        resolvedModel: "beta/model-b",
        outcome: "success",
      },
    ];
  }

  return [
    {
      provider: "alpha",
      resolvedModel: "alpha/model-a",
      outcome: "success",
    },
  ];
}

export function attemptAttributes(
  step: ProviderStep,
  index: number,
): Record<string, string | number | boolean> {
  return {
    "gen_ai.operation.name": "chat",
    "gen_ai.provider.name": step.provider,
    "gen_ai.request.model": step.resolvedModel,
    "otel_genai_lab.attempt.index": index,
    "otel_genai_lab.attempt.outcome": step.outcome,
  };
}

export function successAttributes(
  step: ProviderStep,
): Record<string, string | number> {
  return {
    "gen_ai.response.model": step.resolvedModel,
    "gen_ai.usage.input_tokens": SUCCESS_USAGE.inputTokens,
    "gen_ai.usage.output_tokens": SUCCESS_USAGE.outputTokens,
  };
}
