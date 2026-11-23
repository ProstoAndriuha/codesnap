import { evaluateContent, inlineChip, importBackground } from './content-harness.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { checkPhishingRisk } from '../src/core.js';
import {
  addTotpAccount,
  generateTotpCode,
  getTotpCandidatesForSite,
  awaitFreshTotpResult
} from '../src/totp.js';
import { decodeRawRgbaCrop, classifyQrStringsForTotp } from '../src/qr-scanner.js';

function makeChromeStorageMock(initialLocal = {}, initialSession = {}) {
  const local = { ...initialLocal };
  const session = { ...initialSession };
  const listeners = [];
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
        set: async obj => {
          const changes = {};
          for (const [k, v] of Object.entries(obj)) {
            changes[k] = { oldValue: local[k], newValue: v };
          }
          Object.assign(local, obj);
          for (const fn of listeners) fn(changes, 'local');
        }
      },
      session: {
        get: async keys => {
          if (typeof keys === 'string') return { [keys]: session[keys] };
          if (Array.isArray(keys)) return Object.fromEntries(keys.map(k => [k, session[k]]));
          return { ...session };
        },
        set: async obj => Object.assign(session, obj)
      },
      onChanged: {
        addListener(fn) { listeners.push(fn); }
      }
    }
  };
}

const SAMPLE_SECRET = 'JBSWY3DPEHPK3PXP';

test('Feature #1 Smart Grace Wait returns immediately above 3s and waits for fresh window at <= 3s', async () => {
  const mockStorage = makeChromeStorageMock();
  const prior = { chrome: globalThis.chrome, setInterval: globalThis.setInterval };
  globalThis.chrome = {
    storage: mockStorage.storage,
    runtime: { id: 'ongiekgidmkffdhgmjmlnjjgoggojoak', onMessage: { addListener() {} }, onInstalled: { addListener() {} }, onStartup: { addListener() {} } }
  };

  try {
    let slept = 0;
    let fakeNow = 10_000; // 20s remaining
    const resNormal = await awaitFreshTotpResult(
      async now => ({ status: 'found', id: 'id1', period: 30, ...(await generateTotpCode(SAMPLE_SECRET, now)) }),
      { graceSeconds: 3, nowFn: () => fakeNow, sleepFn: ms => { slept += ms; fakeNow += ms; } }
    );
    assert.equal(slept, 0);
    assert.equal(resNormal.waitedForNextWindow, false);
    assert.equal(resNormal.code, (await generateTotpCode(SAMPLE_SECRET, 10_000)).code);

    // At 28.5s (1.5s remaining <= 3s), awaits boundary and yields next window's code
    slept = 0;
    fakeNow = 28_500;
    const oldWinCode = (await generateTotpCode(SAMPLE_SECRET, 28_500)).code;
    const nextWinCode = (await generateTotpCode(SAMPLE_SECRET, 30_100)).code;
    assert.notEqual(oldWinCode, nextWinCode);

    const resWaited = await awaitFreshTotpResult(
      async now => ({ status: 'found', id: 'id1', period: 30, ...(await generateTotpCode(SAMPLE_SECRET, now)) }),
      { graceSeconds: 3, nowFn: () => fakeNow, sleepFn: ms => { slept += ms; fakeNow += ms; } }
    );
    assert.ok(slept >= 1500, `Expected sleep >= 1500ms, got ${slept}`);
    assert.equal(resWaited.waitedForNextWindow, true);
    assert.equal(resWaited.code, nextWinCode);
    assert.equal(resWaited.remainingSeconds, 30);

    // Real Date.now / INSERT_TOTP_INLINE near boundary inserts new window's code
    const priorNow = Date.now;
    let bgListener;
    let insertedCode = null;
    globalThis.setInterval = () => 1;
    globalThis.chrome = {
      storage: mockStorage.storage,
      identity: { getAuthToken: async () => ({ token: 'tok' }), removeCachedAuthToken: async () => {} },
      tabs: {
        get: async () => ({ id: 7, url: 'https://blofin.com/en/login' }),
        sendMessage: async (_tabId, msg) => {
          if (msg.type === 'INSERT_TOTP') {
            insertedCode = msg.code;
            return { status: 'inserted' };
          }
          return null;
        },
        onRemoved: { addListener() {} },
        onUpdated: { addListener() {} }
      },
      contextMenus: { removeAll: async () => {}, create: () => {} },
      alarms: { create: () => {} },
      offscreen: { createDocument: async () => {} },
      runtime: {
        id: 'ongiekgidmkffdhgmjmlnjjgoggojoak',
        getURL: p => p,
        getContexts: async () => [],
        onMessage: { addListener(fn) { bgListener = fn; } },
        onInstalled: { addListener() {} },
        onStartup: { addListener() {} }
      }
    };
    await addTotpAccount(`otpauth://totp/BloFin:user@test.com?secret=${SAMPLE_SECRET}&issuer=BloFin`);
    await importBackground(`../src/background.js?grace=${Math.random()}`);

    const hintId = mockStorage.localData.totpSiteHints[0].id;
    let mockNow = 29_200;
    Date.now = () => mockNow;
    const advancer = setTimeout(() => { mockNow = 30_200; }, 400);
    try {
      const ins = await new Promise(resolve => bgListener(
        { type: 'INSERT_TOTP_INLINE', origin: 'https://blofin.com', totpId: hintId },
        { tab: { id: 7 }, frameId: 0, url: 'https://blofin.com/en/login' },
        resolve
      ));
      assert.equal(ins.status, 'inserted');
      assert.equal(ins.waitedForNextWindow, true);
      assert.equal(ins.code, nextWinCode);
      assert.equal(insertedCode, nextWinCode);
    } finally {
      clearTimeout(advancer);
      Date.now = priorNow;
    }
  } finally {
    Object.assign(globalThis, prior);
  }
});

