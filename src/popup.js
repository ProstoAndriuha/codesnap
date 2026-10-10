import { siteForOrigin, SITES, candidateIsFresh } from './core.js';
import { listAccounts, connectPrimary, connectAdditional, forgetAdditional, describeAuthError } from './auth.js';
import { MAIL_PROVIDERS } from './mail-bridge.js';

const $ = id => document.getElementById(id);
const t = (key, fallback) => (typeof chrome !== 'undefined' && chrome.i18n?.getMessage(key)) || fallback;

let tab;
let origin;
let siteId;
let current = null;
let polling = false;
let fieldStatus = null;
let searchGeneration = 0;

async function manageMail(payload) {
  const result = await chrome.runtime.sendMessage({ type: 'MAIL_ACCOUNT', payload });
  if (result?.message === 'Unknown request.') throw new Error('Обновите CodeSnap в chrome://extensions: открытое окно использует новую версию, а фоновая часть ещё старую. Затем откройте расширение снова.');
  if (result.status !== 'ok') throw new Error(result.message ?? 'Не удалось подключить почту.');
  return result;
}

function configureProvider() {
  const provider = $('provider').value;
  const preset = MAIL_PROVIDERS[provider];
  $('mailForm').hidden = !preset;
  $('imapAdvanced').open = provider === 'imap';
  $('imapHost').required = provider === 'imap';
  $('imapHost').value = preset?.host ?? '';
  $('imapHost').readOnly = provider !== 'imap';
  $('imapPort').value = '993'; $('imapSecurity').value = 'tls';
  const help = { yahoo: 'https://help.yahoo.com/kb/SLN15241.html', yandex: 'https://yandex.ru/support/id/authorization/app-passwords.html', mailru: 'https://help.mail.ru/mail/security/protection/external/' };
  $('mailHelp').hidden = !help[provider];
  if (help[provider]) $('mailHelp').href = help[provider];
  $('mailPassword').value = '';
  $('mailConsent').checked = false;
  $('connectYandex').hidden = provider !== 'yandex';
  $('yandexOAuthHint').hidden = provider !== 'yandex';
  $('mailCredentials').open = provider !== 'yandex';
  $('mailCredentialsTitle').hidden = provider !== 'yandex';
}

async function enableMailWithConsent() {
  if (!$('mailConsent').checked) {
    $('accounts').textContent = t('mailCloudConsentRequired', 'Подтвердите чтение писем сервером CodeSnap галочкой в форме подключения.');
    $('mailConsent').focus();
    return false;
  }
  await chrome.storage.local.set({ mailCloudEnabled: true });
  $('mailCloudEnabled').checked = true;
  return true;
}

function applyI18n() {
  for (const el of document.querySelectorAll('[data-i18n]')) {
    const key = el.getAttribute('data-i18n');
    const msg = chrome.i18n?.getMessage(key);
    if (msg) el.textContent = msg;
  }
}

function show(message, retry = false) { current = null; $('result').textContent = message; $('search').hidden = !retry; }
function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

function renderFieldStatus() {
  const name = siteId === 'generic' ? new URL(origin).hostname.replace(/^www\./, '') : SITES[siteId].name;
  $('site').textContent = name;
  const badge = $('fieldBadge');
  badge.className = 'badge';
  if (fieldStatus?.channel === 'authenticator') {
    badge.textContent = t('badge2fa', '2FA app'); badge.classList.add('warn');
    $('fieldType').textContent = t('desc2fa', 'This field needs a code from an authenticator app.');
  } else if (fieldStatus?.channel === 'sms') {
    badge.textContent = t('badgeSms', 'SMS'); badge.classList.add('warn');
    $('fieldType').textContent = t('descSms', 'This field needs a text-message code.');
  } else if (fieldStatus?.detected) {
    badge.textContent = fieldStatus.channel === 'email' ? t('badgeReady', 'Email code ready') : t('badgeFound', 'Code field found');
    badge.classList.add('ready');
    $('fieldType').textContent = fieldStatus.channel === 'email' ? t('descEmail', 'A matching email code can appear beside the field.') : t('descUnknown', 'Check the requested code source before using Gmail.');
  } else {
    badge.textContent = t('badgeManual', 'Manual search');
    $('fieldType').textContent = t('descManual', 'No code field yet. You can still search Gmail.');
  }
  $('search').disabled = fieldStatus?.channel === 'authenticator' || fieldStatus?.channel === 'sms';
}

