import {
  ROOT_CONTEXT,
  SpanKind,
  SpanStatusCode,
  trace,
  type Attributes,
  type Tracer,
} from "@opentelemetry/api";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
  type ReadableSpan,
  type SpanExporter,
} from "@opentelemetry/sdk-trace-node";
import {
  ATTR_GEN_AI_OPERATION_NAME,
  ATTR_GEN_AI_PROVIDER_NAME,
  ATTR_GEN_AI_REQUEST_MODEL,
  ATTR_GEN_AI_RESPONSE_MODEL,
  ATTR_GEN_AI_USAGE_INPUT_TOKENS,
  ATTR_GEN_AI_USAGE_OUTPUT_TOKENS,
} from "@opentelemetry/semantic-conventions/incubating";

import type { GatewayResult, ProviderAttempt } from "./gateway.js";
import { executeScenarioFixture, type ScenarioFixture } from "./scenario.js";

export const GEN_AI_SCHEMA_URL =
  "https://opentelemetry.io/schemas/gen-ai-dev/1.42.0-dev";

export const TRACE_FIXTURE_VERSION = "0.1.0";

const BASE_TIME = Date.parse("2026-01-01T00:00:00.000Z");

export interface CanonicalSpan {
  id: string;
  parent: string | null;
  name: string;
  kind: "SERVER" | "CLIENT";
  status: "UNSET" | "ERROR";
  startOffsetMs: number;
  durationMs: number;
  attributes: Attributes;
}

export interface CanonicalTraceFixture {
  fixtureVersion: typeof TRACE_FIXTURE_VERSION;
  sourceScenario: string;
  semanticConventionSchemaUrl: typeof GEN_AI_SCHEMA_URL;
  mappingStatus: "experimental";
  spans: CanonicalSpan[];
}

export function createTracerProvider(
  exporter: SpanExporter,
): BasicTracerProvider {
  return new BasicTracerProvider({
    resource: resourceFromAttributes({
      "service.name": "otel-genai-lab",
      "service.version": "0.1.0",
    }),
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  });
}

export function recordScenario(
  fixture: ScenarioFixture,
  tracer: Tracer,
  startTimeMs = BASE_TIME,
): GatewayResult {
  const result = executeScenarioFixture(fixture);
  const totalDurationMs = result.attempts.reduce(
    (total, attempt) => total + attempt.outcome.durationMs,
    0,
  );
  const gatewaySpan = tracer.startSpan("POST /v1/chat/completions", {
    kind: SpanKind.SERVER,
    startTime: startTimeMs,
    attributes: {
      "http.request.method": "POST",
      "http.route": "/v1/chat/completions",
      "server.address": "genai-gateway.local",
    },
  });
  const gatewayContext = trace.setSpan(ROOT_CONTEXT, gatewaySpan);

  let attemptStartMs = startTimeMs;
  for (const attempt of result.attempts) {
    recordAttempt(tracer, gatewayContext, attempt, attemptStartMs);
    attemptStartMs += attempt.outcome.durationMs;
  }

  if (result.type === "failure") {
    gatewaySpan.setAttribute("error.type", result.errorType);
    gatewaySpan.setStatus({ code: SpanStatusCode.ERROR });
  }
  gatewaySpan.end(startTimeMs + totalDurationMs);

  return result;
}

