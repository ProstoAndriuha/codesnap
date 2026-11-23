import { mkdirSync, mkdtempSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { chromium } from 'playwright-core';

const extension = resolve(process.env.EXTENSION_PATH ?? 'dist');
const workspaceWork = resolve('..', '..', 'work');
mkdirSync(workspaceWork, { recursive: true });
const profile = mkdtempSync(join(workspaceWork, 'vc-chrome-'));
const context = await chromium.launchPersistentContext(profile, {
  ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : { channel: process.env.PLAYWRIGHT_CHANNEL ?? 'chromium' }),
  headless: true,
  args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]
});

async function privateControl(page, hostId, text = null) {
  const client = await context.newCDPSession(page);
  try {
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      const { root } = await client.send('DOM.getDocument', { depth: -1, pierce: true });
      const find = (node, predicate) => predicate(node) ? node :
        [...(node.children || []), ...(node.shadowRoots || [])].map(child => find(child, predicate)).find(Boolean);
      const host = find(root, node => node.attributes?.some((attr, index) => index % 2 === 0 && attr === 'id' && node.attributes[index + 1] === hostId));
      const control = host && find(host, node => node.nodeName === 'BUTTON' && (!text || find(node, child => child.nodeValue?.includes(text))));
      if (control) {
        const { model } = await client.send('DOM.getBoxModel', { nodeId: control.nodeId });
        const [left, top, , , right, bottom] = model.border;
        return { click: () => page.mouse.click((left + right) / 2, (top + bottom) / 2) };
      }
      await new Promise(resolve => setTimeout(resolve, 80));
    }
    throw new Error(`Expected private CodeSnap control ${hostId}${text ? ` with text ${text}` : ''}`);
  } finally {
    await client.detach();
  }
}

async function assertToolbarFits(page) {
  for (const width of [300, 366, 396]) {
    await page.setViewportSize({ width, height: 640 });
    const result = await page.locator('.auth-bar').evaluate(bar => {
      const box = bar.getBoundingClientRect();
      const buttons = [...bar.querySelectorAll('button')];
      return {
        count: buttons.length,
        clipped: document.documentElement.scrollWidth > innerWidth || buttons.some(button => {
          const rect = button.getBoundingClientRect();
          return rect.left < box.left || rect.right > box.right || rect.bottom > box.bottom;
        })
      };
    });
    if (result.count !== 9 || result.clipped) throw new Error(`Authenticator toolbar overflow at ${width}px`);
  }
}

