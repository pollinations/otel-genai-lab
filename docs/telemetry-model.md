# Experimental telemetry model

The lab emits one trace for each logical gateway request. The mapping is explicitly experimental while the OpenTelemetry GenAI SIG discusses the gateway topology in [semantic-conventions-genai#231](https://github.com/open-telemetry/semantic-conventions-genai/issues/231).

## Span topology

```text
POST /v1/chat/completions (SERVER: logical gateway operation)
├── chat alpha/model-a (CLIENT: first provider attempt)
└── chat beta/model-b  (CLIENT: fallback attempt, when executed)
```

The server span answers whether the caller's logical request succeeded and how long the full gateway operation took. A client span exists for every provider call that actually ran. This exposes provider order, latency, failures, fallback, resolved model, and authoritative usage without treating an unexecuted candidate as an attempt.

The gateway span uses stable HTTP server attributes. Attempt spans use the current experimental GenAI attributes:

- `gen_ai.operation.name`
- `gen_ai.provider.name`
- `gen_ai.request.model`
- `gen_ai.response.model` on success
- `gen_ai.usage.input_tokens` and `gen_ai.usage.output_tokens` on success
- `error.type` and error status on failure

The instrumentation scope declares `https://opentelemetry.io/schemas/gen-ai-dev/1.42.0-dev`. The lab does not create new `gen_ai.*` attributes and does not capture prompts or responses.

## Canonical fixtures

`fixtures/traces/v0.1` contains a deterministic, review-friendly projection of the emitted spans. Canonicalization removes random trace and span IDs and absolute timestamps. It preserves parentage, relative start times, durations, status, and attributes.

Regenerate and verify them with:

```bash
npm run traces:generate
npm run traces:check
```

For a full OTLP/HTTP path through the pinned Collector:

```bash
mkdir -p tmp/otel
docker compose up -d collector
npm run traces:export
docker compose down
cat tmp/otel/traces.json
```

Set `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` to send the same spans to another OTLP/HTTP endpoint.
