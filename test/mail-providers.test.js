import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

test('cloud mail account search uses the same origin-bound insertion and preserves provider', async () => {
  const prior = { chrome: globalThis.chrome, fetch: globalThis.fetch, setInterval: globalThis.setInterval };
  let listener;
  let cloudEnabled = true;
  const calls = [];
  globalThis.setInterval = () => 1;
  globalThis.chrome = {
    runtime: { id: 'ongiekgidmkffdhgmjmlnjjgoggojoak', onMessage: { addListener(fn) { listener = fn; } } },
    storage: { local: { get: async () => ({ accountSelections: {}, senders: {}, mailCloudEnabled: cloudEnabled, mailCloudToken: 'a'.repeat(43) }), set: async () => {} }, session: { get: async () => ({ extraAccounts: [] }) } },
    identity: { getAuthToken: async () => { throw new Error('no google'); } },
    tabs: { get: async () => ({ url: 'https://example.com/login' }), sendMessage: async (_id, request) => request.type === 'FIELD_STATUS' ? { origin: 'https://example.com', fieldId: 'field' } : { status: 'inserted' }, onRemoved: { addListener() {} }, onUpdated: { addListener() {} } }
  };
  globalThis.fetch = async (url, options) => {
    assert.equal(url, 'https://codesnap.fundingbotsecret.pp.ua/api/mail');
    assert.equal(options.headers.Authorization, 'Bearer ' + 'a'.repeat(43));
    const request = JSON.parse(options.body); calls.push(request);
    const result = request.command === 'list' ? { ok:true,accounts:[{id:'yahoo',email:'owner@yahoo.com',provider:'yahoo'},{id:'yandex',email:'owner@yandex.ru',provider:'yandex'}] } : request.command === 'search' ? {ok:true,messages:[{id:'1',from:'codes@example.com',subject:'Example verification code',body:'Your verification code is 483921',timestamp:Date.now()}]} : {ok:true};
    return {ok:true,json:async()=>result};
  };
  try {
    await import(`../src/background.js?mail=${Math.random()}`);
    const send = (request, sender) => new Promise(resolve => listener(request, sender, resolve));
    const found = await send({ type: 'SEARCH_POPUP', tabId: 1, origin: 'https://example.com', siteId: 'generic', fieldId: 'field', channel: 'email', accountSelection: 'mail:yahoo' }, {});
    assert.equal(found.status, 'found');
    assert.equal(found.accountEmail, 'owner@yahoo.com');
    assert.equal(found.accountProvider, 'yahoo');
    assert.deepEqual(calls.filter(call => call.command === 'search').map(call => call.id), ['yahoo']);
    cloudEnabled = false;
    assert.equal((await send({type:'INSERT_POPUP',tabId:1,origin:'https://example.com',sessionId:found.sessionId},{})).status,'expired','cached Cloud code cannot be inserted after disabling Cloud');
    const noCloudRequests = calls.length;
    assert.notEqual((await send({type:'SEARCH_POPUP',tabId:1,origin:'https://example.com',siteId:'generic',fieldId:'field',channel:'email',accountSelection:'mail:yahoo'},{})).status,'found');
    assert.equal(calls.length,noCloudRequests);
    cloudEnabled = true;
    const renewed = await send({type:'SEARCH_POPUP',tabId:1,origin:'https://example.com',siteId:'generic',fieldId:'field',channel:'email',accountSelection:'mail:yahoo'},{});
    assert.equal((await send({ type: 'INSERT_POPUP', tabId: 1, origin: 'https://example.com', sessionId: renewed.sessionId }, {})).status, 'inserted');
    const before = calls.length;
    assert.equal((await send({ type: 'MAIL_ACCOUNT', payload: { command: 'connect', password: 'must not reach helper' } }, { tab: { id: 1 }, url: 'https://example.com' })).status, 'untrusted');
    assert.equal(calls.length, before);
    assert.equal((await send({ type: 'MAIL_ACCOUNT', payload: { command: 'remove', id: 'yahoo' } }, { url: `chrome-extension://${globalThis.chrome.runtime.id}/src/popup.html` })).status, 'ok');
  } finally { Object.assign(globalThis, prior); }
});

test('Cloud is opt-in and errors do not disclose credentials', async () => {
  const prior=globalThis.chrome;
  globalThis.chrome={storage:{local:{get:async()=>({mailCloudEnabled:false})}}};
  try {
    const {mailHost,listMailAccounts,describeMailError}=await import('../src/mail-bridge.js');
    assert.deepEqual(await listMailAccounts(),[]);
    await assert.rejects(mailHost({command:'connect'}),/MAIL_CLOUD_DISABLED/);
    assert.doesNotMatch(describeMailError(new Error('private server credentials')),/private server credentials/);
  } finally {globalThis.chrome=prior;}
});

