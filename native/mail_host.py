"""CodeSnap read-only mail helper. Native messaging only; no listening port."""
import base64
import contextlib
import ctypes
import datetime
import email
import email.policy
import html
import imaplib
import json
import os
import re
import ssl
import struct
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from pathlib import Path

ORIGIN = 'chrome-extension://ongiekgidmkffdhgmjmlnjjgoggojoak/'
ROOT = Path(os.environ.get('LOCALAPPDATA', str(Path.home()))) / 'CodeSnap' / 'Mail'
PRESETS = {'yahoo': 'imap.mail.yahoo.com', 'yandex': 'imap.yandex.ru', 'mailru': 'imap.mail.ru'}
SCOPE = 'https://graph.microsoft.com/Mail.Read https://graph.microsoft.com/User.Read offline_access'
MS = 'https://login.microsoftonline.com/common/oauth2/v2.0/'
GRAPH = 'https://graph.microsoft.com/v1.0/'

class MailError(Exception):
    pass

class Blob(ctypes.Structure):
    _fields_ = [('size', ctypes.c_ulong), ('data', ctypes.POINTER(ctypes.c_ubyte))]

def protect(data, decrypt=False):
    if os.name != 'nt':
        raise MailError('MAIL_STORAGE_FAILED')
    buf = (ctypes.c_ubyte * len(data)).from_buffer_copy(data)
    src, dst = Blob(len(data), buf), Blob()
    dll = ctypes.WinDLL('crypt32', use_last_error=True)
    if decrypt:
        ok = dll.CryptUnprotectData(ctypes.byref(src), None, None, None, None, 1, ctypes.byref(dst))
    else:
        ok = dll.CryptProtectData(ctypes.byref(src), 'CodeSnap mail', None, None, None, 1, ctypes.byref(dst))
    if not ok:
        raise MailError('MAIL_STORAGE_FAILED')
    try:
        return ctypes.string_at(dst.data, dst.size)
    finally:
        kernel = ctypes.WinDLL('kernel32', use_last_error=True)
        kernel.LocalFree.argtypes = [ctypes.c_void_p]
        kernel.LocalFree.restype = ctypes.c_void_p
        kernel.LocalFree(dst.data)

@contextlib.contextmanager
def vault():
    import msvcrt
    ROOT.mkdir(parents=True, exist_ok=True)
    with (ROOT / 'vault.lock').open('a+b') as lock:
        lock.seek(0)
        if not lock.read(1):
            lock.write(b'0'); lock.flush()
        lock.seek(0)
        msvcrt.locking(lock.fileno(), msvcrt.LK_LOCK, 1)
        try:
            file = ROOT / 'accounts.dpapi'
            try:
                data = json.loads(protect(file.read_bytes(), True)) if file.exists() else {'accounts': [], 'pending': {}}
            except Exception:
                raise MailError('MAIL_STORAGE_FAILED') from None
            yield data
            temporary = ROOT / f'{uuid.uuid4().hex}.tmp'
            temporary.write_bytes(protect(json.dumps(data).encode('utf-8')))
            os.replace(temporary, file)
        finally:
            lock.seek(0); msvcrt.locking(lock.fileno(), msvcrt.LK_UNLCK, 1)

def public(account):
    return {key: account[key] for key in ('id', 'email', 'provider')}

