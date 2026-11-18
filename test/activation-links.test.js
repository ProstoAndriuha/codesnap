import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { extractActionLinks, rankCandidates, siteIdentity } from '../src/core.js';

const fieldsSource = readFileSync(new URL('../src/fields.js', import.meta.url), 'utf8');

test('extractActionLinks prefers CTA confirmation links and rejects unsubscribe, privacy, homepages and security traps', () => {
  const html = `
    <p>Confirm your email address for Notion by clicking below:</p>
    <p><a href="https://www.notion.so/login/magic?token=tok_abc1234567890xyz">Confirm my email</a></p>
    <p>If this wasn't you, <a href="https://www.notion.so/security/lock?id=9988">lock your account immediately</a>.</p>
    <p><a href="https://www.notion.so/">Visit website</a> · <a href="https://www.notion.so/privacy">Privacy policy</a> · <a href="https://www.notion.so/unsubscribe?u=1">Unsubscribe</a></p>
    <p><a href="https://twitter.com/notionhq">Twitter</a></p>
  `;
  const links = extractActionLinks({ html, body: '' }, siteIdentity('https://www.notion.so'));
  assert.equal(links.length, 1);
  assert.equal(links[0].url, 'https://www.notion.so/login/magic?token=tok_abc1234567890xyz');
  assert.equal(links[0].label, 'Confirm my email');
  assert.equal(links[0].domainRelated, true);
});

test('rankCandidates handles link-only emails, dual code+link emails, and rejects Russian trap links', () => {
  const now = Date.now();
  const magicMail = {
    id: 'magic-1',
    from: 'Auth <noreply@linear.app>',
    subject: 'Sign in to Linear',
    body: 'Нажмите ссылку ниже, чтобы войти. Если вы не запрашивали вход, отмените запрос: https://linear.app/cancel?id=123456789',
    html: '<p>Перейдите для подтверждения входа:</p><a href="https://linear.app/auth/callback?token=magic_9876543210abcdef">Войти в Linear</a><p>Если вы не запрашивали вход, <a href="https://linear.app/cancel?id=123456789">отменить вход</a></p>',
    timestamp: now - 3000
  };
  const ranked = rankCandidates([magicMail], { siteId: 'generic', origin: 'https://linear.app', siteContext: { prefer: 'link' }, now });
  assert.equal(ranked.status, 'found');
  assert.equal(ranked.candidate.kind, 'link');
  assert.equal(ranked.candidate.code, null);
  assert.equal(ranked.candidate.link.url, 'https://linear.app/auth/callback?token=magic_9876543210abcdef');
  assert.equal(ranked.candidate.requiresReview, false);

  const dualMail = {
    id: 'dual-1',
    from: 'Supabase <noreply@auth.example.com>',
    subject: 'Confirm your signup',
    body: 'Your confirmation code is 583920 or click the link.',
    html: '<p>Your code is <b>583920</b></p><a href="https://example.com/auth/confirm?token=verify_1234567890abcd">Confirm your mail</a>',
    timestamp: now - 2000
  };
  const dualRanked = rankCandidates([dualMail], { siteId: 'generic', origin: 'https://example.com', now });
  assert.equal(dualRanked.status, 'found');
  assert.equal(dualRanked.candidate.kind, 'both');
  assert.equal(dualRanked.candidate.code, '583920');
  assert.equal(dualRanked.candidate.link.url, 'https://example.com/auth/confirm?token=verify_1234567890abcd');
});

test('detectLinkPrompt recognizes confirmation-link waiting screens and ignores login email inputs', () => {
  const dom = new JSDOM(`
    <main class="verify-card">
      <h1>Check your email</h1>
      <p>We have sent a confirmation link to a***b@gmail.com. Click the link in the email to activate your account.</p>
    </main>
  `, { url: 'https://app.example.com/check-email', runScripts: 'outside-only' });
  dom.window.eval(fieldsSource);
  assert.equal(dom.window.VerificationFields.detect(dom.window.document), null);
  const prompt = dom.window.VerificationFields.detectLinkPrompt(dom.window.document);
  assert.equal(prompt?.type, 'link-prompt');
  assert.equal(prompt?.channel, 'email');
  dom.window.close();

  const loginDom = new JSDOM(`
    <form>
      <p>Sign in with a magic link — we will send a confirmation link to your email.</p>
      <input type="email" name="email" placeholder="you@example.com">
      <button type="submit">Send link</button>
    </form>
  `, { url: 'https://app.example.com/login', runScripts: 'outside-only' });
  loginDom.window.eval(fieldsSource);
  assert.equal(loginDom.window.VerificationFields.detectLinkPrompt(loginDom.window.document), null);
  loginDom.window.close();
});

test('background OPEN_LINK_POPUP opens validated HTTPS activation links on click', async () => {
  const prior = { chrome: globalThis.chrome, fetch: globalThis.fetch, setInterval: globalThis.setInterval };
  let listener;
  const openedUrls = [];
  globalThis.setInterval = () => 1;
  globalThis.chrome = {
    storage: { local: { get: async () => ({ primaryEmail: 'owner@example.com', accountSelections: {}, learnedSenders: {} }), set: async () => {} }, session: { get: async () => ({ extraAccounts: [] }) } },
    identity: { getAuthToken: async () => ({ token: 'tok' }) },
    tabs: {
      get: async () => ({ url: 'https://example.com/check-email' }),
      sendMessage: async () => ({ origin: 'https://example.com', fieldId: 'prompt-1', fieldType: 'link-prompt' }),
      create: async opts => { openedUrls.push(opts.url); return { id: 99 }; },
      onRemoved: { addListener() {} },
      onUpdated: { addListener() {} }
    },
    runtime: { onMessage: { addListener(fn) { listener = fn; } } }
  };
  const html = '<a href="https://example.com/activate?token=secret_token_12345678">Activate account</a>';
  globalThis.fetch = async url => {
    const path = new URL(url).pathname;
    return {
      ok: true,
      status: 200,
      json: async () => path.endsWith('/messages')
        ? { messages: [{ id: 'act-1' }] }
        : {
            id: 'act-1',
            internalDate: String(Date.now() - 1000),
            payload: {
              headers: [{ name: 'From', value: 'noreply@example.com' }, { name: 'Subject', value: 'Activate your account' }],
              mimeType: 'text/html',
              body: { data: Buffer.from(html).toString('base64url') }
            }
          }
    };
  };
  try {
    await import(`../src/background.js?links=${Math.random()}`);
    const send = (req, sender = {}) => new Promise(resolve => listener(req, sender, resolve));
    const found = await send({ type: 'SEARCH_POPUP', tabId: 5, origin: 'https://example.com', siteId: 'generic', fieldId: 'prompt-1', siteContext: { prefer: 'link', hasCodeField: false } });
    assert.equal(found.status, 'found');
    assert.equal(found.kind, 'link');
    assert.equal(found.link.url, 'https://example.com/activate?token=secret_token_12345678');

    const opened = await send({ type: 'OPEN_LINK_POPUP', tabId: 5, origin: 'https://example.com', sessionId: found.sessionId });
    assert.equal(opened.status, 'opened');
    assert.deepEqual(openedUrls, ['https://example.com/activate?token=secret_token_12345678']);
  } finally {
    Object.assign(globalThis, prior);
  }
});
