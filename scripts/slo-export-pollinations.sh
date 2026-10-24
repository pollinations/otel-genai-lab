#!/usr/bin/env bash
# Export SLO buckets from Pollinations production Tinybird and evaluate them
# against slo/targets/pollinations.json. Read-only and aggregate-only. DAYS
# defaults to 3, the longest alert window; budgets then report partial coverage.
#
#   TINYBIRD_READ_TOKEN=... bash scripts/slo-export-pollinations.sh
#   POLLINATIONS_DIR=~/pollinations bash scripts/slo-export-pollinations.sh
set -euo pipefail

host="${TINYBIRD_HOST:-https://api.europe-west2.gcp.tinybird.co}"
days="${DAYS:-3}"
target="slo/targets/pollinations.json"
output="tmp/slo/pollinations-buckets.json"

if [[ -z "${TINYBIRD_READ_TOKEN:-}" ]]; then
  secrets="${POLLINATIONS_DIR:?set TINYBIRD_READ_TOKEN or POLLINATIONS_DIR}/enter.pollinations.ai/secrets/prod.vars.json"
  TINYBIRD_READ_TOKEN=$(sops -d "$secrets" | jq -r '.TINYBIRD_READ_TOKEN')
fi
[[ -n "$TINYBIRD_READ_TOKEN" && "$TINYBIRD_READ_TOKEN" != "null" ]] || {
  echo "TINYBIRD_READ_TOKEN is empty" >&2
  exit 1
}
[[ "$days" =~ ^[0-9]+$ ]] || {
  echo "DAYS must be an integer" >&2
  exit 2
}

# multiIf(event_type = 'generate.text', 60000, ..., 0) from the target config.
thresholds=$(jq -er '
  .latencyThresholdsMs | to_entries
  | map(select(.key | test("^[a-z.]+$")) | "event_type = '\''\(.key)'\'', \(.value)")
  | "multiIf(\(join(", ")), 0)"' "$target")
query=$(sed -e "s/__LATENCY_THRESHOLD_SQL__/$thresholds/" -e "s/__DAYS__/$days/" \
  slo/sql/pollinations-buckets.sql | grep -v '^--' | tr '\n' ' ')

mkdir -p "$(dirname "$output")"
curl -fsS "$host/v0/sql" -H "Authorization: Bearer $TINYBIRD_READ_TOKEN" \
  --data-urlencode "q=$query FORMAT JSON" |
  jq -e 'if has("error") then error(.error) else . end | {
    source: "pollinations",
    bucketSeconds: 300,
    buckets: [.data[] | {
      start,
      eventType: .event_type,
      model,
      availability: {valid: .availability_valid, good: .availability_good},
      latency: {valid: .latency_valid, good: .latency_good},
      primary: {valid: .primary_valid, good: .primary_good}
    }]
  }' >"$output"
echo "wrote $output ($(jq '.buckets | length' "$output") buckets)"

npm run -s cli -- slo "$output" --target "$target"
