import { importBackground } from './content-harness.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import {
  CODESNAP_PRO_PUBLIC_KEY_B64U,
  FREE_TOTP_LIMIT,
  toBase64Url,
  verifyProLicenseKey,
  getProStatus,
  activateProLicense,
  deactivateProLicense
} from '../src/license.js';
import { signProLicenseKey } from '../scripts/generate-pro-keys.js';

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

const SAMPLE_SECRETS = [
  'JBSWY3DPEHPK3PXP',
  'KRSXG5CTMVRXEZLU',
  'MFRGGZDFMZTWQ2LK',
  'NBSWY3DPEB3W64TM',
  'GEZDGNBVGY3TQOJQ',
  'IFAUCQKBIFAUCQKB'
];

test('Ed25519 offline license verification approves valid keys and rejects forged/tampered/expired keys', async () => {
  assert.ok(CODESNAP_PRO_PUBLIC_KEY_B64U.length >= 42);

  const kp = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
  const pubB64u = toBase64Url(new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey)));
  const privB64u = toBase64Url(new Uint8Array(await crypto.subtle.exportKey('pkcs8', kp.privateKey)));

  const now = 1_700_000_000_000;
  const lifetimeKey = await signProLicenseKey({ id: 'TEST-01', iat: Math.floor(now / 1000) }, privB64u);
  assert.match(lifetimeKey, /^CS1-[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);

  const okRes = await verifyProLicenseKey(lifetimeKey, { now, publicKeyB64u: pubB64u });
  assert.equal(okRes.valid, true);
  assert.equal(okRes.plan, 'pro');
  assert.equal(okRes.keyId, 'TEST-01');
  assert.equal(okRes.lifetime, true);

  // Rejects key signed with wrong key against real embedded public key
  const wrongKeyCheck = await verifyProLicenseKey(lifetimeKey, { now });
  assert.equal(wrongKeyCheck.valid, false);
  assert.equal(wrongKeyCheck.reason, 'SIGNATURE');

  // Tampered payload 1-char change fails verification
  const dotIdx = lifetimeKey.indexOf('.');
  const firstPayloadChar = lifetimeKey[4];
  const flippedChar = firstPayloadChar === 'A' ? 'B' : 'A';
  const tampered = `CS1-${flippedChar}${lifetimeKey.slice(5, dotIdx)}${lifetimeKey.slice(dotIdx)}`;
  const tamperRes = await verifyProLicenseKey(tampered, { now, publicKeyB64u: pubB64u });
  assert.equal(tamperRes.valid, false);
  assert.equal(tamperRes.reason, 'SIGNATURE');

  // Expired key fails cleanly after exp
  const timedKey = await signProLicenseKey({
    id: 'TEST-EXP',
    iat: Math.floor(now / 1000) - 7200,
    exp: Math.floor(now / 1000) - 60
  }, privB64u);
  const expRes = await verifyProLicenseKey(timedKey, { now, publicKeyB64u: pubB64u });
  assert.equal(expRes.valid, false);
  assert.equal(expRes.reason, 'EXPIRED');

  // Forged raw storage key fails getProStatus
  const prior = globalThis.chrome;
  const mock = makeChromeStorageMock({ proLicenseKey: 'CS1-forgedPayloadHere.forgedSignature' });
  globalThis.chrome = { storage: mock.storage };
  try {
    const freeFake = await getProStatus({ publicKeyB64u: pubB64u });
    assert.equal(freeFake.isPro, false);

    const act = await activateProLicense(lifetimeKey, { now, publicKeyB64u: pubB64u });
    assert.equal(act.ok, true);
    assert.equal(act.isPro, true);
    assert.equal((await getProStatus({ now, publicKeyB64u: pubB64u })).isPro, true);

    await deactivateProLicense();
    assert.equal((await getProStatus({ now, publicKeyB64u: pubB64u })).isPro, false);
  } finally {
    globalThis.chrome = prior;
  }
});

