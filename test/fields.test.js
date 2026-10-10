import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const fieldsSource = readFileSync(new URL('../src/fields.js', import.meta.url), 'utf8');
const contentSource = readFileSync(new URL('../src/content.js', import.meta.url), 'utf8');

function page(html = '') {
  const dom = new JSDOM(`<!doctype html><title>Example</title><body>${html}</body>`, { url: 'https://unknown-example.test/login', runScripts: 'outside-only' });
  dom.window.eval(fieldsSource);
  return dom;
}

test('generic detector recognizes a single input in three languages and ignores ordinary numbers', async () => {
  for (const label of ['Enter verification code', 'Введите код подтверждения', 'Introduceți cod de verificare']) {
    const dom = page(`<label>${label}</label><div><input type="text" maxlength="6" inputmode="numeric"></div>`);
    assert.equal(dom.window.VerificationFields.detect(dom.window.document)?.type, 'single', label);
    dom.window.close();
  }
  const dom = page('<input type="number" name="quantity" min="1" max="100">');
  assert.equal(dom.window.VerificationFields.detect(dom.window.document), null);
  dom.window.close();
});

test('email and authenticator fields are distinct; email takes precedence', async () => {
  const dom = page('<label for="mail">Email verification code</label><input id="mail" maxlength="6"><label for="totp">Google Authenticator 2FA code</label><input id="totp" maxlength="6">');
  const field = dom.window.VerificationFields.detect(dom.window.document);
  assert.equal(field?.channel, 'email');
  assert.equal(field.inputs[0].id, 'mail');
  dom.window.document.getElementById('mail').remove();
  assert.equal(dom.window.VerificationFields.detect(dom.window.document)?.channel, 'authenticator');
  dom.window.close();
});

test('KAST email-address step does not start an OTP lookup before the code fields exist', async () => {
  const dom = page('<p>Enter your email. If an account exists, a one-time code will be sent.</p><label for="email-input">email</label><input type="text" id="email-input" name="identifier"><button>Send OTP</button>');
  assert.equal(dom.window.VerificationFields.detect(dom.window.document), null);
  let searches = 0;
  dom.window.crypto.randomUUID = () => 'identifier-field';
  dom.window.chrome = {
    runtime: { onMessage: { addListener() {} }, sendMessage: async () => { searches++; return { status: 'none' }; } },
    storage: { local: { get: async () => ({ autoWatch: true }) }, onChanged: { addListener() {} } }
  };
  dom.window.eval(contentSource);
  await new Promise(resolve => setTimeout(resolve, 40));
  assert.equal(searches, 0);
  assert.equal(dom.window.document.querySelector('button[aria-label="Find verification code"]'), null);
  dom.window.close();
});

test('BingX Russian email security modal detects its generic number field before focus', async () => {
  const dom = page(`<div><input type="text" placeholder="Введите эл. почту"><input type="password" placeholder="Введите пароль от 8 до 30 символов"></div>
    <div role="dialog"><h2>Проверка безопасности</h2><p>В целях безопасности вашего аккаунта, пожалуйста, пройдите проверку</p>
    <div class="form"><div class="form-input-wrapper form-item form-item-email">
    <div>Верификация по эл. почте (to***w@gmail.com)</div><div class="input-wrapper"><div class="bx-input-dark-wrap form-input small"><div class="ti-outer-wrap"><div class="ti-wrap-left"><input class="tl-input-inner" type="number" size="1" placeholder="Введите"></div><button>Отправить повторно</button></div></div></div>
    <a>Верификация с помощью Google Authenticator</a></div><button>Подтвердить</button></div></div>`);
  const { window } = dom;
  const field = window.VerificationFields.detect(window.document);
  assert.equal(field?.type, 'single');
  assert.equal(field?.channel, 'email');
  assert.equal(field.inputs[0].className, 'tl-input-inner');
  let state = '';
  field.inputs[0].addEventListener('input', e => { state = e.target.value; });
  assert.equal(await window.VerificationFields.insert(field, '483921'), true);
  assert.equal(field.inputs[0].value, '483921');
  assert.equal(state, '483921');
  dom.window.close();
});