try {
  const page = await context.newPage();
  await page.route('https://example.com/', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>CodeSnap smoke</title><body></body>' }));
  await page.goto('https://example.com', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => { document.body.innerHTML = '<label for="email-code">Email verification code</label><input id="email-code" maxlength="6">'; });
  console.log('Chrome diagnostic:', { workers: context.serviceWorkers().map(worker => worker.url()), url: page.url() });
  const extensionId = new URL(context.serviceWorkers()[0].url()).hostname;
  const websiteTabId = await context.serviceWorkers()[0].evaluate(async () => (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0].id);
  if (process.env.EXPECTED_EXTENSION_ID && extensionId !== process.env.EXPECTED_EXTENSION_ID) throw new Error(`Unexpected extension ID: ${extensionId}`);
  await page.locator('#codesnap-inline-chip').waitFor({ state: 'attached' });
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
  await page.locator('#codesnap-inline-chip').waitFor({ state: 'detached', timeout: 5000 });
  await page.evaluate(() => { document.body.innerHTML = '<div class="content-top"><h2>Email verification</h2><p>Check your email for a code</p><div class="verify-code-form"><div class="cells">' + '<input type="tel">'.repeat(6) + '</div></div></div>'; });
  await page.locator('#codesnap-inline-chip').waitFor({ state: 'attached' });
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
  await page.locator('#codesnap-inline-chip').waitFor({ state: 'attached' });
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
  await (await privateControl(page, 'codesnap-inline-chip', 'Review')).click();
  const exposed = await page.evaluate(() => ['codesnap-inline-chip', 'codesnap-inline-panel'].some(id => {
    const host = document.getElementById(id);
    return !host || host.shadowRoot !== null || host.textContent.length > 0;
  }));
  if (exposed) throw new Error('Inline CodeSnap content is visible through the page DOM');
  await (await privateControl(page, 'codesnap-inline-panel', '483921')).click();
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
  await (await privateControl(bitbase, 'codesnap-inline-chip', '360069')).click();
  await bitbase.waitForFunction(() => document.querySelector('#email')?.value === '360069', null, { timeout: 5000 });
  if (await bitbase.locator('#auth').inputValue()) throw new Error('Email code was inserted into the authenticator field');

  // Exercise real extension messaging and mail parsing with isolated fixture tabs.
  const paths = [
    { provider: 'gmail', url: 'https://mail.google.com/mail/u/0/', code: '478201' },
    { provider: 'yandex', url: 'https://mail.yandex.ru/', code: '581496' }
  ];
  await context.serviceWorkers()[0].evaluate(async () => {
    chrome.identity.getAuthToken = async () => { throw new Error('No Gmail API account for this test'); };
    await chrome.storage.local.set({ enabledMailProviders: ['gmail', 'yandex'], securitySmokeMarker: 'fixture-only' });
  });
  for (const { provider, url, code } of paths) {
    const mailbox = await context.newPage();
    const stamp = new Date().toISOString();
    const body = provider === 'gmail'
      ? `<h2 class="hP">Example verification code</h2><span class="gD" email="codes@example.com"></span><time class="g3" datetime="${stamp}"></time><div class="a3s">Your Example verification code is ${code}.</div>`
      : `<div class="mail-MessageSnippet is-unread"><span class="mail-MessageSnippet-FromText">codes@example.com</span><span class="mail-MessageSnippet-Item_subject">Example verification code</span><span class="mail-MessageSnippet-Item_firstline">Your Example verification code is ${code}.</span><time class="mail-MessageSnippet-Item_date" datetime="${stamp}"></time></div>`;
    await mailbox.route(url, route => route.fulfill({ contentType: 'text/html', body }));
    await mailbox.goto(url);
    await context.serviceWorkers()[0].evaluate(async provider => {
      await chrome.storage.local.set({ accountSelections: { 'https://example.com': `local:pin:${provider}` } });
    }, provider);
    await page.bringToFront();
    await page.evaluate(() => { document.body.innerHTML = '<label>Email verification code<input id="mail-fixture" maxlength="6"></label>'; });
    await (await privateControl(page, 'codesnap-inline-chip', code)).click();
    await page.waitForFunction(expected => document.getElementById('mail-fixture').value === expected, code);
    await mailbox.close();
  }
  const accessClient = await context.newCDPSession(page);
  const worlds = [];
  accessClient.on('Runtime.executionContextCreated', ({ context: world }) => worlds.push(world));
  await accessClient.send('Runtime.enable');
  let checkedStorage = false;
  for (const world of worlds.filter(world => world.auxData?.type === 'isolated')) {
    const { result } = await accessClient.send('Runtime.evaluate', {
      contextId: world.id, awaitPromise: true, returnByValue: true,
      expression: `(async () => { if (globalThis.chrome?.runtime?.id !== ${JSON.stringify(extensionId)}) return null;
        try { return (await chrome.storage.local.get('securitySmokeMarker')).securitySmokeMarker; }
        catch { return 'denied'; } })()`
    });
    if (result.value === null) continue;
    if (result.value !== 'denied') throw new Error('Content script has direct access to protected storage');
    checkedStorage = true;
  }
  await accessClient.detach();
  if (!checkedStorage) throw new Error('CodeSnap content context was missing from the storage test');

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

  await qrPopup.locator('#modeAuthBtn').click();
  await qrPopup.locator('#authModeView .auth-tile.current-site').waitFor({ timeout: 5000 });
  const authIssuer = await qrPopup.locator('#authModeView .auth-tile.current-site .auth-tile-issuer').textContent();
  const authCode = await qrPopup.locator('#authModeView .auth-tile.current-site .auth-tile-code').textContent();
  const authPieVisible = await qrPopup.locator('#authModeView .auth-tile.current-site svg.auth-pie').isVisible();
  if (!/2FAS/.test(authIssuer || '')) throw new Error(`Authenticator tile issuer did not include 2FAS: ${authIssuer}`);
  if (!/^\d{3}\s\d{3}$/.test((authCode || '').trim())) throw new Error(`Unexpected Authenticator code format: ${authCode}`);
  if (!authPieVisible) throw new Error('Expected Authenticator SVG pie countdown timer to be visible');
  await assertToolbarFits(qrPopup);

  await qrPopup.locator('#authModeView .auth-search').fill('no-such-account-xyz');
  await qrPopup.locator('#authModeView .auth-empty').waitFor({ timeout: 5000 });
  await qrPopup.locator('#authModeView .auth-search').fill('');
  await qrPopup.locator('#authModeView .auth-tile').waitFor({ timeout: 5000 });

  const authWin = await context.newPage();
  await authWin.goto(`chrome-extension://${extensionId}/src/authenticator.html?origin=${encodeURIComponent('https://2fas.com')}`);
  await authWin.locator('#standaloneAuthRoot .auth-tile.current-site').waitFor({ timeout: 5000 });
  const winPieVisible = await authWin.locator('#standaloneAuthRoot .auth-tile.current-site svg.auth-pie').isVisible();
  if (!winPieVisible) throw new Error('Expected standalone Authenticator window SVG pie timer to be visible');
  await assertToolbarFits(authWin);
  if (process.env.AUTH_SCREENSHOT) await authWin.screenshot({ path: process.env.AUTH_SCREENSHOT });
  if (process.env.STORE_SCREENSHOT) {
    await authWin.setViewportSize({ width: 640, height: 400 });
    await authWin.screenshot({ path: process.env.STORE_SCREENSHOT });
  }

  console.log('Chrome smoke passed: email insertion, Gmail and Yandex fixture tabs, protected storage, private inline UI, SVG QR scan, and Authenticator popup/pop-out at 300–396px.');
} finally { await context.close(); }
