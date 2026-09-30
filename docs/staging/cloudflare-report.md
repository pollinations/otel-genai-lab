# Cloudflare staging evidence report

Status: **awaiting credentialed staging run**

This report records the bounded experiment from `staging/cloudflare`. Do not add prompts, responses, authorization values, destination credentials, full Durable Object identifiers, or raw request URLs to this file.

## Run metadata

| Field                                | Value                              |
| ------------------------------------ | ---------------------------------- |
| Date and Worker version              | Pending                            |
| Wrangler version                     | 4.145.0                            |
| Compatibility date                   | 2026-09-30                         |
| Trace sampling                       | 100% for three controlled requests |
| Trace persistence/export destination | Pending                            |

## Scenario evidence

| Scenario             | Native spans observed | Custom spans observed | Portable-model match | Sensitive-field scan | Notes |
| -------------------- | --------------------- | --------------------- | -------------------- | -------------------- | ----- |
| Direct success       | Pending               | Pending               | Pending              | Pending              |       |
| Fallback success     | Pending               | Pending               | Pending              | Pending              |       |
| Durable Object alarm | Pending               | Pending               | Pending              | Pending              |       |

For each row, record span names and scalar attribute keys. Record counts or redacted identifiers rather than full `faas.invocation_id`, `cloudflare.ray_id`, or `cloudflare.durable_object.id` values.

## Required checks

- Confirm no prompt, response, authorization, credential, or request-body data appears.
- Check whether native `url.full` or `url.query` exposes unexpected values.
- Compare route and attempt counts with `fixtures/traces/v0.1`.
- Compare the alarm boundary with `fixtures/traces/v0.2/s6-detached-completion.json`.
- Record whether the Durable Object and alarm remain in one trace, use correlated traces, or cannot be connected.
- Record wall time and CPU time for the three requests; do not infer overhead without an untraced baseline.
- Confirm destination delivery status if OTLP export is enabled.

## Known platform limitations to verify

Workers tracing and custom spans are beta. Span and attribute names can change. Non-I/O operations may show zero duration. Custom spans currently provide no manual parent wiring, span context access, or status setter. Cloudflare does not propagate trace IDs to external services, and OTLP export does not include metrics.

## Platform references

- [Workers traces](https://developers.cloudflare.com/workers/observability/traces/)
- [Custom spans](https://developers.cloudflare.com/workers/observability/traces/custom-spans/)
- [Tracing limitations](https://developers.cloudflare.com/workers/observability/traces/known-limitations/)
- [OpenTelemetry export](https://developers.cloudflare.com/workers/observability/exporting-opentelemetry-data/)
- [Durable Object alarms](https://developers.cloudflare.com/durable-objects/api/alarms/)

## Decision

Complete after evidence collection:

- Diagnostic value: Pending
- Trace-model mismatch: Pending
- Cardinality/privacy risk: Pending
- Measured overhead evidence: Pending
- Recommendation for production instrumentation: Pending
