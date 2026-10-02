import { validateOtlpSpans, type ConformanceIssue } from "./conformance.js";
import type { OtlpAttributeValue, OtlpSpan } from "./otlp.js";

export interface InspectionSpan {
  span: string;
  name: string;
  kind: string;
  status: string;
  genAi: Record<string, OtlpAttributeValue>;
  outcome: Record<string, OtlpAttributeValue>;
  implementationAttributes: string[];
}

export interface InspectionTrace {
  trace: string;
  spans: InspectionSpan[];
}

export interface InspectionReport {
  schemaVersion: "0.1.0";
  status: "pass" | "fail";
  summary: {
    traces: number;
    spans: number;
    genAiSpans: number;
    safetyIssues: number;
  };
  traces: InspectionTrace[];
  safetyIssues: ConformanceIssue[];
}

const retainedGenAiAttributes = new Set([
  "gen_ai.operation.name",
  "gen_ai.provider.name",
  "gen_ai.request.model",
  "gen_ai.response.model",
  "gen_ai.usage.input_tokens",
  "gen_ai.usage.output_tokens",
]);
const retainedOutcomeAttributes = new Set([
  "error.type",
  "http.response.status_code",
  "http.status",
  "http.status_code",
  "retry.attempt",
]);

export function inspectOtlpSpans(spans: readonly OtlpSpan[]): InspectionReport {
  const conformance = validateOtlpSpans(spans);
  const safetyIssues = conformance.traces.flatMap(({ issues }) =>
    issues.filter(
      ({ code }) => code === "privacy" || code === "attribute_safety",
    ),
  );
  const grouped = new Map<string, OtlpSpan[]>();
  for (const span of spans) {
    const trace = grouped.get(span.traceId) ?? [];
    trace.push(span);
    grouped.set(span.traceId, trace);
  }

  let genAiSpans = 0;
  const traces = [...grouped.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, traceSpans], traceIndex): InspectionTrace => {
      const sorted = [...traceSpans].sort((left, right) => {
        const timeOrder = compareStartTime(
          left.startTimeUnixNano,
          right.startTimeUnixNano,
        );
        return timeOrder !== 0
          ? timeOrder
          : [left.name, left.spanId]
              .join("\0")
              .localeCompare([right.name, right.spanId].join("\0"));
      });
      return {
        trace: `trace-${traceIndex + 1}`,
        spans: sorted.map((span, spanIndex) => {
          const genAi = Object.fromEntries(
            Object.entries(span.attributes)
              .filter(([name]) => retainedGenAiAttributes.has(name))
              .sort(([left], [right]) => left.localeCompare(right)),
          );
          const outcome = Object.fromEntries(
            Object.entries(span.attributes)
              .filter(([name]) => retainedOutcomeAttributes.has(name))
              .sort(([left], [right]) => left.localeCompare(right)),
          );
          if (Object.keys(genAi).length > 0) genAiSpans += 1;
          return {
            span: `span-${spanIndex + 1}`,
            name: span.name,
            kind: formatKind(span.kind),
            status: formatStatus(span.statusCode),
            genAi,
            outcome,
            implementationAttributes: Object.keys(span.attributes)
              .filter(
                (name) =>
                  name.startsWith("agw.") || name.startsWith("agentgateway."),
              )
              .sort(),
          };
        }),
      };
    });

  return {
    schemaVersion: "0.1.0",
    status: safetyIssues.length === 0 ? "pass" : "fail",
    summary: {
      traces: traces.length,
      spans: spans.length,
      genAiSpans,
      safetyIssues: safetyIssues.length,
    },
    traces,
    safetyIssues,
  };
}

function compareStartTime(left: string | null, right: string | null): number {
  if (left === right) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return left.length === right.length
    ? left.localeCompare(right)
    : left.length - right.length;
}

function formatKind(kind: OtlpSpan["kind"]): string {
  const kinds: Record<string, string> = {
    "0": "UNSPECIFIED",
    "1": "INTERNAL",
    "2": "SERVER",
    "3": "CLIENT",
    "4": "PRODUCER",
    "5": "CONSUMER",
  };
  return kinds[String(kind)] ?? String(kind).replace("SPAN_KIND_", "");
}

function formatStatus(status: OtlpSpan["statusCode"]): string {
  const statuses: Record<string, string> = {
    "0": "UNSET",
    "1": "OK",
    "2": "ERROR",
  };
  return statuses[String(status)] ?? String(status).replace("STATUS_CODE_", "");
}
