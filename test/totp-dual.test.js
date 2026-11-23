import { evaluateContent, inlineChip, importBackground } from './content-harness.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import {
  normalizeBase32,
  encodeBase32,
  parseTotpInput,
  parseOtpAuthMigrationUri,
  extractTotpFromScannedText,
  generateTotpCode,
  addTotpAccount,
  removeTotpAccount,
  getTotpForSite,
  getTotpVaultStatus,
  setTotpPassphrase,
  lockTotpVault,
  unlockTotpVault
} from '../src/totp.js';
import { decodeQrRgba } from '../src/qr-scanner.js';

function asciiToBase32(str) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const bytes = Buffer.from(str, 'ascii');
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += alphabet[(value >>> bits) & 31];
    }
  }
  if (bits > 0) out += alphabet[(value << (5 - bits)) & 31];
  return out;
}

function makeChromeStorageMock(initialLocal = {}, initialSession = {}) {
  const local = { ...initialLocal };
  const session = { ...initialSession };
  return {
    localData: local,
    sessionData: session,
    storage: {
      local: {
        get: async keys => {
          if (typeof keys === 'string') return { [keys]: local[keys] };
          if (Array.isArray(keys)) return Object.fromEntries(keys.map(k => [k, local[k]]));
          return { ...local };
        },
        set: async obj => Object.assign(local, obj)
      },
      session: {
        get: async keys => {
          if (typeof keys === 'string') return { [keys]: session[keys] };
          if (Array.isArray(keys)) return Object.fromEntries(keys.map(k => [k, session[k]]));
          return { ...session };
        },
        set: async obj => Object.assign(session, obj)
      }
    }
  };
}

test('RFC 6238 TOTP vectors match SHA1, SHA256 and SHA512 in 8-digit mode', async () => {
  const sha1Secret = asciiToBase32('12345678901234567890');
  const sha256Secret = asciiToBase32('12345678901234567890123456789012');
  const sha512Secret = asciiToBase32('1234567890123456789012345678901234567890123456789012345678901234');

  const r1 = await generateTotpCode({ secret: sha1Secret, algorithm: 'SHA1', digits: 8, period: 30 }, 59 * 1000);
  assert.equal(r1.code, '94287082');
  assert.equal(r1.remainingSeconds, 1);

  const r2 = await generateTotpCode({ secret: sha1Secret, algorithm: 'SHA1', digits: 8, period: 30 }, 1111111109 * 1000);
  assert.equal(r2.code, '07081804');
  assert.equal(r2.remainingSeconds, 1);

  const r3 = await generateTotpCode({ secret: sha1Secret, algorithm: 'SHA1', digits: 8, period: 30 }, 1111111111 * 1000);
  assert.equal(r3.code, '14050471');
  assert.equal(r3.remainingSeconds, 29);

  const r256 = await generateTotpCode({ secret: sha256Secret, algorithm: 'SHA256', digits: 8, period: 30 }, 59 * 1000);
  assert.equal(r256.code, '46119246');

  const r512 = await generateTotpCode({ secret: sha512Secret, algorithm: 'SHA512', digits: 8, period: 30 }, 59 * 1000);
  assert.equal(r512.code, '90693936');
});

test('parseTotpInput handles otpauth URIs and formatted Base32 keys', () => {
  assert.equal(normalizeBase32('jbsw-y3dp ehpk 3pxp='), 'JBSWY3DPEHPK3PXP');

  const parsedUri = parseTotpInput('otpauth://totp/GitHub:alice%40example.com?secret=JBSWY3DPEHPK3PXP&issuer=GitHub&digits=6&period=30');
  assert.equal(parsedUri.issuer, 'GitHub');
  assert.equal(parsedUri.account, 'alice@example.com');
  assert.equal(parsedUri.domain, 'github.com');
  assert.equal(parsedUri.secret, 'JBSWY3DPEHPK3PXP');

  const parsedManual = parseTotpInput('jbsw y3dp ehpk 3pxp', { issuer: 'Microsoft', account: 'bob@live.com' });
  assert.equal(parsedManual.domain, 'live.com');
  assert.equal(parsedManual.issuer, 'Microsoft');
  assert.throws(() => parseTotpInput('otpauth://hotp/Test?secret=JBSWY3DPEHPK3PXP'), /TOTP_UNSUPPORTED_URI/);
  assert.throws(() => parseTotpInput('not-valid-base32!'), /TOTP_INVALID_SECRET/);
});