test('six-input OTP group fills each digit and emits framework-observable input events', async () => {
  const dom = page('<label>Verification code</label><div id="otp">' + '<input maxlength="1" inputmode="numeric">'.repeat(6) + '</div>');
  const { window } = dom;
  const detected = window.VerificationFields.detect(window.document);
  assert.equal(detected?.type, 'group');
  let events = 0;
  for (const input of detected.inputs) input.addEventListener('input', () => events++);
  assert.equal(await window.VerificationFields.insert(detected, '483921'), true);
  assert.deepEqual(Array.from(detected.inputs, input => input.value), ['4', '8', '3', '9', '2', '1']);
  assert.equal(events, 6);
  dom.window.close();
});

test('focus-indexed OTP state receives all six digits in order', async () => {
  const dom = page('<label>Email verification code</label><div>' + '<input maxlength="1">'.repeat(6) + '</div>');
  const { window } = dom;
  const inputs = [...window.document.querySelectorAll('input')];
  const state = Array(6).fill('');
  let activeIndex = 0;
  inputs.forEach((input, index) => {
    input.addEventListener('focus', () => { activeIndex = index; });
    input.addEventListener('input', () => {
      state[activeIndex] = input.value;
      inputs.forEach((cell, position) => { cell.value = state[position]; });
      inputs[Math.min(activeIndex + 1, 5)].focus();
    });
  });
  inputs[4].focus();
  assert.equal(await window.VerificationFields.insert(window.VerificationFields.detect(window.document), '310683'), true);
  assert.equal(state.join(''), '310683');
  assert.equal(inputs.map(input => input.value).join(''), '310683');
  dom.window.close();
});

test('insertion rejected by controlled state reports failure', async () => {
  const dom = page('<input aria-label="Email verification code" maxlength="6">');
  const input = dom.window.document.querySelector('input');
  input.addEventListener('input', () => { input.value = ''; });
  assert.equal(await dom.window.VerificationFields.insert(dom.window.VerificationFields.detect(dom.window.document), '310683'), false);
  dom.window.close();
});

test('OTP fallback waits for deferred focus state before writing each digit', async () => {
  const dom = page('<p>Enter the 6-digit code via email</p><div>' + '<input type="tel">'.repeat(6) + '</div>');
  const inputs = [...dom.window.document.querySelectorAll('input')];
  const state = Array(6).fill('');
  let active = 5;
  for (const [index, input] of inputs.entries()) {
    input.addEventListener('focus', () => queueMicrotask(() => { active = index; }));
    input.addEventListener('input', () => {
      state[active] = input.value;
      inputs.forEach((cell, position) => { cell.value = state[position]; });
    });
  }
  assert.equal(await dom.window.VerificationFields.insert(dom.window.VerificationFields.detect(dom.window.document), '310683'), true);
  assert.equal(state.join(''), '310683');
  assert.equal(inputs.map(input => input.value).join(''), '310683');
  dom.window.close();
});

test('consumed partial paste reports failure without a second insertion attempt', async () => {
  const dom = page('<p>Email verification code</p><div>' + '<input maxlength="1">'.repeat(6) + '</div>');
  const inputs = [...dom.window.document.querySelectorAll('input')];
  let fallbackEvents = 0;
  inputs.forEach(input => input.addEventListener('input', () => fallbackEvents++));
  inputs[0].addEventListener('paste', event => {
    event.preventDefault();
    const code = event.clipboardData.getData('text/plain');
    inputs.slice(0, 5).forEach((input, index) => { input.value = code[index]; });
  });
  assert.equal(await dom.window.VerificationFields.insert(dom.window.VerificationFields.detect(dom.window.document), '310683'), false);
  assert.equal(inputs[5].value, '');
  assert.equal(fallbackEvents, 0);
  dom.window.close();
});

test('failed insertion does not show a success checkmark in the inline chip', async () => {
  const dom = page('<input aria-label="Email verification code" maxlength="6">');
  let listener;
  dom.window.crypto.randomUUID = () => 'failed-field';
  dom.window.chrome = {
    runtime: { onMessage: { addListener(fn) { listener = fn; } } },
    storage: { local: { get: async () => ({ autoWatch: false }) }, onChanged: { addListener() {} } }
  };
  dom.window.eval(contentSource);
  await new Promise(resolve => setTimeout(resolve, 20));
  dom.window.document.querySelector('input').addEventListener('input', event => { event.target.value = ''; });
  const status = await new Promise(resolve => listener({ type: 'FIELD_STATUS' }, null, resolve));
  const result = await new Promise(resolve => listener({ type: 'INSERT_CODE', origin: dom.window.location.origin, fieldId: status.fieldId, code: '310683' }, null, resolve));
  assert.equal(result.status, 'missing');
  assert.notEqual(dom.window.document.querySelector('button[aria-label="Find verification code"]').textContent, '✓');
  dom.window.close();
});

