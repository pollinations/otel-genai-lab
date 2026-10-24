-- Five-minute SLO buckets from blogs.elixpo's D1 log of Pollinations image
-- generations. Aggregate only: no user, generation or connection identifiers.
--
-- Availability excludes caller-side outcomes so that only Pollinations failures
-- spend the budget:
--   good      completed
--   bad       failed with a 5xx, or failed after the call started (timeout,
--             network error) without a provider status
--   excluded  failed with a 4xx (pollen, permissions, revoked key, rate limit),
--             failed before the Pollinations call started (duration_ms is
--             NULL), and attempts still marked started
--
-- __LATENCY_THRESHOLD_MS__ and __DAYS__ are substituted by
-- scripts/slo-export-elixpo-blogs.sh.
SELECT
  strftime('%Y-%m-%dT%H:%M:%SZ', (created_at / 300) * 300, 'unixepoch') AS start,
  model,
  SUM(
    CASE
      WHEN status = 'completed' THEN 1
      WHEN status = 'failed'
        AND duration_ms IS NOT NULL
        AND (provider_status IS NULL OR provider_status NOT BETWEEN 400 AND 499)
        THEN 1
      ELSE 0
    END
  ) AS availability_valid,
  SUM(status = 'completed') AS availability_good,
  SUM(status = 'completed') AS latency_valid,
  SUM(status = 'completed' AND duration_ms <= __LATENCY_THRESHOLD_MS__) AS latency_good
FROM pollinations_generation_attempts
WHERE created_at >= unixepoch() - __DAYS__ * 86400
GROUP BY start, model
ORDER BY start, model
