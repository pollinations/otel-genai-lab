import type { ExtendedScenarioFixture } from "./extended-scenario.js";
import {
  EXTENDED_TRACE_FIXTURE_VERSION,
  type ExtendedCanonicalSpan,
  type ExtendedCanonicalTraceFixture,
} from "./extended-telemetry.js";
import { GEN_AI_SCHEMA_URL } from "./telemetry.js";
import type { ValidationIssue } from "./validator.js";

const TRACE_ID = "(trace)";
const allowedGenAiAttributes = new Set([
  "gen_ai.operation.name",
  "gen_ai.provider.name",
  "gen_ai.request.model",
  "gen_ai.response.model",
  "gen_ai.usage.input_tokens",
  "gen_ai.usage.output_tokens",
]);
const allowedProjectAttributes = new Set([
  "otel_genai_lab.correlation.id",
  "otel_genai_lab.generation.execution",
  "otel_genai_lab.observation.type",
]);

export function validateExtendedCanonicalTrace(
  trace: ExtendedCanonicalTraceFixture,
  scenario: ExtendedScenarioFixture,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const add = (
    code: ValidationIssue["code"],
    spanId: string,
    field: string,
    message: string,
  ): void => void issues.push({ code, spanId, field, message });

  if (trace.fixtureVersion !== EXTENDED_TRACE_FIXTURE_VERSION) {
    add("metadata", TRACE_ID, "fixtureVersion", "unexpected fixture version");
  }
  if (trace.sourceScenario !== scenario.id) {
    add(
      "metadata",
      TRACE_ID,
      "sourceScenario",
      "scenario identifier does not match",
    );
  }
  if (trace.semanticConventionSchemaUrl !== GEN_AI_SCHEMA_URL) {
    add(
      "metadata",
      TRACE_ID,
      "semanticConventionSchemaUrl",
      "schema URL does not match",
    );
  }
  if (trace.metricAccountingGuarantee !== "not_asserted") {
    add(
      "metadata",
      TRACE_ID,
      "metricAccountingGuarantee",
      "fixtures must not claim exactly-once metric accounting",
    );
  }

  const observations = trace.spans.filter(({ id }) =>
    id.startsWith("observation-"),
  );
  const logical = observations.filter(({ kind }) => kind === "SERVER");
  const generations = trace.spans.filter(({ id }) => id === "generation");
  const attempts = trace.spans.filter(({ id }) => id.startsWith("attempt-"));
  checkCount(
    logical,
    scenario.expected.logicalOperations,
    "logical operations",
    add,
  );
  checkCount(
    observations,
    scenario.expected.resultObservations,
    "result observations",
    add,
  );
  checkCount(generations, scenario.expected.generations, "generations", add);
  checkCount(
    attempts,
    scenario.expected.providerAttempts,
    "provider attempts",
    add,
  );

  const usageOwners = trace.spans.filter(hasUsage);
  if (usageOwners.length !== scenario.expected.usageOwners) {
    add(
      "usage_attribution",
      TRACE_ID,
      "gen_ai.usage",
      `expected ${scenario.expected.usageOwners} usage owner, found ${usageOwners.length}`,
    );
  }
  for (const span of observations) {
    if (hasUsage(span)) {
      add(
        "usage_attribution",
        span.id,
        "attributes.gen_ai.usage",
        "result observations must not repeat generation usage",
      );
    }
  }
  for (const span of usageOwners) {
    if (span.kind !== "CLIENT") {
      add(
        "usage_attribution",
        span.id,
        "attributes.gen_ai.usage",
        "the provider attempt owns authoritative usage",
      );
    }
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
      scenario.generation !== undefined &&
      (input !== scenario.generation.usage.inputTokens ||
        output !== scenario.generation.usage.outputTokens)
    ) {
      add(
        "usage_attribution",
        span.id,
        "attributes.gen_ai.usage",
        "provider usage does not match the authoritative generation result",
      );
    }
  }

  if (scenario.expected.continuity === "trace_links") {
    const generation = generations[0];
    const first = observations[0];
    const second = observations[1];
    if (
      generation?.parent !== first?.id ||
      generation?.trace !== first?.trace
    ) {
      add(
        "trace_relationship",
        generation?.id ?? TRACE_ID,
        "parent",
        "shared generation must be a child of the initiating operation",
      );
    }
    if (generation === undefined || !second?.links.includes(generation.id)) {
      add(
        "trace_relationship",
        second?.id ?? TRACE_ID,
        "links",
        "joining operation must link to the shared generation",
      );
    }
  }

  if (scenario.expected.continuity === "durable_correlation") {
    const correlated = [...observations, ...generations];
    const values = new Set(
      correlated.map(
        ({ attributes }) => attributes["otel_genai_lab.correlation.id"],
      ),
    );
    if (values.size !== 1 || values.has(undefined)) {
      add(
        "trace_relationship",
        TRACE_ID,
        "attributes.otel_genai_lab.correlation.id",
        "detached spans must share one bounded durable correlation value",
      );
    }
    if (
      new Set(correlated.map(({ trace: traceId }) => traceId)).size !==
      correlated.length
    ) {
      add(
        "trace_relationship",
        TRACE_ID,
        "trace",
        "detached execution must not imply trace continuity",
      );
    }
    for (const span of correlated) {
      if (span.parent !== null || span.links.length !== 0) {
        add(
          "trace_relationship",
          span.id,
          "parent",
          "detached roots must not invent parentage or links",
        );
      }
    }
  }

  for (const span of trace.spans) {
    for (const [name, value] of Object.entries(span.attributes)) {
      if (/authorization|credential|api[._-]?key|url\.query/i.test(name)) {
        add(
          "privacy",
          span.id,
          `attributes.${name}`,
          "sensitive field is not permitted",
        );
      }
      if (name.startsWith("gen_ai.") && !allowedGenAiAttributes.has(name)) {
        add(
          "experimental_attribute",
          span.id,
          `attributes.${name}`,
          "GenAI attribute is not in the pinned allowlist",
        );
      }
      if (
        name.startsWith("otel_genai_lab.") &&
        !allowedProjectAttributes.has(name)
      ) {
        add(
          "experimental_attribute",
          span.id,
          `attributes.${name}`,
          "project attribute is not in the documented allowlist",
        );
      }
      if (
        name === "otel_genai_lab.correlation.id" &&
        (typeof value !== "string" || !/^corr-[a-z0-9-]{1,32}$/.test(value))
      ) {
        add(
          "attribute_safety",
          span.id,
          `attributes.${name}`,
          "correlation value must use the bounded fixture format",
        );
      }
      if (typeof value === "string" && value.length > 256) {
        add(
          "attribute_safety",
          span.id,
          `attributes.${name}`,
          "value exceeds 256 characters",
        );
      }
    }
  }

  return issues;
}

function checkCount(
  spans: readonly ExtendedCanonicalSpan[],
  expected: number,
  label: string,
  add: (
    code: ValidationIssue["code"],
    spanId: string,
    field: string,
    message: string,
  ) => void,
): void {
  if (spans.length !== expected) {
    add(
      "span_count",
      TRACE_ID,
      "spans",
      `expected ${expected} ${label}, found ${spans.length}`,
    );
  }
}

function hasUsage(span: ExtendedCanonicalSpan): boolean {
  return (
    span.attributes["gen_ai.usage.input_tokens"] !== undefined ||
    span.attributes["gen_ai.usage.output_tokens"] !== undefined
  );
}
