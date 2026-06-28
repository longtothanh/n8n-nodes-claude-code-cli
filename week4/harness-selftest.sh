#!/usr/bin/env bash
# Week 4 — Harness self-test: drives the standup webhook twice (bad → good)
# and asserts on the n8n execution record (not log scraping). Non-zero exit
# means the harness is broken — i.e. this script *is* the CI-able gate.
#
# Usage:   ./harness-selftest.sh
# Env:
#   N8N_HOST            default http://localhost:5678
#   N8N_API_KEY         required — n8n personal API key (Settings → API)
#   STANDUP_WEBHOOK     default $N8N_HOST/webhook/standup-run
#   N8N_CONTAINER       default n8n   (used to flip STANDUP_FORCE_FAIL)
#   WORKFLOW_ID         optional — limits exec lookup to one workflow
#
# Exit codes:
#   0  RED proven + GREEN proven  → backpressure works
#   1  RED step failed (post happened, or execution didn't go red)
#   2  GREEN step failed (post did not happen, or execution didn't go green)
#   3  precondition (env / container / api) failed
set -euo pipefail

N8N_HOST="${N8N_HOST:-http://localhost:5678}"
STANDUP_WEBHOOK="${STANDUP_WEBHOOK:-$N8N_HOST/webhook/standup-run}"
N8N_CONTAINER="${N8N_CONTAINER:-n8n}"
: "${N8N_API_KEY:?N8N_API_KEY is required (Settings → API in the n8n UI)}"

need() { command -v "$1" >/dev/null 2>&1 || { echo "missing: $1" >&2; exit 3; }; }
need curl; need jq; need docker

api() {  # GET against the n8n REST API
  curl -fsS -H "X-N8N-API-KEY: $N8N_API_KEY" "$N8N_HOST/api/v1/$1"
}

set_flag() {  # set or clear STANDUP_FORCE_FAIL on the n8n container, then restart
  local value="$1"
  if [[ -z "$value" ]]; then
    docker exec "$N8N_CONTAINER" sh -c 'unset STANDUP_FORCE_FAIL' >/dev/null || true
    # cleanest way to clear an env var on a running container: re-up via compose
    # — but to avoid touching compose here, we just set it to empty.
    docker exec -e STANDUP_FORCE_FAIL= "$N8N_CONTAINER" true >/dev/null
  else
    docker exec -e STANDUP_FORCE_FAIL="$value" "$N8N_CONTAINER" true >/dev/null
  fi
}

latest_exec_id() {  # newest execution id (optionally for $WORKFLOW_ID)
  local q="limit=1&includeData=false"
  [[ -n "${WORKFLOW_ID:-}" ]] && q="$q&workflowId=${WORKFLOW_ID}"
  api "executions?$q" | jq -r '.data[0].id'
}

exec_record() { api "executions/$1?includeData=true"; }

ran() {  # ran <exec.json> <nodeName>  -> True|False (did the node produce any output?)
  jq -r --arg n "$2" '
    (.data.resultData.runData[$n] // []) | length | if . > 0 then "True" else "False" end
  ' <<<"$1"
}

node_json() {  # node_json <exec.json> <nodeName>  -> first item's json output
  jq -r --arg n "$2" '
    (.data.resultData.runData[$n][0].data.main[0][0].json // {}) | tojson
  ' <<<"$1"
}

fire() {
  curl -fsS -X POST "$STANDUP_WEBHOOK" -H 'content-type: application/json' -d '{}' >/dev/null || true
  sleep 4   # let n8n write the execution record
}

echo "── 1. RED — feed bad input (STANDUP_FORCE_FAIL=output) ─────"
set_flag "output"
fire
RED_ID="$(latest_exec_id)"
RED_REC="$(exec_record "$RED_ID")"
RED_STATUS="$(jq -r '.status // .finished // "?"' <<<"$RED_REC")"
RED_VO="$(node_json "$RED_REC" 'Validate Output')"
RED_VO_VALID="$(jq -r '.valid' <<<"$RED_VO")"
RED_VO_ERR="$(jq -c '.errors' <<<"$RED_VO")"
RED_POST="$(ran "$RED_REC" 'Post Standup')"
RED_HANDLE="$(ran "$RED_REC" 'Handle Error (Alert)')"
RED_STOP="$(ran "$RED_REC" 'Stop And Error')"

echo "STATUS=$RED_STATUS  POST_RAN=$RED_POST  HANDLE_RAN=$RED_HANDLE  STOP_RAN=$RED_STOP  VO_VALID=$RED_VO_VALID"
echo "VO_ERR=$RED_VO_ERR   exec id=$RED_ID"

if [[ "$RED_POST" != "False" || "$RED_HANDLE" != "True" || "$RED_STATUS" != "error" ]]; then
  echo "✗ RED FAILED — gate did NOT block the post (status=$RED_STATUS post=$RED_POST handle=$RED_HANDLE)" >&2
  exit 1
fi
echo "✔ RED proven: gate BLOCKED the post, execution red, alert sent"

echo
echo "── 2. GREEN — clear the flag, good run posts ───────────────"
set_flag ""
fire
GREEN_ID="$(latest_exec_id)"
GREEN_REC="$(exec_record "$GREEN_ID")"
GREEN_STATUS="$(jq -r '.status // "?"' <<<"$GREEN_REC")"
GREEN_POST="$(ran "$GREEN_REC" 'Post Standup')"
GREEN_HANDLE="$(ran "$GREEN_REC" 'Handle Error (Alert)')"

echo "STATUS=$GREEN_STATUS  POST_RAN=$GREEN_POST  HANDLE_RAN=$GREEN_HANDLE   exec id=$GREEN_ID"

if [[ "$GREEN_POST" != "True" || "$GREEN_STATUS" != "success" ]]; then
  echo "✗ GREEN FAILED — clean run did not post (status=$GREEN_STATUS post=$GREEN_POST)" >&2
  exit 2
fi
echo "✔ GREEN proven: validation passed, standup posted"

echo
echo "✔ SELF-TEST PASSED — backpressure works.  RED exec=$RED_ID  GREEN exec=$GREEN_ID"
