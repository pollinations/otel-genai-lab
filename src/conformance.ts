import type { OtlpAttributeValue, OtlpSpan } from "./otlp.js";

export type ConformanceCode =
  | "attribute_safety"
  | "experimental_attribute"
  | "privacy"
  | "span_count"
  | "trace_relationship"
  | "usage_attribution";

export interface ConformanceIssue {
  code: ConformanceCode;
  trace: string;
  span: string;
  field: string;
  message: string;
}

export interface TraceResult {
  trace: string;
  spans: number;
  providerAttempts: number;
  issues: ConformanceIssue[];
}

export interface ConformanceReport {
  schemaVersion: "0.1.0";
  status: "pass" | "fail";
  summary: {
    traces: number;
    spans: number;
    providerAttempts: number;
    issues: number;
  };
  traces: TraceResult[];
}

const allowedGenAiAttributes = new Set([
  "gen_ai.operation.name",
  "gen_ai.provider.name",
  "gen_ai.request.model",
  "gen_ai.response.model",
  "gen_ai.usage.input_tokens",
  "gen_ai.usage.output_tokens",
]);
const forbiddenAttributeName =
  /authorization|credential|api[._-]?key|gen_ai\.(?:input|output)\.messages|gen_ai\.(?:prompt|completion)|url\.query|request\.body/i;
const secretLikeValue =
  /(?:^|\s)(?:Bearer\s+[A-Za-z0-9._~+/=-]{12,}|sk-[A-Za-z0-9_-]{16,}|cfut_[A-Za-z0-9_-]{20,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----)/i;

export function validateOtlpSpans(
  spans: readonly OtlpSpan[],
): ConformanceReport {
  const grouped = new Map<string, OtlpSpan[]>();
  for (const span of spans) {
    const trace = grouped.get(span.traceId) ?? [];
    trace.push(span);
    grouped.set(span.traceId, trace);
  }

  const traces = [...grouped.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, traceSpans], index) =>
      validateTrace(`trace-${index + 1}`, traceSpans),
    );
  const issueCount = traces.reduce(
    (total, trace) => total + trace.issues.length,
    0,
  );
  return {
    schemaVersion: "0.1.0",
    status: issueCount === 0 ? "pass" : "fail",
    summary: {
      traces: traces.length,
      spans: spans.length,
      providerAttempts: traces.reduce(
        (total, trace) => total + trace.providerAttempts,
        0,
      ),
      issues: issueCount,
    },
    traces,
  };
}

function validateTrace(trace: string, spans: readonly OtlpSpan[]): TraceResult {
  const issues: ConformanceIssue[] = [];
  const spanLabels = new Map(
    [...spans]
      .sort((left, right) =>
        left.name === right.name
          ? left.spanId.localeCompare(right.spanId)
          : left.name.localeCompare(right.name),
      )
      .map((span, index) => [span.spanId, `${span.name}#${index + 1}`]),
  );
  const add = (
    code: ConformanceCode,
    span: OtlpSpan | undefined,
    field: string,
    message: string,
  ): void => {
    issues.push({
      code,
      trace,
      span:
        span === undefined
          ? "(trace)"
          : (spanLabels.get(span.spanId) ?? span.name),
      field,
      message,
    });
  };

  const servers = spans.filter(isServerSpan);
  if (servers.length !== 1) {
    add(
      "span_count",
      undefined,
      "spans",
      `expected one logical SERVER span, found ${servers.length}`,
    );
  }
  const gateway = servers[0];
  const attempts = spans.filter(isProviderAttempt);
  if (attempts.length === 0) {
    add(
      "span_count",
      undefined,
      "spans",
      "expected at least one GenAI CLIENT provider-attempt span",
    );
  }

  const seenSpanIds = new Set<string>();
  for (const span of spans) {
    if (seenSpanIds.has(span.spanId)) {
      add("trace_relationship", span, "spanId", "duplicate span identifier");
    }
    seenSpanIds.add(span.spanId);
    validateAttributes(span, add);
  }

  if (gateway !== undefined) {
    if (gateway.parentSpanId !== null) {
      add(
        "trace_relationship",
        gateway,
        "parentSpanId",
        "logical SERVER span must be a trace root",
      );
    }
    for (const attempt of attempts) {
      if (attempt.parentSpanId !== gateway.spanId) {
        add(
          "trace_relationship",
          attempt,
          "parentSpanId",
          "provider attempt must be a direct child of the logical SERVER span",
        );
      }
    }
  }

  validateUsage(spans, attempts, add);
  issues.sort((left, right) =>
    [left.code, left.span, left.field, left.message]
      .join("\0")
      .localeCompare(
        [right.code, right.span, right.field, right.message].join("\0"),
      ),
  );
  return {
    trace,
    spans: spans.length,
    providerAttempts: attempts.length,
    issues,
  };
}

