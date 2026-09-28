import { describe, expect, it } from "vitest";

import {
  executeGatewayRequest,
  ScriptedProvider,
  type FailureOutcome,
  type SuccessOutcome,
} from "../src/gateway.js";

const success: SuccessOutcome = {
  type: "success",
  durationMs: 40,
  usage: { inputTokens: 10, outputTokens: 4 },
};

const retryableFailure: FailureOutcome = {
  type: "failure",
  durationMs: 20,
  errorType: "upstream_unavailable",
  retryable: true,
};

describe("executeGatewayRequest", () => {
  it("returns after one successful provider attempt", () => {
    const alpha = new ScriptedProvider("alpha", [success]);

    const result = executeGatewayRequest({ requestedModel: "model-a" }, [
      { provider: alpha, resolvedModel: "alpha/model-a" },
    ]);

    expect(result).toMatchObject({
      type: "success",
      attempts: [{ index: 1, provider: "alpha" }],
      usage: { inputTokens: 10, outputTokens: 4 },
    });
    expect(alpha.calls).toBe(1);
  });

  it("records ordered attempts and succeeds through fallback", () => {
    const alpha = new ScriptedProvider("alpha", [retryableFailure]);
    const beta = new ScriptedProvider("beta", [success]);

    const result = executeGatewayRequest({ requestedModel: "model-a" }, [
      { provider: alpha, resolvedModel: "alpha/model-a" },
      { provider: beta, resolvedModel: "beta/model-b" },
    ]);

    expect(result.type).toBe("success");
    expect(result.attempts.map(({ provider }) => provider)).toEqual([
      "alpha",
      "beta",
    ]);
    expect(result.attempts[0]?.outcome).not.toHaveProperty("usage");
    expect(alpha.calls).toBe(1);
    expect(beta.calls).toBe(1);
  });

  it("returns the final error after exhausting retryable candidates", () => {
    const alpha = new ScriptedProvider("alpha", [retryableFailure]);
    const beta = new ScriptedProvider("beta", [
      { ...retryableFailure, errorType: "upstream_timeout" },
    ]);

    const result = executeGatewayRequest({ requestedModel: "model-a" }, [
      { provider: alpha, resolvedModel: "alpha/model-a" },
      { provider: beta, resolvedModel: "beta/model-b" },
    ]);

    expect(result).toMatchObject({
      type: "failure",
      errorType: "upstream_timeout",
      attempts: [{ index: 1 }, { index: 2 }],
    });
  });

  it("does not fall back after a terminal provider error", () => {
    const alpha = new ScriptedProvider("alpha", [
      { ...retryableFailure, errorType: "content_policy", retryable: false },
    ]);
    const beta = new ScriptedProvider("beta", [success]);

    const result = executeGatewayRequest({ requestedModel: "model-a" }, [
      { provider: alpha, resolvedModel: "alpha/model-a" },
      { provider: beta, resolvedModel: "beta/model-b" },
    ]);

    expect(result).toMatchObject({
      type: "failure",
      errorType: "content_policy",
      attempts: [{ index: 1 }],
    });
    expect(beta.calls).toBe(0);
  });
});
