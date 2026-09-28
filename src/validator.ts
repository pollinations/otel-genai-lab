import type { AttributeValue } from "@opentelemetry/api";

import type { ScenarioFixture } from "./scenario.js";
import {
  GEN_AI_SCHEMA_URL,
  TRACE_FIXTURE_VERSION,
  type CanonicalSpan,
  type CanonicalTraceFixture,
} from "./telemetry.js";

export type ValidationCode =
  | "attribute_safety"
  | "experimental_attribute"
  | "metadata"
  | "privacy"
  | "span_count"
  | "trace_relationship"
  | "usage_attribution";

export interface ValidationIssue {
  code: ValidationCode;
  spanId: string;
  field: string;
  message: string;
}

const TRACE_ID = "(trace)";
const MAX_ATTRIBUTE_NAME_LENGTH = 128;
const MAX_STRING_VALUE_LENGTH = 256;
const MAX_ARRAY_VALUE_LENGTH = 16;

const allowedGenAiAttributes = new Set([
  "gen_ai.operation.name",
  "gen_ai.provider.name",
  "gen_ai.request.model",
  "gen_ai.response.model",
  "gen_ai.usage.input_tokens",
  "gen_ai.usage.output_tokens",
]);

const forbiddenAttributeName =
  /authorization|credential|api[._-]?key|gen_ai\.(?:input|output)\.messages|gen_ai\.prompt|gen_ai\.completion|url\.query/i;

export function validateCanonicalTrace(
  trace: CanonicalTraceFixture,
  scenario: ScenarioFixture,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const add = (
    code: ValidationCode,
    spanId: string,
    field: string,
    message: string,
  ): void => {
    issues.push({ code, spanId, field, message });
  };

  validateMetadata(trace, scenario, add);
  validateSpanIdentities(trace.spans, add);

  const gateways = trace.spans.filter(({ kind }) => kind === "SERVER");
  if (gateways.length !== scenario.expected.logicalOperations) {
    add(
      "span_count",
      TRACE_ID,
      "spans",
      `expected ${scenario.expected.logicalOperations} logical-operation span, found ${gateways.length}`,
    );
  }
  const attempts = trace.spans.filter(({ kind }) => kind === "CLIENT");
  if (attempts.length !== scenario.expected.providerAttempts) {
    add(
      "span_count",
      TRACE_ID,
      "spans",
      `expected ${scenario.expected.providerAttempts} provider-attempt spans, found ${attempts.length}`,
    );
  }

  const gateway = gateways[0];
  if (gateway !== undefined) {
    validateGateway(gateway, scenario, attempts, add);
    validateAttempts(attempts, gateway, scenario, add);
  }

  for (const span of trace.spans) validateAttributes(span, add);
  validateUsage(attempts, scenario, add);

  return issues;
}

export function assertValidCanonicalTrace(
  trace: CanonicalTraceFixture,
  scenario: ScenarioFixture,
): void {
  const issues = validateCanonicalTrace(trace, scenario);
  if (issues.length === 0) return;

  throw new Error(
    issues
      .map(
        ({ code, spanId, field, message }) =>
          `[${code}] ${spanId}.${field}: ${message}`,
      )
      .join("\n"),
  );
}

function validateMetadata(
  trace: CanonicalTraceFixture,
  scenario: ScenarioFixture,
  add: AddIssue,
): void {
  if (trace.fixtureVersion !== TRACE_FIXTURE_VERSION) {
    add(
      "metadata",
      TRACE_ID,
      "fixtureVersion",
      `expected ${TRACE_FIXTURE_VERSION}, found ${String(trace.fixtureVersion)}`,
    );
  }
  if (trace.sourceScenario !== scenario.id) {
    add(
      "metadata",
      TRACE_ID,
      "sourceScenario",
      `expected ${scenario.id}, found ${trace.sourceScenario}`,
    );
  }
  if (trace.semanticConventionSchemaUrl !== GEN_AI_SCHEMA_URL) {
    add(
      "metadata",
      TRACE_ID,
      "semanticConventionSchemaUrl",
      `expected ${GEN_AI_SCHEMA_URL}, found ${String(trace.semanticConventionSchemaUrl)}`,
    );
  }
  if (trace.mappingStatus !== "experimental") {
    add(
      "metadata",
      TRACE_ID,
      "mappingStatus",
      `expected experimental, found ${String(trace.mappingStatus)}`,
    );
  }
}

function validateSpanIdentities(
  spans: readonly CanonicalSpan[],
  add: AddIssue,
): void {
  const seen = new Set<string>();
  for (const span of spans) {
    if (seen.has(span.id)) {
      add(
        "trace_relationship",
        span.id,
        "id",
        `duplicate normalized span identifier ${span.id}`,
      );
    }
    seen.add(span.id);
  }
}

