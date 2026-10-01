# Cloudflare staging evidence report

Status: **complete — suitable for continued lab work, blocked for production use**

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

The final deployment after PR #24 used Cloudflare version `6cf10721-726c-4852-9445-daf9abc64a05`. GET and HEAD returned 200. The final smoke run completed at 16:02:12 UTC with direct, fallback, and detached client durations of 254.91 ms, 58.19 ms, and 202.96 ms respectively.

## Scenario evidence

| Scenario             | Native spans observed                   | Custom spans observed                               | Portable-model match | Sensitive-field scan                          | Notes                                                                |
| -------------------- | --------------------------------------- | --------------------------------------------------- | -------------------- | --------------------------------------------- | -------------------------------------------------------------------- |
| Direct success       | Yes; 6 spans, 46–48 ms                  | Yes; route and successful-attempt span count        | Partial              | Application fields pass; native metadata risk | One provider attempt and scalar usage match the fixture              |
| Fallback success     | Yes; 6 spans, 4–5 ms                    | Yes; scripted exception appears in trace summary    | Partial              | Application fields pass; native metadata risk | Two attempts match; expected failure is reported as a trace error    |
| Durable Object alarm | Yes; route 7 spans, alarm 5, provider 1 | Yes; route and detached-generation spans contribute | Mismatch             | Application fields pass; native metadata risk | Route, alarm, and alarm-side provider invocation use separate traces |

The REST trace view returned root names, transaction names, counts, durations, services, and errors, but not individual child-span names or attributes. The custom names and bounded scalar keys are therefore verified from the deployed source, while persistence is verified by the extra span counts and the custom `scripted staging failure` exception. No trace, span, Ray, request, or Durable Object identifier is retained in this report.

## Privacy and cardinality result

Across the bounded trace, invocation, and event API responses, scans found zero occurrences of `prompt`, `authorization`, `credential`, `api_key`, `api-key`, `request.body`, or `url.query`. Custom attributes remain bounded scalar values from the checked-in policy.

Native persisted events nevertheless contained request metadata fields for `cf-connecting-ip`, `x-real-ip`, user agent, accepted languages, request header names, ASN, organization, city, country, postal code, latitude, longitude, and request URL. No authorization header was sent in this experiment. Disabling Workers logs did not remove these fields from persisted trace telemetry. This metadata footprint blocks a production recommendation until Pollinations defines collection, retention, access, and redaction controls.

## Trace continuity and timing

Direct and fallback request traces preserved their route and attempt structure. The detached scenario did not match the portable model's correlated completion: the initial route, Durable Object alarm, and alarm-side provider invocation appeared as separate traces. Current custom-span APIs provide no trace context access or manual parent wiring to repair that boundary.

For two captured runs, Workers reported 3 ms CPU for direct, 2 ms for fallback, 1 ms for the detached route, 0 ms for the Durable Object scheduling call, and 1 ms for the alarm. These values describe traced executions only. With no untraced baseline, they do not measure instrumentation overhead. Client wall time was also dominated by network and scheduling behavior.

## Required checks

- [x] No prompt, response content, authorization, credential, or request body appeared.
- [x] No query string appeared; native request URLs and broader client metadata did.
- [x] Direct and fallback route and attempt behavior was compared with `fixtures/traces/v0.1`.
- [x] The alarm boundary was compared with `fixtures/traces/v0.2/s6-detached-completion.json`.
- [x] The route, alarm, and alarm-side provider invocation were observed as separate traces.
- [x] Client wall time and Workers CPU time were recorded without claiming overhead.
- [ ] External OTLP destination delivery was not tested; Cloudflare persistence and the Observability REST API were tested.

## Known platform limitations to verify

Workers tracing and custom spans are beta. Span and attribute names can change. Non-I/O operations may show zero duration. Custom spans currently provide no manual parent wiring, span context access, or status setter. Cloudflare does not propagate trace IDs to external services, and OTLP export does not include metrics.

## Platform references

- [Workers traces](https://developers.cloudflare.com/workers/observability/traces/)
- [Custom spans](https://developers.cloudflare.com/workers/observability/traces/custom-spans/)
- [Tracing limitations](https://developers.cloudflare.com/workers/observability/traces/known-limitations/)
- [OpenTelemetry export](https://developers.cloudflare.com/workers/observability/exporting-opentelemetry-data/)
- [Durable Object alarms](https://developers.cloudflare.com/durable-objects/api/alarms/)

## Decision

- Diagnostic value: **High for route selection, fallback diagnosis, and Durable Object boundary discovery.**
- Trace-model mismatch: **Material for detached work because the alarm and its provider call are not connected to the initiating route.**
- Cardinality/privacy risk: **Custom fields are bounded, but native telemetry persists client and request metadata that requires explicit governance.**
- Measured overhead evidence: **CPU and wall time are recorded, but no causal overhead result is possible without an untraced baseline.**
- Recommendation: **Continue this as a vendor-neutral OpenTelemetry/CNCF lab and LFX-sized project. Do not enable the current 100% native trace configuration in Pollinations production. A production proposal needs sampling, retention, access, redaction, and detached-correlation designs plus an untraced benchmark.**
