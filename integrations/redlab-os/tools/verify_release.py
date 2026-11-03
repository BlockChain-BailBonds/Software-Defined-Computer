#!/usr/bin/env python3
"""Verify source-file checksum manifest for an unpacked RedLab release kit."""
import hashlib
import json
import sys
from pathlib import Path

root = Path(__file__).resolve().parents[1]
manifest_path = root/'SOURCE_SHA256.json'
try:
    expected = json.loads(manifest_path.read_text('utf-8'))
    if not isinstance(expected, dict) or not expected:
        raise ValueError('Empty or malformed checksum manifest')
    actual = {str(p.relative_to(root)): hashlib.sha256(p.read_bytes()).hexdigest()
              for p in root.rglob('*') if p.is_file() and p.name != 'SOURCE_SHA256.json'
              and '__pycache__' not in p.parts and not p.name.endswith('.pyc')}
    if actual != expected:
        missing = sorted(expected.keys() - actual.keys())
        extra = sorted(actual.keys() - expected.keys())
        altered = sorted(k for k in expected.keys() & actual.keys() if expected[k] != actual[k])
        raise ValueError(f'Missing={missing}; Extra={extra}; Altered={altered}')
    print(f'PASS: all {len(expected)} source and documentation files match SOURCE_SHA256.json')
except (OSError, ValueError) as exc:
    print(f'FAIL: {exc}', file=sys.stderr)
    raise SystemExit(1)
