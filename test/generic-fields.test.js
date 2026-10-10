import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
const source = readFileSync(new URL('../src/fields.js', import.meta.url), 'utf8');
function page(html) {
  const dom = new JSDOM(html, { url: 'https://new-provider.test/verify', runScripts: 'outside-only' });
  dom.window.eval(source);
  return dom;
}

for (const depth of [1, 4, 7]) {
  for (const label of ['Верификация по эл. почте', 'Email verification', 'Verificare prin email', 'Vérification par courriel']) {
    test(`generic verification label survives ${depth} wrappers: ${label}`, () => {
      const dom = page(`<section><p>${label}</p>${'<div>'.repeat(depth)}<input type="number" placeholder="Enter">${'</div>'.repeat(depth)}<a>Switch to Google Authenticator instead</a></section>`);
      const field = dom.window.VerificationFields.detect(dom.window.document);
      assert.equal(field?.channel, 'email');
      assert.equal(field?.type, 'single');
      dom.window.close();
    });
  }
}

test('accessible descriptions and nearest source distinguish app and email codes', () => {
  const dom = page('<p>Email verification</p><section><div id="help">Code from your authentication app</div><input aria-describedby="help" maxlength="6"></section>');
  assert.equal(dom.window.VerificationFields.detect(dom.window.document)?.channel, 'authenticator');
  dom.window.close();
  const email = page('<p id="help">Email authentication code</p><input aria-describedby="help" maxlength="6">');
  assert.equal(email.window.VerificationFields.detect(email.window.document)?.channel, 'email');
  email.window.close();
});

test('active security dialog wins over background code fields', () => {
  const dom = page('<label>Email verification code<input id="background" maxlength="6"></label><div role="dialog"><p>Enter security code sent by email</p><input id="modal" maxlength="6"></div>');
  assert.equal(dom.window.VerificationFields.detect(dom.window.document)?.inputs[0].id, 'modal');
  dom.window.close();
});

test('hidden, inert and unrelated fields cannot become code targets', () => {
  for (const html of [
    '<section style="display:none"><label>Email code<input maxlength="6"></label></section>',
    '<section style="visibility:hidden"><label>Email code<input maxlength="6"></label></section>',
    '<section hidden><label>Email code<input maxlength="6"></label></section>',
    '<section inert><label>Email code<input maxlength="6"></label></section>',
    '<input id="quantity" maxlength="6" inputmode="numeric">',
    '<label>Security code<input name="cvv" maxlength="4"></label>',
    '<label>Promo code<input name="promo-code" maxlength="6"></label>',
    '<label>Enter verification code<input autocomplete="current-password" type="password"></label>',
    '<p>Your email verification code will be sent after login</p><input placeholder="Введите эл. почту">'
  ]) {
    const dom = page(html);
    dom.window.document.querySelector('input').focus();
    assert.equal(dom.window.VerificationFields.detect(dom.window.document), null, html);
    dom.window.close();
  }
});

test('low-confidence email candidate cannot mask an explicit authenticator field', () => {
  const dom = page('<input id="email"><label>Google Authenticator code<input id="totp" maxlength="6"></label>');
  assert.equal(dom.window.VerificationFields.detect(dom.window.document)?.inputs[0].id, 'totp');
  dom.window.close();
});

test('email delivery and resend controls identify generic OTP without a code label', () => {
  const dom = page('<section><p>Sent to a***@example.com</p><div><div><input type="number"></div><button>Resend</button></div></section>');
  assert.equal(dom.window.VerificationFields.detect(dom.window.document)?.channel, 'email');
  dom.window.close();
});
