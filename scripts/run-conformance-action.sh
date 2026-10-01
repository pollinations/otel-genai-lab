#!/usr/bin/env bash
set -euo pipefail

: "${ACTION_PATH:?ACTION_PATH is required}"
: "${GITHUB_WORKSPACE:?GITHUB_WORKSPACE is required}"
: "${TRACE_PATH:?TRACE_PATH is required}"
: "${REPORT_PATH:?REPORT_PATH is required}"
: "${REPORT_FORMAT:?REPORT_FORMAT is required}"

if [[ "$REPORT_FORMAT" != "json" && "$REPORT_FORMAT" != "text" ]]; then
  echo "format must be json or text" >&2
  exit 2
fi

validate_relative_path() {
  local label="$1"
  local value="$2"
  if [[ "$value" == /* || "$value" == ".." || "$value" == ../* || "$value" == */../* || "$value" == */.. ]]; then
    echo "$label must stay within GITHUB_WORKSPACE" >&2
    exit 2
  fi
}

validate_relative_path "traces" "$TRACE_PATH"
validate_relative_path "report" "$REPORT_PATH"

trace_file="$GITHUB_WORKSPACE/$TRACE_PATH"
report_file="$GITHUB_WORKSPACE/$REPORT_PATH"
mkdir -p -- "$(dirname -- "$report_file")"

set -o pipefail
node "$ACTION_PATH/dist/bin.js" validate "$trace_file" --format "$REPORT_FORMAT" | tee "$report_file"