test('unlabeled six-cell group without maxlength is detected from surrounding verification text', async () => {
  const html = '<div class="content-top"><h2>Email verification</h2><p>Check your email for a code</p><div class="verify-code-form"><div class="cells">' + '<input type="tel">'.repeat(6) + '</div></div></div>';
  const dom = page(html);
  const found = dom.window.VerificationFields.detect(dom.window.document);
  assert.equal(found?.type, 'group');
  assert.equal(found.channel, 'email');
  assert.equal(found.inputs.length, 6);
  assert.equal(await dom.window.VerificationFields.insert(found, '483921'), true);
  assert.deepEqual(Array.from(found.inputs, input => input.value), ['4', '8', '3', '9', '2', '1']);
  dom.window.close();

  const ordinary = page('<div class="cells">' + '<input type="tel">'.repeat(6) + '</div>');
  assert.equal(ordinary.window.VerificationFields.detect(ordinary.window.document), null);
  ordinary.window.close();
});

test('verification input inside an open shadow root is detected and inserted', async () => {
  const dom = page('<div id="widget"></div>');
  const root = dom.window.document.getElementById('widget').attachShadow({ mode: 'open' });
  root.innerHTML = '<label for="code">Email verification code</label><input id="code" maxlength="6">';
  const field = dom.window.VerificationFields.detect(dom.window.document);
  assert.equal(field?.channel, 'email');
  assert.equal(await dom.window.VerificationFields.insert(field, '483921'), true);
  assert.equal(root.querySelector('input').value, '483921');
  dom.window.close();
});

test('controlled-input listeners observe insertion for React/Vue/Angular-style state', async () => {
  const dom = page('<input aria-label="Email verification code" maxlength="6">');
  const input = dom.window.document.querySelector('input');
  const state = { react: '', vue: '', angular: '' };
  input.addEventListener('input', event => { state.react = event.target.value; state.vue = event.target.value; state.angular = event.target.value; });
  const detected = dom.window.VerificationFields.detect(dom.window.document);
  assert.equal(await dom.window.VerificationFields.insert(detected, '847291'), true);
  assert.deepEqual(state, { react: '847291', vue: '847291', angular: '847291' });
  dom.window.close();
});

test('focusable aria-hidden OTP proxy is detected without accepting arbitrary hidden fields', async () => {
  const dom = page('<div class="input-otp"><input aria-hidden="true" tabindex="0" autocomplete="one-time-code" maxlength="6" aria-label="Email verification code"></div><input aria-hidden="true" tabindex="0" name="tracking_code">');
  const found = dom.window.VerificationFields.detect(dom.window.document);
  assert.equal(found?.inputs[0].autocomplete, 'one-time-code');
  assert.equal(await dom.window.VerificationFields.insert(found, '483921'), true);
  assert.equal(found.inputs[0].value, '483921');
  dom.window.close();
});

test('content script detects a field added after initial page load', async () => {
  const dom = page();
  let listener;
  let fieldNumber = 0;
  dom.window.crypto.randomUUID = () => `field-${++fieldNumber}`;
  dom.window.chrome = { runtime: { onMessage: { addListener(fn) { listener = fn; } } }, storage: { local: { get: async () => ({ autoWatch: false }) }, onChanged: { addListener() {} } } };
  dom.window.eval(contentSource);
  const before = await new Promise(resolve => listener({ type: 'FIELD_STATUS' }, null, resolve));
  assert.equal(before.detected, false);
  dom.window.document.body.innerHTML = '<label>Security code</label><div><input maxlength="6" autocomplete="one-time-code"></div>';
  await new Promise(resolve => setTimeout(resolve, 180));
  const after = await new Promise(resolve => listener({ type: 'FIELD_STATUS' }, null, resolve));
  assert.equal(after.detected, true);
  assert.equal(after.fieldId, 'field-1');
  const inserted = await new Promise(resolve => listener({ type: 'INSERT_CODE', origin: 'https://unknown-example.test', fieldId: after.fieldId, code: '483921' }, null, resolve));
  assert.equal(inserted.status, 'inserted');
  assert.equal(dom.window.document.querySelector('input').value, '483921');
  dom.window.document.querySelector('input').replaceWith(dom.window.document.createElement('input'));
  await new Promise(resolve => setTimeout(resolve, 180));
  const stale = await new Promise(resolve => listener({ type: 'INSERT_CODE', origin: 'https://unknown-example.test', fieldId: after.fieldId, code: '847291' }, null, resolve));
  assert.equal(stale.status, 'changed');
  dom.window.close();
});

