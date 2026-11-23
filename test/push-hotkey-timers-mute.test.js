import { evaluateContent, inlineChip, importBackground } from './content-harness.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const fieldsSource = readFileSync(new URL('../src/fields.js', import.meta.url), 'utf8');
const contentSource = readFileSync(new URL('../src/content.js', import.meta.url), 'utf8');
const webmailSource = readFileSync(new URL('../src/webmail.js', import.meta.url), 'utf8');

test('Item 2: Webmail MutationObserver pushes fresh code immediately to waiting website tab', async () => {
  const prior = { chrome: globalThis.chrome, setInterval: globalThis.setInterval };
  let bgListener;
  const pushedToWebsite = [];
  const storageData = {
    accountSelections: {},
    senders: {},
    learnedSenders: {},
    learnedAccounts: {},
    localWebmailEnabled: true,
    mutedOrigins: []
  };

  globalThis.setInterval = () => 1;
  globalThis.chrome = {
    storage: {
      local: {
        get: async () => storageData,
        set: async obj => Object.assign(storageData, obj)
      },
      session: { get: async () => ({ extraAccounts: [] }), set: async () => {} }
    },
    identity: { getAuthToken: async () => { throw new Error('no gmail'); } },
    tabs: {
      query: async () => [
        { id: 1, url: 'https://example.com/verify' },
        { id: 2, url: 'https://mail.yandex.ru/?uid=1#inbox' }
      ],
      get: async id => ({ id, url: id === 1 ? 'https://example.com/verify' : 'https://mail.yandex.ru/' }),
      sendMessage: async (tabId, message) => {
        if (tabId === 1 && message.type === 'FIELD_STATUS') return { origin: 'https://example.com', fieldId: 'otp-field' };
        if (tabId === 1 && message.type === 'CODE_FOUND') { pushedToWebsite.push(message); return { status: 'ok' }; }
        if (tabId === 2 && message.type === 'SCAN_WEBMAIL') return { ok: true, provider: 'yandex', accountEmail: 'alice@yandex.ru', messages: [], unreadHints: [] };
        return {};
      },
      onRemoved: { addListener() {} },
      onUpdated: { addListener() {} }
    },
    runtime: {
      id: 'ongiekgidmkffdhgmjmlnjjgoggojoak',
      onMessage: { addListener(fn) { bgListener = fn; } }
    }
  };

  const mailDom = new JSDOM(`<!doctype html><body><div class="mail-User-Name">alice@yandex.ru</div><div id="inbox"></div></body>`, {
    url: 'https://mail.yandex.ru/?uid=1#inbox',
    runScripts: 'outside-only'
  });

  try {
    await importBackground(`../src/background.js?push=${Math.random()}`);
    const sendBg = (req, sender) => new Promise(resolve => bgListener(req, sender, resolve));

    // Step 1: Website tab searches and enters waiting state (no code in webmail yet)
    const waiting = await sendBg(
      { type: 'SEARCH_INLINE', origin: 'https://example.com', fieldId: 'otp-field', channel: 'email', automatic: true },
      { tab: { id: 1 }, frameId: 0, url: 'https://example.com/verify' }
    );
    assert.equal(waiting.status, 'none');

    // Step 2: Mount webmail content script and simulate email arrival via DOM mutation
    mailDom.window.chrome = {
      runtime: {
        onMessage: { addListener() {} },
        sendMessage: async msg => {
          return sendBg(msg, { tab: { id: 2, url: 'https://mail.yandex.ru/?uid=1#inbox' }, frameId: 0, url: 'https://mail.yandex.ru/?uid=1#inbox' });
        }
      }
    };
    mailDom.window.eval(webmailSource);
    await new Promise(r => setTimeout(r, 30));

    mailDom.window.document.getElementById('inbox').innerHTML = `
      <h1 class="mail-Message-Toolbar-Subject">Example login code</h1>
      <span class="mail-Message-Sender-Email">noreply@example.com</span>
      <span class="mail-Message-Head-RecievedDate">только что</span>
      <div class="mail-Message-Body-Content">Your Example verification code is 849201.</div>
    `;

    await new Promise(r => setTimeout(r, 220));
    assert.equal(pushedToWebsite.length, 1);
    assert.equal(pushedToWebsite[0].type, 'CODE_FOUND');
    assert.equal(pushedToWebsite[0].code, '849201');
    assert.equal(pushedToWebsite[0].fieldId, 'otp-field');

    // Muted origin suppresses future pushes
    pushedToWebsite.length = 0;
    storageData.mutedOrigins = ['https://example.com'];
    await sendBg(
      {
        type: 'WEBMAIL_PUSH',
        provider: 'yandex',
        accountEmail: 'alice@yandex.ru',
        messages: [{ id: 'm2', from: 'noreply@example.com', subject: 'Example code', body: 'Code: 112233', timestamp: Date.now() }],
        unreadHints: []
      },
      { tab: { id: 2, url: 'https://mail.yandex.ru/' }, frameId: 0, url: 'https://mail.yandex.ru/' }
    );
    assert.equal(pushedToWebsite.length, 0);
  } finally {
    mailDom.window.close();
    Object.assign(globalThis, prior);
  }
});

