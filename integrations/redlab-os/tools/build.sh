#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
ROOT=$(dirname "$SCRIPT_DIR")
DEST=${1:-"$ROOT/derived-linux-esp32s3"}
python3 "$SCRIPT_DIR/integrate.py" --dest "$DEST"
printf '\nDerived checkout: %s\n' "$DEST"
printf 'To build on a Linux x86-64 host with Docker, >=25 GiB free, and internet:\n'
printf '  cd %q && JOBS=8 bash build/reproduce.sh\n' "$DEST"
printf '\nBuild outputs are for review and testing only. No firmware has been flashed.\n'
