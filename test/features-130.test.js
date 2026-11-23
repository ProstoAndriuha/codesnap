import { evaluateContent, inlineChip } from './content-harness.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { encodeQrMatrix, renderQrSvgString, createQrSvgElement } from '../src/qr-generator.js';
import { decodeQrRgba } from '../src/qr-scanner.js';
import { extractWithdrawalInfo, rankCandidates } from '../src/core.js';
import { apiFetch } from '../src/gmail.js';
import {
  addTotpAccount,
  generateTotpCode,
  getTotpCandidatesForSite,
  getTotpById,
  listAllTotpCodes,
  awaitFreshTotpResult,
  setTotpTimeOffset,
  measureServerClockSkew,
  exportTotpAccountUri
} from '../src/totp.js';
import { mountAuthenticatorView } from '../src/authenticator.js';

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

function rasterizeQrToRgba(matrix, margin = 4, scale = 4) {
  const size = matrix.size;
  const full = (size + margin * 2) * scale;
  const rgba = new Uint8ClampedArray(full * full * 4);
  rgba.fill(255);
  for (let my = 0; my < size; my++) {
    for (let mx = 0; mx < size; mx++) {
      if (!matrix.modules[my][mx]) continue;
      for (let sy = 0; sy < scale; sy++) {
        const y = (my + margin) * scale + sy;
        for (let sx = 0; sx < scale; sx++) {
          const x = (mx + margin) * scale + sx;
          const idx = (y * full + x) * 4;
          rgba[idx] = 0;
          rgba[idx + 1] = 0;
          rgba[idx + 2] = 0;
          rgba[idx + 3] = 255;
        }
      }
    }
  }
  return { rgba, width: full, height: full };
}

test('Feature #4 Offline QR Generator encodes short, standard and long V10+ otpauth URIs decodable by jsQR & Authenticator UI', async () => {
  const uris = [
    'otpauth://totp/OKX?secret=JBSWY3DPEHPK3PXP',
    'otpauth://totp/OKEx.com:tomaandreioff%40gmail.com?secret=JBSWY3DPEHPK3PXP&issuer=OKEx&algorithm=SHA1&digits=6&period=30',
    'otpauth://totp/' + encodeURIComponent('Binance:very.long.trading.account.alias.2026+subaccount123456@protonmail.com') +
      '?secret=JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP&issuer=BinanceGlobalTradingExchangePro&algorithm=SHA256&digits=8&period=30&note=' + 'A'.repeat(60)
  ];

  for (const uri of uris) {
    const matrix = encodeQrMatrix(uri);
    const { rgba, width, height } = rasterizeQrToRgba(matrix, 4, 4);
    const decoded = decodeQrRgba(rgba, width, height);
    assert.equal(decoded, uri, `Round-trip failed for version ${matrix.version} (${uri.length} chars)`);

    const svg = renderQrSvgString(uri);
    assert.ok(svg.startsWith('<svg ') && svg.includes('<path d="M'));
  }

  // Test exportTotpAccountUri + UI 📱 QR toggle inside mountAuthenticatorView
  const mockStorage = makeChromeStorageMock();
  const prior = { chrome: globalThis.chrome };
  globalThis.chrome = { storage: mockStorage.storage };

  let authCtrl;
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: 'chrome-extension://ongiekgidmkffdhgmjmlnjjgoggojoak/src/popup.html',
    runScripts: 'outside-only'
  });
  const priorDom = { document: globalThis.document, window: globalThis.window };

  try {
    const added = await addTotpAccount('otpauth://totp/OKX:trader@gmail.com?secret=JBSWY3DPEHPK3PXP&issuer=OKX');
    const exported = await exportTotpAccountUri(added.account.id);
    assert.match(exported.uri, /^otpauth:\/\/totp\//);
    const mat = encodeQrMatrix(exported.uri);
    const rast = rasterizeQrToRgba(mat, 4, 4);
    assert.equal(decodeQrRgba(rast.rgba, rast.width, rast.height), exported.uri);

    globalThis.document = dom.window.document;
    globalThis.window = dom.window;
    globalThis.chrome = {
      storage: mockStorage.storage,
      runtime: {
        sendMessage: async msg => {
          if (msg.type !== 'TOTP_ACTION') return {};
          if (msg.payload.command === 'list_all') {
            return { ...(await listAllTotpCodes('https://okx.com')), status: 'ok', vaultLocked: false, clockState: { offsetSeconds: 0, detectedSkewSeconds: null, uncompensatedSkewSeconds: 0 } };
          }
          if (msg.payload.command === 'export_uri') {
            return { status: 'ok', ...(await exportTotpAccountUri(msg.payload.id)) };
          }
          return { status: 'ok' };
        }
      }
    };

    authCtrl = await mountAuthenticatorView(dom.window.document.getElementById('root'), { origin: 'https://okx.com' });
    const qrBtn = dom.window.document.querySelector('.auth-qr-btn');
    assert.ok(qrBtn);
    qrBtn.click();
    await new Promise(r => setTimeout(r, 40));
    const qrSvg = dom.window.document.querySelector('.auth-qr-svg');
    assert.ok(qrSvg, 'Inline QR <svg> must render inside tile when 📱 clicked');
    assert.ok(qrSvg.querySelector('path')?.getAttribute('d')?.length > 20);
  } finally {
    authCtrl?.destroy();
    dom.window.close();
    globalThis.document = priorDom.document;
    globalThis.window = priorDom.window;
    globalThis.chrome = prior.chrome;
  }
});

