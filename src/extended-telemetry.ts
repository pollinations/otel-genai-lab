import {
  ROOT_CONTEXT,
  SpanKind,
  trace,
  type Attributes,
  type Span,
  type Tracer,
} from "@opentelemetry/api";
import {
  InMemorySpanExporter,
  type ReadableSpan,
} from "@opentelemetry/sdk-trace-node";
import {
  ATTR_GEN_AI_OPERATION_NAME,
  ATTR_GEN_AI_PROVIDER_NAME,
  ATTR_GEN_AI_REQUEST_MODEL,
  ATTR_GEN_AI_RESPONSE_MODEL,
  ATTR_GEN_AI_USAGE_INPUT_TOKENS,
  ATTR_GEN_AI_USAGE_OUTPUT_TOKENS,
} from "@opentelemetry/semantic-conventions/incubating";

import type {
  ExtendedScenarioFixture,
  Observation,
} from "./extended-scenario.js";
import { createTracerProvider, GEN_AI_SCHEMA_URL } from "./telemetry.js";

export const EXTENDED_TRACE_FIXTURE_VERSION = "0.2.0";
const BASE_TIME = Date.parse("2026-01-02T00:00:00.000Z");

export interface ExtendedCanonicalSpan {
  id: string;
  trace: string;
  parent: string | null;
  links: string[];
  name: string;
  kind: "SERVER" | "CLIENT" | "INTERNAL";
  status: "UNSET";
  startOffsetMs: number;
  durationMs: number;
  attributes: Attributes;
}

export interface ExtendedCanonicalTraceFixture {
  fixtureVersion: typeof EXTENDED_TRACE_FIXTURE_VERSION;
  sourceScenario: string;
  semanticConventionSchemaUrl: typeof GEN_AI_SCHEMA_URL;
  mappingStatus: "experimental";
  metricAccountingGuarantee: "not_asserted";
  spans: ExtendedCanonicalSpan[];
}

export function recordExtendedScenario(
  fixture: ExtendedScenarioFixture,
  tracer: Tracer,
  startTimeMs = BASE_TIME,
): void {
  const observations = new Map<string, Span>();
  const correlation = fixture.generation?.correlationId;

  for (const observation of fixture.observations) {
    const links = [];
    const generation = observations.get("generation");
    if (
      fixture.mode === "concurrent_deduplication" &&
      observation.id === "observation-2" &&
      generation !== undefined
    ) {
      links.push({ context: generation.spanContext() });
    }
    const span = tracer.startSpan(
      observation.role === "request"
        ? "POST /v1/chat/completions"
        : "observe generation result",
      {
        kind:
          observation.role === "request" ? SpanKind.SERVER : SpanKind.INTERNAL,
        startTime: startTimeMs + observation.startOffsetMs,
        links,
        attributes: observationAttributes(observation, correlation),
      },
      ROOT_CONTEXT,
    );
    observations.set(observation.id, span);

    if (
      observation.id === "observation-1" &&
      fixture.generation !== undefined
    ) {
      const parentContext =
        fixture.mode === "concurrent_deduplication"
          ? trace.setSpan(ROOT_CONTEXT, span)
          : ROOT_CONTEXT;
      const generationSpan = tracer.startSpan(
        "execute generation",
        {
          kind: SpanKind.INTERNAL,
          startTime: startTimeMs + fixture.generation.startOffsetMs,
          attributes: {
            "otel_genai_lab.generation.execution": fixture.generation.execution,
            ...(correlation === undefined
              ? {}
              : { "otel_genai_lab.correlation.id": correlation }),
          },
        },
        parentContext,
      );
      observations.set("generation", generationSpan);
      recordProviderAttempt(fixture, tracer, generationSpan, startTimeMs);
    }
  }

  for (const observation of fixture.observations) {
    observations
      .get(observation.id)
      ?.end(startTimeMs + observation.startOffsetMs + observation.durationMs);
  }
  observations
    .get("generation")
    ?.end(
      startTimeMs +
        fixture.generation!.startOffsetMs +
        fixture.generation!.durationMs,
    );
}

function recordProviderAttempt(
  fixture: ExtendedScenarioFixture,
  tracer: Tracer,
  generationSpan: Span,
  startTimeMs: number,
): void {
  const generation = fixture.generation!;
  const span = tracer.startSpan(
    `chat ${generation.resolvedModel}`,
    {
      kind: SpanKind.CLIENT,
      startTime: startTimeMs + generation.startOffsetMs,
      attributes: {
        [ATTR_GEN_AI_OPERATION_NAME]: "chat",
        [ATTR_GEN_AI_PROVIDER_NAME]: generation.provider,
        [ATTR_GEN_AI_REQUEST_MODEL]: generation.resolvedModel,
        [ATTR_GEN_AI_RESPONSE_MODEL]: generation.resolvedModel,
        [ATTR_GEN_AI_USAGE_INPUT_TOKENS]: generation.usage.inputTokens,
        [ATTR_GEN_AI_USAGE_OUTPUT_TOKENS]: generation.usage.outputTokens,
      },
    },
    trace.setSpan(ROOT_CONTEXT, generationSpan),
  );
  span.end(startTimeMs + generation.startOffsetMs + generation.durationMs);
}

