import { mkdirSync, mkdtempSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { chromium } from 'playwright-core';

const extension = resolve(process.env.EXTENSION_PATH ?? 'dist');
const workspaceWork = resolve('..', '..', 'work');
mkdirSync(workspaceWork, { recursive: true });
const profile = mkdtempSync(join(workspaceWork, 'vc-chrome-'));
const context = await chromium.launchPersistentContext(profile, {
  channel: process.env.PLAYWRIGHT_CHANNEL ?? 'chromium', headless: true,
  args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]
});
try {
  const page = await context.newPage();
  await page.goto('https://example.com', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => { document.body.innerHTML = '<label for="email-code">Email verification code</label><input id="email-code" maxlength="6">'; });
  console.log('Chrome diagnostic:', { workers: context.serviceWorkers().map(worker => worker.url()), url: page.url() });
  const extensionId = new URL(context.serviceWorkers()[0].url()).hostname;
  const websiteTabId = await context.serviceWorkers()[0].evaluate(async () => (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0].id);
  if (process.env.EXPECTED_EXTENSION_ID && extensionId !== process.env.EXPECTED_EXTENSION_ID) throw new Error(`Unexpected extension ID: ${extensionId}`);
  await page.locator('button[aria-label="Find verification code"]').waitFor({ timeout: 5000 });
  const status = await context.serviceWorkers()[0].evaluate(async () => {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    return chrome.tabs.sendMessage(tab.id, { type: 'FIELD_STATUS' });
  });
  if (!status?.detected || status.channel !== 'email') throw new Error('Email field was not classified correctly');
  const inserted = await context.serviceWorkers()[0].evaluate(async ({ fieldId }) => {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    return chrome.tabs.sendMessage(tab.id, { type: 'INSERT_CODE', code: '483921', origin: 'https://example.com', fieldId });
  }, { fieldId: status.fieldId });
  if (inserted.status !== 'inserted' || await page.locator('#email-code').inputValue() !== '483921') throw new Error('One-click insertion did not reach the email field');
  await page.evaluate(() => { document.body.innerHTML = '<label for="app-code">Google Authenticator 2FA code</label><input id="app-code" maxlength="6">'; });
  await page.locator('button[aria-label="Find verification code"]').waitFor({ state: 'detached', timeout: 5000 });
  await page.evaluate(() => { document.body.innerHTML = '<div class="content-top"><h2>Email verification</h2><p>Check your email for a code</p><div class="verify-code-form"><div class="cells">' + '<input type="tel">'.repeat(6) + '</div></div></div>'; });
  await page.locator('button[aria-label="Find verification code"]').waitFor({ timeout: 5000 });
  const groupStatus = await context.serviceWorkers()[0].evaluate(async () => {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    return chrome.tabs.sendMessage(tab.id, { type: 'FIELD_STATUS' });
  });
  if (groupStatus.type !== 'group' || groupStatus.channel !== 'email') throw new Error('Generic six-cell group was not detected as email verification');
  const groupInserted = await context.serviceWorkers()[0].evaluate(async ({ fieldId }) => {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    return chrome.tabs.sendMessage(tab.id, { type: 'INSERT_CODE', code: '483921', origin: 'https://example.com', fieldId });
  }, { fieldId: groupStatus.fieldId });
  const digits = await page.locator('.cells input').evaluateAll(inputs => inputs.map(input => input.value).join(''));
  if (groupInserted.status !== 'inserted' || digits !== '483921') throw new Error('Generic six-cell group insertion failed');
  await page.evaluate(() => {
    const inputs = [...document.querySelectorAll('.cells input')];
    const state = Array(6).fill('');
    let activeIndex = 0;
    inputs.forEach((input, index) => {
      input.value = '';
      input.addEventListener('focus', () => { activeIndex = index; });
      input.addEventListener('input', () => {
        state[activeIndex] = input.value;
        inputs.forEach((cell, position) => { cell.value = state[position]; });
        inputs[Math.min(activeIndex + 1, 5)].focus();
      });
    });
    inputs[4].focus();
    window.__otpState = state;
  });
  const focusedInsert = await context.serviceWorkers()[0].evaluate(async ({ fieldId }) => {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    return chrome.tabs.sendMessage(tab.id, { type: 'INSERT_CODE', code: '310683', origin: 'https://example.com', fieldId });
  }, { fieldId: groupStatus.fieldId });
  if (focusedInsert.status !== 'inserted' || await page.evaluate(() => window.__otpState.join('')) !== '310683') throw new Error('Focus-indexed OTP state lost or shifted digits');
  await page.evaluate(() => { document.body.innerHTML = '<div id="widget"></div>'; document.querySelector('#widget').attachShadow({ mode: 'open' }).innerHTML = '<label for="code">Email verification code</label><input id="code" maxlength="6">'; });
  const shadowChip = page.locator('button[aria-label="Find verification code"]');
  await shadowChip.waitFor({ timeout: 5000 });
  const shadowStatus = await context.serviceWorkers()[0].evaluate(async () => { const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true }); return chrome.tabs.sendMessage(tab.id, { type: 'FIELD_STATUS' }); });
  if (!shadowStatus.detected || shadowStatus.channel !== 'email') throw new Error('Open shadow-root field not detected');
  await context.serviceWorkers()[0].evaluate(() => {
    const realGet = chrome.tabs.get.bind(chrome.tabs);
    chrome.tabs.get = async tabId => ({ ...(await realGet(tabId)), url: undefined });
    chrome.identity.getAuthToken = async () => ({ token: 'smoke-token' });
    globalThis.fetch = async url => {
      const path = new URL(url).pathname;
      const body = 'Example login. Your verification code is 483921. This code expires in 10 minutes.';
      const json = path.endsWith('/messages') ? { messages: [{ id: 'provider-code' }] } : {
        id: 'provider-code', internalDate: String(Date.now()),
        payload: { mimeType: 'text/plain', headers: [{ name: 'From', value: 'codes@mailer.test' }, { name: 'Subject', value: 'Login' }], body: { data: btoa(body) } }
      };
      return { ok: true, status: 200, json: async () => json };
    };
  });
  await context.serviceWorkers()[0].evaluate(async () => chrome.storage.local.set({ primaryEmail: 'test@gmail.com' }));
  await page.evaluate(() => { document.body.innerHTML = '<label for="provider-code">Email verification code</label><input id="provider-code" maxlength="6">'; });
  await page.locator('button[aria-label="Find verification code"]').getByText('Review').waitFor({ timeout: 10000 });
  await page.locator('button[aria-label="Find verification code"]').click();
  await page.locator('#codesnap-inline-panel').getByText('codes@mailer.test').waitFor();
  await page.locator('#codesnap-inline-panel').getByText('483921').click();
  await page.waitForFunction(() => document.querySelector('#provider-code')?.value === '483921', null, { timeout: 5000 }).catch(async () => {
    throw new Error(`Inline provider code did not insert with a hidden tab URL: ${await page.locator('#codesnap-inline-panel').textContent().catch(() => 'panel closed')}`);
  });
  const popup = await context.newPage();
  await popup.addInitScript(tab => { chrome.tabs.query = async () => [tab]; }, { id: websiteTabId, url: page.url() });
  await popup.addInitScript(() => {
    const realSend = chrome.runtime.sendMessage.bind(chrome.runtime);
    chrome.runtime.sendMessage = async request => {
      if (request.type === 'SEARCH_POPUP') return { status: 'found', code: '483921', timestamp: Date.now(), sessionId: 'ui-test', accountEmail: 'test@gmail.com' };
      if (request.type === 'INSERT_POPUP') return { status: 'inserted' };
      return realSend(request);
    };
  });
  await popup.goto(`chrome-extension://${extensionId}/src/popup.html`);
  await popup.locator('.brand').getByText('CodeSnap').waitFor();
  await popup.locator('.pro-card').getByText('CodeSnap').waitFor();
  await popup.waitForFunction(() => document.querySelector('#autoWatch')?.checked, null, { timeout: 3000 }).catch(async () => { throw new Error(`Automatic field codes should be enabled by default: ${await popup.locator('#result').textContent()}`); });
  if (await popup.locator('#sender').count() || await popup.locator('#copy').count() || await popup.locator('#insert').count()) throw new Error('Removed legacy controls are still visible');
  await popup.locator('.code-button').getByText('483921').waitFor();
  if (await popup.locator('#search').isVisible()) throw new Error('Manual search button should not be required when a code exists');
  if (process.env.POPUP_SCREENSHOT) await popup.locator('body').screenshot({ path: process.env.POPUP_SCREENSHOT });
  await popup.locator('.code-button').click();
  await popup.locator('#result').getByText('Code inserted. Finish on the website.').waitFor();
  await popup.evaluate(() => {
    chrome.tabs.sendMessage = async () => ({ detected: false, channel: null });
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async value => { window.__copiedCode = value; } } });
  });
  await popup.locator('#search').click();
  await popup.locator('.code-button').click();
  await popup.locator('#result').getByText('Code copied. Paste it into the website.').waitFor();
  if (await popup.evaluate(() => window.__copiedCode) !== '483921') throw new Error('Clicking the code without a field did not copy it');
  await context.serviceWorkers()[0].evaluate(() => {
    globalThis.fetch = async url => {
      const parsed = new URL(url);
      const listing = parsed.pathname.endsWith('/messages');
      const broad = !parsed.searchParams.get('q')?.includes('{');
      const body = 'Dear Bitbase user: Your email verification code for login is 360069. Verification code is valid for 5 minutes.';
      return { ok: true, status: 200, json: async () => listing ? { messages: broad ? [{ id: 'bitbase-login' }] : [] } : {
        id: 'bitbase-login', internalDate: String(Date.now()),
        payload: { mimeType: 'text/plain', headers: [{ name: 'From', value: 'Bitbase <no-reply@mail.bitbase.com>' }, { name: 'Subject', value: 'Login' }], body: { data: btoa(body) } }
      } };
    };
  });
  const bitbase = await context.newPage();
  await bitbase.route('https://www.bitbase.com/verify', route => route.fulfill({ contentType: 'text/html', body: '<h1>Security Verification</h1><label for="auth">Google Authenticator code</label><input id="auth" placeholder="Enter Google Authenticator code"><label for="email">Email verification code</label><input id="email" placeholder="Enter email verification code">' }));
  await bitbase.goto('https://www.bitbase.com/verify');
  await bitbase.locator('button[aria-label="Find verification code"]').getByText('360069').waitFor({ timeout: 10000 });
  await bitbase.locator('button[aria-label="Find verification code"]').click();
  await bitbase.waitForFunction(() => document.querySelector('#email')?.value === '360069', null, { timeout: 5000 });
  if (await bitbase.locator('#auth').inputValue()) throw new Error('Email code was inserted into the authenticator field');
  console.log('Chrome smoke: Bitbase-style email found through recent-mail fallback and inserted only into its email field; hidden-tab-URL insertion and popup actions also worked.');
} finally { await context.close(); }