test('Feature #7 Clock Skew detection, TOTP time offset & Authenticator 1-click sync', async () => {
  const secret = 'JBSWY3DPEHPK3PXP';
  const mockStorage = makeChromeStorageMock();
  const prior = { chrome: globalThis.chrome, fetch: globalThis.fetch, document: globalThis.document, window: globalThis.window };
  globalThis.chrome = { storage: mockStorage.storage };

  const fixedNow = 1_700_000_000_000;
  const serverAhead = new Date(Date.now() + 45_000).toUTCString();
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    headers: { get: name => (String(name).toLowerCase() === 'date' ? serverAhead : null) },
    json: async () => ({ emailAddress: 'user@gmail.com' })
  });

  let authCtrl;
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: 'chrome-extension://ongiekgidmkffdhgmjmlnjjgoggojoak/src/popup.html',
    runScripts: 'outside-only'
  });

  try {
    // 1) Passive Date header capture in gmail.js
    await apiFetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', 'tok');
    await new Promise(r => setTimeout(r, 10));
    assert.ok(Math.abs(mockStorage.localData.detectedClockSkewSec - 45) <= 2);

    // 2) TOTP generation stays RFC-6238 pure for direct calls, while site/vault getters apply totpTimeOffsetSeconds
    const added = await addTotpAccount(`otpauth://totp/OKX:user@gmail.com?secret=${secret}&issuer=OKX`, {}, fixedNow);
    const rawFuture = await generateTotpCode(secret, fixedNow + 45_000);
    await setTotpTimeOffset(45);

    const bySite = await getTotpCandidatesForSite('https://www.okx.com', {}, fixedNow);
    const byId = await getTotpById(added.account.id, fixedNow);
    const listed = await listAllTotpCodes('https://www.okx.com', {}, fixedNow);
    assert.equal(bySite.code, rawFuture.code);
    assert.equal(byId.code, rawFuture.code);
    assert.equal(listed.items[0].code, rawFuture.code);
    assert.equal(bySite.timeOffsetSeconds, 45);

    // 3) awaitFreshTotpResult honors timeOffsetSeconds near offset boundary
    let nowCursor = 29_000; // at +45s => 74s => remaining 16s; let's test at offset where (now + offset) mod 30 == 28s
    // At offset=+45s and now=13_500 -> effective=58_500 -> 1.5s remaining <= 3s!
    nowCursor = 13_500;
    let slept = 0;
    const graceRes = await awaitFreshTotpResult(
      now => getTotpById(added.account.id, now),
      { graceSeconds: 3, nowFn: () => nowCursor, sleepFn: ms => { slept += ms; nowCursor += ms; } }
    );
    assert.ok(slept >= 1500);
    assert.equal(graceRes.waitedForNextWindow, true);
    assert.equal(graceRes.code, (await generateTotpCode(secret, 60_500)).code);

    // 4) On-demand measureServerClockSkew({ autoApply: true })
    await setTotpTimeOffset(0);
    const measured = await measureServerClockSkew({ autoApply: true });
    assert.ok(Math.abs(measured.offsetSeconds - 45) <= 2);

    // 5) Authenticator UI shows skew banner when uncompensated |skew| >= 20 and applies fix in 1 click
    await setTotpTimeOffset(0);
    mockStorage.localData.detectedClockSkewSec = -40;
    globalThis.document = dom.window.document;
    globalThis.window = dom.window;
    globalThis.chrome = {
      storage: mockStorage.storage,
      runtime: {
        sendMessage: async msg => {
          if (msg.type !== 'TOTP_ACTION') return {};
          if (msg.payload.command === 'list_all') {
            const list = await listAllTotpCodes('https://okx.com');
            const skew = mockStorage.localData.detectedClockSkewSec;
            const off = mockStorage.localData.totpTimeOffsetSeconds || 0;
            const uncomp = Math.abs(skew - off) >= 20 ? skew - off : 0;
            return { ...list, status: 'ok', vaultLocked: false, clockState: { offsetSeconds: off, detectedSkewSeconds: skew, uncompensatedSkewSeconds: uncomp } };
          }
          if (msg.payload.command === 'set_time_offset') {
            await setTotpTimeOffset(msg.payload.offsetSeconds);
            return { status: 'ok' };
          }
          return { status: 'ok' };
        }
      }
    };
    authCtrl = await mountAuthenticatorView(dom.window.document.getElementById('root'), { origin: 'https://okx.com' });
    const banner = dom.window.document.querySelector('.clock-skew-banner');
    assert.equal(banner.hidden, false);
    assert.match(banner.textContent, /спешат на 40с/);
    banner.querySelector('button').click();
    await new Promise(r => setTimeout(r, 40));
    assert.equal(mockStorage.localData.totpTimeOffsetSeconds, -40);
    assert.equal(dom.window.document.querySelector('.clock-skew-banner').hidden, true);
  } finally {
    authCtrl?.destroy();
    dom.window.close();
    globalThis.chrome = prior.chrome;
    globalThis.fetch = prior.fetch;
    globalThis.document = prior.document;
    globalThis.window = prior.window;
  }
});