async function refreshFieldStatus() {
  try { fieldStatus = await chrome.tabs.sendMessage(tab.id, { type: 'FIELD_STATUS' }, { frameId: 0 }); }
  catch { fieldStatus = null; }
  renderFieldStatus();
}

function showCode(result) {
  current = result;
  $('search').hidden = true;
  const root = $('result');
  root.replaceChildren();
  const button = document.createElement('button');
  button.type = 'button'; button.className = 'code-button';
  button.setAttribute('aria-label', `Use code ${result.code}`);
  const digits = document.createElement('span'); digits.className = 'code-digits';
  for (const character of result.code) {
    const tile = document.createElement('span'); tile.className = 'code-digit'; tile.textContent = character;
    digits.append(tile);
  }
  const action = document.createElement('span'); action.className = 'code-action';
  action.textContent = fieldStatus?.detected ? t('tapToInsert', 'Tap to insert ↗') : t('tapToCopy', 'Tap to copy ↗');
  button.append(digits, action);
  button.addEventListener('click', () => void useCode());
  root.append(button);
  const meta = document.createElement('small'); meta.className = 'code-meta';
  meta.textContent = `${result.from ?? 'Gmail'} · ${Math.max(0, Math.floor((Date.now() - result.timestamp) / 1000))} sec ago${result.accountEmail ? ` · ${result.accountEmail}` : ''}`;
  root.append(meta);
  if (result.requiresReview) {
    const warning = document.createElement('small'); warning.className = 'review';
    warning.textContent = `From ${result.from ?? 'unknown sender'}. Subject: ${result.subject || 'unknown'}. Check that this message belongs to the website before tapping the code.`;
    root.append(warning);
  }
}

async function useCode() {
  if (!current || !candidateIsFresh(current)) { show('That code expired. Check again.', true); return; }
  const selected = current;
  await refreshFieldStatus();
  if (fieldStatus?.channel === 'authenticator' || fieldStatus?.channel === 'sms') { show('This field needs a different kind of code.'); return; }
  if (fieldStatus?.detected) {
    const inserted = await chrome.runtime.sendMessage({ type: 'INSERT_POPUP', tabId: tab.id, origin, sessionId: selected.sessionId });
    if (inserted.status === 'inserted') { show(t('codeInserted', 'Code inserted. Finish on the website.'), true); return; }
  }
  try {
    await navigator.clipboard.writeText(selected.code);
    await chrome.runtime.sendMessage({ type: 'TRUST_CANDIDATE', tabId: tab.id, origin, sessionId: selected.sessionId });
    show(t('codeCopied', 'Code copied. Paste it into the website.'), true);
  } catch {
    const offscreenRes = await chrome.runtime.sendMessage({ type: 'COPY_CLIPBOARD', text: selected.code }).catch(() => null);
    if (offscreenRes?.status === 'copied') {
      await chrome.runtime.sendMessage({ type: 'TRUST_CANDIDATE', tabId: tab.id, origin, sessionId: selected.sessionId });
      show(t('codeCopied', 'Code copied. Paste it into the website.'), true);
    } else {
      showCode(selected);
      const warning = document.createElement('small'); warning.className = 'review';
      warning.textContent = 'Automatic copy was blocked. Select the code above to copy it.';
      $('result').append(warning);
    }
  }
}

async function refreshAccounts() {
  const accounts = await listAccounts();
  const stored = await chrome.storage.local.get('accountSelections');
  const selected = stored.accountSelections?.[origin] ?? 'all';
  $('account').replaceChildren(new Option(t('allAccounts', 'All connected accounts'), 'all'));
  if (accounts.primaryEmail) $('account').append(new Option(accounts.primaryEmail, 'primary'));
  for (const extra of accounts.extras) $('account').append(new Option(extra.email, `extra:${extra.email}`));
  for (const account of accounts.mailAccounts ?? []) $('account').append(new Option(`${account.email} · ${MAIL_PROVIDERS[account.provider]?.name ?? 'IMAP'}`, `mail:${account.id}`));
  $('account').value = [...$('account').options].some(option => option.value === selected) ? selected : 'all';
  $('removeAccount').hidden = !/^(?:extra|mail):/.test($('account').value);
  const count = Number(Boolean(accounts.primaryEmail)) + accounts.extras.length + (accounts.mailAccounts?.length ?? 0);
  $('accounts').textContent = count ? `${count} account${count === 1 ? '' : 's'} connected. Use the same button to add another.` : t('connectPrompt', 'Connect Gmail to find your codes.');
  return accounts;
}

