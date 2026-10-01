# Cloudflare staging evidence report

Status: **smoke run captured; trace inspection pending**

This report records the bounded experiment from `staging/cloudflare`. Do not add prompts, responses, authorization values, destination credentials, full Durable Object identifiers, or raw request URLs to this file.

## Run metadata

| Field                                | Value                                                      |
| ------------------------------------ | ---------------------------------------------------------- |
| Date captured                        | 2026-09-30 17:09:49 UTC                                    |
| Worker host                          | `otel-genai-lab-staging.ayushbhatt633.workers.dev`         |
| Source revision                      | `56bd52e`                                                  |
| Wrangler version                     | 4.145.0                                                    |
| Compatibility date                   | 2026-09-30                                                 |
| Trace sampling                       | 100% for three controlled requests                         |
| Trace persistence/export destination | Cloudflare persistence enabled; external export not tested |

## Smoke result

| Scenario             | HTTP status | Client duration | Response              |
| -------------------- | ----------- | --------------- | --------------------- |
| Direct success       | 200         | 369.87 ms       | `success`, 1 attempt  |
| Fallback success     | 200         | 58.40 ms        | `success`, 2 attempts |
| Durable Object alarm | 202         | 945.70 ms       | `scheduled`           |

These client durations confirm route behavior only. They are not instrumentation overhead measurements and cannot replace the platform wall-time and CPU-time review below.

### Preview deployment revalidation

The browser preview from PR #22 was deployed on 2026-10-01 as Cloudflare version `ec0c1d7f-ec33-40f3-9e41-540cd804f6f7`. A GET request returned the expected HTML with its restrictive Content Security Policy. The bounded smoke run completed at 15:58:45 UTC:

| Scenario             | HTTP status | Client duration | Response              |
| -------------------- | ----------- | --------------- | --------------------- |
| Direct success       | 200         | 252.05 ms       | `success`, 1 attempt  |
| Fallback success     | 200         | 58.55 ms        | `success`, 2 attempts |
| Durable Object alarm | 202         | 649.17 ms       | `scheduled`           |

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
