import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

class PackagingTests(unittest.TestCase):
    def test_manifest(self):
        data = json.loads((ROOT/'manifest.json').read_text())
        self.assertEqual(len(data['esp_base']['commit']),40)
        self.assertFalse(data['status']['hardware_accepted'])
    def test_no_flash_command_in_overlay(self):
        script = (ROOT/'esp_overlay/usr/bin/evil').read_text()
        self.assertNotIn('esptool', script)
        self.assertNotIn('write_flash', script)
        self.assertNotIn('rfkill', script)
    def test_shell_syntax(self):
        subprocess.run(['sh', '-n', str(ROOT/'esp_overlay/usr/bin/evil')], check=True)
    def test_shell_help(self):
        proc = subprocess.run(['sh', str(ROOT/'esp_overlay/usr/bin/evil'),'help'],
                              text=True, capture_output=True, check=True)
        self.assertIn('MOBILE RED LAB', proc.stdout)
    def test_unsupported_subcommand(self):
        proc = subprocess.run(['sh', str(ROOT/'esp_overlay/usr/bin/evil'),'erase'],
                              text=True, capture_output=True)
        self.assertEqual(proc.returncode, 2)
    def test_python_compilation(self):
        import ast
        ast.parse((ROOT/'phone/redlab.py').read_text())
        ast.parse((ROOT/'tools/integrate.py').read_text())
    def test_upstream_pinned(self):
        manifest = json.loads((ROOT/'manifest.json').read_text())
        script = (ROOT/'tools/integrate.py').read_text()
        self.assertIn(manifest['esp_base']['commit'], script)
    def test_scripts_do_not_flash_by_default(self):
        data = (ROOT/'tools/build.sh').read_text()
        self.assertNotIn('flash.sh ', data)
        self.assertIn('build/reproduce.sh', data)

if __name__=='__main__': unittest.main()
