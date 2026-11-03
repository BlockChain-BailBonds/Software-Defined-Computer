#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
python3 scripts/verify_release.py
(cd core && node --test *.test.js)
(cd extensions/ntl && node --test *.test.js)
(cd integrations/agency-lab/web/vm && node --test *.test.js)
(cd integrations/agency-lab && python3 -m pytest -q tests)
(cd integrations/redlab-os && python3 -m unittest discover -s tests -q)
python3 -m compileall -q integrations/agency-lab integrations/redlab-os
echo 'SOURCE CHECKS PASS. Hardware acceptance is not implied.'
