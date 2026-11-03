#!/usr/bin/env python3
"""Regenerate reproducible hash manifests after intentional reviewed source updates."""
import hashlib
import json
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
exclude = {'SHA256SUMS', 'RELEASE_MANIFEST.json'}
rows = []
for path in sorted(ROOT.rglob('*')):
    if not path.is_file():
        continue
    if any(part in {'.git', '__pycache__', '.pytest_cache', '.venv'} for part in path.parts) or path.name.endswith('.pyc'):
        continue
    relative = path.relative_to(ROOT).as_posix()
    if path.suffix in {'.sqlite', '.sqlite3', '.db', '.log'} or 'data' in path.relative_to(ROOT).parts:
        continue
    if relative in exclude:
        continue
    data = path.read_bytes()
    rows.append({'path': relative, 'sha256': hashlib.sha256(data).hexdigest(), 'bytes': len(data)})
(ROOT / 'SHA256SUMS').write_text(''.join(f'{r["sha256"]}  {r["path"]}\n' for r in rows), encoding='utf-8')
(ROOT / 'RELEASE_MANIFEST.json').write_text(json.dumps({'schema_version': 1, 'release_date': '2026-11-03', 'files': rows}, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
print(f'Wrote manifest of {len(rows)} files')
