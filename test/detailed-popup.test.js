import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
const fields = readFileSync(new URL('../src/fields.js', import.meta.url), 'utf8');
const content = readFileSync(new URL('../src/content.js', import.meta.url), 'utf8');
const wait = () => new Promise(resolve => setTimeout(resolve, 65));
async function setup(detailedPopup, result) {
  const dom = new JSDOM('<label>Email verification code<input maxlength="6"></label>', { url: 'https://new-provider.test/verify', runScripts: 'outside-only' });
  const { window } = dom;
  let messageListener, settingsListener;
  const calls = [];
  window.crypto.randomUUID = () => 'field';
  window.chrome = {
    storage: { local: { get: async () => ({ autoWatch: true, detailedPopup }) }, onChanged: { addListener(fn) { settingsListener = fn; } } },
    runtime: { onMessage: { addListener(fn) { messageListener = fn; } }, sendMessage: async request => {
      calls.push(request);
      if (request.type === 'SEARCH_INLINE') return result;
      if (request.type === 'SELECT_INLINE_CANDIDATE') return { ...result.candidates[request.index], status: 'found', sessionId: result.sessionId, index: undefined };
      if (request.type === 'INSERT_INLINE') return await new Promise(resolve => messageListener({ type: 'INSERT_CODE', code: result.code ?? result.candidates[1].code, fieldId: 'field', origin: window.location.origin }, null, resolve));
    } }
  };
  window.eval(fields);
  // Only the test harness removes the browser trusted-click restriction.
  window.eval(content.replaceAll('if (!event.isTrusted) return;', '').replaceAll('if (event.isTrusted) void insertDetailed', 'void insertDetailed'));
  await wait();
  return { dom, calls, settingsListener, messageListener, panel: () => window.document.querySelector('#codesnap-inline-panel')?.shadowRoot };
}
const found = () => ({ status: 'found', code: '657931', from: 'codes@example.com', accountEmail: 'owner@gmail.com', timestamp: Date.now(), sessionId: 'session', lifetimeSeconds: 180 });

test('detailed popup is opt-in and setting changes update the open page', async () => {
  const app = await setup(false, found());
  assert.equal(app.panel(), undefined);
  app.settingsListener({ detailedPopup: { newValue: true } }, 'local');
  assert.match(app.panel().textContent, /657 931/);
  assert.match(app.panel().textContent, /codes@example.com.*Gmail/);
  assert.match(app.panel().textContent, /owner@gmail.com/);
  app.settingsListener({ detailedPopup: { newValue: false } }, 'local');
  assert.equal(app.panel(), undefined);
  app.dom.window.close();
});

test('detailed Fill inserts actual values through the existing field-bound session', async () => {
  const app = await setup(true, found());
  assert.equal(app.calls.filter(call => call.type === 'INSERT_INLINE').length, 0);
  app.panel().querySelector('.fill').click();
  await wait();
  assert.equal(app.dom.window.document.querySelector('input').value, '657931');
  assert.equal(app.panel(), undefined);
  assert.equal(app.dom.window.document.querySelector('[aria-label="Find verification code"]').textContent, '✓');
  app.dom.window.close();
});

test('ambiguous email rows require explicit selection, preserve metadata and insert chosen code', async () => {
  const app = await setup(true, { status: 'ambiguous', sessionId: 'choice-session', candidates: [
    { code: '657931', from: 'codes@example.com', timestamp: Date.now(), accountEmail: 'first@gmail.com', index: 0 },
    { code: '275521', from: 'codes@example.com', timestamp: Date.now() - 60000, accountEmail: 'second@gmail.com', index: 1 }
  ] });
  assert.equal(app.panel().querySelectorAll('.code-row').length, 2);
  app.panel().querySelectorAll('.fill')[1].click();
  await wait();
  assert.equal(app.calls.find(call => call.type === 'SELECT_INLINE_CANDIDATE').index, 1);
  assert.equal(app.dom.window.document.querySelector('input').value, '275521');
  app.dom.window.close();
});

test('untrusted email metadata is text and expired codes cannot be filled', async () => {
  const app = await setup(true, { ...found(), from: '<img src=x onerror=alert(1)>', timestamp: Date.now() - 240000, requiresReview: true });
  assert.equal(app.panel().querySelector('img'), null);
  assert.equal(app.panel().querySelector('.fill').disabled, true);
  assert.equal(app.calls.filter(call => call.type === 'INSERT_INLINE').length, 0);
  app.dom.window.close();
});

test('changing field invalidates detailed popup instead of inserting into a new target', async () => {
  const app = await setup(true, found());
  app.dom.window.document.querySelector('input').remove();
  await new Promise(resolve => app.messageListener({ type: 'FIELD_STATUS' }, null, resolve));
  assert.equal(app.panel(), undefined);
  assert.equal(app.calls.filter(call => call.type === 'INSERT_INLINE').length, 0);
  app.dom.window.close();
});