test('automatic watch shows an email code beside the field and skips authenticator fields', async () => {
  for (const [label, shouldSearch] of [['Email verification code', true], ['Google Authenticator 2FA code', false]]) {
    const dom = page(`<label for="code">${label}</label><input id="code" maxlength="6">`);
    let searches = 0;
    dom.window.crypto.randomUUID = () => 'email-field';
    dom.window.chrome = {
      runtime: { onMessage: { addListener() {} }, sendMessage: async () => { searches++; return { status: 'found', code: '483921', sessionId: 'session' }; } },
      storage: { local: { get: async () => ({ autoWatch: true }) }, onChanged: { addListener() {} } }
    };
    dom.window.eval(contentSource);
    await new Promise(resolve => setTimeout(resolve, 40));
    assert.equal(searches, shouldSearch ? 1 : 0, label);
    assert.equal(dom.window.document.querySelector('button[aria-label="Find verification code"]')?.textContent ?? null, shouldSearch ? '483921' : null);
    dom.window.close();
  }
});

test('automatic watch is enabled when the user has not saved a preference', async () => {
  const dom = page('<label for="code">Email verification code</label><input id="code" maxlength="6">');
  let searches = 0;
  dom.window.crypto.randomUUID = () => 'default-field';
  dom.window.chrome = {
    runtime: { onMessage: { addListener() {} }, sendMessage: async () => { searches++; return { status: 'found', code: '483921', sessionId: 'session' }; } },
    storage: { local: { get: async () => ({}) }, onChanged: { addListener() {} } }
  };
  dom.window.eval(contentSource);
  await new Promise(resolve => setTimeout(resolve, 40));
  assert.equal(searches, 1);
  assert.equal(dom.window.document.querySelector('button[aria-label="Find verification code"]')?.textContent, '483921');
  dom.window.close();
});

test('invalidated extension offers page reload instead of retrying the disconnected context', async () => {
  const dom = page('<label>Email verification code</label><input maxlength="6">');
  let searches = 0;
  let reloads = 0;
  dom.window.__testReload = () => reloads++;
  dom.window.crypto.randomUUID = () => 'invalidated-field';
  dom.window.chrome = {
    runtime: { onMessage: { addListener() {} }, sendMessage() { searches++; throw new Error('Extension context invalidated.'); } },
    storage: { local: { get: async () => ({ autoWatch: true }) }, onChanged: { addListener() {} } }
  };
  dom.window.eval(contentSource.replaceAll('if (!event.isTrusted) return;', '').replace('location.reload();', 'globalThis.__testReload();'));
  await new Promise(resolve => setTimeout(resolve, 40));
  const chip = dom.window.document.querySelector('button[aria-label="Find verification code"]');
  assert.equal(chip.textContent, 'Reload');
  assert.match(chip.title, /updated.*Reload/i);
  dom.window.document.querySelector('input').dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  await new Promise(resolve => setTimeout(resolve, 140));
  assert.equal(chip.textContent, 'Reload', 'field changes do not restart the dead connection');
  chip.click();
  assert.equal(reloads, 1);
  assert.equal(searches, 1, 'reload click does not repeat Gmail lookup');
  dom.window.close();
});

test('ordinary Gmail failures remain retryable and a retry can find the code', async () => {
  const dom = page('<label>Email verification code</label><input maxlength="6">');
  let searches = 0;
  dom.window.crypto.randomUUID = () => 'retry-field';
  dom.window.chrome = {
    runtime: { onMessage: { addListener() {} }, sendMessage: async () => {
      if (++searches === 1) throw new Error('Network request failed');
      return { status: 'found', code: '483921', sessionId: 'retry-session' };
    } },
    storage: { local: { get: async () => ({ autoWatch: true }) }, onChanged: { addListener() {} } }
  };
  dom.window.eval(contentSource.replaceAll('if (!event.isTrusted) return;', ''));
  await new Promise(resolve => setTimeout(resolve, 40));
  const chip = dom.window.document.querySelector('button[aria-label="Find verification code"]');
  assert.equal(chip.textContent, 'Retry');
  chip.click();
  await new Promise(resolve => setTimeout(resolve, 40));
  assert.equal(chip.textContent, '483921');
  assert.equal(searches, 2);
  dom.window.close();
});

