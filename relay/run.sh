#!/usr/bin/env bash
# Forwards live Bee events to the Earmark ingress. `bee stream` exits when its
# connection drops and never retries, so this loop restarts it. Stop with Ctrl-C.
# The secret goes in an `x-earmark-key` header via relay/forward.ts (the CLI's own webhook cannot add headers).
# Never prints the secret or the full URL (host/path only).
# Config: EARMARK_RELAY_URL + EARMARK_WEBHOOK_SECRET from the environment (systemd EnvironmentFile) or from .env.local.
set -euo pipefail
cd "$(dirname "$0")/.."
if [ -f .env.local ]; then
  set -a
  # shellcheck disable=SC1091
  source .env.local
  set +a
fi
: "${EARMARK_WEBHOOK_SECRET:?EARMARK_WEBHOOK_SECRET missing}"
export EARMARK_RELAY_URL="${EARMARK_RELAY_URL:-http://localhost:2000/api/bee/events}"

TYPES="new-utterance,new-conversation,update-conversation,update-conversation-summary,delete-conversation,update-location,todo-created,todo-updated,todo-deleted,journal-created,journal-updated,journal-deleted,journal-text"

trap 'echo "[relay] stopped"; exit 0' INT TERM
# Backoff: 3 s doubling to a 60 s cap; a run that lasted >= 60 s was healthy, so the delay resets.
delay=3
while true; do
  echo "[relay] streaming to ${EARMARK_RELAY_URL%%\?*}"
  started=$SECONDS
  bee stream --json --types "$TYPES" | node relay/forward.ts || true
  if [ $((SECONDS - started)) -ge 60 ]; then delay=3; fi
  echo "[relay] stream ended, restarting in ${delay}s"
  sleep "$delay"
  delay=$((delay * 2 > 60 ? 60 : delay * 2))
done