test('Feature #5 Phishing Guard detects visual/IDN/typosquat/bait clones, blocks autofill and allows legitimate sites', async () => {
  // 1) core checkPhishingRisk checks
  assert.equal(checkPhishingRisk('https://bl0fin.com').suspicious, true);
  assert.equal(checkPhishingRisk('https://bl0fin.com').reason, 'visual_homograph');
  assert.equal(checkPhishingRisk('https://byblt.com').suspicious, true);
  assert.equal(checkPhishingRisk('https://blofim.com').reason, 'typosquat');
  assert.equal(checkPhishingRisk('https://okx-login.com').reason, 'brand_bait');
  assert.equal(checkPhishingRisk('https://blofin.org').reason, 'wrong_tld');
  assert.equal(checkPhishingRisk('https://bl\u043efin.com').reason, 'idn_homograph');

  // Safe domains must NEVER trigger false positives
  for (const okUrl of [
    'https://blofin.com',
    'https://www.okx.com',
    'https://accounts.binance.com',
    'https://example.com',
    'https://cloud.com',
    'https://bank.com'
  ]) {
    assert.equal(checkPhishingRisk(okUrl).suspicious, false, `Unexpected phishing flag for ${okUrl}`);
  }
  assert.equal(checkPhishingRisk('https://bl0fin.com', [], ['https://bl0fin.com']).suspicious, false);

  // 2) Full inline + vault enforcement on clone site https://bl0fin.com/en/login
  const fieldsSource = readFileSync(new URL('../src/fields.js', import.meta.url), 'utf8');
  const contentSource = readFileSync(new URL('../src/content.js', import.meta.url), 'utf8')
    .replaceAll(/if \(!\w+\.isTrusted\) return;/g, '')
    .replaceAll(/if \(\w+\.isTrusted\) /g, '');
  const mockStorage = makeChromeStorageMock({
    autoWatch: true,
    totpEnabled: true,
    senders: {},
    learnedSenders: {},
    accountSelections: {},
    learnedAccounts: {}
  });
  const prior = { chrome: globalThis.chrome, setInterval: globalThis.setInterval };
  let bgListener;

  globalThis.setInterval = () => 1;
  globalThis.chrome = {
    storage: mockStorage.storage,
    identity: { getAuthToken: async () => ({ token: 'tok' }), removeCachedAuthToken: async () => {} },
    tabs: { get: async () => ({ id: 8, url: 'https://bl0fin.com/en/login' }), sendMessage: async () => null, onRemoved: { addListener() {} }, onUpdated: { addListener() {} } },
    contextMenus: { removeAll: async () => {}, create: () => {} },
    alarms: { create: () => {} },
    offscreen: { createDocument: async () => {} },
    runtime: {
      id: 'ongiekgidmkffdhgmjmlnjjgoggojoak',
      getURL: p => p,
      getContexts: async () => [],
      onMessage: { addListener(fn) { bgListener = fn; } },
      onInstalled: { addListener() {} },
      onStartup: { addListener() {} }
    }
  };

  try {
    await addTotpAccount(`otpauth://totp/BloFin:user@blofin.com?secret=${SAMPLE_SECRET}&issuer=BloFin`);
    await importBackground(`../src/background.js?phish=${Math.random()}`);

    // Vault lookup on clone site must return 'none'
    const cloneLookup = await getTotpCandidatesForSite('https://bl0fin.com');
    assert.equal(cloneLookup.status, 'none');

    // Background INSERT_TOTP_INLINE on clone site is blocked
    const hintId = mockStorage.localData.totpSiteHints[0].id;
    const blocked = await new Promise(resolve => bgListener(
      { type: 'INSERT_TOTP_INLINE', origin: 'https://bl0fin.com', totpId: hintId },
      { tab: { id: 8 }, frameId: 0, url: 'https://bl0fin.com/en/login' },
      resolve
    ));
    assert.equal(blocked.status, 'phishing_blocked');

    const dom = new JSDOM(`
      <main>
        <h1>Google Authenticator</h1>
        <input id="ga" maxlength="6" inputmode="numeric">
      </main>
    `, { url: 'https://bl0fin.com/en/login', runScripts: 'outside-only' });
    try {
      dom.window.crypto.randomUUID = () => 'ph-1';
      dom.window.setInterval = () => 1;
      dom.window.chrome = {
        storage: mockStorage.storage,
        runtime: {
          onMessage: { addListener() {} },
          sendMessage: async req => new Promise(resolve => bgListener(req, { tab: { id: 8 }, frameId: 0, url: 'https://bl0fin.com/en/login' }, resolve))
        }
      };
      dom.window.eval(fieldsSource);
      evaluateContent(dom.window, contentSource);

      let chip;
      for (let i = 0; i < 30; i++) {
        chip = inlineChip(dom.window.document);
        if (chip?.textContent === '⚠️ Фишинг?') break;
        await new Promise(r => setTimeout(r, 25));
      }
      assert.ok(chip);
      assert.equal(chip.textContent, '⚠️ Фишинг?');

      chip.click();
      await new Promise(r => setTimeout(r, 30));
      const panel = dom.window.document.querySelector('#codesnap-inline-panel');
      assert.ok(panel);
      assert.match(panel.shadowRoot.textContent, /blofin\.com/i);

      // User explicitly trusts the domain -> trust origin persisted & phishing banner clears
      const trustBtn = [...panel.shadowRoot.querySelectorAll('button')].find(b => /разблокировать/i.test(b.textContent ?? ''));
      assert.ok(trustBtn);
      trustBtn.click();
      await new Promise(r => setTimeout(r, 50));
      assert.ok((mockStorage.localData.phishingTrustedOrigins ?? []).includes('https://bl0fin.com'));
    } finally {
      dom.window.close();
    }
  } finally {
    Object.assign(globalThis, prior);
  }
});

