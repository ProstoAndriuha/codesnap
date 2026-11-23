import { importBackground } from './content-harness.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { JSDOM } from 'jsdom';

test('local multi-mail search scans open webmail tabs without servers and respects toggle', async () => {
  const prior = { chrome: globalThis.chrome, setInterval: globalThis.setInterval };
  let listener;
  let webmailEnabled = true;
  const scannedTabs = [];
  globalThis.setInterval = () => 1;
  globalThis.chrome = {
    runtime: { id: 'ongiekgidmkffdhgmjmlnjjgoggojoak', onMessage: { addListener(fn) { listener = fn; } } },
    storage: {
      local: {
        get: async () => ({ accountSelections: {}, senders: {}, localWebmailEnabled: webmailEnabled, enabledMailProviders: ['yandex', 'outlook'], localApiAccounts: [] }),
        set: async () => {}
      },
      session: { get: async () => ({ extraAccounts: [] }) }
    },
    identity: { getAuthToken: async () => { throw new Error('no google'); } },
    tabs: {
      query: async () => [
        { id: 1, url: 'https://example.com/login' },
        { id: 42, url: 'https://mail.yandex.ru/?uid=1#inbox' }
      ],
      get: async id => ({ id, url: id === 1 ? 'https://example.com/login' : 'https://mail.yandex.ru/' }),
      sendMessage: async (tabId, request) => {
        if (request.type === 'FIELD_STATUS') return { origin: 'https://example.com', fieldId: 'field' };
        if (request.type === 'SCAN_WEBMAIL') {
          scannedTabs.push(tabId);
          return {
            ok: true,
            provider: 'yandex',
            accountEmail: 'owner@yandex.ru',
            messages: [{ id: 'ym-1', from: 'codes@example.com', subject: 'Example verification code', body: 'Your verification code is 483921', timestamp: Date.now() }],
            unreadHints: []
          };
        }
        return { status: 'inserted' };
      },
      onRemoved: { addListener() {} },
      onUpdated: { addListener() {} }
    }
  };
  try {
    await importBackground(`../src/background.js?localmail=${Math.random()}`);
    const send = (request, sender) => new Promise(resolve => listener(request, sender, resolve));
    const found = await send({ type: 'SEARCH_POPUP', tabId: 1, origin: 'https://example.com', siteId: 'generic', fieldId: 'field', channel: 'email', accountSelection: 'local:tab:42' }, {});
    assert.equal(found.status, 'found');
    assert.equal(found.code, '483921');
    assert.equal(found.accountEmail, 'owner@yandex.ru');
    assert.equal(found.accountProvider, 'yandex');
    assert.deepEqual(scannedTabs, [42]);
    const pinFound = await send({ type: 'SEARCH_POPUP', tabId: 1, origin: 'https://example.com', siteId: 'generic', fieldId: 'field', channel: 'email', accountSelection: 'local:pin:yandex' }, {});
    assert.equal(pinFound.code, '483921');

    webmailEnabled = false;
    assert.equal((await send({ type: 'INSERT_POPUP', tabId: 1, origin: 'https://example.com', sessionId: pinFound.sessionId }, {})).status, 'expired');
    const callsBefore = scannedTabs.length;
    assert.notEqual((await send({ type: 'SEARCH_POPUP', tabId: 1, origin: 'https://example.com', siteId: 'generic', fieldId: 'field', channel: 'email', accountSelection: 'local:tab:42' }, {})).status, 'found');
    assert.equal(scannedTabs.length, callsBefore);

    assert.equal((await send({ type: 'LOCAL_MAIL_ACTION', payload: { command: 'connect', provider: 'yandex' } }, { tab: { id: 1 }, url: 'https://example.com' })).status, 'untrusted');
  } finally {
    Object.assign(globalThis, prior);
  }
});

test('no Cloud backend URLs or helper settings remain in extension source or manifest', () => {
  const manifest = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
  assert.equal(manifest.host_permissions.some(p => p.includes('fundingbotsecret')), false);
  for (const file of readdirSync(new URL('../src', import.meta.url)).filter(name => /\.(js|html|css)$/.test(name))) {
    const content = readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8');
    assert.doesNotMatch(content, /fundingbotsecret\.pp\.ua|mailCloudEnabled|MAIL_YANDEX_CONNECT/);
  }
});

test('popup exposes 12 local mail providers and handles local connect/remove safely', async () => {
  const html = readFileSync(new URL('../src/popup.html', import.meta.url), 'utf8');
  const code = readFileSync(new URL('../src/popup.js', import.meta.url), 'utf8').replace(/^import .*;\r?\n/gm, '');
  const dom = new JSDOM(html, { url: 'https://extension-test.invalid', runScripts: 'outside-only' });
  const { window } = dom;
  const requests = [];
  window.listAccounts = async () => ({ primaryEmail: null, extras: [], mailAccounts: [] });
  window.LOCAL_MAIL_PROVIDERS = {
    yandex: { name: 'Яндекс Почта' },
    outlook: { name: 'Outlook / Hotmail' },
    yahoo: { name: 'Yahoo Mail' },
    mailru: { name: 'Mail.ru' },
    proton: { name: 'Proton Mail' },
    icloud: { name: 'iCloud Mail' },
    zoho: { name: 'Zoho Mail' },
    rambler: { name: 'Рамблер/почта' },
    fastmail: { name: 'Fastmail' },
    aol: { name: 'AOL Mail' },
    gmx: { name: 'GMX / Mail.com' },
    gmail: { name: 'Gmail (вкладка)' }
  };
  window.chrome = {
    i18n: { getMessage: () => '' },
    runtime: {
      getManifest: () => ({ version: '0.9.0' }),
      sendMessage: async request => {
        requests.push(request);
        return { status: 'ok', account: { id: 'pin:outlook', provider: 'outlook', email: 'Outlook / Hotmail' } };
      }
    },
    tabs: { query: async () => [{ id: 1, url: 'about:blank' }] },
    storage: { local: { get: async () => ({}), set: async () => {} } }
  };
  window.eval(code);
  await new Promise(resolve => setTimeout(resolve, 25));
  const $ = id => window.document.getElementById(id);

  assert.equal($('provider').hidden, false);
  for (const provider of ['gmail', 'yandex', 'outlook', 'yahoo', 'mailru', 'proton', 'icloud', 'zoho', 'rambler', 'fastmail', 'aol', 'gmx']) {
    assert.ok($('provider').querySelector(`option[value="${provider}"]`), `missing provider ${provider}`);
  }
  assert.equal($('localWebmailEnabled').checked, true);

  $('provider').value = 'outlook';
  $('provider').dispatchEvent(new window.Event('change'));
  assert.equal($('localProviderHint').hidden, false);
  assert.equal($('localApiForm').hidden, false);
  assert.equal($('outlookFields').hidden, false);
  assert.equal($('fastmailFields').hidden, true);

  $('connect').click();
  await new Promise(resolve => setTimeout(resolve, 25));
  assert.deepEqual(JSON.parse(JSON.stringify(requests.at(-1))), { type: 'LOCAL_MAIL_ACTION', payload: { command: 'connect', provider: 'outlook' } });

  $('provider').value = 'fastmail';
  $('provider').dispatchEvent(new window.Event('change'));
  assert.equal($('fastmailFields').hidden, false);
  $('fastmailToken').value = 'fmu1-secret-token';
  $('localApiForm').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await new Promise(resolve => setTimeout(resolve, 25));
  assert.equal(requests.at(-1).payload.provider, 'fastmail_jmap');
  assert.equal($('fastmailToken').value, '');
  dom.window.close();
});
