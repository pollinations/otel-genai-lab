export interface Usage {
  inputTokens: number;
  outputTokens: number;
}

export interface SuccessOutcome {
  type: "success";
  durationMs: number;
  usage: Usage;
}

export interface FailureOutcome {
  type: "failure";
  durationMs: number;
  errorType: string;
  retryable: boolean;
}

export type ProviderOutcome = SuccessOutcome | FailureOutcome;

export interface ProviderAttempt {
  index: number;
  provider: string;
  resolvedModel: string;
  outcome: ProviderOutcome;
}

export interface GatewayRequest {
  requestedModel: string;
}

export interface ProviderCandidate {
  provider: ScriptedProvider;
  resolvedModel: string;
}

export type GatewayResult =
  | {
      type: "success";
      requestedModel: string;
      attempts: ProviderAttempt[];
      usage: Usage;
    }
  | {
      type: "failure";
      requestedModel: string;
      attempts: ProviderAttempt[];
      errorType: string;
    };

export class ScriptedProvider {
  readonly #outcomes: ProviderOutcome[];
  #calls = 0;

  constructor(
    readonly name: string,
    outcomes: readonly ProviderOutcome[],
  ) {
    if (outcomes.length === 0) {
      throw new Error(`Provider ${name} needs at least one scripted outcome`);
    }

    this.#outcomes = [...outcomes];
  }

  get calls(): number {
    return this.#calls;
  }

  generate(): ProviderOutcome {
    const outcome = this.#outcomes[this.#calls];

    if (outcome === undefined) {
      throw new Error(
        `Provider ${this.name} has no outcome for call ${this.#calls + 1}`,
      );
    }

    this.#calls += 1;
    return structuredClone(outcome);
  }
}

export function executeGatewayRequest(
  request: GatewayRequest,
  candidates: readonly ProviderCandidate[],
): GatewayResult {
  if (candidates.length === 0) {
    throw new Error("A gateway request needs at least one provider candidate");
  }

  const attempts: ProviderAttempt[] = [];

  for (const candidate of candidates) {
    const outcome = candidate.provider.generate();
    attempts.push({
      index: attempts.length + 1,
      provider: candidate.provider.name,
      resolvedModel: candidate.resolvedModel,
      outcome,
    });

    if (outcome.type === "success") {
      return {
        type: "success",
        requestedModel: request.requestedModel,
        attempts,
        usage: outcome.usage,
      };
    }

    if (!outcome.retryable) {
      return {
        type: "failure",
        requestedModel: request.requestedModel,
        attempts,
        errorType: outcome.errorType,
      };
    }
  }

  const finalOutcome = attempts.at(-1)?.outcome;
  if (finalOutcome?.type !== "failure") {
    throw new Error("Gateway exhausted candidates without a failure outcome");
  }

  return {
    type: "failure",
    requestedModel: request.requestedModel,
    attempts,
    errorType: finalOutcome.errorType,
  };
}