test('Feature #6 QR Region Sniper crops & decodes embedded QR and saves via BEGIN/FINISH_QR_SNIPER', async () => {
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

  // Build 640x480 white buffer with random noisy black corner blocks + real QR embedded at (180, 120)
  const imgW = 640;
  const imgH = 480;
  const rgba = new Uint8ClampedArray(imgW * imgH * 4).fill(255);
  const paintRect = (rx, ry, rw, rh) => {
    for (let y = ry; y < ry + rh; y++) {
      for (let x = rx; x < rx + rw; x++) {
        const off = (y * imgW + x) * 4;
        rgba[off] = 0; rgba[off + 1] = 0; rgba[off + 2] = 0; rgba[off + 3] = 255;
      }
    }
  };
  paintRect(20, 20, 90, 90);
  paintRect(500, 340, 100, 100);
  const scale = 3;
  for (let r = 0; r < rows.length; r++) {
    for (let c = 0; c < rows[r].length; c++) {
      if (rows[r][c] === '1') paintRect(180 + c * scale, 120 + r * scale, scale, scale);
    }
  }

  const hits = decodeRawRgbaCrop(rgba, imgW, imgH, {
    x: 180, y: 120, width: rows.length * scale, height: rows.length * scale,
    viewportWidth: imgW, viewportHeight: imgH
  });
  assert.deepEqual(hits, ['otpauth://totp/2FAS:demo@2fas.com?secret=JBSWY3DPEHPK3PXP&issuer=2FAS']);
  const classified = classifyQrStringsForTotp(hits, { domain: '2fas.com' });
  assert.equal(classified.status, 'found');
  assert.equal(classified.entries[0].issuer, '2FAS');

  // Verify sniper overlay UI + FINISH_QR_SNIPER message flow
  const fieldsSource = readFileSync(new URL('../src/fields.js', import.meta.url), 'utf8');
  const contentSource = readFileSync(new URL('../src/content.js', import.meta.url), 'utf8');
  const svgRects = rows.map((r, y) => [...r].map((ch, x) => ch === '1' ? `<rect x="${x}" y="${y}" width="1" height="1"/>` : '').join('')).join('');
  const dom = new JSDOM(`<!doctype html><body><div id="qrbox"><svg viewBox="0 0 37 37" width="148" height="148">${svgRects}</svg></div></body>`, {
    url: 'https://2fas.com/setup',
    runScripts: 'outside-only'
  });
  const sentMsgs = [];
  let contentListener;
  try {
    dom.window.chrome = {
      storage: { local: { get: async () => ({ autoWatch: false }), set: async () => {} }, onChanged: { addListener() {} } },
      runtime: {
        onMessage: { addListener(fn) { contentListener = fn; } },
        sendMessage: async msg => { sentMsgs.push(msg); return { status: 'ok' }; }
      }
    };
    dom.window.document.querySelector('svg').getBoundingClientRect = () => ({ left: 100, top: 80, right: 248, bottom: 228, width: 148, height: 148 });
    dom.window.eval(fieldsSource);
    evaluateContent(dom.window, contentSource.replaceAll('!e.isTrusted || ', ''));

    await new Promise(resolve => contentListener({ type: 'BEGIN_QR_SNIPER' }, null, resolve));
    const overlay = dom.window.document.querySelector('#codesnap-sniper-overlay');
    assert.ok(overlay, 'Expected QR Sniper overlay');

    overlay.dispatchEvent(new dom.window.MouseEvent('pointerdown', { bubbles: true, cancelable: true, clientX: 90, clientY: 70 }));
    dom.window.document.dispatchEvent(new dom.window.MouseEvent('pointermove', { bubbles: true, clientX: 260, clientY: 240 }));
    dom.window.document.dispatchEvent(new dom.window.MouseEvent('pointerup', { bubbles: true, clientX: 260, clientY: 240 }));

    await new Promise(r => setTimeout(r, 80));
    const finishMsg = sentMsgs.find(m => m.type === 'FINISH_QR_SNIPER');
    assert.ok(finishMsg, 'Expected FINISH_QR_SNIPER message');
    assert.equal(finishMsg.rect.width, 170);
    assert.equal(finishMsg.regionVisualUrls.length, 1);
    assert.equal(dom.window.document.querySelector('#codesnap-sniper-overlay'), null);
  } finally {
    dom.window.close();
  }
});