def validate(request):
    provider = request.get('provider')
    address = str(request.get('email', '')).strip()
    raw_host = str(request.get('host', ''))
    if any(char in raw_host for char in '\r\n\x00'): raise MailError('MAIL_CONFIG_INVALID')
    host = PRESETS.get(provider, raw_host.strip())
    port = request.get('port', 993)
    if provider not in (*PRESETS, 'imap') or not re.fullmatch(r'[^\s@\x00-\x1f]+@[^\s@\x00-\x1f]+\.[^\s@]+', address):
        raise MailError('MAIL_CONFIG_INVALID')
    if not re.fullmatch(r'[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?', host) or not isinstance(port, int) or not 1 <= port <= 65535:
        raise MailError('MAIL_CONFIG_INVALID')
    password = request.get('password')
    if not isinstance(password, str) or not password or len(password) > 2048:
        raise MailError('MAIL_CONFIG_INVALID')
    login = str(request.get('login') or address).strip()
    if any(char in login for char in '\r\n\x00') or len(login) > 320:
        raise MailError('MAIL_CONFIG_INVALID')
    security = request.get('security', 'tls')
    if security not in ('tls', 'starttls'): raise MailError('MAIL_CONFIG_INVALID')
    return {'id': uuid.uuid4().hex, 'provider': provider, 'email': address, 'host': host, 'port': port, 'login': login, 'password': password, 'security': security}

@contextlib.contextmanager
def imap_connection(account):
    client = None
    try:
        if account['security'] == 'tls':
            client = imaplib.IMAP4_SSL(account['host'], account['port'], ssl_context=ssl.create_default_context(), timeout=8)
        elif account['security'] == 'starttls':
            client = imaplib.IMAP4(account['host'], account['port'], timeout=8)
            client.starttls(ssl_context=ssl.create_default_context())
        else:
            raise MailError('MAIL_CONFIG_INVALID')
        client.login(account['login'], account['password'])
        if client.select('INBOX', readonly=True)[0] != 'OK':
            raise MailError('MAIL_UNAVAILABLE')
        yield client
    except ssl.SSLError:
        raise MailError('MAIL_TLS_FAILED') from None
    except imaplib.IMAP4.error:
        raise MailError('MAIL_AUTH_FAILED') from None
    except (OSError, TimeoutError):
        raise MailError('MAIL_UNAVAILABLE') from None
    finally:
        if client:
            try: client.logout()
            except Exception: pass

def parse_message(raw, internaldate, uid, account):
    msg = email.message_from_bytes(raw, policy=email.policy.default)
    date_match = re.search(rb'INTERNALDATE "([^"]+)"', internaldate)
    if not date_match:
        return None
    stamp = datetime.datetime.strptime(date_match[1].decode('ascii'), '%d-%b-%Y %H:%M:%S %z').timestamp() * 1000
    plain, rich = [], []
    for part in msg.walk():
        if part.get_content_disposition() == 'attachment' or part.is_multipart():
            continue
        if part.get_content_type() not in ('text/plain', 'text/html'):
            continue
        try: text = part.get_content()
        except Exception: continue
        if not isinstance(text, str): continue
        if part.get_content_type() == 'text/plain': plain.append(text)
        else: rich.append(text)
    body = '\n'.join(plain) if plain else html.unescape(re.sub(r'<[^>]*>', ' ', re.sub(r'<(?:script|style)\b[^>]*>.*?</(?:script|style)>', '', '\n'.join(rich), flags=re.I | re.S)))
    return {'id': f"imap:{account['id']}:{uid.decode('ascii')}", 'from': str(msg.get('From', ''))[:500], 'subject': str(msg.get('Subject', ''))[:500], 'timestamp': stamp, 'body': body[:8000], 'accountEmail': account['email'], 'accountProvider': account['provider']}

def search_imap(account, age):
    cutoff = time.time() - age - 60
    since = datetime.datetime.fromtimestamp(cutoff, datetime.timezone.utc).strftime('%d-%b-%Y')
    messages = []
    with imap_connection(account) as client:
        status, data = client.uid('search', None, f'(SINCE {since})')
        if status != 'OK': raise MailError('MAIL_UNAVAILABLE')
        uids = (data[0] or b'').split()[-30:]
        if not uids: return []
        status, rows = client.uid('fetch', b','.join(uids), '(UID INTERNALDATE BODY.PEEK[])')
        if status != 'OK': raise MailError('MAIL_UNAVAILABLE')
        for row in rows:
            if isinstance(row, tuple) and isinstance(row[1], bytes) and len(row[1]) <= 512000:
                uid_match = re.search(rb'\bUID (\d+)\b', row[0])
                if not uid_match: continue
                item = parse_message(row[1], row[0], uid_match[1], account)
                if item and item['timestamp'] >= cutoff * 1000: messages.append(item)
    return messages

