import json
import os
import socket
import sys
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'phone'))
from redlab import RedLab, LabError, LabServer, canonical_host, target_addresses, validate_ports, validate_port

class ValidationTests(unittest.TestCase):
    def test_ipv4(self):
        self.assertEqual(canonical_host(' 192.168.0.1 '), '192.168.0.1')
    def test_hostname(self):
        self.assertEqual(canonical_host('LOCALHOST'), 'localhost')
    def test_single_label(self):
        self.assertEqual(canonical_host('x'), 'x')
    def test_reject_shell_payload(self):
        for value in ['-p 22', 'evil;id', '127.0.0.1/24', 'a b', '', 'a..b', 'evil\ncommand']:
            with self.subTest(value=value), self.assertRaises(LabError):
                canonical_host(value)
    def test_reject_public_address(self):
        with self.assertRaises(LabError):
            target_addresses('8.8.8.8')
    def test_approve_private_address(self):
        self.assertEqual(target_addresses('127.0.0.1')[0][1], '127.0.0.1')
    def test_dns_rebinding_guard(self):
        info = [(socket.AF_INET, socket.SOCK_STREAM, 6, '', ('8.8.8.8', 0))]
        with patch('redlab.socket.getaddrinfo', return_value=info):
            with self.assertRaises(LabError):
                target_addresses('internal.local')
    def test_ports_are_explicit(self):
        self.assertEqual(validate_ports([22, 80]), [22, 80])
        for candidate in [[], [0], [65536], [80, 80], list(range(1, 15)), ['22-25']]:
            with self.subTest(ports=candidate), self.assertRaises(LabError):
                validate_ports(candidate)
    def test_reject_boolean_port(self):
        with self.assertRaises(LabError):
            validate_port(True)

class LabTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.lab = RedLab(Path(self.temp.name))
    def tearDown(self):
        self.temp.cleanup()
    def test_scope_requires_consent(self):
        with self.assertRaises(LabError):
            self.lab.add_target('127.0.0.1', False)
    def test_scope_round_trip(self):
        self.assertEqual(self.lab.add_target('127.0.0.1', True), ['127.0.0.1'])
        self.assertEqual(self.lab.remove_target('127.0.0.1'), [])
    def test_public_scope_refused(self):
        with self.assertRaises(LabError):
            self.lab.add_target('8.8.8.8', True)
    def test_probe_blocked_without_scope(self):
        with self.assertRaises(LabError):
            self.lab.probe('127.0.0.1', [80])
    def test_tcp_probe_local_open(self):
        s = socket.socket(); s.bind(('127.0.0.1', 0)); s.listen(1)
        try:
            port = s.getsockname()[1]
            self.lab.add_target('127.0.0.1', True)
            data = self.lab.probe('127.0.0.1', [port])
            self.assertEqual(data['checks'][0]['results'][0]['state'], 'open')
            self.assertEqual(self.lab.events()[-1]['type'], 'tcp_connect_check')
        finally:
            s.close()
    def test_board_command_allowlist(self):
        self.lab.add_target('127.0.0.1', True)
        with self.assertRaises(LabError):
            self.lab.board('127.0.0.1', 'rm -rf /')
    def test_reports_are_not_exploit_claims(self):
        report = self.lab.report()
        self.assertIn('no vulnerability proof', ' '.join(report['limits']))
    def test_deterministic_agent(self):
        report = self.lab.analyze(False)
        self.assertEqual(report['mode'], 'deterministic')
        self.assertIn('not confirmed vulnerabilities', report['summary'])
    def test_event_truncation_for_response(self):
        for i in range(10):
            self.lab.event('test', {'i': i})
        self.assertEqual(len(self.lab.events(3)), 3)

class HTTPTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.lab = RedLab(Path(self.temp.name))
        self.server = LabServer(('127.0.0.1', 0), self.lab, 'test-token')
        self.worker = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.worker.start()
        self.url = f'http://127.0.0.1:{self.server.server_port}'
    def tearDown(self):
        self.server.shutdown(); self.server.server_close(); self.worker.join(3)
        self.temp.cleanup()
    def request(self, endpoint, *, token=None, payload=None, origin=None):
        h = {}
        if token: h['X-RedLab-Token'] = token
        if origin: h['Origin'] = origin
        method = 'POST' if payload is not None else 'GET'
        if payload is not None: h['Content-Type'] = 'application/json'
        return urllib.request.urlopen(urllib.request.Request(self.url + endpoint, headers=h,
            data=json.dumps(payload).encode() if payload is not None else None, method=method), timeout=2)
    def test_auth_required(self):
        with self.assertRaises(urllib.error.HTTPError) as info:
            self.request('/api/status')
        self.assertEqual(info.exception.code, 401)
    def test_bad_origin_rejected(self):
        with self.assertRaises(urllib.error.HTTPError) as info:
            self.request('/api/status', token='test-token', origin='https://bad.example')
        self.assertEqual(info.exception.code, 403)
    def test_status_authorized(self):
        with self.request('/api/status', token='test-token') as response:
            self.assertEqual(json.loads(response.read())['version'], '0.1.0')
    def test_can_add_scope_with_confirmation(self):
        with self.request('/api/targets', token='test-token', payload={'host':'127.0.0.1','authorized':True}) as response:
            self.assertEqual(json.loads(response.read())['targets'], ['127.0.0.1'])
    def test_reject_unauthorized_scope_add(self):
        with self.assertRaises(urllib.error.HTTPError) as info:
            self.request('/api/targets', token='test-token', payload={'host':'127.0.0.1','authorized':False})
        self.assertEqual(info.exception.code, 400)
    def test_virtual_machine_asset(self):
        with self.request('/vm') as response:
            self.assertIn(b'html', response.read(256).lower())

if __name__ == '__main__': unittest.main()
