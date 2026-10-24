-- Five-minute SLO buckets from Pollinations production Tinybird, using the
-- coverage filters and SLI definitions in docs/slo/pollinations-slo-spec.md.
-- Aggregate only: counts per event type and official model name.
--
-- __LATENCY_THRESHOLD_SQL__ and __DAYS__ are substituted by
-- scripts/slo-export-pollinations.sh from slo/targets/pollinations.json.
SELECT
  formatDateTime(toStartOfFiveMinutes(start_time), '%Y-%m-%dT%H:%i:%SZ') AS start,
  event_type,
  resolved_model_requested AS model,
  countIf(is_final AND (response_status < 400 OR response_status >= 500)) AS availability_valid,
  countIf(is_final AND response_status < 400) AS availability_good,
  countIf(is_final AND response_status >= 200 AND response_status < 300) AS latency_valid,
  countIf(
    is_final AND response_status >= 200 AND response_status < 300
    AND response_time <= __LATENCY_THRESHOLD_SQL__
  ) AS latency_good,
  countIf(NOT fallback_used AND error_response_code != 'community_model_rate_limit') AS primary_valid,
  countIf(
    NOT fallback_used AND error_response_code != 'community_model_rate_limit'
    AND response_status >= 200 AND response_status < 300
  ) AS primary_good
FROM generation_events_classified
WHERE environment = 'production'
  AND traffic_group = 'regular'
  AND model_provider_used != 'community'
  AND start_time >= now() - INTERVAL __DAYS__ DAY
GROUP BY start, event_type, model
ORDER BY start, event_type, model
