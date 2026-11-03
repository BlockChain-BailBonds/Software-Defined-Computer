#!/usr/bin/env python3
"""Copy additive ESP overlay into an isolated checkout of the pinned upstream revision.

This tool never flashes firmware and never edits an existing upstream checkout.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import shutil
import subprocess
import sys
from pathlib import Path

UPSTREAM_URL = 'https://github.com/paulneja/Linux-on-esp32-S3.git'
UPSTREAM_SHA = '979acc45629e985b757735e8222dbedf3aa5f1e1'
ROOT = Path(__file__).resolve().parents[1]
TARGET_OVERLAY = Path('new-files/board/espressif/esp32s3/rootfs_overlay')

def run(args: list[str], *, cwd: Path | None = None) -> str:
    result = subprocess.run(args, cwd=cwd, check=True, text=True, capture_output=True)
    return result.stdout.strip()

def integrate(dest: Path, *, local_source: Path | None = None) -> dict:
    dest = dest.resolve()
    if dest.exists():
        raise ValueError(f'Destination already exists: {dest}')
    if local_source is None:
        run(['git', 'clone', '--no-checkout', UPSTREAM_URL, str(dest)])
    else:
        local_source = local_source.resolve()
        if not (local_source / '.git').exists():
            raise ValueError('Source must be a Git repository')
        run(['git', 'clone', '--no-checkout', str(local_source), str(dest)])
    try:
        run(['git', 'checkout', '--detach', UPSTREAM_SHA], cwd=dest)
        sha = run(['git', 'rev-parse', 'HEAD'], cwd=dest)
        if sha != UPSTREAM_SHA:
            raise ValueError(f'Unexpected source revision {sha}')
        overlay = dest / TARGET_OVERLAY
        if not overlay.is_dir():
            raise ValueError('Pinned upstream overlay path was not found')
        manifest = []
        for source in sorted((ROOT / 'esp_overlay').rglob('*')):
            if not source.is_file():
                continue
            rel = source.relative_to(ROOT / 'esp_overlay')
            destination = overlay / rel
            if destination.exists() or destination.is_symlink():
                raise ValueError(f'Collision with upstream-owned file: {rel}')
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, destination)
            digest = hashlib.sha256(destination.read_bytes()).hexdigest()
            manifest.append({'path': str(TARGET_OVERLAY / rel), 'sha256': digest})
        # The upstream reproducible builder snapshots only committed HEAD.
        run(['git', 'add', '--', str(TARGET_OVERLAY)], cwd=dest)
        run(['git', 'diff', '--cached', '--check'], cwd=dest)
        run(['git', '-c', 'user.name=RedLab Builder',
             '-c', 'user.email=builder@localhost', 'commit', '-m',
             'Add Evil Inspector Gadget RedLab OS non-flashing overlay'], cwd=dest)
        head = run(['git', 'rev-parse', 'HEAD'], cwd=dest)
        output = {'version': '0.1.0', 'upstream': UPSTREAM_URL, 'upstream_sha': sha,
                  'derived_commit': head, 'overlay': manifest, 'hardware_tested': False,
                  'flash_performed': False}
        (dest.parent / (dest.name + '-integration.json')).write_text(
            json.dumps(output, indent=2) + '\n', encoding='utf-8')
        return output
    except BaseException:
        # Keep failed staging for inspection, but never modify a source checkout.
        raise

def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--dest', type=Path, required=True,
                        help='New, nonexistent destination for derived git checkout')
    parser.add_argument('--local-source', type=Path,
                        help='Optional local upstream Git clone (must contain pinned commit)')
    args = parser.parse_args()
    result = integrate(args.dest, local_source=args.local_source)
    print(json.dumps(result, indent=2))
    print('\nNo build, flash, or board mutation was performed.')
    return 0

if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except (OSError, ValueError, subprocess.CalledProcessError) as exc:
        print(f'ERROR: {exc}', file=sys.stderr)
        raise SystemExit(1)
