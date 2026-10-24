#!/usr/bin/env bash
# Measure Pollinations SLIs from production Tinybird so objectives can be
# calibrated (docs/slo/pollinations-slo-spec.md). Read-only, aggregate-only:
# results hold counts and percentiles per event_type and official model name,
# never user, key, request or IP identifiers.
#
#   POLLINATIONS_DIR=~/pollinations bash scripts/slo-calibrate.sh
#   TINYBIRD_READ_TOKEN=... bash scripts/slo-calibrate.sh
set -euo pipefail

host="${TINYBIRD_HOST:-https://api.europe-west2.gcp.tinybird.co}"
out_dir="tmp/slo"

if [[ -z "${TINYBIRD_READ_TOKEN:-}" ]]; then
  secrets="${POLLINATIONS_DIR:?set TINYBIRD_READ_TOKEN or POLLINATIONS_DIR}/enter.pollinations.ai/secrets/prod.vars.json"
  TINYBIRD_READ_TOKEN=$(sops -d "$secrets" | jq -r '.TINYBIRD_READ_TOKEN')
fi
if [[ -z "$TINYBIRD_READ_TOKEN" || "$TINYBIRD_READ_TOKEN" == "null" ]]; then
  echo "TINYBIRD_READ_TOKEN is empty" >&2
  exit 1
fi

# Coverage filters shared by every SLI.
scope="environment = 'production'
  AND traffic_group = 'regular'
  AND model_provider_used != 'community'"

# Last three complete calendar months.
months="start_time >= toStartOfMonth(now()) - INTERVAL 3 MONTH
  AND start_time < toStartOfMonth(now())"

run() {
  local name="$1" query="$2"
  local response
  response=$(curl -fsS "$host/v0/sql" \
    -H "Authorization: Bearer $TINYBIRD_READ_TOKEN" \
    --data-urlencode "q=$query FORMAT JSON")
  jq -e 'if has("error") then error(.error) else {data, rows, statistics} end' \
    <<<"$response" >"$out_dir/$name.json"
  echo "wrote $out_dir/$name.json ($(jq '.rows' "$out_dir/$name.json") rows)"
}

mkdir -p "$out_dir"

# SLI-A: monthly availability per event_type.
run availability-monthly "
SELECT
  toStartOfMonth(start_time) AS month,
  event_type,
  countIf(response_status < 400 OR response_status >= 500) AS valid,
  countIf(response_status < 400) AS good,
  round(good / valid, 5) AS availability
FROM generation_events_classified
WHERE $scope AND $months AND is_final
GROUP BY month, event_type
ORDER BY event_type, month"

# SLI-B: latency distribution and share under candidate thresholds, last 30 days.
run latency-30d "
SELECT
  event_type,
  count() AS valid,
  quantiles(0.5, 0.9, 0.95, 0.99)(response_time) AS p50_p90_p95_p99_ms,
  round(countIf(response_time <= 2000) / valid, 4) AS within_2s,
  round(countIf(response_time <= 5000) / valid, 4) AS within_5s,
  round(countIf(response_time <= 10000) / valid, 4) AS within_10s,
  round(countIf(response_time <= 30000) / valid, 4) AS within_30s,
  round(countIf(response_time <= 60000) / valid, 4) AS within_60s,
  round(countIf(response_time <= 120000) / valid, 4) AS within_120s,
  round(countIf(response_time <= 300000) / valid, 4) AS within_300s
FROM generation_events_classified
WHERE $scope AND start_time >= now() - INTERVAL 30 DAY
  AND is_final AND response_status >= 200 AND response_status < 300
GROUP BY event_type
ORDER BY valid DESC"

# SLI-C: monthly primary upstream health per official model, same rule as model_health.
run primary-health-monthly "
SELECT
  toStartOfMonth(start_time) AS month,
  resolved_model_requested AS model,
  event_type,
  count() AS own_calls,
  countIf(response_status >= 200 AND response_status < 300) AS own_calls_ok,
  round(own_calls_ok / own_calls, 5) AS primary_health
FROM generation_events_classified
WHERE $scope AND $months
  AND NOT fallback_used AND error_response_code != 'community_model_rate_limit'
GROUP BY month, model, event_type
HAVING own_calls >= 1000
ORDER BY model, month"

# Minimum-volume guard: hourly valid availability events per event_type, last 30 days.
run hourly-volume-30d "
SELECT
  event_type,
  quantiles(0.1, 0.5)(valid) AS p10_p50_per_hour,
  min(valid) AS min_per_hour
FROM (
  SELECT toStartOfHour(start_time) AS hour, event_type, count() AS valid
  FROM generation_events_classified
  WHERE $scope AND start_time >= now() - INTERVAL 30 DAY
    AND is_final AND (response_status < 400 OR response_status >= 500)
  GROUP BY hour, event_type
)
GROUP BY event_type
ORDER BY event_type"