test('Encrypted AES-GCM TOTP vault matches ecosystems, supports PIN lock/unlock and never stores plaintext secrets', async () => {
  const prior = globalThis.chrome;
  const mock = makeChromeStorageMock();
  globalThis.chrome = { storage: mock.storage };
  const secret = 'JBSWY3DPEHPK3PXP';
  const fixedNow = 1_700_000_010_000;
  try {
    const gh = await addTotpAccount(`otpauth://totp/GitHub:alice@example.com?secret=${secret}&issuer=GitHub`, {}, fixedNow);
    assert.equal(gh.account.domain, 'github.com');
    assert.equal(mock.localData.totpEnabled, true);
    assert.equal(JSON.stringify(mock.localData).includes(secret), false);

    const ms = await addTotpAccount(`otpauth://totp/Microsoft:bob@outlook.com?secret=GEZDGNBVGY3TQOJQ&issuer=Microsoft`, {}, fixedNow);
    assert.equal(ms.account.domain, 'live.com');

    assert.equal((await getTotpForSite('https://github.com/sessions/two-factor', {}, fixedNow)).status, 'found');
    assert.equal((await getTotpForSite('https://login.live.com/ppsecure/post.srf', {}, fixedNow)).issuer, 'Microsoft');
    assert.equal((await getTotpForSite('https://unrelated-bank.example', {}, fixedNow)).status, 'none');

    await setTotpPassphrase('2468');
    await lockTotpVault();
    assert.equal((await getTotpForSite('https://github.com', {}, fixedNow)).status, 'locked');
    await assert.rejects(() => unlockTotpVault('0000'), /TOTP_WRONG_PIN/);
    await unlockTotpVault('2468');
    assert.equal((await getTotpForSite('https://github.com', {}, fixedNow)).status, 'found');

    await removeTotpAccount(gh.account.id);
    await removeTotpAccount(ms.account.id);
    const status = await getTotpVaultStatus();
    assert.equal(status.count, 0);
    assert.equal(mock.localData.totpEnabled, false);
  } finally {
    globalThis.chrome = prior;
  }
});

