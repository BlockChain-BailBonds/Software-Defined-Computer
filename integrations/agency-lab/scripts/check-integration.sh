#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
python3 -m compileall -q agency bridge
python3 -m pytest -q
if command -v node >/dev/null 2>&1; then
  node --check tools/vm_runner.js
  (cd web/vm && node --test core.test.js ui.smoke.test.js)
else
  printf '%s\n' 'Node.js unavailable: browser VM works, but server replay and JS tests were not checked.'
fi
printf '%s\n' 'Integration source/API acceptance passed. This is NOT physical hardware acceptance.'