test('third-party email code can be reviewed and inserted beside the field', async () => {
  const dom = page('<h2>Email verification</h2><p>Check your email for a code</p><div>' + '<input type="tel">'.repeat(6) + '</div>');
  dom.window.crypto.randomUUID = () => 'review-field';
  const requests = [];
  dom.window.chrome = {
    runtime: {
      onMessage: { addListener() {} },
      sendMessage: async request => {
        requests.push(request.type);
        if (request.type === 'SEARCH_INLINE') return { status: 'review', code: '483921', from: 'codes@mailer.example', timestamp: Date.now(), lifetimeSeconds: 600, sessionId: 'review-session' };
        return { status: 'inserted' };
      }
    },
    storage: { local: { get: async () => ({}) }, onChanged: { addListener() {} } }
  };
  // jsdom cannot synthesize trusted clicks; keep every other production path intact.
  const clickable = contentSource.replaceAll('if (!event.isTrusted) return;', '').replaceAll('if (!event.isTrusted || fieldId !== item.fieldId) return;', 'if (fieldId !== item.fieldId) return;');
  dom.window.eval(clickable);
  await new Promise(resolve => setTimeout(resolve, 40));
  const chip = dom.window.document.querySelector('button[aria-label="Find verification code"]');
  assert.equal(chip.textContent, 'Review');
  chip.click();
  const panel = dom.window.document.getElementById('codesnap-inline-panel');
  assert.match(panel.shadowRoot.textContent, /codes@mailer\.example/);
  assert.match(panel.shadowRoot.textContent, /483921/);
  panel.shadowRoot.querySelectorAll('button')[1].click();
  await new Promise(resolve => setTimeout(resolve, 40));
  assert.equal(chip.textContent, '✓');
  assert.deepEqual(requests, ['SEARCH_INLINE', 'INSERT_INLINE']);
  dom.window.close();
});

test('clicking the searching chip starts a manual lookup instead of ignoring the click', async () => {
  const dom = page('<label for="code">Email verification code</label><input id="code" maxlength="6">');
  dom.window.crypto.randomUUID = () => 'pending-field';
  let finishAutomatic;
  const modes = [];
  dom.window.chrome = {
    runtime: {
      onMessage: { addListener() {} },
      sendMessage: request => {
        modes.push(request.automatic);
        if (request.automatic) return new Promise(resolve => { finishAutomatic = resolve; });
        return Promise.resolve({ status: 'review', code: '483921', from: 'codes@mailer.example', timestamp: Date.now(), lifetimeSeconds: 600, sessionId: 'manual-session' });
      }
    },
    storage: { local: { get: async () => ({}) }, onChanged: { addListener() {} } }
  };
  dom.window.eval(contentSource.replaceAll('if (!event.isTrusted) return;', ''));
  await new Promise(resolve => setTimeout(resolve, 25));
  const chip = dom.window.document.querySelector('button[aria-label="Find verification code"]');
  assert.equal(chip.textContent, 'Finding…');
  chip.click();
  await new Promise(resolve => setTimeout(resolve, 25));
  assert.deepEqual(modes, [true, false]);
  assert.equal(chip.textContent, 'Review');
  finishAutomatic({ status: 'none' });
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(chip.textContent, 'Review');
  dom.window.close();
});

test('detects Russian withdrawal email verification field alongside authenticator field', async () => {
  const dom = page(`
    <form>
      <div>
        <label for="totp">Google Authenticator (2FA)</label>
        <input id="totp" maxlength="6" inputmode="numeric">
      </div>
      <div>
        <label for="email-code">Код подтверждения с эл. почты</label>
        <input id="email-code" maxlength="6" inputmode="numeric">
      </div>
    </form>
  `);
  const field = dom.window.VerificationFields.detect(dom.window.document);
  assert.equal(field?.type, 'single');
  assert.equal(field?.channel, 'email');
  assert.equal(field?.inputs[0].id, 'email-code');
  assert.equal(await dom.window.VerificationFields.insert(field, '413356'), true);
  assert.equal(dom.window.document.getElementById('email-code').value, '413356');
  dom.window.close();
});