test('mail connection UI sends credentials only to extension service worker, then clears them', async () => {
  const html = readFileSync(new URL('../src/popup.html', import.meta.url), 'utf8');
  const code = readFileSync(new URL('../src/popup.js', import.meta.url), 'utf8').replace(/^import .*;\r?\n/gm, '');
  const dom = new JSDOM(html, { url: 'https://extension-test.invalid', runScripts: 'outside-only' });
  const { window } = dom;
  const writes = [], requests = [];
  window.listAccounts = async () => ({ primaryEmail: null, extras: [], mailAccounts: [] });
  window.MAIL_PROVIDERS = { yandex: {name:'Яндекс',host:'imap.yandex.ru'}, yahoo: { name: 'Yahoo', host: 'imap.mail.yahoo.com' }, imap: { name: 'IMAP', host: '' } };
  window.chrome = {
    i18n: { getMessage: () => '' }, runtime: { getManifest: () => ({ version: '0.7.0' }), sendMessage: async request => { requests.push(request); return { status: 'ok', account: { email: 'owner@yahoo.com' } }; } },
    tabs: { query: async () => [{ id: 1, url: 'about:blank' }] },
    storage: { local: { get: async () => ({}), set: async data => writes.push(data) } }
  };
  window.eval(code);
  await new Promise(resolve => setTimeout(resolve, 20));
  const $ = id => window.document.getElementById(id);
  assert.equal($('provider').querySelector('option[value="outlook"]'), null);
  assert.equal($('provider').hidden,true);
  assert.equal($('cloudMailPrivacy').hidden,true);
  $('provider').value = 'yahoo'; $('provider').dispatchEvent(new window.Event('change'));
  assert.equal($('mailForm').hidden,true);
  assert.equal($('provider').value,'gmail');
  $('mailCloudEnabled').checked=true; $('mailCloudEnabled').dispatchEvent(new window.Event('change'));
  await new Promise(resolve=>setTimeout(resolve,20));
  assert.equal($('provider').hidden,false);
  $('provider').value = 'yahoo'; $('provider').dispatchEvent(new window.Event('change'));
  assert.equal($('mailForm').hidden, false);
  assert.equal($('imapHost').value, 'imap.mail.yahoo.com');
  $('mailCloudEnabled').checked = true; $('mailConsent').checked = true;
  $('mailEmail').value = 'owner@yahoo.com'; $('mailPassword').value = 'fake-app-password';
  $('mailForm').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(requests[0].payload.password, 'fake-app-password');
  assert.equal(requests[0].payload.provider, 'yahoo');
  assert.equal($('mailPassword').value, '');
  assert.doesNotMatch(JSON.stringify(writes), /fake-app-password/);
  window.chrome.runtime.sendMessage = async () => ({ status: 'error', message: 'Unknown request.' });
  $('mailPassword').value = 'second-fake-password';
  $('mailForm').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.match($('accounts').textContent, /Обновите CodeSnap/);
  assert.equal($('mailPassword').value, '');
  $('provider').value = 'yandex'; $('provider').dispatchEvent(new window.Event('change'));
  assert.equal($('mailCredentials').open,false);
  const before=requests.length;
  $('connect').click();
  await new Promise(resolve => setTimeout(resolve,20));
  assert.equal(requests.length,before,'no server contact before explicit consent');
  $('mailCloudEnabled').checked=false; $('mailConsent').checked=true;
  window.chrome.runtime.sendMessage=async request=>{ requests.push(request); return {status:'error',message:'test OAuth rejection'}; };
  $('connect').click();
  await new Promise(resolve => setTimeout(resolve,20));
  assert.equal(requests.length,before,'connecting never automatically enables Cloud');
  $('mailCloudEnabled').checked=true;
  $('connect').click();
  await new Promise(resolve => setTimeout(resolve,20));
  assert.equal(requests.at(-1).type,'MAIL_YANDEX_CONNECT','main connect button launches official OAuth without email or password');
  assert.equal($('mailCloudEnabled').checked,true);
  assert.equal($('accounts').textContent,'test OAuth rejection');
  $('mailPassword').value='must-clear-on-disable';
  $('mailCloudEnabled').checked=false; $('mailCloudEnabled').dispatchEvent(new window.Event('change'));
  await new Promise(resolve=>setTimeout(resolve,20));
  assert.equal($('provider').hidden,true);
  assert.equal($('mailForm').hidden,true);
  assert.equal($('cloudStorageDetails').hidden,true);
  assert.equal($('mailPassword').value,'');
  dom.window.close();
});