test('Feature #6 Withdraw Check extracts amount/wallet and renders only when setting is enabled', async () => {
  const enInfo = extractWithdrawalInfo(
    'Withdraw Confirmation',
    'You requested to withdraw 250.5 USDT to address TXyz123456789012345678901234569aBC. Verification code: 482910'
  );
  assert.equal(enInfo.amount, '250.5');
  assert.equal(enInfo.currency, 'USDT');
  assert.equal(enInfo.addressShort, 'TXyz12…9aBC');
  assert.equal(enInfo.summary, '250.5 USDT → TXyz12…9aBC');

  const ruInfo = extractWithdrawalInfo(
    'Подтверждение вывода средств',
    'Сумма вывода: 1 200 USDC на кошелёк 0x71C8000000000000000000000000000000004f9A. Код: 731904'
  );
  assert.equal(ruInfo.amount, '1200');
  assert.equal(ruInfo.currency, 'USDC');
  assert.equal(ruInfo.addressShort, '0x71C8…4f9A');

  assert.equal(extractWithdrawalInfo('Login verification code', 'Your code is 482910'), null);

  const ranked = rankCandidates([{
    id: 'wd-1',
    from: 'noreply@okx.com',
    subject: 'Withdraw Confirmation',
    body: 'Withdraw 250.5 USDT to TXyz123456789012345678901234569aBC. Code: 482910',
    timestamp: Date.now()
  }], { siteId: 'generic', origin: 'https://www.okx.com' });
  assert.equal(ranked.status, 'found');
  assert.equal(ranked.candidate.withdrawalInfo.summary, '250.5 USDT → TXyz12…9aBC');

  // Verify content.js hides withdrawal badge when showWithdrawalDetails=false and reveals when true
  const fieldsSource = readFileSync(new URL('../src/fields.js', import.meta.url), 'utf8');
  const contentSource = readFileSync(new URL('../src/content.js', import.meta.url), 'utf8').replace(/if \(!\w+\.isTrusted\) return;/g, '');
  const mockStorage = makeChromeStorageMock({ autoWatch: true, showWithdrawalDetails: false, detailedPopup: false });

  const dom = new JSDOM(`
    <label for="otp">Email verification code</label>
    <input id="otp" maxlength="6" inputmode="numeric">
  `, { url: 'https://www.okx.com/balance/withdrawal', runScripts: 'outside-only' });

  dom.window.chrome = {
    storage: mockStorage.storage,
    runtime: {
      sendMessage: async req => {
        if (req.type === 'SEARCH_INLINE') {
          return {
            status: 'found',
            kind: 'code',
            code: '482910',
            withdrawalInfo: enInfo,
            timestamp: Date.now(),
            lifetimeSeconds: 300,
            from: 'noreply@okx.com',
            subject: 'Withdraw Confirmation',
            requiresReview: false,
            sessionId: 'sess-wd'
          };
        }
        return {};
      },
      onMessage: { addListener() {} }
    }
  };

  try {
    dom.window.eval(fieldsSource);
    evaluateContent(dom.window, contentSource);
    await new Promise(r => setTimeout(r, 60));

    const chipOff = inlineChip(dom.window.document);
    assert.ok(chipOff);
    assert.equal(chipOff.textContent, '482910');

    // Enable the opt-in setting dynamically
    await mockStorage.storage.local.set({ showWithdrawalDetails: true });
    await new Promise(r => setTimeout(r, 20));
    assert.match(chipOff.textContent, /482910/);
    assert.match(chipOff.textContent, /250\.5 USDT/);
    assert.match(chipOff.textContent, /TXyz12…9aBC/);
  } finally {
    dom.window.close();
  }
});

