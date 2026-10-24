# Pollinations service level objectives

- Status: **draft; objectives are proposals until calibrated against production data and approved by Pollinations maintainers**
- Scope: authenticated, non-cached Gen API traffic recorded in Tinybird
- Source revision inspected: `pollinations/pollinations@5d8c7dac9` (2026-10-24)

## Why

Pollinations already measures model health well. [`model_health.pipe`][model-health] separates what callers experienced from whether a model's own upstream works, [`model_route_health.pipe`][route-health] shows each execution route, and Model Monitor and the community monitor agent read those views.

What is missing is a decision rule. The repository provisions Grafana dashboards but no alert rules, and the community monitor runs as a 30-minute agent loop. Nobody is told when reliability degrades, and there is no shared answer to "how bad is this, and does it need someone now?"

This specification defines that rule: a small set of service level indicators (SLIs) computed from data Pollinations already collects, objectives for them, and multi-window burn-rate alerts. It does not add instrumentation, change routing, or replace the existing monitors.

## Data and coverage

All SLIs read [`generation_events_classified`][classified], which is `generation_event_v2` plus the existing `traffic_group` classification. Every SLI applies these filters:

| Filter                               | Reason                                                                                                                                    |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `environment = 'production'`         | Staging and local events are not user traffic.                                                                                            |
| `traffic_group = 'regular'`          | Excludes legacy bridges, operations (monitors, bots, the community model proxy) and staff development keys.                               |
| `model_provider_used != 'community'` | Community model health belongs to the model's owner. This is the rule Model Monitor uses to mark a model as community.                    |
| `event_type` set per SLO             | `generate.text`, `generate.image`, `generate.audio`, `generate.embedding`, `generate.realtime`. Video currently logs as `generate.image`. |

Known blind spots, which Phase 2's external probe is intended to cover:

- Unauthenticated requests and cache hits never reach `generation_event_v2`.
- A request that fails before tracking writes its event is invisible.
- `response_time` covers the whole response, including the full stream, so text latency includes generation length. There is no time-to-first-token field.

## Service level indicators

### SLI-A: request availability

The share of requests that did not fail because of Pollinations or its providers.

- **Valid:** `is_final` rows with `response_status < 400 OR response_status >= 500`.
- **Good:** valid rows with `response_status < 500`.

Caller errors (`4xx`) are excluded rather than counted as good, so a burst of invalid requests cannot dilute a real outage. This is safe because the gateway remaps upstream `4xx` that are Pollinations' own concern, such as provider authentication or quota, to `502` ([`failedAttemptStatus`][track] in `track.ts`). A fallback that rescues a request counts as good, because the caller succeeded.

### SLI-B: request latency

The share of successful requests that completed within a per-category threshold.

- **Valid:** `is_final` rows with `200 <= response_status < 300`.
- **Good:** valid rows with `response_time <= threshold_ms(event_type)`.

A threshold count is used instead of a percentile so that the SLI is additive across windows and can feed the same burn-rate rule as availability. Thresholds come from calibration.

### SLI-C: primary upstream health

The share of a model's own primary calls that succeeded. This uses exactly the `own_calls` and `own_calls_ok` definitions in `model_health`, so the two never disagree.

- **Valid:** all rows (final and non-final) with `NOT fallback_used AND error_response_code != 'community_model_rate_limit'`.
- **Good:** valid rows with `200 <= response_status < 300`.

SLI-C is not user-facing. It exists because a successful fallback can hide a broken primary: a model rescued on every request reads 100% available in SLI-A and 0% here. SLI-C alerts open a ticket and never page.

## Objectives

| SLO            | SLI | Grain              | Window          | Proposed objective   | Alert route   |
| -------------- | --- | ------------------ | --------------- | -------------------- | ------------- |
| Availability   | A   | per `event_type`   | rolling 30 days | calibrate (see rule) | page + ticket |
| Latency        | B   | per `event_type`   | rolling 30 days | calibrate (see rule) | ticket        |
| Primary health | C   | per official model | rolling 7 days  | calibrate (see rule) | ticket        |

Grain is deliberately coarse. Pollinations serves many models, and paging per model would be noise. Per-model detail stays in the existing dashboards, and SLI-C handles per-model upstream decay.

### Calibration rule