test('Inline 2FA stays silent on sites without matching secret and performs 1-click Dual Fill (Email + 2FA) on Binance', async () => {
  const fieldsSource = readFileSync(new URL('../src/fields.js', import.meta.url), 'utf8');
  const contentSource = readFileSync(new URL('../src/content.js', import.meta.url), 'utf8');
  const prior = { chrome: globalThis.chrome, fetch: globalThis.fetch, setInterval: globalThis.setInterval };
  const secret = 'JBSWY3DPEHPK3PXP';
  const now = Date.now();
  const expectedTotp = (await generateTotpCode(secret, now)).code;

  // 1) Other site with 2FA field must send ZERO messages and render ZERO chip when only binance.com is in hints.
  {
    const dom = new JSDOM(`
      <label for="ga">Google Authenticator 2FA code</label>
      <input id="ga" maxlength="6" inputmode="numeric">
    `, { url: 'https://other-exchange.example/verify', runScripts: 'outside-only' });
    let messagesSent = 0;
    dom.window.chrome = {
      storage: {
        local: { get: async () => ({ autoWatch: true, totpEnabled: true, totpSiteHints: [{ id: 't1', issuer: 'Binance', domain: 'binance.com', matchDomains: ['binance.com'], matchNames: ['binance'] }] }) },
        onChanged: { addListener() {} }
      },
      runtime: {
        onMessage: { addListener() {} },
        sendMessage: async () => { messagesSent++; return {}; }
      }
    };
    dom.window.eval(fieldsSource);
    evaluateContent(dom.window, contentSource);
    await new Promise(r => setTimeout(r, 40));
    assert.equal(messagesSent, 0);
    assert.equal(inlineChip(dom.window.document), null);
    dom.window.close();
  }

  // 2) Binance page with BOTH Email + Google Authenticator 2FA fills BOTH fields atomically via Dual Fill.
  const dom = new JSDOM(`
    <div role="dialog">
      <h2>Security Verification</h2>
      <div>
        <p>Email verification code (sent to u***@gmail.com)</p>
        <div id="email-cells">${'<input maxlength="1" inputmode="numeric">'.repeat(6)}</div>
      </div>
      <div>
        <p>Google Authenticator 2FA code</p>
        <div id="totp-cells">${'<input maxlength="1" inputmode="numeric">'.repeat(6)}</div>
      </div>
    </div>
  `, { url: 'https://www.binance.com/en/my/wallet/withdraw', runScripts: 'outside-only' });

  const mockStorage = makeChromeStorageMock({
    primaryEmail: 'alice@gmail.com',
    accountSelections: {},
    senders: {},
    learnedSenders: {}
  });
  let bgListener;
  let contentListener;
  globalThis.setInterval = () => 1;
  globalThis.chrome = {
    storage: {
      ...mockStorage.storage,
      onChanged: { addListener() {} }
    },
    identity: { getAuthToken: async () => ({ token: 'tok' }), removeCachedAuthToken: async () => {} },
    tabs: {
      get: async () => ({ id: 5, url: 'https://www.binance.com/en/my/wallet/withdraw' }),
      sendMessage: async (_tabId, msg) => new Promise(resolve => contentListener(msg, {}, resolve)),
      onRemoved: { addListener() {} },
      onUpdated: { addListener() {} }
    },
    runtime: {
      id: 'ongiekgidmkffdhgmjmlnjjgoggojoak',
      onMessage: { addListener(fn) { bgListener = fn; } },
      onInstalled: { addListener() {} },
      onStartup: { addListener() {} }
    }
  };
  globalThis.fetch = async url => {
    const p = new URL(url).pathname;
    if (p.endsWith('/messages')) return { ok: true, status: 200, json: async () => ({ messages: [{ id: 'bn-mail' }] }) };
    return {
      ok: true,
      status: 200,
      json: async () => ({
        id: 'bn-mail',
        internalDate: String(Date.now()),
        payload: {
          headers: [{ name: 'From', value: 'Binance <do-not-reply@ses.binance.com>' }, { name: 'Subject', value: '[Binance] Withdrawal Verification' }],
          mimeType: 'text/plain',
          body: { data: Buffer.from('Your Binance verification code is 483921. Valid for 10 minutes.').toString('base64url') }
        }
      })
    };
  };

  try {
    await addTotpAccount(`otpauth://totp/Binance:alice@gmail.com?secret=${secret}&issuer=Binance`, {}, now);
    await importBackground(`../src/background.js?dual=${Math.random()}`);

    dom.window.crypto.randomUUID = (() => { let n = 0; return () => `f-${++n}`; })();
    dom.window.chrome = {
      storage: {
        local: {
          get: async keys => mockStorage.storage.local.get(keys),
          set: async obj => mockStorage.storage.local.set(obj)
        },
        onChanged: { addListener() {} }
      },
      runtime: {
        onMessage: { addListener(fn) { contentListener = fn; } },
        sendMessage: async req => new Promise(resolve => bgListener(req, { tab: { id: 5 }, frameId: 0, url: 'https://www.binance.com/en/my/wallet/withdraw' }, resolve))
      }
    };

    dom.window.eval(fieldsSource);
    evaluateContent(dom.window, contentSource.replaceAll('if (!event.isTrusted) return;', ''));

    let chip;
    for (let i = 0; i < 30; i++) {
      chip = inlineChip(dom.window.document);
      if (chip?.textContent === '483921 + 2FA') break;
      await new Promise(r => setTimeout(r, 25));
    }
    assert.ok(chip);
    assert.equal(chip.textContent, '483921 + 2FA');

    chip.click();
    for (let i = 0; i < 25; i++) {
      if (chip.textContent === '✓✓') break;
      await new Promise(r => setTimeout(r, 25));
    }

    const emailVal = [...dom.window.document.querySelectorAll('#email-cells input')].map(i => i.value).join('');
    const totpVal = [...dom.window.document.querySelectorAll('#totp-cells input')].map(i => i.value).join('');
    const validTotpCodes = new Set([
      expectedTotp,
      (await generateTotpCode(secret, Date.now())).code
    ]);
    assert.equal(emailVal, '483921');
    assert.ok(validTotpCodes.has(totpVal), `Unexpected 2FA code inserted: ${totpVal}`);
    assert.equal(chip.textContent, '✓✓');
  } finally {
    dom.window.close();
    Object.assign(globalThis, prior);
  }
});

