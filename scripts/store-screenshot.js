import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright-core';

const css = readFileSync('src/popup.css', 'utf8');
const html = readFileSync('src/popup.html', 'utf8')
  .replace('<link rel="stylesheet" href="popup.css">', `<style>${css}\n:root{background:#fff}body{margin:0 auto}</style>`)
  .replace('<script type="module" src="popup.js"></script>', '');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 800, height: 600 }, deviceScaleFactor: 1 });
  await page.setContent(html);
  await page.evaluate(() => {
    document.querySelector('#fieldBadge').textContent = 'Email code ready';
    document.querySelector('#fieldBadge').classList.add('ready');
    document.querySelector('#site').textContent = 'example.com';
    document.querySelector('#fieldType').textContent = 'Email verification code field';
    document.querySelector('#result').innerHTML = '<button class="code-button"><span class="code-digits">' +
      [...'483921'].map(digit => `<span class="code-digit">${digit}</span>`).join('') +
      '</span><span class="code-action">Tap to insert ↗</span></button><span class="code-meta">Just now · demo@gmail.com</span>';
    document.querySelector('#accounts').textContent = '1 account connected.';
    document.querySelector('#autoWatch').checked = true;
    document.querySelector('#autoState').textContent = 'On by default';
  });
  await page.screenshot({ path: resolve('..', 'codesnap-store-demo.png') });
} finally { await browser.close(); }