Objectives must describe the service Pollinations actually runs, not an aspiration. For each SLO, using the [calibration script](#calibration):

1. Compute the SLI for each of the last three calendar months.
2. Choose the highest objective from `99%`, `99.5%`, `99.9%` (availability) or `90%`, `95%`, `99%` (latency, primary health) that **at least two of the three months met**.
3. For latency, choose `threshold_ms` per category from the measured distribution so that the chosen latency objective falls between the measured p90 and p99.
4. Record the measured values next to the chosen objective in this document. Raise an objective only after two further months meet it.

If a category has too little traffic for a meaningful objective (see the minimum-volume guard below), it gets no SLO yet and is listed as such.

## Burn-rate alerting

An error budget is `1 - objective` over the SLO window. The burn rate is how fast the budget is being spent: `burn = (1 - good/valid) / (1 - objective)`. A burn rate of 1 spends exactly the whole budget over the window.

Alerts use the standard multi-window, multi-burn-rate pattern. Each alert fires only when both its long and short window exceed the threshold. The short window makes the alert reset quickly once the problem stops.

| Severity | Long window | Short window | Burn rate | Budget spent at trigger | Route  |
| -------- | ----------- | ------------ | --------- | ----------------------- | ------ |
| Page     | 1 hour      | 5 minutes    | 14.4      | 2% of 30 days           | page   |
| Page     | 6 hours     | 30 minutes   | 6         | 5% of 30 days           | page   |
| Ticket   | 3 days      | 6 hours      | 1         | 10% of 30 days          | ticket |

SLI-C uses only the ticket row, computed over its 7-day window.

**Minimum-volume guard.** An alert evaluates only when the long window has at least `min_valid` valid events, so a quiet hour with two failures cannot page anyone. `min_valid` is set per category from calibration as the 10th percentile of hourly valid volume, with a floor of 50.

Every alert links to the runbooks Pollinations already maintains: [`model-debugging`][model-debugging] for availability and latency, and [`monitor-services`][monitor-services] for GPU-backed models.

## Implementation shape

This section is a sketch for the follow-up implementation PR to `pollinations/pollinations`. It is not part of this specification's approval.

1. **Rollup.** A materialized view `slo_events_5m` over `generation_events_classified`, applying the coverage filters above and keyed by 5-minute bucket, `event_type` and `resolved_model_requested`, holding SLI-A, SLI-B and SLI-C good and valid counts. The existing `generation_usage_hourly` is too coarse for 5-minute windows and does not split by status or latency.
2. **Endpoint.** A pipe `slo_burn_rate` that sums the rollup over a requested long and short window and returns good, valid and burn rate per SLO.
3. **Alert rules.** Grafana alert rules provisioned from git next to the existing dashboards, querying the same `grafana-clickhouse-datasource` that the dashboards use.
4. **Tests.** Burn-rate arithmetic tested against Tinybird Local, which the Gen tests already use on `localhost:7181`, with synthetic events for each alert row.
5. **Dashboard.** One SLO panel per category showing remaining budget and current burn, added to an existing provisioned dashboard rather than a new one.

## Relationship to the OpenTelemetry work

The SLIs are defined on Pollinations' existing Tinybird events, so they do not depend on the unresolved gateway span conventions in [semantic-conventions-genai#231][otel-231].

Phase 2 adds an external probe, compiled with `otelc`, that calls the public Gen API and reports through the OpenTelemetry Collector's Tinybird exporter. It provides a black-box availability and time-to-first-token SLI that covers the blind spots listed above, and is compared against SLI-A rather than replacing it.

## Calibration

[`scripts/slo-calibrate.sh`](../../scripts/slo-calibrate.sh) runs read-only aggregate queries against the production workspace and writes JSON to the ignored `tmp/slo/` directory. The queries return counts and percentiles per `event_type` and per official model name. They return no user, key, request or IP identifiers.

```sh
POLLINATIONS_DIR=~/pollinations bash scripts/slo-calibrate.sh
```

The script reads `TINYBIRD_READ_TOKEN` from the environment, or decrypts it from the Pollinations production secrets with SOPS. It never prints the token.

## Open questions for Pollinations maintainers

1. Is there alerting outside the repository, such as Cloudflare notifications or a hosted Grafana alerting setup, that this would duplicate?
2. Where should pages and tickets go: a Discord channel, GitHub issues, or something else?
3. Who owns an exhausted error budget, and what does the team do when it happens?
4. Should `operations` traffic from the community model proxy count toward a separate community SLO later?

[model-health]: https://github.com/pollinations/pollinations/blob/5d8c7dac9/enter.pollinations.ai/observability/endpoints/model_health.pipe
[route-health]: https://github.com/pollinations/pollinations/blob/5d8c7dac9/enter.pollinations.ai/observability/endpoints/model_route_health.pipe
[classified]: https://github.com/pollinations/pollinations/blob/5d8c7dac9/enter.pollinations.ai/observability/pipes/generation_events_classified.pipe
[track]: https://github.com/pollinations/pollinations/blob/5d8c7dac9/gen.pollinations.ai/src/middleware/track.ts
[model-debugging]: https://github.com/pollinations/pollinations/blob/5d8c7dac9/.claude/skills/model-debugging/SKILL.md
[monitor-services]: https://github.com/pollinations/pollinations/blob/5d8c7dac9/.claude/skills/monitor-services/SKILL.md
[otel-231]: https://github.com/open-telemetry/semantic-conventions-genai/issues/231