function validateGateway(
  gateway: CanonicalSpan,
  scenario: ScenarioFixture,
  attempts: readonly CanonicalSpan[],
  add: AddIssue,
): void {
  if (gateway.id !== "gateway") {
    add(
      "trace_relationship",
      gateway.id,
      "id",
      "logical-operation span must use the normalized id gateway",
    );
  }
  if (gateway.parent !== null) {
    add(
      "trace_relationship",
      gateway.id,
      "parent",
      "logical-operation span must be a root span",
    );
  }
  if (gateway.startOffsetMs !== 0) {
    add(
      "trace_relationship",
      gateway.id,
      "startOffsetMs",
      "logical-operation span must start at offset zero",
    );
  }
  const attemptDuration = attempts.reduce(
    (total, span) => total + span.durationMs,
    0,
  );
  if (gateway.durationMs !== attemptDuration) {
    add(
      "trace_relationship",
      gateway.id,
      "durationMs",
      `expected the sum of attempt durations (${attemptDuration}), found ${gateway.durationMs}`,
    );
  }
  const expectedStatus =
    scenario.expected.result === "failure" ? "ERROR" : "UNSET";
  if (gateway.status !== expectedStatus) {
    add(
      "trace_relationship",
      gateway.id,
      "status",
      `expected ${expectedStatus}, found ${gateway.status}`,
    );
  }
  const gatewayError = gateway.attributes["error.type"];
  if (gatewayError !== scenario.expected.errorType) {
    add(
      "trace_relationship",
      gateway.id,
      "attributes.error.type",
      `expected ${String(scenario.expected.errorType)}, found ${String(gatewayError)}`,
    );
  }
}

function validateAttempts(
  attempts: readonly CanonicalSpan[],
  gateway: CanonicalSpan,
  scenario: ScenarioFixture,
  add: AddIssue,
): void {
  let expectedOffset = 0;
  for (const [index, span] of attempts.entries()) {
    const expectedId = `attempt-${index + 1}`;
    if (span.id !== expectedId) {
      add(
        "trace_relationship",
        span.id,
        "id",
        `expected ordered normalized id ${expectedId}`,
      );
    }
    if (span.parent !== gateway.id) {
      add(
        "trace_relationship",
        span.id,
        "parent",
        `expected parent ${gateway.id}, found ${String(span.parent)}`,
      );
    }
    if (span.startOffsetMs !== expectedOffset) {
      add(
        "trace_relationship",
        span.id,
        "startOffsetMs",
        `expected sequential offset ${expectedOffset}, found ${span.startOffsetMs}`,
      );
    }
    expectedOffset += span.durationMs;

    const expectedProvider = scenario.expected.attemptOrder[index];
    const provider = span.attributes["gen_ai.provider.name"];
    if (expectedProvider !== undefined && provider !== expectedProvider) {
      add(
        "trace_relationship",
        span.id,
        "attributes.gen_ai.provider.name",
        `expected ${expectedProvider}, found ${String(provider)}`,
      );
    }

    const candidate = scenario.candidates[index];
    if (candidate === undefined) continue;
    const expectedAttemptStatus =
      candidate.outcome.type === "failure" ? "ERROR" : "UNSET";
    if (span.status !== expectedAttemptStatus) {
      add(
        "trace_relationship",
        span.id,
        "status",
        `expected ${expectedAttemptStatus}, found ${span.status}`,
      );
    }
    if (span.durationMs !== candidate.outcome.durationMs) {
      add(
        "trace_relationship",
        span.id,
        "durationMs",
        `expected ${candidate.outcome.durationMs}, found ${span.durationMs}`,
      );
    }
    if (span.attributes["gen_ai.operation.name"] !== "chat") {
      add(
        "trace_relationship",
        span.id,
        "attributes.gen_ai.operation.name",
        "expected chat",
      );
    }
    if (span.attributes["gen_ai.request.model"] !== candidate.resolvedModel) {
      add(
        "trace_relationship",
        span.id,
        "attributes.gen_ai.request.model",
        `expected ${candidate.resolvedModel}`,
      );
    }

    const errorType = span.attributes["error.type"];
    const responseModel = span.attributes["gen_ai.response.model"];
    if (candidate.outcome.type === "failure") {
      if (errorType !== candidate.outcome.errorType) {
        add(
          "trace_relationship",
          span.id,
          "attributes.error.type",
          `expected ${candidate.outcome.errorType}, found ${String(errorType)}`,
        );
      }
      if (responseModel !== undefined) {
        add(
          "trace_relationship",
          span.id,
          "attributes.gen_ai.response.model",
          "failed attempt must not report a response model",
        );
      }
    } else {
      if (errorType !== undefined) {
        add(
          "trace_relationship",
          span.id,
          "attributes.error.type",
          "successful attempt must not report an error",
        );
      }
      if (responseModel !== candidate.resolvedModel) {
        add(
          "trace_relationship",
          span.id,
          "attributes.gen_ai.response.model",
          `expected ${candidate.resolvedModel}, found ${String(responseModel)}`,
        );
      }
    }
  }
}

