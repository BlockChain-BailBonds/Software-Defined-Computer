#!/usr/bin/env python3
"""Build the standalone offline Internal Computer HTML from split sources."""
from pathlib import Path
import hashlib

root = Path(__file__).resolve().parent
html = (root / 'index.html').read_text(encoding='utf-8')
css = (root / 'style.css').read_text(encoding='utf-8')
core = (root / 'core.js').read_text(encoding='utf-8')
app = (root / 'app.js').read_text(encoding='utf-8')
css_slot = '<link rel="stylesheet" href="style.css">'
js_slot = '<script src="core.js"></script><script src="app.js"></script>'
if html.count(css_slot) != 1 or html.count(js_slot) != 1:
    raise SystemExit('Invalid source HTML: expected one CSS and one JS insertion slot')
output = html.replace(css_slot, '<style>\n' + css + '\n</style>')
output = output.replace(js_slot, '<script>\n' + core + '\n</script>\n<script>\n' + app + '\n</script>')
target = root / 'internal_computer.html'
target.write_text(output, encoding='utf-8')
print('Built:', target)
print('SHA256:', hashlib.sha256(target.read_bytes()).hexdigest())
