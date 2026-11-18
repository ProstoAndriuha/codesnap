import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const webmailSource = readFileSync(new URL('../src/webmail.js', import.meta.url), 'utf8');

function loadWebmail(html, url) {
  const dom = new JSDOM(html, { url, runScripts: 'outside-only' });
  dom.window.eval(webmailSource);
  return { dom, api: dom.window.CodeSnapWebmail };
}

test('CodeSnapWebmail reads Yandex, Outlook, Yahoo, Mail.ru and Proton messages locally and unwraps SafeLinks', () => {
  const now = Date.now();

  const yandex = loadWebmail(`
    <div class="mail-User-Name">user@yandex.ru</div>
    <h1 class="mail-Message-Toolbar-Subject">Код подтверждения Notion</h1>
    <span class="mail-Message-Sender-Email">noreply@notion.so</span>
    <span class="mail-Message-Head-RecievedDate">только что</span>
    <div class="mail-Message-Body-Content">Ваш код: 492018. <a href="https://www.notion.so/verify?token=abc123456789">Подтвердить</a></div>
  `, 'https://mail.yandex.ru/?uid=1#inbox');
  const yScan = yandex.api.scanDocument(yandex.dom.window.document, 'mail.yandex.ru', now);
  assert.equal(yScan.provider, 'yandex');
  assert.equal(yScan.accountEmail, 'user@yandex.ru');
  assert.equal(yScan.messages.length, 1);
  assert.match(yScan.messages[0].body, /492018/);
  assert.equal(yScan.messages[0].links[0].url, 'https://www.notion.so/verify?token=abc123456789');
  yandex.dom.window.close();

  const outlook = loadWebmail(`
    <div id="mectrl_currentAccount_secondary">user@outlook.com</div>
    <div role="heading" aria-level="2">Confirm email</div>
    <div data-testid="SenderPersona">security@linear.app</div>
    <time datetime="${new Date(now - 20_000).toISOString()}">1m</time>
    <div aria-label="Message body">
      <a href="https://eur01.safelinks.protection.outlook.com/?url=https%3A%2F%2Flinear.app%2Fverify%3Ftoken%3Dxyz987654321&amp;data=05">Verify email</a>
    </div>
  `, 'https://outlook.live.com/mail/0/inbox');
  const oScan = outlook.api.scanDocument(outlook.dom.window.document, 'outlook.live.com', now);
  assert.equal(oScan.provider, 'outlook');
  assert.equal(oScan.accountEmail, 'user@outlook.com');
  assert.equal(oScan.messages[0].links[0].url, 'https://linear.app/verify?token=xyz987654321');
  outlook.dom.window.close();

  const yahoo = loadWebmail(`
    <h1 data-test-id="message-group-subject">Bybit Verification</h1>
    <span data-test-id="message-from">noreply@bybit.com</span>
    <span data-test-id="message-date">2 мин назад</span>
    <div data-test-id="message-view-body-content">Your verification code is 718293</div>
  `, 'https://mail.yahoo.com/d/folders/1');
  const yaScan = yahoo.api.scanDocument(yahoo.dom.window.document, 'mail.yahoo.com', now);
  assert.equal(yaScan.provider, 'yahoo');
  assert.match(yaScan.messages[0].body, /718293/);
  yahoo.dom.window.close();

  const mailru = loadWebmail(`
    <span class="ph-project__user-name">user@mail.ru</span>
    <h2 class="thread-subject">Код входа</h2>
    <span class="letter-contact" title="noreply@okx.com">OKX</span>
    <span class="letter__date">just now</span>
    <div class="letter-body">Ваш код подтверждения: 384729</div>
  `, 'https://e.mail.ru/inbox/');
  const mrScan = mailru.api.scanDocument(mailru.dom.window.document, 'e.mail.ru', now);
  assert.equal(mrScan.provider, 'mailru');
  assert.equal(mrScan.accountEmail, 'user@mail.ru');
  assert.match(mrScan.messages[0].body, /384729/);
  mailru.dom.window.close();

  const proton = loadWebmail(`
    <h1 data-testid="conversation-header:subject">Discord Login</h1>
    <span data-testid="message-header:from">noreply@discord.com</span>
    <time data-testid="item-date">1 min ago</time>
    <div data-testid="message-content:body">Verification code: 649201</div>
  `, 'https://mail.proton.me/u/0/inbox');
  const pScan = proton.api.scanDocument(proton.dom.window.document, 'mail.proton.me', now);
  assert.equal(pScan.provider, 'proton');
  assert.match(pScan.messages[0].body, /649201/);
  proton.dom.window.close();
});