test('SCAN_PAGE_TOTP extracts otpauth link, BarcodeDetector QR and manual Base32 setup key', async () => {
  const fieldsSource = readFileSync(new URL('../src/fields.js', import.meta.url), 'utf8');
  const contentSource = readFileSync(new URL('../src/content.js', import.meta.url), 'utf8');

  const scanHtml = async (html, setupWindow = () => {}) => {
    const dom = new JSDOM(`<!doctype html><title>Security — Discord</title><body>${html}</body>`, { url: 'https://discord.com/settings', runScripts: 'outside-only' });
    let msgListener;
    dom.window.chrome = {
      storage: { local: { get: async () => ({ autoWatch: false }), set: async () => {} }, onChanged: { addListener() {} } },
      runtime: { onMessage: { addListener(fn) { msgListener = fn; } }, sendMessage: async () => ({}) }
    };
    setupWindow(dom.window);
    dom.window.eval(fieldsSource);
    evaluateContent(dom.window, contentSource);
    const res = await new Promise(resolve => msgListener({ type: 'SCAN_PAGE_TOTP' }, null, resolve));
    dom.window.close();
    return res;
  };

  const fromLink = await scanHtml('<a href="otpauth://totp/Discord:me@test.com?secret=JBSWY3DPEHPK3PXP&issuer=Discord">Open Authenticator</a>');
  assert.equal(fromLink.status, 'found');
  assert.equal(fromLink.source, 'link');

  const fromQr = await scanHtml('<canvas width="120" height="120"></canvas>', win => {
    win.BarcodeDetector = class {
      async detect() { return [{ rawValue: 'otpauth://totp/Discord:me?secret=JBSWY3DPEHPK3PXP&issuer=Discord' }]; }
    };
  });
  assert.equal(fromQr.status, 'found');
  assert.equal(fromQr.source, 'qr');

  const fromText = await scanHtml('<div><p>Scan QR or enter this setup key manually:</p><code>JBSW Y3DP EHPK 3PXP</code></div>');
  assert.equal(fromText.status, 'found');
  assert.equal(fromText.secret, 'JBSWY3DPEHPK3PXP');
  assert.equal(fromText.source, 'text');

  // When BarcodeDetector is absent (like Chrome on Windows), <svg> QR is serialized into visualDataUrls
  const svgRes = await scanHtml('<svg viewBox="0 0 37 37" width="185" height="185"><rect x="0" y="0" width="7" height="7"/><rect x="30" y="0" width="7" height="7"/></svg>');
  assert.equal(svgRes.status, 'none');
  assert.ok(Array.isArray(svgRes.visualDataUrls) && svgRes.visualDataUrls.length === 1);
  assert.ok(svgRes.visualDataUrls[0].startsWith('data:image/svg+xml;charset=utf-8,'));
});

