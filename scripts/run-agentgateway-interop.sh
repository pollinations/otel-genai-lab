#!/usr/bin/env bash
set -euo pipefail

trace_file="tmp/otel/agentgateway-traces.json"
services=(agentgateway agentgateway-provider agentgateway-collector)

cleanup() {
  docker compose --profile agentgateway rm -sf "${services[@]}" >/dev/null
}
trap cleanup EXIT

mkdir -p tmp/otel
rm -f "$trace_file"

docker compose --profile agentgateway up -d "${services[@]}"
npm run interop:agentgateway:traffic

for _ in {1..15}; do
  if [[ -s "$trace_file" ]]; then
    npm run cli -- inspect "$trace_file"
    exit 0
  fi
  sleep 1
done

docker compose --profile agentgateway logs --no-color --tail=200 "${services[@]}"
echo "agentgateway trace export was not written to $trace_file" >&2
exit 1
