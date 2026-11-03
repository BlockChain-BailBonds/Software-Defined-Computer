#!/usr/bin/env bash
set -euo pipefail
if [[ $# -lt 1 ]]; then
  echo 'Usage: scripts/gguf-server.sh /absolute/path/model.gguf [port]' >&2
  exit 2
fi
MODEL="$1"
PORT="${2:-8081}"
if [[ ! -f "$MODEL" ]]; then echo 'GGUF file not found' >&2; exit 1; fi
# A separate llama-server process may run for every configured role/model.
exec llama-server -m "$MODEL" --host 127.0.0.1 --port "$PORT" -c 4096 -ngl 0