def ms_request(url, form=None, token=None):
    data = urllib.parse.urlencode(form).encode() if form is not None else None
    headers = {'Content-Type': 'application/x-www-form-urlencoded'} if data else {}
    if token: headers['Authorization'] = 'Bearer ' + token
    try:
        with urllib.request.urlopen(urllib.request.Request(url, data=data, headers=headers), timeout=10) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        try: result = json.load(error)
        except Exception: result = {}
        return {'error': result.get('error', 'OUTLOOK_AUTH_FAILED') if isinstance(result.get('error'), str) else 'OUTLOOK_AUTH_FAILED'}
    except (OSError, TimeoutError):
        raise MailError('MAIL_UNAVAILABLE') from None

def outlook_start(client_id):
    if not re.fullmatch(r'[0-9a-fA-F-]{36}', str(client_id or '')):
        raise MailError('OUTLOOK_CLIENT_REQUIRED')
    result = ms_request(MS + 'devicecode', {'client_id': client_id, 'scope': SCOPE})
    if 'device_code' not in result: raise MailError('OUTLOOK_AUTH_FAILED')
    pending_id = uuid.uuid4().hex
    with vault() as data:
        data['pending'] = {k: v for k, v in data.get('pending', {}).items() if v['expires'] > time.time()}
        data['pending'][pending_id] = {'client_id': client_id, 'device_code': result['device_code'], 'expires': time.time() + min(result.get('expires_in', 900), 900)}
    return {'pendingId': pending_id, 'userCode': result['user_code'], 'url': result['verification_uri'], 'interval': result.get('interval', 5)}

def outlook_poll(pending_id):
    with vault() as data: pending = data.get('pending', {}).get(pending_id)
    if not pending or pending['expires'] < time.time(): raise MailError('OUTLOOK_AUTH_FAILED')
    tokens = ms_request(MS + 'token', {'grant_type': 'urn:ietf:params:oauth:grant-type:device_code', 'client_id': pending['client_id'], 'device_code': pending['device_code']})
    if tokens.get('error') in ('authorization_pending', 'slow_down'):
        return {'pending': True, 'slowDown': tokens['error'] == 'slow_down'}
    if 'access_token' not in tokens or 'refresh_token' not in tokens: raise MailError('OUTLOOK_AUTH_FAILED')
    profile = ms_request(GRAPH + 'me?$select=mail,userPrincipalName', token=tokens['access_token'])
    address = profile.get('mail') or profile.get('userPrincipalName')
    if not address: raise MailError('OUTLOOK_AUTH_FAILED')
    account = {'id': uuid.uuid4().hex, 'email': address, 'provider': 'outlook', 'client_id': pending['client_id'], 'refresh_token': tokens['refresh_token'], 'access_token': tokens['access_token'], 'expires': time.time() + tokens.get('expires_in', 3600) - 60}
    with vault() as data:
        data['pending'].pop(pending_id, None)
        previous = next((a for a in data['accounts'] if a['email'].lower() == address.lower() and a['provider'] == 'outlook'), None)
        if previous: account['id'] = previous['id']
        data['accounts'] = [a for a in data['accounts'] if not (a['email'].lower() == address.lower() and a['provider'] == 'outlook')] + [account]
    return {'account': public(account)}