test('CodeSnapWebmail rejects yesterday/old messages and surfaces unread row hints', () => {
  const now = Date.now();
  const yandexOld = loadWebmail(`
    <div class="mail-MessageSnippet is-unread">
      <span class="mail-MessageSnippet-FromText">codes@example.com</span>
      <span class="mail-MessageSnippet-Item_subject">Verification code</span>
      <span class="mail-MessageSnippet-Item_date">вчера</span>
    </div>
    <div class="mail-MessageSnippet is-unread">
      <span class="mail-MessageSnippet-FromText">codes@example.com</span>
      <span class="mail-MessageSnippet-Item_subject">Example verification code</span>
      <span class="mail-MessageSnippet-Item_date">только что</span>
    </div>
  `, 'https://mail.yandex.ru/');
  const scan = yandexOld.api.scanDocument(yandexOld.dom.window.document, 'mail.yandex.ru', now);
  assert.equal(scan.messages.length, 1);
  assert.equal(scan.unreadHints.length, 1);
  assert.equal(yandexOld.api.parseRelativeTimestamp('12 окт', now), null);
  assert.equal(yandexOld.api.parseRelativeTimestamp('2 hours ago', now), null);
  assert.equal(yandexOld.api.parseRelativeTimestamp('yesterday', now), null);
  assert.ok(yandexOld.api.parseRelativeTimestamp('3 мин назад', now) !== null);
  yandexOld.dom.window.close();
});

test('Fastmail JMAP local connector works without backend servers', async () => {
  const prior = { chrome: globalThis.chrome, fetch: globalThis.fetch };
  const stored = { localApiAccounts: [] };
  globalThis.chrome = {
    permissions: { request: async () => true },
    storage: {
      local: {
        get: async () => stored,
        set: async value => Object.assign(stored, value)
      }
    }
  };
  globalThis.fetch = async url => {
    if (url.endsWith('/jmap/session')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ username: 'user@fastmail.com', apiUrl: 'https://api.fastmail.com/jmap/api/', primaryAccounts: { 'urn:ietf:params:jmap:mail': 'u123' } })
      };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({
        methodResponses: [
          ['Email/query', { ids: ['e1'] }, 'q0'],
          ['Email/get', {
            list: [{
              id: 'e1',
              from: [{ name: 'GitHub', email: 'noreply@github.com' }],
              subject: 'GitHub verification code',
              receivedAt: new Date().toISOString(),
              textBody: [{ partId: 'p1' }],
              htmlBody: [],
              bodyValues: { p1: { value: 'Your GitHub code is 849201' } }
            }]
          }, 'g0']
        ]
      })
    };
  };
  try {
    const { connectLocalProvider, scanLocalMail } = await import(`../src/local-mail.js?fm=${Math.random()}`);
    const connected = await connectLocalProvider({ provider: 'fastmail_jmap', apiToken: 'fmu1-test' });
    assert.equal(connected.account.email, 'user@fastmail.com');
    const scan = await scanLocalMail({ selected: `local:${connected.account.id}` });
    assert.equal(scan.messages.length, 1);
    assert.equal(scan.messages[0].accountProvider, 'fastmail');
    assert.match(scan.messages[0].body, /849201/);
  } finally {
    Object.assign(globalThis, prior);
  }
});
