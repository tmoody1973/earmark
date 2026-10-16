#!/usr/bin/env bash
# Forwards live Bee events to the Earmark agent. `bee stream` exits when its
# connection drops and never retries, so this loop restarts it. Stop with Ctrl-C.
# Never prints the secret or the full URL (host/path only).
set -euo pipefail
cd "$(dirname "$0")/.."
set -a
# shellcheck disable=SC1091
source .env.local
set +a
: "${EARMARK_WEBHOOK_SECRET:?EARMARK_WEBHOOK_SECRET missing in .env.local}"

BASE_URL="${EARMARK_RELAY_URL:-http://localhost:2000/api/bee/events}"
URL="${BASE_URL}?key=${EARMARK_WEBHOOK_SECRET}"
TYPES="new-utterance,new-conversation,update-conversation,update-conversation-summary,delete-conversation,update-location,todo-created,todo-updated,todo-deleted,journal-created,journal-updated,journal-deleted,journal-text"
# {{raw}} stays unquoted: the CLI does not escape template values, so only raw JSON survives quotes in speech.
BODY='{"event":"{{event}}","ts":"{{timestamp}}","data":{{raw}}}'

trap 'echo "[relay] stopped"; exit 0' INT TERM
while true; do
  echo "[relay] streaming to ${BASE_URL%%\?*}"
  bee stream --types "$TYPES" --webhook-endpoint "$URL" --webhook-body "$BODY" || true
  echo "[relay] stream ended, restarting"
  sleep 3
done