test('detects Binance SPA nested form structure prioritizing email over authenticator', async () => {
  const dom = page(`
    <div class="modal">
      <div class="modal-header">Проверка безопасности</div>
      <div class="bn-form-item">
        <div class="bn-form-item-label">Код подтверждения с эл. почты</div>
        <div class="bn-form-item-control">
          <div class="bn-input-wrapper">
            <div class="bn-input-inner">
              <input id="email-in" class="bn-input" type="text" maxlength="6" inputmode="numeric">
              <button class="bn-button">Получить код</button>
            </div>
          </div>
        </div>
      </div>
      <div class="bn-form-item">
        <div class="bn-form-item-label">Приложение для аутентификации</div>
        <div class="bn-form-item-control">
          <div class="bn-input-wrapper">
            <div class="bn-input-inner">
              <input id="totp-in" class="bn-input" type="text" maxlength="6" inputmode="numeric">
            </div>
          </div>
        </div>
      </div>
    </div>
  `);
  const field = dom.window.VerificationFields.detect(dom.window.document);
  assert.equal(field?.type, 'single');
  assert.equal(field?.channel, 'email');
  assert.equal(field?.inputs[0].id, 'email-in');
  dom.window.close();
});

test('detects OneBullEx simple code input field', async () => {
  const dom = page(`
    <div class="form-container">
      <div class="field">
        <label>Код</label>
        <input id="onebullex-code" type="text" placeholder="Код" maxlength="6">
      </div>
    </div>
  `);
  const field = dom.window.VerificationFields.detect(dom.window.document);
  assert.equal(field?.type, 'single');
  assert.equal(field?.inputs[0].id, 'onebullex-code');
  dom.window.close();
});

test('detects 6-cell OTP group with masked email and sets channel to email', async () => {
  const dom = page(`
    <div class="modal-dialog">
      <h2>Email Verification</h2>
      <p class="subtitle">Enter the 6-digit code sent to to*******iw@gm*il.com</p>
      <div class="otp-container">
        <input maxlength="1" class="otp-cell">
        <input maxlength="1" class="otp-cell">
        <input maxlength="1" class="otp-cell">
        <input maxlength="1" class="otp-cell">
        <input maxlength="1" class="otp-cell">
        <input maxlength="1" class="otp-cell">
      </div>
    </div>
  `);
  const field = dom.window.VerificationFields.detect(dom.window.document);
  assert.ok(field);
  assert.equal(field.type, 'group');
  assert.equal(field.channel, 'email');
  assert.equal(field.inputs.length, 6);
  assert.equal(await dom.window.VerificationFields.insert(field, '928374'), true);
  assert.deepEqual(Array.from(field.inputs, input => input.value), ['9', '2', '8', '3', '7', '4']);
  dom.window.close();
});

test('detects and fills contenteditable OTP fields', async () => {
  const dom = page(`
    <div class="card">
      <label>Email verification code</label>
      <div class="code-boxes">
        <div contenteditable="true" data-cell class="otp-cell"></div>
        <div contenteditable="true" data-cell class="otp-cell"></div>
        <div contenteditable="true" data-cell class="otp-cell"></div>
        <div contenteditable="true" data-cell class="otp-cell"></div>
        <div contenteditable="true" data-cell class="otp-cell"></div>
        <div contenteditable="true" data-cell class="otp-cell"></div>
      </div>
    </div>
  `);
  const field = dom.window.VerificationFields.detect(dom.window.document);
  assert.ok(field);
  assert.equal(field.type, 'group');
  assert.equal(field.inputs.length, 6);
  assert.equal(await dom.window.VerificationFields.insert(field, '123456'), true);
  assert.deepEqual(Array.from(field.inputs, input => input.textContent), ['1', '2', '3', '4', '5', '6']);
  dom.window.close();
});

test('detects web component with closed shadow root', async () => {
  const dom = page('<div class="form"><div id="host"></div></div>');
  const host = dom.window.document.getElementById('host');
  const shadow = host.attachShadow({ mode: 'closed' });
  shadow.innerHTML = '<label>Security code</label><input type="text" maxlength="6" inputmode="numeric">';
  const field = dom.window.VerificationFields.detect(dom.window.document);
  assert.ok(field);
  assert.equal(field.type, 'single');
  assert.equal(await dom.window.VerificationFields.insert(field, '654321'), true);
  assert.equal(shadow.querySelector('input').value, '654321');
  dom.window.close();
});
