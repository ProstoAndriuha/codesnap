import importlib.util
import json
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('mail_host', Path(__file__).with_name('mail_host.py'))
host = importlib.util.module_from_spec(spec)
spec.loader.exec_module(host)

class MailTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = patch.object(host, 'ROOT', Path(self.temp.name)); self.root.start()

    def tearDown(self):
        self.root.stop(); self.temp.cleanup()

    def test_dpapi_vault_and_public_metadata(self):
        with host.vault() as data:
            data['accounts'] = [{'id': 'one', 'email': 'a@yahoo.com', 'provider': 'yahoo', 'password': 'example-secret-not-real'}]
        encrypted = (host.ROOT / 'accounts.dpapi').read_bytes()
        self.assertNotIn(b'example-secret-not-real', encrypted)
        self.assertNotIn(b'a@yahoo.com', encrypted)
        self.assertEqual(host.dispatch({'command': 'list'})['accounts'], [{'id': 'one', 'email': 'a@yahoo.com', 'provider': 'yahoo'}])
        host.dispatch({'command': 'remove', 'id': 'one'})
        self.assertEqual(host.dispatch({'command': 'list'})['accounts'], [])

    def test_presets_and_validation(self):
        for provider, expected in host.PRESETS.items():
            self.assertEqual(host.validate({'provider': provider, 'email': 'a@example.com', 'password': 'app', 'host': 'attacker.test'})['host'], expected)
        for invalid in [{'provider': 'imap', 'email': 'bad', 'host': 'imap.example.com', 'password': 'app'}, {'provider': 'imap', 'email': 'a@e.com', 'host': 'imap.e.com\r\n', 'password': 'app'}, {'provider': 'imap', 'email': 'a@e.com', 'host': 'https://e.com', 'password': 'app'}]:
            with self.assertRaises(host.MailError): host.validate(invalid)

    def test_imap_readonly_peek_and_internal_date(self):
        account = host.validate({'provider': 'imap', 'email': 'a@example.com', 'password': 'app', 'host': 'imap.example.com'})
        now = host.datetime.datetime.now(host.datetime.timezone.utc).strftime('%d-%b-%Y %H:%M:%S %z')
        raw = b'From: Codes <codes@example.com>\r\nSubject: Your verification code\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nYour code is 483921'
        class IMAP:
            def __init__(self, *args, **kwargs): self.calls = []
            def login(self, *args): pass
            def select(self, folder, readonly=False):
                self.readonly = readonly; return 'OK', [b'1']
            def uid(self, cmd, *args):
                self.calls.append((cmd, args))
                return ('OK', [b'42']) if cmd == 'search' else ('OK', [(f'1 (UID 42 INTERNALDATE "{now}" BODY[]'.encode(), raw)])
            def logout(self): pass
        fake = IMAP()
        with patch.object(host.imaplib, 'IMAP4_SSL', return_value=fake): result = host.search_imap(account, 180)
        self.assertTrue(fake.readonly)
        self.assertIn('BODY.PEEK[]', fake.calls[1][1][1])
        self.assertEqual(result[0]['body'], 'Your code is 483921')
        self.assertEqual(result[0]['from'], 'Codes <codes@example.com>')
        self.assertEqual(result[0]['accountProvider'], 'imap')

    def test_failed_connect_does_not_store_credentials(self):
        with patch.object(host.imaplib, 'IMAP4_SSL', side_effect=host.imaplib.IMAP4.error('secret server text')):
            with self.assertRaisesRegex(host.MailError, '^MAIL_AUTH_FAILED$'):
                host.dispatch({'command': 'connect', 'provider': 'yahoo', 'email': 'a@yahoo.com', 'password': 'bad'})
        self.assertEqual(host.dispatch({'command': 'list'})['accounts'], [])

    def test_reconnecting_mail_preserves_account_selection_identity(self):
        @host.contextlib.contextmanager
        def connection(account): yield None
        with patch.object(host, 'imap_connection', connection):
            first = host.dispatch({'command': 'connect', 'provider': 'yahoo', 'email': 'a@yahoo.com', 'password': 'one'})
            second = host.dispatch({'command': 'connect', 'provider': 'yahoo', 'email': 'a@yahoo.com', 'password': 'two'})
        self.assertEqual(first['account']['id'], second['account']['id'])
        self.assertEqual(len(host.dispatch({'command': 'list'})['accounts']), 1)

    def test_outlook_device_flow_and_refresh_are_encrypted(self):
        client = '00000000-0000-4000-8000-000000000000'
        response = {'device_code': 'private-device', 'user_code': 'USER-CODE', 'verification_uri': 'https://microsoft.com/devicelogin', 'expires_in': 900, 'interval': 5}
        with patch.object(host, 'ms_request', return_value=response): result = host.outlook_start(client)
        self.assertNotIn('device_code', result)
        self.assertNotIn(b'private-device', (host.ROOT / 'accounts.dpapi').read_bytes())
        with patch.object(host, 'ms_request', return_value={'error': 'authorization_pending'}):
            self.assertTrue(host.outlook_poll(result['pendingId'])['pending'])
        with patch.object(host, 'ms_request', side_effect=[{'access_token': 'private-token', 'refresh_token': 'private-refresh', 'expires_in': 3600}, {'mail': 'a@outlook.com'}]): connected = host.outlook_poll(result['pendingId'])
        self.assertEqual(connected['account']['email'], 'a@outlook.com')
        self.assertNotIn('access_token', connected['account'])
        self.assertNotIn(b'private-refresh', (host.ROOT / 'accounts.dpapi').read_bytes())

    def test_protocol_origin_and_ping(self):
        import struct
        executable = Path(__file__).resolve().parents[2] / 'CodeSnap-Mail' / 'CodeSnapMail.exe'
        payload = json.dumps({'command': 'ping'}).encode()
        result = subprocess.run([str(executable), host.ORIGIN], input=struct.pack('<I', len(payload)) + payload, capture_output=True, timeout=15)
        size = struct.unpack('<I', result.stdout[:4])[0]
        self.assertEqual(size, len(result.stdout[4:]))
        self.assertTrue(json.loads(result.stdout[4:])['readOnly'])
        foreign = subprocess.run([str(executable), 'chrome-extension://foreign/'], input=struct.pack('<I', len(payload)) + payload, capture_output=True, timeout=15)
        self.assertEqual(foreign.stdout, b'')

if __name__ == '__main__': unittest.main()