function recordAttempt(
  tracer: Tracer,
  parentContext: ReturnType<typeof trace.setSpan>,
  attempt: ProviderAttempt,
  startTimeMs: number,
): void {
  const attributes: Attributes = {
    [ATTR_GEN_AI_OPERATION_NAME]: "chat",
    [ATTR_GEN_AI_PROVIDER_NAME]: attempt.provider,
    [ATTR_GEN_AI_REQUEST_MODEL]: attempt.resolvedModel,
  };

  if (attempt.outcome.type === "success") {
    attributes[ATTR_GEN_AI_RESPONSE_MODEL] = attempt.resolvedModel;
    attributes[ATTR_GEN_AI_USAGE_INPUT_TOKENS] =
      attempt.outcome.usage.inputTokens;
    attributes[ATTR_GEN_AI_USAGE_OUTPUT_TOKENS] =
      attempt.outcome.usage.outputTokens;
  } else {
    attributes["error.type"] = attempt.outcome.errorType;
  }

  const span = tracer.startSpan(
    `chat ${attempt.resolvedModel}`,
    {
      kind: SpanKind.CLIENT,
      startTime: startTimeMs,
      attributes,
    },
    parentContext,
  );

  if (attempt.outcome.type === "failure") {
    span.setStatus({ code: SpanStatusCode.ERROR });
  }
  span.end(startTimeMs + attempt.outcome.durationMs);
}

export async function captureCanonicalTrace(
  fixture: ScenarioFixture,
): Promise<CanonicalTraceFixture> {
  const exporter = new InMemorySpanExporter();
  const provider = createTracerProvider(exporter);
  const tracer = provider.getTracer("otel-genai-lab", "0.1.0", {
    schemaUrl: GEN_AI_SCHEMA_URL,
  });

  recordScenario(fixture, tracer);
  await provider.forceFlush();
  const spans = exporter.getFinishedSpans();
  await provider.shutdown();

  return normalizeTrace(fixture.id, spans);
}

export function normalizeTrace(
  sourceScenario: string,
  spans: readonly ReadableSpan[],
): CanonicalTraceFixture {
  const gateway = spans.find((span) => span.kind === SpanKind.SERVER);
  if (gateway === undefined) {
    throw new Error(`Scenario ${sourceScenario} did not emit a gateway span`);
  }

  const ordered = [...spans].sort((left, right) => {
    const timeDifference =
      toEpochMilliseconds(left.startTime) -
      toEpochMilliseconds(right.startTime);
    if (timeDifference !== 0) return timeDifference;
    return left.kind === SpanKind.SERVER ? -1 : 1;
  });
  const gatewaySpanId = gateway.spanContext().spanId;
  for (const span of spans) {
    if (span.instrumentationScope.schemaUrl !== GEN_AI_SCHEMA_URL) {
      throw new Error(
        `Scenario ${sourceScenario} used an unexpected schema URL`,
      );
    }
    if (span !== gateway && span.parentSpanContext?.spanId !== gatewaySpanId) {
      throw new Error(
        `Scenario ${sourceScenario} emitted an attempt outside the gateway span`,
      );
    }
  }
  let attemptNumber = 0;

  return {
    fixtureVersion: TRACE_FIXTURE_VERSION,
    sourceScenario,
    semanticConventionSchemaUrl: GEN_AI_SCHEMA_URL,
    mappingStatus: "experimental",
    spans: ordered.map((span) => {
      const isGateway = span.spanContext().spanId === gatewaySpanId;
      const id = isGateway ? "gateway" : `attempt-${++attemptNumber}`;
      return {
        id,
        parent: isGateway ? null : "gateway",
        name: span.name,
        kind: span.kind === SpanKind.SERVER ? "SERVER" : "CLIENT",
        status: span.status.code === SpanStatusCode.ERROR ? "ERROR" : "UNSET",
        startOffsetMs:
          toEpochMilliseconds(span.startTime) -
          toEpochMilliseconds(gateway.startTime),
        durationMs: toDurationMilliseconds(span.duration),
        attributes: sortAttributes(span.attributes),
      };
    }),
  };
}

function toEpochMilliseconds(time: readonly [number, number]): number {
  return time[0] * 1_000 + time[1] / 1_000_000;
}

function toDurationMilliseconds(time: readonly [number, number]): number {
  return time[0] * 1_000 + time[1] / 1_000_000;
}

function sortAttributes(attributes: Attributes): Attributes {
  return Object.fromEntries(
    Object.entries(attributes).sort(([left], [right]) =>
      left.localeCompare(right),
    ),
  );
}
