import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const fieldsSource = readFileSync(new URL('../src/fields.js', import.meta.url), 'utf8');
const contentSource = readFileSync(new URL('../src/content.js', import.meta.url), 'utf8');

function setup(html, url = 'https://app.example.test/security', title = 'Security') {
  const dom = new JSDOM(`<!doctype html><title>${title}</title><body>${html}</body>`, { url, runScripts: 'outside-only' });
  dom.window.eval(fieldsSource);
  return dom;
}

test('logged-in user email header on a Google Authenticator 2FA screen never causes email false positive', async () => {
  const dom = setup(`
    <header>Signed in as alice@gmail.com</header>
    <div role="dialog">
      <h2>Two-Factor Authentication</h2>
      <p>Enter the 6-digit code from Google Authenticator for alice@gmail.com</p>
      <input id="totp" maxlength="6" inputmode="numeric">
    </div>
  `);
  const field = dom.window.VerificationFields.detect(dom.window.document);
  assert.equal(field?.channel, 'authenticator');
  assert.equal(field?.subchannel, 'totp');
  assert.equal(field?.providerHint, 'google-authenticator');
  assert.equal(field?.confidence, 'high');

  let searches = 0;
  dom.window.chrome = {
    runtime: { onMessage: { addListener() {} }, sendMessage: async () => { searches++; return { status: 'found', code: '123456' }; } },
    storage: { local: { get: async () => ({ autoWatch: true }) }, onChanged: { addListener() {} } }
  };
  dom.window.eval(contentSource);
  await new Promise(resolve => setTimeout(resolve, 40));
  assert.equal(searches, 0);
  assert.equal(dom.window.document.querySelector('button[aria-label="Find verification code"]'), null);
  dom.window.close();
});

test('GitHub-style TOTP heading outside <form> and snake_case app_totp id classify as authenticator and skip email search', async () => {
  const dom = setup(`
    <main>
      <h1>Two-factor authentication</h1>
      <p>Open your two-factor authentication (TOTP) app or browser extension to view your authentication code.</p>
      <form>
        <label for="app_totp">Authentication code</label>
        <input id="app_totp" name="app_otp" maxlength="6" autocomplete="one-time-code" inputmode="numeric">
        <button type="submit">Verify</button>
      </form>
    </main>
  `, 'https://github.com/sessions/two-factor');
  const field = dom.window.VerificationFields.detect(dom.window.document);
  assert.equal(field?.channel, 'authenticator');
  assert.equal(field?.subchannel, 'totp');

  let searches = 0;
  dom.window.chrome = {
    runtime: { onMessage: { addListener() {} }, sendMessage: async () => { searches++; return { status: 'found', code: '123456' }; } },
    storage: { local: { get: async () => ({ autoWatch: true }) }, onChanged: { addListener() {} } }
  };
  dom.window.eval(contentSource);
  await new Promise(resolve => setTimeout(resolve, 40));
  assert.equal(searches, 0);
  assert.equal(dom.window.document.querySelector('button[aria-label="Find verification code"]'), null);
  dom.window.close();
});

test('camelCase and snake_case 2FA attributes (ga_code, googleAuthCode, totpCode, mfa_code, twoFactorCode) classify as authenticator', () => {
  for (const attrs of [
    'name="ga_code" maxlength="6"',
    'id="googleAuthCode" maxlength="6"',
    'name="totpCode" maxlength="6"',
    'name="mfa_code" maxlength="6"',
    'name="twoFactorCode" maxlength="6"'
  ]) {
    const dom = setup(`<label>Verification code</label><input ${attrs}>`);
    const field = dom.window.VerificationFields.detect(dom.window.document);
    assert.equal(field?.channel, 'authenticator', attrs);
    dom.window.close();
  }
});

test('6-cell 2FA group with "Send verification code to email instead" button stays authenticator and never triggers email search', async () => {
  const dom = setup(`
    <div role="dialog">
      <h2>Authenticator App</h2>
      <p>Enter the 6-digit code from 1Password or Authy</p>
      <div class="otp-row">${'<input maxlength="1" inputmode="numeric">'.repeat(6)}</div>
      <button type="button">Send verification code to email instead</button>
    </div>
  `);
  const field = dom.window.VerificationFields.detect(dom.window.document);
  assert.equal(field?.type, 'group');
  assert.equal(field?.channel, 'authenticator');
  assert.equal(field?.confidence, 'high');

  let searches = 0;
  dom.window.chrome = {
    runtime: { onMessage: { addListener() {} }, sendMessage: async () => { searches++; return { status: 'found', code: '123456' }; } },
    storage: { local: { get: async () => ({ autoWatch: true }) }, onChanged: { addListener() {} } }
  };
  dom.window.eval(contentSource);
  await new Promise(resolve => setTimeout(resolve, 40));
  assert.equal(searches, 0);
  assert.equal(dom.window.document.querySelector('button[aria-label="Find verification code"]'), null);
  dom.window.close();
});

test('2FA via Email heading with actual email delivery cue correctly classifies as email', () => {
  const dom = setup(`
    <div class="card">
      <h2>Two-Factor Authentication</h2>
      <p>We sent a 6-digit verification code to your email a***@gmail.com</p>
      <input id="email-2fa" maxlength="6" inputmode="numeric">
      <button type="button">Resend</button>
    </div>
  `);
  const field = dom.window.VerificationFields.detect(dom.window.document);
  assert.equal(field?.channel, 'email');
  assert.equal(field?.subchannel, 'email_otp');
  dom.window.close();
});