test('background TOTP_ACTION enforces Free 5-key limit and unlocks >5 + LICENSE_ACTION on real signed Pro key', async () => {
  const prior = { chrome: globalThis.chrome, setInterval: globalThis.setInterval };
  const mock = makeChromeStorageMock();
  let listener;
  globalThis.setInterval = () => 1;
  globalThis.chrome = {
    runtime: { id: 'ongiekgidmkffdhgmjmlnjjgoggojoak', onMessage: { addListener(fn) { listener = fn; } } },
    storage: mock.storage,
    identity: { getAuthToken: async () => { throw new Error('none'); } },
    tabs: { query: async () => [], get: async () => null, sendMessage: async () => null, onRemoved: { addListener() {} }, onUpdated: { addListener() {} } }
  };

  try {
    await importBackground(`../src/background.js?pro=${Math.random()}`);
    const send = request => new Promise(resolve => listener(request, {}, resolve));

    const freeStatus = await send({ type: 'LICENSE_ACTION', payload: { command: 'status' } });
    assert.equal(freeStatus.isPro, false);
    assert.equal(freeStatus.freeTotpLimit, FREE_TOTP_LIMIT);

    // Reject invalid key
    const badAct = await send({ type: 'LICENSE_ACTION', payload: { command: 'activate', key: 'CS1-bad.sig' } });
    assert.equal(badAct.status, 'error');

    // Add 5 keys in Free mode -> allowed
    for (let i = 0; i < FREE_TOTP_LIMIT; i++) {
      const res = await send({
        type: 'TOTP_ACTION',
        payload: { command: 'add', input: SAMPLE_SECRETS[i], meta: { issuer: `Site${i}` } }
      });
      assert.equal(res.status, 'ok');
    }

    // Adding 6th key without Pro -> blocked with pro_required
    const sixthBlocked = await send({
      type: 'TOTP_ACTION',
      payload: { command: 'add', input: SAMPLE_SECRETS[5], meta: { issuer: 'Site6' } }
    });
    assert.equal(sixthBlocked.status, 'pro_required');

    // Bulk import exceeding 5 without Pro -> blocked
    const bulkBlocked = await send({
      type: 'TOTP_ACTION',
      payload: { command: 'import', text: SAMPLE_SECRETS.map((s, idx) => `otpauth://totp/S${idx}?secret=${s}`).join('\n') }
    });
    assert.equal(bulkBlocked.status, 'pro_required');

    // If owner key file exists locally, test full end-to-end real key activation -> 6th+ key unlocked
    const ownerKeysUrl = new URL('../../CodeSnap-Owner-Keys-DO-NOT-SHARE.json', import.meta.url);
    if (existsSync(ownerKeysUrl)) {
      const ownerKeys = JSON.parse(readFileSync(ownerKeysUrl, 'utf8'));
      const realKey = await signProLicenseKey({ id: 'VIP-TEST' }, ownerKeys.privateKeyPkcs8B64u);
      const actOk = await send({ type: 'LICENSE_ACTION', payload: { command: 'activate', key: realKey } });
      assert.equal(actOk.status, 'ok');
      assert.equal(actOk.isPro, true);
      assert.equal(actOk.keyId, 'VIP-TEST');

      const sixthAllowed = await send({
        type: 'TOTP_ACTION',
        payload: { command: 'add', input: SAMPLE_SECRETS[5], meta: { issuer: 'Site6' } }
      });
      assert.equal(sixthAllowed.status, 'ok');
    }
  } finally {
    globalThis.chrome = prior.chrome;
    globalThis.setInterval = prior.setInterval;
  }
});