def search_outlook(account, age):
    if account.get('expires', 0) <= time.time():
        tokens = ms_request(MS + 'token', {'grant_type': 'refresh_token', 'client_id': account['client_id'], 'refresh_token': account['refresh_token'], 'scope': SCOPE})
        if 'access_token' not in tokens: raise MailError('OUTLOOK_AUTH_FAILED')
        account.update(access_token=tokens['access_token'], refresh_token=tokens.get('refresh_token', account['refresh_token']), expires=time.time() + tokens.get('expires_in', 3600) - 60)
        with vault() as data:
            data['accounts'] = [account if a['id'] == account['id'] else a for a in data['accounts']]
    cutoff = datetime.datetime.fromtimestamp(time.time() - age - 60, datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
    query = urllib.parse.urlencode({'$filter': f'receivedDateTime ge {cutoff}', '$top': '30', '$orderby': 'receivedDateTime desc', '$select': 'id,from,subject,receivedDateTime,body'})
    result = ms_request(GRAPH + 'me/mailFolders/inbox/messages?' + query, token=account['access_token'])
    if 'error' in result: raise MailError('OUTLOOK_AUTH_FAILED')
    return [{'id': f"outlook:{account['id']}:{msg['id']}", 'from': msg.get('from', {}).get('emailAddress', {}).get('address', ''), 'subject': msg.get('subject', ''), 'timestamp': datetime.datetime.fromisoformat(msg['receivedDateTime'].replace('Z', '+00:00')).timestamp() * 1000, 'body': html.unescape(re.sub(r'<[^>]*>', ' ', msg.get('body', {}).get('content', '')))[:8000], 'accountEmail': account['email'], 'accountProvider': 'outlook'} for msg in result.get('value', [])]

def dispatch(request):
    command = request.get('command')
    if command == 'ping': return {'version': '0.7.0', 'storage': 'Windows DPAPI', 'readOnly': True}
    if command == 'connect':
        account = validate(request)
        with imap_connection(account): pass
        with vault() as data:
            previous = next((a for a in data['accounts'] if a['email'].lower() == account['email'].lower() and a['provider'] == account['provider']), None)
            if previous: account['id'] = previous['id']
            data['accounts'] = [a for a in data['accounts'] if not (a['email'].lower() == account['email'].lower() and a['provider'] == account['provider'])] + [account]
        return {'account': public(account)}
    if command == 'list':
        with vault() as data: return {'accounts': [public(a) for a in data['accounts']]}
    if command == 'remove':
        with vault() as data: data['accounts'] = [a for a in data['accounts'] if a['id'] != request.get('id')]
        return {}
    if command == 'search':
        with vault() as data: account = next((a for a in data['accounts'] if a['id'] == request.get('id')), None)
        if not account: raise MailError('MAIL_AUTH_FAILED')
        age = max(60, min(900, int(request.get('maxAgeSeconds', 180))))
        return {'messages': search_outlook(account, age) if account['provider'] == 'outlook' else search_imap(account, age)}
    raise MailError('MAIL_CONFIG_INVALID')

def main():
    if len(sys.argv) < 2 or sys.argv[1] != ORIGIN: return
    import msvcrt
    msvcrt.setmode(sys.stdin.fileno(), os.O_BINARY)
    msvcrt.setmode(sys.stdout.fileno(), os.O_BINARY)
    header = sys.stdin.buffer.read(4)
    if len(header) != 4: return
    length = struct.unpack('<I', header)[0]
    if not 0 < length <= 64000: return
    try:
        request = json.loads(sys.stdin.buffer.read(length))
        result = {'ok': True, **dispatch(request)}
    except MailError as error: result = {'ok': False, 'error': str(error)}
    except Exception: result = {'ok': False, 'error': 'MAIL_UNAVAILABLE'}
    output = json.dumps(result, ensure_ascii=False).encode('utf-8')
    if len(output) > 900000: output = b'{"ok":false,"error":"MAIL_UNAVAILABLE"}'
    sys.stdout.buffer.write(struct.pack('<I', len(output)) + output)
    sys.stdout.buffer.flush()

if __name__ == '__main__': main()