function validateUsage(
  attempts: readonly CanonicalSpan[],
  scenario: ScenarioFixture,
  add: AddIssue,
): void {
  const usageSpans = attempts.filter((span) => hasUsage(span));
  if (usageSpans.length !== scenario.expected.usageObservations) {
    add(
      "usage_attribution",
      TRACE_ID,
      "gen_ai.usage",
      `expected ${scenario.expected.usageObservations} usage observation, found ${usageSpans.length}`,
    );
  }

  for (const span of attempts) {
    const input = span.attributes["gen_ai.usage.input_tokens"];
    const output = span.attributes["gen_ai.usage.output_tokens"];
    if ((input === undefined) !== (output === undefined)) {
      add(
        "usage_attribution",
        span.id,
        "attributes.gen_ai.usage",
        "input and output token counts must be recorded together",
      );
    }
    if (
      span.status === "ERROR" &&
      (input !== undefined || output !== undefined)
    ) {
      add(
        "usage_attribution",
        span.id,
        "attributes.gen_ai.usage",
        "failed attempts must not report authoritative usage",
      );
    }
  }

  const expected = scenario.expected.authoritativeUsage;
  if (expected !== undefined && usageSpans.length === 1) {
    const span = usageSpans[0]!;
    if (
      span.attributes["gen_ai.usage.input_tokens"] !== expected.inputTokens ||
      span.attributes["gen_ai.usage.output_tokens"] !== expected.outputTokens
    ) {
      add(
        "usage_attribution",
        span.id,
        "attributes.gen_ai.usage",
        `expected authoritative usage ${expected.inputTokens}/${expected.outputTokens}`,
      );
    }
  }
}

function validateAttributes(span: CanonicalSpan, add: AddIssue): void {
  if (
    span.name.length > MAX_STRING_VALUE_LENGTH ||
    hasControlCharacter(span.name)
  ) {
    add(
      "attribute_safety",
      span.id,
      "name",
      "span name is too long or contains a control character",
    );
  }

  for (const [name, value] of Object.entries(span.attributes)) {
    const field = `attributes.${name}`;
    if (forbiddenAttributeName.test(name)) {
      add(
        "privacy",
        span.id,
        field,
        "attribute name can expose sensitive content",
      );
    }
    if (name.startsWith("gen_ai.") && !allowedGenAiAttributes.has(name)) {
      add(
        "experimental_attribute",
        span.id,
        field,
        "GenAI attribute is not in the lab's pinned experimental allowlist",
      );
    }
    if (name.length > MAX_ATTRIBUTE_NAME_LENGTH) {
      add(
        "attribute_safety",
        span.id,
        field,
        `attribute name exceeds ${MAX_ATTRIBUTE_NAME_LENGTH} characters`,
      );
    }
    validateAttributeValue(span.id, field, name, value, add);
  }
}

function validateAttributeValue(
  spanId: string,
  field: string,
  name: string,
  value: AttributeValue | undefined,
  add: AddIssue,
): void {
  if (value === undefined) {
    add("attribute_safety", spanId, field, "attribute value is undefined");
    return;
  }
  const values = Array.isArray(value) ? value : [value];
  if (Array.isArray(value) && value.length > MAX_ARRAY_VALUE_LENGTH) {
    add(
      "attribute_safety",
      spanId,
      field,
      `attribute array exceeds ${MAX_ARRAY_VALUE_LENGTH} values`,
    );
  }
  for (const item of values) {
    if (
      typeof item === "string" &&
      (item.length > MAX_STRING_VALUE_LENGTH || hasControlCharacter(item))
    ) {
      add(
        "attribute_safety",
        spanId,
        field,
        `string value is unsafe or exceeds ${MAX_STRING_VALUE_LENGTH} characters`,
      );
    }
    if (typeof item === "number" && !Number.isFinite(item)) {
      add("attribute_safety", spanId, field, "numeric value must be finite");
    }
    if (
      typeof item === "string" &&
      (name === "url.full" || name === "url.original") &&
      item.includes("?")
    ) {
      add("privacy", spanId, field, "raw URL query values are not permitted");
    }
  }
}

function hasUsage(span: CanonicalSpan): boolean {
  return (
    span.attributes["gen_ai.usage.input_tokens"] !== undefined ||
    span.attributes["gen_ai.usage.output_tokens"] !== undefined
  );
}

function hasControlCharacter(value: string): boolean {
  return /[\u0000-\u001f\u007f]/.test(value);
}

type AddIssue = (
  code: ValidationCode,
  spanId: string,
  field: string,
  message: string,
) => void;