test('popup gates Direct Gmail OAuth and Withdraw Check behind Pro while allowing Free Gmail Web tab', async () => {
  const html = readFileSync(new URL('../src/popup.html', import.meta.url), 'utf8');
  const code = readFileSync(new URL('../src/popup.js', import.meta.url), 'utf8').replace(/^import .*;\r?\n/gm, '');
  const dom = new JSDOM(html, { url: 'chrome-extension://ongiekgidmkffdhgmjmlnjjgoggojoak/src/popup.html', runScripts: 'outside-only' });
  const { window } = dom;
  let oauthCalls = 0;
  let isProMock = false;
  const requests = [];

  window.siteForOrigin = () => 'generic';
  window.SITES = {};
  window.candidateIsFresh = () => true;
  window.listAccounts = async () => ({ primaryEmail: null, extras: [], mailAccounts: [] });
  window.connectPrimary = async () => { oauthCalls++; return 'user@gmail.com'; };
  window.connectAdditional = async () => { oauthCalls++; return 'extra@gmail.com'; };
  window.LOCAL_MAIL_PROVIDERS = {
    gmail: { name: 'Gmail (вкладка)' },
    yandex: { name: 'Яндекс Почта' }
  };

  window.chrome = {
    i18n: { getMessage: () => '' },
    runtime: {
      getManifest: () => ({ version: '1.4.0' }),
      sendMessage: async req => {
        requests.push(req);
        if (req.type === 'LICENSE_ACTION') {
          if (req.payload.command === 'activate') {
            isProMock = true;
            return { status: 'ok', isPro: true, keyId: 'VIP-01', lifetime: true };
          }
          if (req.payload.command === 'deactivate') {
            isProMock = false;
            return { status: 'ok', isPro: false };
          }
          return { status: 'ok', isPro: isProMock, keyId: isProMock ? 'VIP-01' : null, lifetime: true };
        }
        if (req.type === 'TOTP_ACTION') {
          return { status: 'ok', count: 0, accounts: [], siteMatch: { status: 'none' }, proStatus: { isPro: isProMock }, clockState: { offsetSeconds: 0, uncompensatedSkewSeconds: 0 } };
        }
        if (req.type === 'LOCAL_MAIL_ACTION') return { status: 'ok', account: { email: 'Gmail (вкладка)' } };
        return { status: 'none' };
      }
    },
    tabs: {
      query: async () => [{ id: 1, url: 'https://example.com/login' }],
      sendMessage: async () => ({ detected: true, channel: 'email' })
    },
    storage: { local: { get: async () => ({}), set: async () => {} } }
  };

  window.eval(code);
  await new Promise(r => setTimeout(r, 40));
  const $ = id => window.document.getElementById(id);

  // 1) In Free mode, Direct Gmail OAuth is blocked without calling connectPrimary()
  $('provider').value = 'gmail';
  $('provider').dispatchEvent(new window.Event('change'));
  assert.match($('connect').textContent, /Pro/i);
  $('connect').click();
  await new Promise(r => setTimeout(r, 25));
  assert.equal(oauthCalls, 0);
  assert.equal($('proStatusMsg').hidden, false);

  // 2) Free Gmail Web tab works cleanly without Pro
  $('provider').value = 'gmail_web';
  $('provider').dispatchEvent(new window.Event('change'));
  $('connect').click();
  await new Promise(r => setTimeout(r, 25));
  assert.deepEqual(
    JSON.parse(JSON.stringify(requests.find(r => r.type === 'LOCAL_MAIL_ACTION'))),
    { type: 'LOCAL_MAIL_ACTION', payload: { command: 'connect', provider: 'gmail' } }
  );

  // 3) Activating Pro key unlocks Direct Gmail OAuth
  $('proKeyInput').value = 'CS1-demo.key';
  $('proActivateForm').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await new Promise(r => setTimeout(r, 40));
  assert.equal($('proHeroBadge').hidden, false);
  assert.equal($('proStatePill').textContent, '✦ АКТИВЕН');

  $('provider').value = 'gmail';
  $('provider').dispatchEvent(new window.Event('change'));
  $('connect').click();
  await new Promise(r => setTimeout(r, 25));
  assert.equal(oauthCalls, 1);

  dom.window.close();
});