test('Item 3 & 5: Alt+Shift+V hotkey, context menu fallback, clipboard 45s auto-clear alarm', async () => {
  const prior = { chrome: globalThis.chrome, fetch: globalThis.fetch, setInterval: globalThis.setInterval };
  let bgListener;
  let cmdListener;
  let menuListener;
  let alarmListener;
  let offscreenListener;
  const alarmsCreated = [];
  const offscreenWrites = [];
  const toasts = [];
  let autoClearSetting = true;

  globalThis.setInterval = () => 1;
  let mode = 'active_custom';
  globalThis.chrome = {
    i18n: { getMessage: () => '' },
    storage: {
      local: {
        get: async () => ({ primaryEmail: 'alice@gmail.com', accountSelections: {}, senders: {}, learnedSenders: {}, autoClearClipboard: autoClearSetting }),
        set: async () => {}
      },
      session: { get: async () => ({ extraAccounts: [] }), set: async () => {} }
    },
    identity: { getAuthToken: async () => ({ token: 'tok' }), removeCachedAuthToken: async () => {} },
    offscreen: { createDocument: async () => {} },
    alarms: {
      create: (name, opts) => alarmsCreated.push({ name, opts }),
      onAlarm: { addListener(fn) { alarmListener = fn; } }
    },
    contextMenus: {
      removeAll: cb => cb?.(),
      create: () => {},
      onClicked: { addListener(fn) { menuListener = fn; } }
    },
    commands: {
      onCommand: { addListener(fn) { cmdListener = fn; } }
    },
    tabs: {
      query: async () => [{ id: 10, url: 'https://custom-app.example/check' }],
      get: async () => ({ id: 10, url: 'https://custom-app.example/check' }),
      sendMessage: async (_tabId, msg) => {
        if (msg.type === 'FIELD_STATUS') return { origin: 'https://custom-app.example', detected: false, channel: null, siteContext: { title: 'Custom App' } };
        if (msg.type === 'FORCE_INSERT_ACTIVE') return mode === 'active_custom' ? { status: 'inserted' } : { status: 'no_active_input' };
        if (msg.type === 'SHOW_INLINE_TOAST') { toasts.push(msg.text); return { status: 'ok' }; }
        return {};
      },
      onRemoved: { addListener() {} },
      onUpdated: { addListener() {} }
    },
    runtime: {
      id: 'ongiekgidmkffdhgmjmlnjjgoggojoak',
      getURL: path => `chrome-extension://ongiekgidmkffdhgmjmlnjjgoggojoak/${path}`,
      getContexts: async () => [{}],
      onInstalled: { addListener() {} },
      onStartup: { addListener() {} },
      onMessage: { addListener(fn) { bgListener = fn; } },
      sendMessage: async msg => {
        if (msg.type === 'OFFSCREEN_CLIPBOARD_WRITE') {
          offscreenWrites.push(msg.text);
          return { ok: true };
        }
        return {};
      }
    }
  };

  globalThis.fetch = async url => {
    if (new URL(url).pathname.endsWith('/messages')) return { ok: true, status: 200, json: async () => ({ messages: [{ id: 'm1' }] }) };
    return {
      ok: true,
      status: 200,
      json: async () => ({
        id: 'm1',
        internalDate: String(Date.now()),
        payload: {
          headers: [{ name: 'From', value: 'no-reply@custom-app.example' }, { name: 'Subject', value: 'Your verification code' }],
          mimeType: 'text/plain',
          body: { data: Buffer.from('Custom App login code: 593027').toString('base64url') }
        }
      })
    };
  };

  try {
    await importBackground(`../src/background.js?hotkey=${Math.random()}`);

    // 1) Hotkey Alt+Shift+V falls back to FORCE_INSERT_ACTIVE on an undetected active input
    await cmdListener('fill-verification-code');
    assert.ok(toasts.some(t => /вставлен/i.test(t)));

    // 2) Context menu falls back to offscreen clipboard + 45s auto-clear alarm when no input is active
    mode = 'no_input';
    await menuListener({ menuItemId: 'codesnap-fill-code', frameId: 0 }, { id: 10, url: 'https://custom-app.example/check' });
    await new Promise(r => setTimeout(r, 30));
    assert.equal(offscreenWrites[0], '593027');
    assert.equal(alarmsCreated.at(-1)?.name, 'codesnap-clear-clipboard');
    assert.equal(alarmsCreated.at(-1)?.opts?.delayInMinutes, 0.75);

    // 3) Alarm clears clipboard
    await alarmListener({ name: 'codesnap-clear-clipboard' });
    assert.equal(offscreenWrites.at(-1), '');

    // 4) When disabled, alarm does not overwrite clipboard
    autoClearSetting = false;
    const before = offscreenWrites.length;
    await alarmListener({ name: 'codesnap-clear-clipboard' });
    assert.equal(offscreenWrites.length, before);
  } finally {
    Object.assign(globalThis, prior);
  }
});