test('Feature #7 Manual Field Picker captures exotic field, persists custom selector and enables detection/insertion', async () => {
  const fieldsSource = readFileSync(new URL('../src/fields.js', import.meta.url), 'utf8');
  const contentSource = readFileSync(new URL('../src/content.js', import.meta.url), 'utf8');
  const mockStorage = makeChromeStorageMock({ autoWatch: false });
  let contentListener;

  const pageHtml = `
    <main>
      <div class="exotic-box">
        <span>Enter secret widget value</span>
        <div class="inner-shell"><input class="custom-xyz" type="text"></div>
      </div>
    </main>
  `;

  const dom = new JSDOM(pageHtml, { url: 'https://weird-widget.example/step', runScripts: 'outside-only' });
  try {
    dom.window.crypto.randomUUID = () => 'pick-1';
    dom.window.setInterval = () => 1;
    dom.window.chrome = {
      storage: mockStorage.storage,
      runtime: { onMessage: { addListener(fn) { contentListener = fn; } }, sendMessage: async () => ({ status: 'none' }) }
    };
    dom.window.eval(fieldsSource);
    evaluateContent(dom.window, contentSource.replaceAll('!e.isTrusted || ', ''));

    // Before picking: standard heuristics must NOT recognize non-OTP text input
    const before = await new Promise(resolve => contentListener({ type: 'FIELD_STATUS' }, null, resolve));
    assert.equal(before.detected, false);
    assert.equal(before.hasCustomField, false);

    // Start manual field picker and click inside .custom-xyz
    await new Promise(resolve => contentListener({ type: 'BEGIN_FIELD_PICKER', defaultChannel: 'email' }, null, resolve));
    const bar = dom.window.document.querySelector('#codesnap-picker-bar');
    assert.ok(bar, 'Expected field picker bar');
    dom.window.document.querySelector('.custom-xyz').click();
    await new Promise(r => setTimeout(r, 30));

    assert.equal(dom.window.document.querySelector('#codesnap-picker-bar'), null);
    assert.ok(mockStorage.localData.customFieldSelectors['https://weird-widget.example']?.selector);
  } finally {
    dom.window.close();
  }

  // Reloading same page remembers the custom field and allows INSERT_CODE
  const reloadDom = new JSDOM(pageHtml, { url: 'https://weird-widget.example/step', runScripts: 'outside-only' });
  let reloadListener;
  try {
    reloadDom.window.crypto.randomUUID = () => 'pick-2';
    reloadDom.window.setInterval = () => 1;
    reloadDom.window.chrome = {
      storage: mockStorage.storage,
      runtime: { onMessage: { addListener(fn) { reloadListener = fn; } }, sendMessage: async () => ({ status: 'none' }) }
    };
    reloadDom.window.eval(fieldsSource);
    evaluateContent(reloadDom.window, contentSource);
    await new Promise(r => setTimeout(r, 25));

    const after = await new Promise(resolve => reloadListener({ type: 'FIELD_STATUS' }, null, resolve));
    assert.equal(after.detected, true);
    assert.equal(after.hasCustomField, true);
    assert.equal(after.channel, 'email');

    const inserted = await new Promise(resolve => reloadListener(
      { type: 'INSERT_CODE', origin: 'https://weird-widget.example', fieldId: after.fieldId, code: '654321' },
      null,
      resolve
    ));
    assert.equal(inserted.status, 'inserted');
    assert.equal(reloadDom.window.document.querySelector('.custom-xyz').value, '654321');
  } finally {
    reloadDom.window.close();
  }
});