test('jsQR decodes 2FAS QR pixels without BarcodeDetector, and migration/non-2FA classification works', () => {
  const rows = (
    '1111111000010011001101110110001111111|1000001010001110110100001100001000001|1011101011011000000111010000101011101|' +
    '1011101011110001110101101000001011101|1011101001111000000101100100001011101|1000001001111001101010000000101000001|' +
    '1111111010101010101010101010101111111|0000000010101001000010110011100000000|1000001010100110001111111110011001110|' +
    '0011000110010100000010000001111111110|0101111000110010011010001111010000111|1011000101000101100000011000010011001|' +
    '1111101001100010100110011101111100101|0000010111111110111110010001000000011|1001111110101011110010000101001011011|' +
    '0000000001111110011100000000101001110|1110011000110100100101010111111001101|1001110101000110001010011010101100110|' +
    '0100111010110111010010010111100010101|1001100100111100000110000010010100010|1010001100100011110100111010111110110|' +
    '0000110100100111101101110001010010111|1001111011011001001010100101000000011|0011110010001110100101000010110011000|' +
    '1101011110001011111101010001011110011|1111000001000010100000011010110100000|1011111001010010011011001101011000111|' +
    '1000010111110111000010011000101011111|1001101111011010110000101101111111011|0000000011000101110110110011100011001|' +
    '1111111000000001000111111100101010101|1000001001111010111110100011100011000|1011101000100101100101000111111110100|' +
    '1011101001100000101000010111011001101|1011101001111111111100000100100101011|1000001000010000001110100001001001001|' +
    '1111111010010101100010111000100010101'
  ).split('|');
  const scale = 4;
  const pad = 4;
  const side = (rows.length + pad * 2) * scale;
  const rgba = new Uint8ClampedArray(side * side * 4).fill(255);
  for (let r = 0; r < rows.length; r++) {
    for (let c = 0; c < rows[r].length; c++) {
      if (rows[r][c] !== '1') continue;
      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++) {
          const px = (c + pad) * scale + dx;
          const py = (r + pad) * scale + dy;
          const off = (py * side + px) * 4;
          rgba[off] = 0; rgba[off + 1] = 0; rgba[off + 2] = 0; rgba[off + 3] = 255;
        }
      }
    }
  }
  const decoded = decodeQrRgba(rgba, side, side);
  assert.equal(decoded, 'otpauth://totp/2FAS:demo@2fas.com?secret=JBSWY3DPEHPK3PXP&issuer=2FAS');
  const extracted = extractTotpFromScannedText(decoded);
  assert.equal(extracted.kind, 'totp');
  assert.equal(extracted.entries[0].issuer, '2FAS');
  assert.equal(extracted.entries[0].secret, 'JBSWY3DPEHPK3PXP');

  // Google Authenticator otpauth-migration protobuf payload
  const secretRaw = Buffer.from('Hello!\xDE\xAD\xBE\xEF', 'latin1');
  const nameBuf = Buffer.from('GitHub:octocat', 'utf8');
  const issuerBuf = Buffer.from('GitHub', 'utf8');
  const otpParam = Buffer.concat([
    Buffer.from([0x0a, secretRaw.length]), secretRaw,
    Buffer.from([0x12, nameBuf.length]), nameBuf,
    Buffer.from([0x1a, issuerBuf.length]), issuerBuf,
    Buffer.from([0x20, 0x01, 0x28, 0x01, 0x30, 0x02])
  ]);
  const payload = Buffer.concat([Buffer.from([0x0a, otpParam.length]), otpParam]);
  const migUri = `otpauth-migration://offline?data=${encodeURIComponent(payload.toString('base64'))}`;
  const migrated = parseOtpAuthMigrationUri(migUri);
  assert.equal(migrated.length, 1);
  assert.equal(migrated[0].secret, encodeBase32(secretRaw));
  assert.equal(migrated[0].issuer, 'GitHub');
  assert.equal(migrated[0].account, 'octocat');

  // Non-TOTP QR (e.g. App Store download link) is flagged clearly
  const linkQr = extractTotpFromScannedText('https://2fas.com/download-app');
  assert.equal(linkQr.kind, 'non_totp_qr');
  assert.equal(linkQr.preview, '2fas.com');
});
