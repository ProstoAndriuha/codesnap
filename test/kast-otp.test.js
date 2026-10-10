import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import React from 'react';
import OtpModule from 'react-otp-input';
import { useForm } from 'react-hook-form';

test('React OTP paste replaces the entire code with one controlled-state update', async () => {
  const dom = new JSDOM('<!doctype html><p>Enter the 6-digit code via email</p><div id="root"></div>', { url: 'https://affiliate.kast.xyz/auth', runScripts: 'outside-only', pretendToBeVisual: true });
  const saved = Object.fromEntries(['window', 'document', 'navigator', 'HTMLElement', 'HTMLInputElement'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const key of Object.keys(saved)) Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key] });
  const { createRoot } = await import('react-dom/client');
  const { flushSync } = await import('react-dom');
  const OtpInput = OtpModule.default ?? OtpModule;
  let state = '';
  let submissions = 0;
  const changes = [];
  function Form() {
    const form = useForm({ defaultValues: { otp: '' } });
    const value = form.watch('otp');
    return React.createElement(OtpInput, { value, numInputs: 6, inputType: 'tel', skipDefaultStyles: true,
      onChange(code) { changes.push(code); state = code; form.setValue('otp', code); if (code.length === 6) submissions++; },
      renderInput: (props, index) => React.createElement('input', { ...props, id: `otp-input-${index + 1}`, name: `otp-${index + 1}`, autoComplete: index === 0 ? 'one-time-code' : 'off' }) });
  }
  const root = createRoot(dom.window.document.getElementById('root'));
  try {
    flushSync(() => root.render(React.createElement(Form)));
    dom.window.eval(readFileSync(new URL('../src/fields.js', import.meta.url), 'utf8'));
    const inputs = [...dom.window.document.querySelectorAll('input')];
    inputs[4].focus();
    const inserted = await dom.window.VerificationFields.insert(dom.window.VerificationFields.detect(dom.window.document), '310683');
    await new Promise(resolve => setTimeout(resolve, 30));
    assert.equal(inputs.map(input => input.value).join(''), '310683', 'actual values after React rerender');
    assert.equal(state, '310683', 'controlled component state');
    assert.equal(inserted, true);
    assert.equal(submissions, 1, 'website completion callback runs once');
    assert.deepEqual(changes, ['310683'], 'no incomplete intermediate codes');
  } finally {
    flushSync(() => root.unmount());
    dom.window.close();
    for (const [key, descriptor] of Object.entries(saved)) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; }
  }
});