test('Item 5 & 6: Live countdown expires inline code, mute hides/restores chip, and learnedAccounts resolves multi-mailbox ambiguity', async () => {
  // Part A: Live countdown & mute toggle in content.js
  const dom = new JSDOM('<label for="c">Email verification code</label><input id="c" maxlength="6">', {
    url: 'https://shop.example/verify',
    runScripts: 'outside-only'
  });
  let settingsListener;
  const store = { autoWatch: true, detailedPopup: true, mutedOrigins: [] };
  dom.window.crypto.randomUUID = () => 'f1';
  dom.window.chrome = {
    storage: {
      local: {
        get: async () => store,
        set: async obj => Object.assign(store, obj)
      },
      onChanged: { addListener(fn) { settingsListener = fn; } }
    },
    runtime: {
      onMessage: { addListener() {} },
      sendMessage: async req => {
        if (req.type === 'SEARCH_INLINE') {
          return {
            status: 'found',
            code: '731940',
            from: 'security@shop.example',
            timestamp: Date.now() - 178_500,
            lifetimeSeconds: 180,
            sessionId: 's1'
          };
        }
        return {};
      }
    }
  };
  try {
    dom.window.eval(fieldsSource);
    evaluateContent(dom.window, contentSource.replaceAll('if (!event.isTrusted) return;', '').replaceAll('if (event.isTrusted) void ', 'void '));
    await new Promise(r => setTimeout(r, 50));

    const chip = inlineChip(dom.window.document);
    assert.ok(chip);
    const panel = () => dom.window.document.querySelector('#codesnap-inline-panel')?.shadowRoot;
    assert.ok(panel().querySelector('.timer-badge'));
    assert.match(panel().querySelector('.timer-badge').textContent, /⏱ 0:0[12]/);

    // Wait for 2s expiry tick -> code automatically marks expired and fill disables
    await new Promise(r => setTimeout(r, 2200));
    assert.equal(panel().querySelector('.fill').disabled, true);
    assert.equal(chip.textContent, 'Retry');

    // Click per-site mute button -> hides chip & panel immediately
    panel().querySelector('.panel-mute-btn').click();
    await new Promise(r => setTimeout(r, 40));
    assert.deepEqual([...store.mutedOrigins], ['https://shop.example']);
    assert.equal(inlineChip(dom.window.document), null);

    // Unmute via storage listener -> chip comes back
    store.mutedOrigins = [];
    settingsListener({ mutedOrigins: { newValue: [] } }, 'local');
    assert.ok(inlineChip(dom.window.document));
  } finally {
    dom.window.close();
  }

  // Part B: learnedAccounts resolves two simultaneous codes across personal@gmail.com and work@yandex.ru
  const { rankCandidates } = await import('../src/core.js');
  const now = Date.now();
  const twoMessages = [
    { id: 'm-personal', from: 'noreply@portal.example', subject: 'Portal code', body: 'Your verification code is 111222', timestamp: now - 5000, accountEmail: 'personal@gmail.com', accountProvider: 'gmail' },
    { id: 'm-work', from: 'noreply@portal.example', subject: 'Portal code', body: 'Your verification code is 999888', timestamp: now - 5000, accountEmail: 'work@yandex.ru', accountProvider: 'yandex' }
  ];

  const withoutPreferred = rankCandidates(twoMessages, { siteId: 'generic', origin: 'https://portal.example', now });
  assert.equal(withoutPreferred.status, 'ambiguous');

  const withPreferred = rankCandidates(twoMessages, { siteId: 'generic', origin: 'https://portal.example', preferredAccount: 'work@yandex.ru', now });
  assert.equal(withPreferred.status, 'found');
  assert.equal(withPreferred.candidate.code, '999888');
  assert.equal(withPreferred.candidate.accountEmail, 'work@yandex.ru');

  // Still falls back if only personal@gmail.com has a message
  const fallback = rankCandidates([twoMessages[0]], { siteId: 'generic', origin: 'https://portal.example', preferredAccount: 'work@yandex.ru', now });
  assert.equal(fallback.status, 'found');
  assert.equal(fallback.candidate.code, '111222');
});
