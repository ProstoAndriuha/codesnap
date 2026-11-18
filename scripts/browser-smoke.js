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
  await popup.locator('#result').getByText(/Code inserted\. Finish on the website\.|Код вставлен\. Завершите действие на сайте\./).waitFor();
  await popup.evaluate(() => {
    chrome.tabs.sendMessage = async () => ({ detected: false, channel: null });
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async value => { window.__copiedCode = value; } } });
  });
  await popup.locator('#search').click();
  await popup.locator('.code-button').click();
  await popup.locator('#result').getByText(/Code copied\. Paste it into the website\.|Код скопирован\. Вставьте его в поле на сайте\./).waitFor();
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

  // Verify live SVG QR 2FA scanning inside real Chromium without native BarcodeDetector
  const qrPage = await context.newPage();
  const qrRows = (
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
  let svgRects = '';
  qrRows.forEach((row, r) => {
    for (let c = 0; c < row.length; c++) if (row[c] === '1') svgRects += `<rect x="${c}" y="${r}" width="1" height="1"/>`;
  });
  await qrPage.route('https://2fas.com/setup', route => route.fulfill({
    contentType: 'text/html',
    body: `<h1>2FAS Setup</h1><svg viewBox="0 0 37 37" width="185" height="185" fill="#000">${svgRects}</svg>`
  }));
  await qrPage.goto('https://2fas.com/setup', { waitUntil: 'domcontentloaded' });
  const qrTab = await context.serviceWorkers()[0].evaluate(async () => {
    const [active] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    return { id: active.id, windowId: active.windowId };
  });
  const qrPopup = await context.newPage();
  await qrPopup.addInitScript(t => { chrome.tabs.query = async () => [t]; }, { id: qrTab.id, url: 'https://2fas.com/setup', windowId: qrTab.windowId });
  await qrPopup.goto(`chrome-extension://${extensionId}/src/popup.html`);
  await qrPopup.locator('#totpToggleAdd').click();
  await qrPopup.locator('#totpScanBtn').click();
  await qrPopup.locator('.totp-digits-text').waitFor({ timeout: 5000 });
  const totpAddedText = await qrPopup.locator('#totpStatus').textContent();
  if (!/2FAS/.test(totpAddedText || '')) throw new Error(`SVG QR 2FA scan did not report 2FAS success: ${totpAddedText}`);

  console.log('Chrome smoke: Bitbase-style email found through recent-mail fallback and inserted only into its email field; hidden-tab-URL insertion, SVG QR 2FA scanning and popup actions all worked.');
} finally { await context.close(); }