test('dual 6-cell Email + 6-cell Authenticator withdrawal modal isolates both channels and hides chip when email cells are removed', async () => {
  const dom = setup(`
    <div role="dialog">
      <h2>Security Verification</h2>
      <div class="section">
        <p>Email verification code (sent to u***@gmail.com)</p>
        <div id="email-cells">${'<input maxlength="1" inputmode="numeric">'.repeat(6)}</div>
      </div>
      <div class="section">
        <p>Google Authenticator 2FA code</p>
        <div id="totp-cells">${'<input maxlength="1" inputmode="numeric">'.repeat(6)}</div>
      </div>
    </div>
  `);
  const primary = dom.window.VerificationFields.detect(dom.window.document);
  const twofa = dom.window.VerificationFields.detect2FA(dom.window.document);
  const all = dom.window.VerificationFields.detectAll(dom.window.document);

  assert.equal(primary?.channel, 'email');
  assert.equal(primary?.inputs[0].closest('#email-cells')?.id, 'email-cells');
  assert.equal(twofa?.channel, 'authenticator');
  assert.equal(twofa?.inputs[0].closest('#totp-cells')?.id, 'totp-cells');
  assert.equal(all.length, 2);
  assert.deepEqual([...all.map(item => item.channel)], ['email', 'authenticator']);

  dom.window.document.getElementById('email-cells').remove();
  assert.equal(dom.window.VerificationFields.detect(dom.window.document)?.channel, 'authenticator');
  dom.window.close();
});

test('QR setup 2FA modal, recovery code field, and /totp URL tie-breaker classify as authenticator', () => {
  const qr = setup(`
    <div role="dialog">
      <h2>Enable Two-Factor Authentication</h2>
      <p>Scan this QR code with your authenticator app, then enter the 6-digit code below:</p>
      <input maxlength="6" inputmode="numeric">
    </div>
  `);
  assert.equal(qr.window.VerificationFields.detect(qr.window.document)?.channel, 'authenticator');
  qr.window.close();

  const rec = setup(`<label for="rc">Backup recovery code</label><input id="rc" maxlength="8">`);
  const recField = rec.window.VerificationFields.detect(rec.window.document);
  assert.equal(recField?.channel, 'authenticator');
  assert.equal(recField?.subchannel, 'recovery');
  rec.window.close();

  const byUrl = setup(`<label>Verification code</label><input maxlength="6">`, 'https://app.example.test/auth/totp', 'Sign in');
  assert.equal(byUrl.window.VerificationFields.detect(byUrl.window.document)?.channel, 'authenticator');
  byUrl.window.close();
});

test('split 3+3 OTP group, ARIA Digit 1 of 6 cells, placeholder mask, and INN/CVV negative exclusions work cleanly', async () => {
  const split = setup(`
    <div>
      <p>Enter email verification code</p>
      <div class="split">
        <div class="half">${'<input maxlength="1" inputmode="numeric">'.repeat(3)}</div>
        <span>-</span>
        <div class="half">${'<input maxlength="1" inputmode="numeric">'.repeat(3)}</div>
      </div>
    </div>
  `);
  const splitField = split.window.VerificationFields.detect(split.window.document);
  assert.equal(splitField?.type, 'group');
  assert.equal(splitField?.expectedLength, 6);
  assert.equal(splitField?.channel, 'email');
  assert.equal(await split.window.VerificationFields.insert(splitField, '918273'), true);
  assert.equal([...split.window.document.querySelectorAll('input')].map(i => i.value).join(''), '918273');
  split.window.close();

  const ariaCells = setup(`
    <div>
      <p>Email verification code</p>
      <div>
        <input aria-label="Digit 1 of 6">
        <input aria-label="Digit 2 of 6">
        <input aria-label="Digit 3 of 6">
        <input aria-label="Digit 4 of 6">
        <input aria-label="Digit 5 of 6">
        <input aria-label="Digit 6 of 6">
      </div>
    </div>
  `);
  const ariaField = ariaCells.window.VerificationFields.detect(ariaCells.window.document);
  assert.equal(ariaField?.type, 'group');
  assert.equal(ariaField?.inputs.length, 6);
  ariaCells.window.close();

  const masked = setup(`<label>Security code</label><input placeholder="000000">`);
  assert.equal(masked.window.VerificationFields.detect(masked.window.document)?.type, 'single');
  masked.window.close();

  for (const excluded of [
    '<label>Code</label><input name="iban" maxlength="8">',
    '<label>Verification code</label><input name="inn" maxlength="8">',
    '<label>Code</label><input name="card_security_code" maxlength="4">'
  ]) {
    const neg = setup(excluded);
    assert.equal(neg.window.VerificationFields.detect(neg.window.document), null, excluded);
    neg.window.close();
  }
});

test('future 2FA readiness: allow2fa and detect2FA support targeting and inserting into 2FA fields when enabled', async () => {
  const dom = setup(`
    <div role="dialog">
      <label for="auth">Microsoft Authenticator code</label>
      <input id="auth" maxlength="6" inputmode="numeric">
    </div>
  `);
  const twofa = dom.window.VerificationFields.detect2FA(dom.window.document);
  assert.equal(twofa?.channel, 'authenticator');
  assert.equal(twofa?.providerHint, 'microsoft-authenticator');
  assert.equal(await dom.window.VerificationFields.insert(twofa, '654321'), true);
  assert.equal(dom.window.document.getElementById('auth').value, '654321');
  const viaOption = dom.window.VerificationFields.detect(dom.window.document, { allow2fa: true });
  assert.equal(viaOption?.channel, 'authenticator');
  dom.window.close();
});