async function init() {
  applyI18n();
  const manifest = chrome.runtime.getManifest?.();
  if (manifest?.version && $('appVersion')) $('appVersion').textContent = manifest.version;
  const { autoWatch, detailedPopup, mailCloudEnabled } = await chrome.storage.local.get(['autoWatch', 'detailedPopup', 'mailCloudEnabled']);
  $('mailCloudEnabled').checked = mailCloudEnabled === true;
  $('detailedPopup').checked = detailedPopup === true;
  $('autoWatch').checked = autoWatch !== false;
  $('autoState').textContent = autoWatch === false ? 'Paused' : 'On by default';
  [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  try { origin = new URL(tab.url).origin; } catch { show('Open an HTTPS website to search for a code.'); $('search').disabled = true; return; }
  if (!origin.startsWith('https://')) { show('Open an HTTPS website to search for a code.'); $('search').disabled = true; return; }
  siteId = siteForOrigin(origin) ?? 'generic';
  await refreshAccounts();
  await refreshFieldStatus();
  void searchLatest(false);
}

$('connect').addEventListener('click', async () => {
  const provider = $('provider').value;
  if (provider !== 'gmail') {
    if ($('mailForm').hidden) { configureProvider(); $('mailEmail').focus(); }
    else if (provider === 'yandex') $('connectYandex').click();
    else $('mailForm').requestSubmit();
    return;
  }
  $('connect').disabled = true;
  try {
    const accounts = await listAccounts();
    const email = accounts.primaryEmail ? await connectAdditional() : await connectPrimary();
    await refreshAccounts();
    $('accounts').textContent = `Connected ${email}. Looking for your code…`;
    void searchLatest();
  } catch (error) {
    show(describeAuthError(error));
  }
  finally { $('connect').disabled = false; }
});

$('account').addEventListener('change', async () => {
  const { accountSelections = {} } = await chrome.storage.local.get('accountSelections');
  accountSelections[origin] = $('account').value;
  await chrome.storage.local.set({ accountSelections });
  $('removeAccount').hidden = !/^(?:extra|mail):/.test($('account').value);
  void searchLatest();
});

$('removeAccount').addEventListener('click', async () => {
  const value = $('account').value;
  if (value.startsWith('mail:')) await manageMail({ command: 'remove', id: value.slice(5) });
  else if (value.startsWith('extra:')) await forgetAdditional(value.slice(6), true);
  else return;
  const { accountSelections = {} } = await chrome.storage.local.get('accountSelections');
  accountSelections[origin] = 'all';
  await chrome.storage.local.set({ accountSelections });
  await refreshAccounts();
  void searchLatest();
});

$('autoWatch').addEventListener('change', async () => {
  const enabled = $('autoWatch').checked;
  await chrome.storage.local.set({ autoWatch: enabled });
  $('autoState').textContent = enabled ? 'On' : 'Paused';
});

$('detailedPopup').addEventListener('change', async () => {
  await chrome.storage.local.set({ detailedPopup: $('detailedPopup').checked });
});

$('provider').addEventListener('change', configureProvider);
$('connectYandex').addEventListener('click', async () => {
  if ($('connectYandex').disabled || !await enableMailWithConsent()) return;
  $('connectYandex').disabled = true;
  try {
    const result = await chrome.runtime.sendMessage({ type: 'MAIL_YANDEX_CONNECT', consent: true });
    if (result?.status !== 'ok') throw new Error(result?.message ?? 'Не удалось войти через Яндекс.');
    $('mailForm').hidden = true; await refreshAccounts(); $('accounts').textContent = `Подключено: ${result.account.email}`; void searchLatest();
  } catch (error) { $('accounts').textContent = error.message; }
  finally { $('connectYandex').disabled = false; }
});
$('mailCloudEnabled').addEventListener('change', async () => {
  await chrome.storage.local.set({ mailCloudEnabled: $('mailCloudEnabled').checked });
  await refreshAccounts();
});
$('imapSecurity').addEventListener('change', () => {
  if ($('imapSecurity').value === 'starttls' && $('imapPort').value === '993') $('imapPort').value = '143';
  else if ($('imapSecurity').value === 'tls' && $('imapPort').value === '143') $('imapPort').value = '993';
});
$('mailForm').addEventListener('submit', async event => {
  event.preventDefault(); $('saveMail').disabled = true;
  if (!await enableMailWithConsent()) { $('saveMail').disabled = false; return; }
  const password = $('mailPassword').value; $('mailPassword').value = '';
  try {
    const result = await manageMail({ command: 'connect', consent: true, provider: $('provider').value, email: $('mailEmail').value.trim(), password, host: $('imapHost').value.trim(), port: Number($('imapPort').value), security: $('imapSecurity').value, login: $('imapLogin').value.trim() });
    $('mailForm').hidden = true; await refreshAccounts(); $('accounts').textContent = `Подключено: ${result.account.email}`; void searchLatest();
  } catch (error) { $('accounts').textContent = error.message; }
  finally { $('saveMail').disabled = false; }
});

$('search').addEventListener('click', () => { void searchLatest(); });

async function searchLatest(refreshField = true) {
  if (!origin?.startsWith('https://')) return;
  const generation = ++searchGeneration;
  current = null;
  $('search').hidden = true;
  if (refreshField) await refreshFieldStatus();
  if (generation !== searchGeneration) return;
  if (fieldStatus?.channel === 'authenticator' || fieldStatus?.channel === 'sms') { show('This field needs a different kind of code.'); return; }
  const accounts = await listAccounts();
  if (generation !== searchGeneration) return;
  if (!accounts.primaryEmail && !accounts.extras.length && !accounts.mailAccounts?.length) { show('Connect a mail account and your code will appear here automatically.'); return; }
  polling = true; $('search').disabled = true;
  const delays = [0, 2500, 5000, 9000];
  const selectedAccount = $('account').value;
  try {
    for (const delay of delays) {
      if (delay) await sleep(delay);
      if (generation !== searchGeneration) return;
      $('result').textContent = 'Checking mail…';
      const result = await chrome.runtime.sendMessage({ type: 'SEARCH_POPUP', tabId: tab.id, origin, siteId, fieldId: fieldStatus?.fieldId, detectedAt: fieldStatus?.detectedAt, siteContext: fieldStatus?.siteContext, channel: fieldStatus?.channel, accountSelection: selectedAccount });
      if (generation !== searchGeneration) return;
      if (result.status === 'found') {
        showCode(result);
        chrome.tabs.sendMessage(tab.id, { ...result, type: 'CODE_FOUND', fieldId: fieldStatus?.fieldId }).catch(() => {});
        break;
      }
      if (result.status === 'ambiguous') {
        const root = $('result'); root.textContent = 'Choose the email you requested:';
        for (const candidate of result.candidates) {
          const button = document.createElement('button'); button.type = 'button'; button.className = 'choice';
          button.textContent = `${candidate.code} · ${candidate.accountEmail ?? 'Gmail'} · ${Math.max(0, Math.floor((Date.now() - candidate.timestamp) / 1000))} sec ago`;
          button.addEventListener('click', async () => {
            const selected = await chrome.runtime.sendMessage({ type: 'SELECT_CANDIDATE', tabId: tab.id, origin, sessionId: result.sessionId, index: candidate.index });
            if (selected.status === 'found') {
              showCode(selected);
              chrome.tabs.sendMessage(tab.id, { ...selected, type: 'CODE_FOUND', fieldId: fieldStatus?.fieldId }).catch(() => {});
            } else show(selected.message ?? 'Search again.');
          });
          root.append(button);
        }
        break;
      }
      if (result.status !== 'none') { show(result.message ?? 'No code found.', true); break; }
      if (delay === delays.at(-1)) show(result.message ?? 'No recent email code found.', true);
    }
  } catch { if (generation === searchGeneration) show('Search failed. Check again.', true); }
  finally { if (generation === searchGeneration) { polling = false; $('search').disabled = false; } }
}

init().catch(() => show('Could not open this tab.'));