test('Feature #8 Smart Multi-Cell Paste Helper stays idle on load and distributes broken paste across 6 cells in 1 click', async () => {
  const fieldsSource = readFileSync(new URL('../src/fields.js', import.meta.url), 'utf8');
  const contentSource = readFileSync(new URL('../src/content.js', import.meta.url), 'utf8');
  const mockStorage = makeChromeStorageMock({ autoWatch: false });
  let runtimeMessages = 0;

  const dom = new JSDOM(`
    <form>
      <p>Enter SMS confirmation code from Telegram</p>
      <div class="otp-row">
        <input type="tel" class="cell"><input type="tel" class="cell"><input type="tel" class="cell">
        <input type="tel" class="cell"><input type="tel" class="cell"><input type="tel" class="cell">
      </div>
    </form>
  `, { url: 'https://sms-app.example/verify', runScripts: 'outside-only' });

  dom.window.chrome = {
    storage: mockStorage.storage,
    runtime: {
      sendMessage: async () => { runtimeMessages++; return {}; },
      onMessage: { addListener() {} }
    }
  };

  try {
    dom.window.eval(fieldsSource);
    evaluateContent(dom.window, contentSource.replace('if (!e.isTrusted) return;', ''));
    await new Promise(r => setTimeout(r, 40));

    assert.equal(runtimeMessages, 0);
    assert.equal(dom.window.document.querySelector('#codesnap-paste-pill'), null);

    const cells = [...dom.window.document.querySelectorAll('.cell')];
    // Simulate a broken site where pasting only puts the string/digit into cell 0 and leaves cells 1..5 empty
    cells[0].value = '4';
    const pasteEvent = new dom.window.Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(pasteEvent, 'clipboardData', {
      value: { getData: type => (/^text/i.test(type) ? 'Код Telegram: 482915' : '') }
    });
    cells[0].dispatchEvent(pasteEvent);

    await new Promise(r => setTimeout(r, 50));
    const pillHost = dom.window.document.querySelector('#codesnap-paste-pill');
    assert.ok(pillHost, 'Broken paste helper pill must appear below 6-cell group');
    const splitBtn = pillHost.shadowRoot.querySelector('.cs-split-paste-btn');
    assert.match(splitBtn.textContent, /482915/);

    splitBtn.click();
    for (let i = 0; i < 30 && dom.window.document.querySelector('#codesnap-paste-pill'); i++) {
      await new Promise(r => setTimeout(r, 25));
    }
    assert.deepEqual(cells.map(c => c.value), ['4', '8', '2', '9', '1', '5']);
    assert.equal(dom.window.document.querySelector('#codesnap-paste-pill'), null);
  } finally {
    dom.window.close();
  }
});
