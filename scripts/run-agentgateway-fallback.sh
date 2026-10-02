#!/usr/bin/env bash
set -euo pipefail

trace_file="tmp/otel/agentgateway-fallback-traces.json"
services=(agentgateway-fallback agentgateway-provider agentgateway-fallback-collector)

cleanup() {
  docker compose --profile agentgateway-fallback rm -sf "${services[@]}" >/dev/null
}
trap cleanup EXIT

mkdir -p tmp/otel
rm -f "$trace_file"

docker compose --profile agentgateway-fallback up -d "${services[@]}"
npm run interop:agentgateway:fallback:traffic

for _ in {1..15}; do
  if [[ -s "$trace_file" ]]; then
    npm run cli -- inspect "$trace_file"
    exit 0
  fi
  sleep 1
done

docker compose --profile agentgateway-fallback logs --no-color --tail=200 "${services[@]}"
echo "agentgateway fallback trace export was not written to $trace_file" >&2
exit 1
