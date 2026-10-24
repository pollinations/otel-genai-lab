#!/usr/bin/env bash
# Export SLO buckets from blogs.elixpo's production D1 database and evaluate
# them against slo/targets/elixpo-blogs.json. Read-only and aggregate-only.
#
#   BLOGS_DIR=~/elixpo_projects/blogs.elixpo bash scripts/slo-export-elixpo-blogs.sh
set -euo pipefail

blogs_dir="${BLOGS_DIR:?set BLOGS_DIR to the blogs.elixpo checkout}"
days="${DAYS:-30}"
target="slo/targets/elixpo-blogs.json"
output="tmp/slo/elixpo-blogs-buckets.json"

threshold=$(jq -er '.latencyThresholdsMs["generate.image"]' "$target")
[[ "$threshold" =~ ^[0-9]+$ && "$days" =~ ^[0-9]+$ ]] || {
  echo "threshold and DAYS must be integers" >&2
  exit 2
}
query=$(sed -e "s/__LATENCY_THRESHOLD_MS__/$threshold/" -e "s/__DAYS__/$days/" \
  slo/sql/elixpo-blogs-buckets.sql | grep -v '^--' | tr '\n' ' ')

mkdir -p "$(dirname "$output")"
(cd "$blogs_dir" && npx wrangler d1 execute lixblogs --remote --json --command "$query") |
  jq '{
    source: "elixpo-blogs",
    bucketSeconds: 300,
    buckets: [.[0].results[] | {
      start,
      eventType: "generate.image",
      model,
      availability: {valid: .availability_valid, good: .availability_good},
      latency: {valid: .latency_valid, good: .latency_good}
    }]
  }' >"$output"
echo "wrote $output ($(jq '.buckets | length' "$output") buckets)"

npm run -s cli -- slo "$output" --target "$target"