function observationAttributes(
  observation: Observation,
  correlation: string | undefined,
): Attributes {
  return {
    "otel_genai_lab.observation.type": observation.outcome,
    ...(observation.role === "request"
      ? {
          "http.request.method": "POST",
          "http.route": "/v1/chat/completions",
          "server.address": "genai-gateway.local",
        }
      : {}),
    ...(correlation === undefined
      ? {}
      : { "otel_genai_lab.correlation.id": correlation }),
  };
}

export async function captureExtendedCanonicalTrace(
  fixture: ExtendedScenarioFixture,
): Promise<ExtendedCanonicalTraceFixture> {
  const exporter = new InMemorySpanExporter();
  const provider = createTracerProvider(exporter);
  const tracer = provider.getTracer("otel-genai-lab", "0.2.0", {
    schemaUrl: GEN_AI_SCHEMA_URL,
  });
  recordExtendedScenario(fixture, tracer);
  await provider.forceFlush();
  const spans = exporter.getFinishedSpans();
  await provider.shutdown();
  return normalizeExtendedTrace(fixture, spans);
}

function normalizeExtendedTrace(
  fixture: ExtendedScenarioFixture,
  spans: readonly ReadableSpan[],
): ExtendedCanonicalTraceFixture {
  const ordered = [...spans].sort((left, right) => {
    const time = milliseconds(left.startTime) - milliseconds(right.startTime);
    if (time !== 0) return time;
    return kindRank(left.kind) - kindRank(right.kind);
  });
  const spanIds = new Map<string, string>();
  let observation = 0;
  for (const span of ordered) {
    const id =
      span.kind === SpanKind.SERVER || span.name === "observe generation result"
        ? `observation-${++observation}`
        : span.kind === SpanKind.INTERNAL
          ? "generation"
          : "attempt-1";
    spanIds.set(span.spanContext().spanId, id);
  }
  const traces = new Map<string, string>();
  for (const span of ordered) {
    const traceId = span.spanContext().traceId;
    if (!traces.has(traceId)) traces.set(traceId, `trace-${traces.size + 1}`);
  }
  for (const span of ordered) {
    if (span.instrumentationScope.schemaUrl !== GEN_AI_SCHEMA_URL) {
      throw new Error(`Scenario ${fixture.id} used an unexpected schema URL`);
    }
    if (
      span.parentSpanContext !== undefined &&
      !spanIds.has(span.parentSpanContext.spanId)
    ) {
      throw new Error(`Scenario ${fixture.id} has an unknown parent span`);
    }
    if (span.links.some(({ context }) => !spanIds.has(context.spanId))) {
      throw new Error(`Scenario ${fixture.id} has an unknown linked span`);
    }
  }

  return {
    fixtureVersion: EXTENDED_TRACE_FIXTURE_VERSION,
    sourceScenario: fixture.id,
    semanticConventionSchemaUrl: GEN_AI_SCHEMA_URL,
    mappingStatus: "experimental",
    metricAccountingGuarantee: "not_asserted",
    spans: ordered.map((span) => ({
      id: spanIds.get(span.spanContext().spanId)!,
      trace: traces.get(span.spanContext().traceId)!,
      parent:
        span.parentSpanContext === undefined
          ? null
          : (spanIds.get(span.parentSpanContext.spanId) ?? null),
      links: span.links
        .map(({ context }) => spanIds.get(context.spanId))
        .filter((id): id is string => id !== undefined),
      name: span.name,
      kind:
        span.kind === SpanKind.SERVER
          ? "SERVER"
          : span.kind === SpanKind.CLIENT
            ? "CLIENT"
            : "INTERNAL",
      status: "UNSET",
      startOffsetMs: milliseconds(span.startTime) - BASE_TIME,
      durationMs: milliseconds(span.duration),
      attributes: Object.fromEntries(
        Object.entries(span.attributes).sort(([a], [b]) => a.localeCompare(b)),
      ),
    })),
  };
}

function milliseconds(time: readonly [number, number]): number {
  return time[0] * 1_000 + time[1] / 1_000_000;
}

function kindRank(kind: SpanKind): number {
  if (kind === SpanKind.SERVER) return 0;
  if (kind === SpanKind.INTERNAL) return 1;
  return 2;
}