function validateAttributes(
  span: OtlpSpan,
  add: (
    code: ConformanceCode,
    span: OtlpSpan,
    field: string,
    message: string,
  ) => void,
): void {
  for (const [name, value] of Object.entries(span.attributes)) {
    if (name.length > 128) {
      add(
        "attribute_safety",
        span,
        `attributes.${name}`,
        "attribute name exceeds 128 characters",
      );
    }
    if (forbiddenAttributeName.test(name)) {
      add(
        "privacy",
        span,
        `attributes.${name}`,
        "sensitive or content-bearing attribute is not permitted",
      );
    }
    if (name.startsWith("gen_ai.") && !allowedGenAiAttributes.has(name)) {
      add(
        "experimental_attribute",
        span,
        `attributes.${name}`,
        "GenAI attribute is outside the pinned allowlist",
      );
    }
    validateAttributeValue(span, name, value, add);
  }
}

function validateAttributeValue(
  span: OtlpSpan,
  name: string,
  value: OtlpAttributeValue,
  add: (
    code: ConformanceCode,
    span: OtlpSpan,
    field: string,
    message: string,
  ) => void,
): void {
  const field = `attributes.${name}`;
  if (typeof value === "string") {
    if (value.length > 256) {
      add(
        "attribute_safety",
        span,
        field,
        "string value exceeds 256 characters",
      );
    }
    if (secretLikeValue.test(value)) {
      add(
        "privacy",
        span,
        field,
        "value resembles a credential or private key",
      );
    }
  }
  if (Array.isArray(value) && value.length > 16) {
    add("attribute_safety", span, field, "array value exceeds 16 entries");
  }
}

function validateUsage(
  spans: readonly OtlpSpan[],
  attempts: readonly OtlpSpan[],
  add: (
    code: ConformanceCode,
    span: OtlpSpan,
    field: string,
    message: string,
  ) => void,
): void {
  const usageOwners = spans.filter(hasUsage);
  if (usageOwners.length > 1) {
    for (const span of usageOwners) {
      add(
        "usage_attribution",
        span,
        "attributes.gen_ai.usage",
        "usage appears on more than one span in the trace",
      );
    }
  }
  for (const span of usageOwners) {
    if (!attempts.includes(span)) {
      add(
        "usage_attribution",
        span,
        "attributes.gen_ai.usage",
        "authoritative usage must belong to a provider-attempt CLIENT span",
      );
    }
    const input = span.attributes["gen_ai.usage.input_tokens"];
    const output = span.attributes["gen_ai.usage.output_tokens"];
    if ((input === undefined) !== (output === undefined)) {
      add(
        "usage_attribution",
        span,
        "attributes.gen_ai.usage",
        "input and output token counts must be recorded together",
      );
    }
    if (!isNonNegativeInteger(input) || !isNonNegativeInteger(output)) {
      add(
        "usage_attribution",
        span,
        "attributes.gen_ai.usage",
        "token counts must be non-negative integers",
      );
    }
    if (isErrorSpan(span)) {
      add(
        "usage_attribution",
        span,
        "attributes.gen_ai.usage",
        "failed provider attempts must not claim authoritative usage",
      );
    }
  }
}

function isProviderAttempt(span: OtlpSpan): boolean {
  return (
    isClientSpan(span) &&
    Object.keys(span.attributes).some((name) => name.startsWith("gen_ai."))
  );
}

function isServerSpan(span: OtlpSpan): boolean {
  return span.kind === 2 || span.kind === "SPAN_KIND_SERVER";
}

function isClientSpan(span: OtlpSpan): boolean {
  return span.kind === 3 || span.kind === "SPAN_KIND_CLIENT";
}

function isErrorSpan(span: OtlpSpan): boolean {
  return span.statusCode === 2 || span.statusCode === "STATUS_CODE_ERROR";
}

function hasUsage(span: OtlpSpan): boolean {
  return (
    span.attributes["gen_ai.usage.input_tokens"] !== undefined ||
    span.attributes["gen_ai.usage.output_tokens"] !== undefined
  );
}

function isNonNegativeInteger(value: OtlpAttributeValue | undefined): boolean {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}
