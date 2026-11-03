#!/usr/bin/env python3
"""Validate recorded source release; never execute untrusted source in this check."""
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
manifest = ROOT / 'RELEASE_MANIFEST.json'
ledger = ROOT / 'SHA256SUMS'
if not manifest.is_file() or not ledger.is_file():
    raise SystemExit('Missing release manifest or SHA256SUMS')
records = json.loads(manifest.read_text(encoding='utf-8'))
if records.get('schema_version') != 1 or not isinstance(records.get('files'), list):
    raise SystemExit('Unexpected manifest schema')
listed = {}
for record in records['files']:
    rel = record['path']
    if rel.startswith('/') or '..' in Path(rel).parts or '\\' in rel:
        raise SystemExit(f'Unsafe recorded path: {rel}')
    target = ROOT / rel
    if not target.is_file():
        raise SystemExit(f'Missing file: {rel}')
    actual = hashlib.sha256(target.read_bytes()).hexdigest()
    if actual != record['sha256'] or target.stat().st_size != record['bytes']:
        raise SystemExit(f'Integrity mismatch: {rel}')
    if rel in listed:
        raise SystemExit(f'Duplicate file: {rel}')
    listed[rel] = actual
excluded = {'RELEASE_MANIFEST.json', 'SHA256SUMS'}
actual_files = {p.relative_to(ROOT).as_posix() for p in ROOT.rglob('*')
                if p.is_file() and not any(part in {'.git', '__pycache__', '.pytest_cache', '.venv'} for part in p.parts)
                and not p.name.endswith('.pyc') and p.suffix not in {'.sqlite', '.sqlite3', '.db', '.log'}
                and 'data' not in p.relative_to(ROOT).parts and p.relative_to(ROOT).as_posix() not in excluded}
if actual_files != set(listed):
    raise SystemExit('Unexpected or unrecorded files: ' + str(sorted(actual_files.symmetric_difference(listed))))
expected_lines = ''.join(f'{listed[rel]}  {rel}\n' for rel in sorted(listed))
if ledger.read_text(encoding='utf-8') != expected_lines:
    raise SystemExit('SHA256SUMS differs from manifest')
print(f'PASS: {len(listed)} source files SHA-256 validated')
