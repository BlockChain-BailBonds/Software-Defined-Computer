#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ ! -f .env.local ]]; then
  umask 077
  printf 'export AGENCY_ADMIN_KEY=%q\n' "$(python3 -c 'import secrets;print(secrets.token_urlsafe(36))')" > .env.local
  printf 'Created private .env.local with a new admin key.\n'
fi
# shellcheck source=/dev/null
source .env.local
: "${AGENCY_HOST:=127.0.0.1}"
: "${AGENCY_PORT:=8789}"
python3 -m uvicorn agency.api:app --host "$AGENCY_HOST" --port "$AGENCY_PORT" --workers 1
