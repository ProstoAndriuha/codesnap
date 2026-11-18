import { siteForOrigin, SITES, candidateIsFresh } from './core.js';
import { listAccounts, connectPrimary, connectAdditional, forgetAdditional, describeAuthError } from './auth.js';
import { LOCAL_MAIL_PROVIDERS } from './local-mail.js';

const $ = id => document.getElementById(id);
const t = (key, fallback) => (typeof chrome !== 'undefined' && chrome.i18n?.getMessage(key)) || fallback;

let tab;
let origin;
let siteId;
let current = null;
let polling = false;
let fieldStatus = null;
let searchGeneration = 0;
let totpSiteMatch = null;
let totpVault = null;
let isSiteMuted = false;
let liveTicker = null;
let refreshingTotp = false;
let authController = null;
let activeMode = 'mail';

function formatMMSS(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

async function manageLocalMail(payload) {
  const result = await chrome.runtime.sendMessage({ type: 'LOCAL_MAIL_ACTION', payload });
  if (result?.message === 'Unknown request.') throw new Error('Обновите CodeSnap в chrome://extensions: открытое окно использует новую версию, а фоновая часть ещё старую.');
  if (result?.status && result.status !== 'ok') throw new Error(result.message ?? 'Не удалось выполнить действие с локальной почтой.');
  return result;
}

async function manageTotp(payload) {
  const result = await chrome.runtime.sendMessage({ type: 'TOTP_ACTION', payload });
  if (result?.status && result.status !== 'ok') throw new Error(result.message ?? 'Ошибка локального 2FA-хранилища.');
  return result;
}

function showTotpStatus(message, tone = 'info') {
  const el = $('totpStatus');
  if (!el) return;
  el.hidden = !message;
  el.textContent = message || '';
  el.className = tone === 'ok' ? 'totp-status ok' : tone === 'err' ? 'totp-status err' : 'totp-status';
  if (message) el.scrollIntoView?.({ block: 'nearest' });
}

function updateDualFillVisibility() {
  const wrap = $('dualFillWrap');
  if (!wrap) return;
  const ready = Boolean(
    current?.code &&
    totpSiteMatch?.status === 'found' &&
    (fieldStatus?.isDualField || fieldStatus?.has2faField)
  );
  wrap.hidden = !ready;
}

function renderMuteControl() {
  const btn = $('toggleMuteSite');
  if (!btn || !origin?.startsWith('https://')) return;
  btn.hidden = false;
  btn.textContent = isSiteMuted
    ? `✓ ${t('unmuteThisSite', 'Enable chip on this site')}`
    : `× ${t('muteThisSite', 'Hide chip on this site')}`;
}

function configureProvider() {
  const provider = $('provider').value;
  const preset = LOCAL_MAIL_PROVIDERS[provider];
  const isGmailOAuth = provider === 'gmail';
  const hint = $('localProviderHint');
  if (isGmailOAuth) {
    hint.hidden = true;
    $('localApiForm').hidden = true;
    $('connect').textContent = t('connectGmail', 'Connect mail');
  } else {
    hint.hidden = false;
    hint.textContent = `Откроет ${preset?.name ?? provider} во вкладке браузера. CodeSnap читает свежие коды и ссылки локально из открытой вкладки без пароля и серверов.`;
    $('connect').textContent = `Открыть ${preset?.name ?? provider}`;
    const hasApiOption = provider === 'fastmail' || provider === 'outlook';
    $('localApiForm').hidden = !hasApiOption;
    $('fastmailFields').hidden = provider !== 'fastmail';
    $('outlookFields').hidden = provider !== 'outlook';
    $('localApiAdvanced').open = false;
  }
}

function applyI18n() {
  for (const el of document.querySelectorAll('[data-i18n]')) {
    const key = el.getAttribute('data-i18n');
    const msg = chrome.i18n?.getMessage(key);
    if (msg) el.textContent = msg;
  }
}

function show(message, retry = false) {
  current = null;
  $('result').textContent = message;
  $('search').hidden = !retry;
  updateDualFillVisibility();
}
function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

function renderFieldStatus() {
  const name = siteId === 'generic' ? new URL(origin).hostname.replace(/^www\./, '') : SITES[siteId].name;
  $('site').textContent = name;
  const badge = $('fieldBadge');
  badge.className = 'badge';
  if (isSiteMuted) {
    badge.textContent = 'Скрыт на сайте';
    badge.classList.add('warn');
    $('fieldType').textContent = 'Чип CodeSnap отключён для этого сайта. Можно включить кнопкой ниже.';
  } else if (fieldStatus?.channel === 'authenticator') {
    badge.textContent = t('badge2fa', '2FA app'); badge.classList.add('warn');
    const providerLabels = {
      'google-authenticator': 'Google Authenticator',
      'microsoft-authenticator': 'Microsoft Authenticator',
      'yandex-key': 'Яндекс Ключ',
      authy: 'Authy',
      '1password': '1Password',
      bitwarden: 'Bitwarden',
      duo: 'Duo',
      okta: 'Okta Verify',
      '2fas': '2FAS',
      aegis: 'Aegis',
      'steam-guard': 'Steam Guard',
      'security-key': 'Security Key'
    };
    const hint = providerLabels[fieldStatus.providerHint];
    if (fieldStatus.subchannel === 'recovery') $('fieldType').textContent = t('desc2faRecovery', 'This field needs a backup or recovery code.');
    else if (fieldStatus.subchannel === 'hardware') $('fieldType').textContent = t('desc2faHardware', 'This field needs a hardware key or passkey.');
    else $('fieldType').textContent = hint ? `${t('desc2fa', 'This field needs a code from an authenticator app.')} (${hint})` : t('desc2fa', 'This field needs a code from an authenticator app.');
  } else if (fieldStatus?.channel === 'sms') {
    badge.textContent = t('badgeSms', 'SMS'); badge.classList.add('warn');
    $('fieldType').textContent = t('descSms', 'This field needs a text-message code.');
  } else if (fieldStatus?.fieldType === 'link-prompt') {
    badge.textContent = t('badgeLinkReady', 'Activation link'); badge.classList.add('ready');
    $('fieldType').textContent = t('descLinkPrompt', 'Confirmation link page detected. Looking for the link in your mail…');
  } else if (fieldStatus?.detected) {
    badge.textContent = fieldStatus.channel === 'email' ? t('badgeReady', 'Email code ready') : t('badgeFound', 'Code field found');
    badge.classList.add('ready');
    $('fieldType').textContent = fieldStatus.channel === 'email' ? t('descEmail', 'A matching email code can appear beside the field.') : t('descUnknown', 'Check the requested code source before using your mail.');
  } else {
    badge.textContent = t('badgeManual', 'Manual search');
    $('fieldType').textContent = t('descManual', 'No code field yet. You can still search your mail for codes or activation links.');
  }
  $('search').disabled = fieldStatus?.channel === 'authenticator' || fieldStatus?.channel === 'sms';
  if ($('clearPickedFieldBtn')) $('clearPickedFieldBtn').hidden = !fieldStatus?.hasCustomField;
  renderPhishingBanner(totpVault?.phishingAlert ?? fieldStatus?.phishingAlert);
  updateDualFillVisibility();
}

function renderPhishingBanner(alert) {
  const banner = $('phishingBanner');
  if (!banner) return;
  const isSuspicious = Boolean(alert?.suspicious);
  banner.hidden = !isSuspicious;
  if (isSuspicious && $('phishingBannerText')) {
    $('phishingBannerText').textContent = `⚠️ Внимание: ${alert.hostname} похож на фишинговый клон ${alert.targetDomain}. Автозаполнение заблокировано.`;
  }
}

async function refreshFieldStatus() {
  try { fieldStatus = await chrome.tabs.sendMessage(tab.id, { type: 'FIELD_STATUS' }, { frameId: 0 }); }
  catch { fieldStatus = null; }
  renderFieldStatus();
}

function showResult(result) {
  current = result;
  $('search').hidden = true;
  const root = $('result');
  root.replaceChildren();

  if (result.code) {
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
  }

  if (result.link?.url) {
    const linkBtn = document.createElement('button');
    linkBtn.type = 'button';
    linkBtn.className = result.code ? 'link-button secondary-link' : 'link-button';
    const title = document.createElement('span'); title.className = 'link-title';
    title.textContent = `🔗 ${result.link.label || result.link.host}`;
    const host = document.createElement('span'); host.className = 'link-host';
    host.textContent = result.link.host;
    const action = document.createElement('span'); action.className = 'code-action';
    action.textContent = t('tapToOpenLink', 'Open confirmation link ↗');
    linkBtn.append(title, host, action);
    linkBtn.addEventListener('click', () => void openActivationLink());
    root.append(linkBtn);

    if (!result.code) {
      const actionsRow = document.createElement('div'); actionsRow.className = 'link-actions';
      const copyLink = document.createElement('button'); copyLink.type = 'button'; copyLink.className = 'text-button';
      copyLink.textContent = t('copyLink', 'Copy link');
      copyLink.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(result.link.url);
          chrome.runtime.sendMessage({ type: 'CLIPBOARD_COPIED' }).catch(() => {});
          copyLink.textContent = '✓ Copied';
        } catch {
          const res = await chrome.runtime.sendMessage({ type: 'COPY_CLIPBOARD', text: result.link.url }).catch(() => null);
          if (res?.status === 'copied') copyLink.textContent = '✓ Copied';
        }
      });
      actionsRow.append(copyLink);
      root.append(actionsRow);
    }
  }

  const meta = document.createElement('small'); meta.className = 'code-meta';
  const ageSec = Math.max(0, Math.floor((Date.now() - result.timestamp) / 1000));
  const lifeSec = result.lifetimeSeconds ?? (result.code ? 180 : 600);
  const remSec = Math.max(0, Math.ceil((result.timestamp + lifeSec * 1000 - Date.now()) / 1000));
  const pill = document.createElement('span');
  pill.id = 'emailExpiryPill';
  pill.className = remSec <= 0 ? 'expiry-pill expired' : 'expiry-pill';
  pill.textContent = remSec <= 0 ? t('inlineExpiredShort', 'Expired') : `⏱ ${formatMMSS(remSec)}`;
  meta.append(document.createTextNode(`${result.from ?? 'Mail'} · ${ageSec} sec ago${result.accountEmail ? ` · ${result.accountEmail}` : ''} `), pill);
  root.append(meta);
  if (result.requiresReview) {
    const warning = document.createElement('small'); warning.className = 'review';
    warning.textContent = `From ${result.from ?? 'unknown sender'}. Subject: ${result.subject || 'unknown'}. Check that this message belongs to the website before continuing.`;
    root.append(warning);
  }
  updateDualFillVisibility();
}

async function openActivationLink() {
  if (!current?.link?.url || !candidateIsFresh(current)) { show('That link expired. Check again.', true); return; }
  const opened = await chrome.runtime.sendMessage({ type: 'OPEN_LINK_POPUP', tabId: tab.id, origin, sessionId: current.sessionId });
  if (opened?.status === 'opened') show(t('linkOpened', 'Confirmation link opened in a new tab.'), true);
  else show(opened?.message ?? 'Could not open link.', true);
}

async function useCode() {
  if (!current || !candidateIsFresh(current)) { show('That code expired. Check again.', true); return; }
  const selected = current;
  await refreshFieldStatus();
  if (fieldStatus?.channel === 'authenticator' || fieldStatus?.channel === 'sms') { show('This field needs a different kind of code.'); return; }
  if (fieldStatus?.detected && fieldStatus?.fieldType !== 'link-prompt') {
    const inserted = await chrome.runtime.sendMessage({ type: 'INSERT_POPUP', tabId: tab.id, origin, sessionId: selected.sessionId });
    if (inserted.status === 'inserted') { show(t('codeInserted', 'Code inserted. Finish on the website.'), true); return; }
  }
  try {
    await navigator.clipboard.writeText(selected.code);
    chrome.runtime.sendMessage({ type: 'CLIPBOARD_COPIED' }).catch(() => {});
    await chrome.runtime.sendMessage({ type: 'TRUST_CANDIDATE', tabId: tab.id, origin, sessionId: selected.sessionId });
    show(t('codeCopied', 'Code copied. Paste it into the website.'), true);
  } catch {
    const offscreenRes = await chrome.runtime.sendMessage({ type: 'COPY_CLIPBOARD', text: selected.code }).catch(() => null);
    if (offscreenRes?.status === 'copied') {
      await chrome.runtime.sendMessage({ type: 'TRUST_CANDIDATE', tabId: tab.id, origin, sessionId: selected.sessionId });
      show(t('codeCopied', 'Code copied. Paste it into the website.'), true);
    } else {
      showResult(selected);
      const warning = document.createElement('small'); warning.className = 'review';
      warning.textContent = 'Automatic copy was blocked. Select the code above to copy it.';
      $('result').append(warning);
    }
  }
}

async function useTotpCode(totpItem) {
  if (!totpItem?.code) return;
  if (totpVault?.phishingAlert?.suspicious) {
    showTotpStatus(`⚠️ Заблокировано: ${totpVault.phishingAlert.hostname} похож на фишинговый клон ${totpVault.phishingAlert.targetDomain}.`, 'err');
    return;
  }
  await refreshFieldStatus();
  let chosen = totpItem;
  if (fieldStatus?.channel === 'authenticator' || fieldStatus?.has2faField || fieldStatus?.isDualField) {
    if ((totpItem.remainingSeconds ?? 30) <= 3) {
      showTotpStatus('⏳ До смены ≤3с — ждём свежий 30-сек код…', 'info');
    }
    const res = await manageTotp({ command: 'insert_totp', tabId: tab.id, origin, id: totpItem.id, siteContext: fieldStatus?.siteContext }).catch(() => null);
    if (res?.status === 'phishing_blocked') {
      showTotpStatus(res.message, 'err');
      return;
    }
    if (res?.code) chosen = { ...chosen, code: res.code, remainingSeconds: res.remainingSeconds };
    if (res?.status === 'inserted') {
      showTotpStatus(res.waitedForNextWindow ? '✓ Свежий 2FA код вставлен.' : '✓ 2FA код вставлен.');
      return;
    }
  } else if ((totpItem.remainingSeconds ?? 30) <= 3) {
    showTotpStatus('⏳ До смены ≤3с — ждём свежий 30-сек код…', 'info');
    const fresh = await manageTotp({ command: 'fresh_code_by_id', id: totpItem.id }).catch(() => null);
    if (fresh?.code) chosen = { ...chosen, code: fresh.code, remainingSeconds: fresh.remainingSeconds };
  }
  try {
    await navigator.clipboard.writeText(chosen.code);
    chrome.runtime.sendMessage({ type: 'CLIPBOARD_COPIED' }).catch(() => {});
    showTotpStatus(`✓ 2FA код ${chosen.code} скопирован (очистится через 45 сек).`);
  } catch {
    const offscreenRes = await chrome.runtime.sendMessage({ type: 'COPY_CLIPBOARD', text: chosen.code }).catch(() => null);
    if (offscreenRes?.status === 'copied') showTotpStatus(`✓ 2FA код ${chosen.code} скопирован.`);
  }
}

function renderTotpBox(match) {
  const root = $('totpResult');
  if (!root) return;
  root.replaceChildren();

  const buildTotpCard = (item, includeDualBtn = false) => {
    const wrap = document.createElement('div');
    wrap.className = 'totp-cand-wrap';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'totp-code-button';
    const top = document.createElement('div'); top.className = 'totp-row-top';
    const digits = document.createElement('span'); digits.className = 'totp-digits-text';
    digits.textContent = String(item.code ?? '').replace(/^(.{3})(.{3})$/, '$1 $2');
    const secBadge = document.createElement('span');
    secBadge.className = 'totp-sec';
    secBadge.setAttribute('data-totp-sec-id', item.id);
    if (!includeDualBtn) secBadge.id = 'totpSecLive';
    secBadge.textContent = `${item.remainingSeconds}s`;
    top.append(digits, secBadge);

    const progress = document.createElement('div'); progress.className = 'totp-progress';
    const bar = document.createElement('div');
    bar.className = 'totp-progress-bar';
    bar.setAttribute('data-totp-bar-id', item.id);
    if (!includeDualBtn) bar.id = 'totpProgressBar';
    bar.style.width = `${Math.round((item.remainingSeconds / (item.period || 30)) * 100)}%`;
    progress.append(bar);

    const sub = document.createElement('div'); sub.className = 'totp-sub';
    const who = document.createElement('span');
    who.textContent = `${item.issuer}${item.account ? ` · ${item.account}` : ''}`;
    const act = document.createElement('span');
    act.textContent = (fieldStatus?.channel === 'authenticator' || fieldStatus?.has2faField) ? 'Вставить 2FA ↗' : 'Скопировать ↗';
    sub.append(who, act);

    btn.append(top, progress, sub);
    btn.addEventListener('click', () => void useTotpCode(item));
    wrap.append(btn);

    if (includeDualBtn && current?.code && (fieldStatus?.isDualField || fieldStatus?.has2faField)) {
      const dBtn = document.createElement('button');
      dBtn.type = 'button';
      dBtn.className = 'totp-dual-mini';
      dBtn.textContent = `⚡ Почта + ${item.accountEmail || item.issuer}`;
      dBtn.addEventListener('click', async () => {
        const res = await chrome.runtime.sendMessage({
          type: 'INSERT_DUAL_POPUP',
          tabId: tab.id,
          origin,
          sessionId: current.sessionId,
          siteContext: fieldStatus?.siteContext,
          totpId: item.id
        }).catch(() => null);
        if (res?.status === 'inserted_dual') show(t('dualInserted', 'Both Email and 2FA codes inserted.'), true);
        else showTotpStatus(res?.message ?? 'Не удалось вставить оба кода.', 'err');
      });
      wrap.append(dBtn);
    }
    return wrap;
  };

  if (match?.status === 'found') {
    root.append(buildTotpCard(match, false));
  } else if (match?.status === 'choose' && Array.isArray(match.candidates)) {
    const info = document.createElement('p'); info.className = 'subtle';
    info.textContent = `Найдено ${match.candidates.length} 2FA-аккаунта — выберите нужную почту:`;
    const list = document.createElement('div'); list.className = 'totp-choose-list';
    for (const cand of match.candidates) list.append(buildTotpCard(cand, true));
    root.append(info, list);
  } else if (match?.status === 'locked') {
    const p = document.createElement('p'); p.className = 'subtle';
    p.textContent = `🔒 2FA (${match.account?.issuer ?? 'сейф'}) защищён PIN-кодом.`;
    root.append(p);
  } else if (totpVault?.count > 0 && totpVault.unlocked) {
    const picker = document.createElement('select');
    picker.setAttribute('aria-label', 'Choose saved 2FA key');
    picker.append(new Option(`Сохранённые 2FA ключи (${totpVault.count}) — выбрать для этого сайта…`, ''));
    for (const acc of totpVault.accounts ?? []) {
      picker.append(new Option(`${acc.issuer}${acc.account ? ` (${acc.account})` : ''}`, acc.id));
    }
    picker.addEventListener('change', async () => {
      if (!picker.value) return;
      try {
        const res = await manageTotp({ command: 'code_by_id', id: picker.value });
        totpSiteMatch = res;
        renderTotpBox(res);
        updateDualFillVisibility();
      } catch (err) { showTotpStatus(err.message, 'err'); }
    });
    root.append(picker);
  } else {
    const p = document.createElement('p'); p.className = 'subtle';
    p.textContent = 'Локальный 2FA-сейф (TOTP). Нажмите «Импорт», «+ Добавить» или «Сканировать QR».';
    root.append(p);
  }
}

function renderSavedTotpList() {
  const list = $('totpSavedList');
  if (!list) return;
  list.replaceChildren();
  for (const acc of totpVault?.accounts ?? []) {
    const row = document.createElement('div'); row.className = 'totp-saved-item';
    const info = document.createElement('span'); info.className = 'totp-saved-info';
    info.textContent = `${acc.issuer}${acc.account ? ` (${acc.account})` : ''}${acc.domain ? ` · ${acc.domain}` : ''}`;
    const del = document.createElement('button'); del.type = 'button'; del.className = 'text-button';
    del.textContent = 'Удалить';
    del.addEventListener('click', async () => {
      try {
        await manageTotp({ command: 'remove', id: acc.id });
        await refreshTotp();
      } catch (err) { showTotpStatus(err.message); }
    });
    row.append(info, del);
    list.append(row);
  }
}

async function refreshTotp() {
  if (!origin?.startsWith('https://') || refreshingTotp) return;
  refreshingTotp = true;
  try {
    const res = await chrome.runtime.sendMessage({
      type: 'TOTP_ACTION',
      payload: {
        command: 'status',
        tabId: tab?.id,
        origin,
        siteContext: fieldStatus?.siteContext,
        matchedEmailAccount: current?.accountEmail ?? null
      }
    });
    if (!res || res.status !== 'ok') return;
    totpVault = res;
    totpSiteMatch = res.siteMatch ?? { status: 'none' };
    renderPhishingBanner(res.phishingAlert ?? fieldStatus?.phishingAlert);
    const badge = $('authCountBadge');
    if (badge) { badge.textContent = String(res.count ?? 0); badge.hidden = !(res.count > 0); }
    $('totpLockBtn').hidden = !(res.pinProtected && res.unlocked);
    $('totpUnlockForm').hidden = !(res.pinProtected && !res.unlocked);
    renderTotpBox(totpSiteMatch);
    renderSavedTotpList();
    updateDualFillVisibility();
    if (fieldStatus?.channel === 'authenticator' && (totpSiteMatch.status === 'found' || totpSiteMatch.status === 'choose')) {
      $('result').textContent = totpSiteMatch.status === 'choose'
        ? 'Выберите нужный 2FA-аккаунт ниже ↓'
        : '2FA-код готов ниже ↓ Нажмите для вставки.';
    }
  } catch { /* Ignore when background test stub doesn't handle TOTP_ACTION. */ }
  finally { refreshingTotp = false; }
}

async function switchMode(mode, initialDrawer = null) {
  activeMode = mode;
  $('modeMailBtn')?.classList.toggle('active', mode === 'mail');
  $('modeAuthBtn')?.classList.toggle('active', mode === 'auth');
  if ($('mailModeView')) $('mailModeView').hidden = mode !== 'mail';
  if ($('authModeView')) $('authModeView').hidden = mode !== 'auth';

  if (mode === 'auth') {
    const host = $('authModeView');
    if (!authController) {
      const { mountAuthenticatorView } = await import('./authenticator.js');
      authController = await mountAuthenticatorView(host, {
        tab,
        origin: origin ?? '',
        siteContext: fieldStatus?.siteContext ?? {},
        has2faField: Boolean(fieldStatus?.has2faField || fieldStatus?.channel === 'authenticator'),
        initialDrawer,
        onCountChange: count => {
          const badge = $('authCountBadge');
          if (badge) { badge.textContent = String(count); badge.hidden = !(count > 0); }
        }
      });
    } else {
      await authController.setContext({
        tab,
        origin: origin ?? '',
        siteContext: fieldStatus?.siteContext ?? {},
        has2faField: Boolean(fieldStatus?.has2faField || fieldStatus?.channel === 'authenticator')
      });
      if (initialDrawer === 'import') authController.openImport();
    }
  } else {
    if (origin?.startsWith('https://')) await refreshTotp();
  }
}

function startLiveTicker() {
  clearInterval(liveTicker);
  liveTicker = setInterval(() => {
    if (!document.defaultView) { clearInterval(liveTicker); return; }
    if (current?.timestamp) {
      const lifeSec = current.lifetimeSeconds ?? (current.code ? 180 : 600);
      const remSec = Math.ceil((current.timestamp + lifeSec * 1000 - Date.now()) / 1000);
      const pill = $('emailExpiryPill');
      if (pill) {
        if (remSec <= 0) {
          pill.textContent = t('inlineExpiredShort', 'Expired');
          pill.className = 'expiry-pill expired';
          const btn = $('result')?.querySelector('.code-button');
          if (btn) btn.disabled = true;
          $('search').hidden = false;
        } else {
          pill.textContent = `⏱ ${formatMMSS(remSec)}`;
        }
      }
    }
    if (totpSiteMatch?.status === 'found' || totpSiteMatch?.status === 'choose') {
      const period = totpSiteMatch.period || 30;
      const epochSec = Math.floor(Date.now() / 1000);
      const counter = Math.floor(epochSec / period);
      if (counter !== totpSiteMatch.counter) {
        void refreshTotp();
        return;
      }
      const rem = period - (((epochSec % period) + period) % period);
      totpSiteMatch.remainingSeconds = rem;
      const secEl = $('totpSecLive');
      const barEl = $('totpProgressBar');
      if (secEl) {
        secEl.textContent = rem <= 3 ? `⏳ ${rem}s → новый` : `${rem}s`;
        secEl.classList.toggle('expiring', rem <= 3);
      }
      if (barEl) {
        barEl.style.width = `${Math.round((rem / period) * 100)}%`;
        barEl.classList.toggle('expiring', rem <= 3);
      }
      for (const c of totpSiteMatch.candidates ?? []) {
        const cPer = c.period || 30;
        const cRem = cPer - (((epochSec % cPer) + cPer) % cPer);
        const sEl = $('totpResult')?.querySelector(`[data-totp-sec-id="${c.id}"]`);
        const bEl = $('totpResult')?.querySelector(`[data-totp-bar-id="${c.id}"]`);
        if (sEl) {
          sEl.textContent = cRem <= 3 ? `⏳ ${cRem}s → новый` : `${cRem}s`;
          sEl.classList.toggle('expiring', cRem <= 3);
        }
        if (bEl) {
          bEl.style.width = `${Math.round((cRem / cPer) * 100)}%`;
          bEl.classList.toggle('expiring', cRem <= 3);
        }
      }
    }
  }, 1000);
  liveTicker?.unref?.();
}

async function refreshAccounts() {
  const accounts = await listAccounts();
  const stored = await chrome.storage.local.get(['accountSelections', 'learnedAccounts']);
  const selected = stored.accountSelections?.[origin] ?? 'all';
  const learned = stored.learnedAccounts?.[origin] ?? null;
  $('account').replaceChildren(new Option(t('allAccounts', 'All connected accounts'), 'all'));
  if (accounts.primaryEmail) $('account').append(new Option(`${accounts.primaryEmail} · Gmail`, 'primary'));
  for (const extra of accounts.extras) $('account').append(new Option(`${extra.email} · Gmail`, `extra:${extra.email}`));
  for (const localAcc of accounts.mailAccounts ?? []) {
    const providerLabel = LOCAL_MAIL_PROVIDERS[localAcc.provider]?.name ?? localAcc.provider;
    const text = localAcc.email.includes('@') ? `${localAcc.email} · ${providerLabel}` : localAcc.email;
    $('account').append(new Option(text, `local:${localAcc.id}`));
  }
  $('account').value = [...$('account').options].some(option => option.value === selected) ? selected : 'all';
  $('removeAccount').hidden = !/^(?:extra|local):/.test($('account').value) || $('account').value.startsWith('local:tab:');
  const activeLocal = (accounts.mailAccounts ?? []).filter(a => a.active).length;
  const count = Number(Boolean(accounts.primaryEmail)) + accounts.extras.length + activeLocal;
  $('accounts').textContent = count
    ? `${count} active mail source${count === 1 ? '' : 's'} ready.`
    : t('connectPrompt', 'Connect Gmail or open any webmail tab to find codes & links.');
  const learnedEl = $('learnedAccountHint');
  if (learnedEl) {
    if (learned && origin?.startsWith('https://')) {
      learnedEl.hidden = false;
      learnedEl.textContent = `★ Запомненный ящик для сайта: ${learned}`;
    } else {
      learnedEl.hidden = true;
    }
  }
  return accounts;
}

async function init() {
  applyI18n();
  const manifest = chrome.runtime.getManifest?.();
  if (manifest?.version && $('appVersion')) $('appVersion').textContent = manifest.version;
  const settings = await chrome.storage.local.get(['autoWatch', 'detailedPopup', 'localWebmailEnabled', 'autoClearClipboard', 'mutedOrigins']);
  const { autoWatch, detailedPopup, localWebmailEnabled, autoClearClipboard, mutedOrigins } = settings ?? {};
  $('localWebmailEnabled').checked = localWebmailEnabled !== false;
  $('detailedPopup').checked = detailedPopup === true;
  if ($('autoClearClipboard')) $('autoClearClipboard').checked = autoClearClipboard !== false;
  $('autoWatch').checked = autoWatch !== false;
  $('autoState').textContent = autoWatch === false ? 'Paused' : 'On by default';
  configureProvider();
  [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  try { origin = new URL(tab.url).origin; } catch { show('Open an HTTPS website to search for a code.'); $('search').disabled = true; return; }
  if (!origin.startsWith('https://')) { show('Open an HTTPS website to search for a code.'); $('search').disabled = true; return; }
  isSiteMuted = Array.isArray(mutedOrigins) && mutedOrigins.includes(origin);
  renderMuteControl();
  siteId = siteForOrigin(origin) ?? 'generic';
  if ($('totpIssuerInput') && !$('totpIssuerInput').value) {
    $('totpIssuerInput').placeholder = new URL(origin).hostname.replace(/^www\./, '');
  }
  await refreshAccounts();
  await refreshFieldStatus();
  await refreshTotp();
  startLiveTicker();
  void searchLatest(false);
}

$('modeMailBtn')?.addEventListener('click', () => { void switchMode('mail'); });
$('modeAuthBtn')?.addEventListener('click', () => { void switchMode('auth'); });
$('totpOpenImportBtn')?.addEventListener('click', () => { void switchMode('auth', 'import'); });
$('totpOpenAllBtn')?.addEventListener('click', () => { void switchMode('auth'); });
$('popoutAuthBtn')?.addEventListener('click', async () => {
  const qs = new URLSearchParams();
  if (tab?.id) qs.set('tabId', String(tab.id));
  if (origin) qs.set('origin', origin);
  const url = chrome.runtime.getURL(`src/authenticator.html${qs.toString() ? `?${qs}` : ''}`);
  if (chrome.windows?.create) {
    await chrome.windows.create({ url, type: 'popup', width: 396, height: 590 }).catch(() => {});
  } else {
    await chrome.tabs?.create?.({ url, active: true }).catch(() => {});
  }
});

$('dualFillBtn')?.addEventListener('click', async () => {
  if (!current?.sessionId) return;
  const res = await chrome.runtime.sendMessage({
    type: 'INSERT_DUAL_POPUP',
    tabId: tab.id,
    origin,
    sessionId: current.sessionId,
    siteContext: fieldStatus?.siteContext
  }).catch(() => null);
  if (res?.status === 'inserted_dual') {
    show(t('dualInserted', 'Both Email and 2FA codes inserted.'), true);
  } else {
    show(res?.message ?? 'Could not insert both codes.', true);
  }
});

$('toggleMuteSite')?.addEventListener('click', async () => {
  if (!origin?.startsWith('https://')) return;
  const data = (await chrome.storage.local.get('mutedOrigins')) ?? {};
  const list = Array.isArray(data.mutedOrigins) ? data.mutedOrigins : [];
  const next = list.includes(origin) ? list.filter(x => x !== origin) : [...list, origin];
  isSiteMuted = next.includes(origin);
  await chrome.storage.local.set({ mutedOrigins: next });
  renderMuteControl();
  renderFieldStatus();
});

$('phishingTrustBtn')?.addEventListener('click', async () => {
  if (!origin?.startsWith('https://')) return;
  await chrome.runtime.sendMessage({ type: 'TRUST_PHISHING_ORIGIN', origin }).catch(() => {});
  await refreshFieldStatus();
  await refreshTotp();
});

$('pickFieldBtn')?.addEventListener('click', async () => {
  if (!tab?.id || !origin?.startsWith('https://')) return;
  const res = await chrome.runtime.sendMessage({
    type: 'START_FIELD_PICKER',
    tabId: tab.id,
    defaultChannel: fieldStatus?.channel === 'authenticator' ? 'authenticator' : 'email'
  }).catch(() => null);
  if (res?.status === 'started') window.close?.();
  else show(res?.message ?? 'Обновите страницу (F5) и попробуйте снова.', true);
});

$('clearPickedFieldBtn')?.addEventListener('click', async () => {
  if (!origin?.startsWith('https://')) return;
  await chrome.runtime.sendMessage({ type: 'CLEAR_CUSTOM_FIELD', origin }).catch(() => {});
  await refreshFieldStatus();
  show('Ручная привязка поля сброшена.', false);
});

$('totpRegionScanBtn')?.addEventListener('click', async () => {
  if (!tab?.id || !origin?.startsWith('https://')) return;
  const res = await chrome.runtime.sendMessage({ type: 'START_QR_SNIPER', tabId: tab.id }).catch(() => null);
  if (res?.status === 'started') window.close?.();
  else showTotpStatus(res?.message ?? 'Обновите вкладку (F5) и попробуйте снова.', 'err');
});

$('totpToggleAdd')?.addEventListener('click', () => {
  const panel = $('totpManagePanel');
  if (panel) panel.hidden = !panel.hidden;
  showTotpStatus('');
});

$('totpScanBtn')?.addEventListener('click', async () => {
  if (!tab?.id) return;
  $('totpScanBtn').disabled = true;
  showTotpStatus('🔍 Сканируем QR-код и ключи на странице…', 'info');
  try {
    const { scanTabForTotp } = await import('./qr-scanner.js');
    const scan = await scanTabForTotp(tab, {
      issuer: $('totpIssuerInput')?.value.trim() || undefined,
      domain: origin?.startsWith('https://') ? new URL(origin).hostname : ''
    });
    if (scan.status === 'found' && scan.entries?.length) {
      const saved = await manageTotp({ command: 'add_entries', entries: scan.entries });
      await refreshTotp();
      $('totpManagePanel').hidden = true;
      const firstLabel = saved.first?.account?.issuer ?? scan.entries[0]?.issuer ?? '2FA';
      showTotpStatus(
        saved.count > 1
          ? `✓ Импортировано 2FA ключей: ${saved.count}`
          : `✓ Добавлено (${firstLabel}): ${saved.first?.code ?? ''}`,
        'ok'
      );
    } else {
      showTotpStatus(scan.message ?? 'QR-код или секретный ключ 2FA не найден.', 'err');
    }
  } catch (err) {
    showTotpStatus(err.message || 'Не удалось отсканировать страницу.', 'err');
  } finally {
    $('totpScanBtn').disabled = false;
  }
});

$('totpAddForm')?.addEventListener('submit', async event => {
  event.preventDefault();
  const input = $('totpSecretInput').value.trim();
  const issuer = $('totpIssuerInput').value.trim();
  if (!input) { showTotpStatus('Вставьте секретный ключ или otpauth:// ссылку.', 'err'); return; }
  $('totpSaveBtn').disabled = true;
  try {
    const res = await manageTotp({
      command: 'add',
      input,
      meta: {
        issuer: issuer || undefined,
        domain: origin?.startsWith('https://') ? new URL(origin).hostname : ''
      }
    });
    $('totpSecretInput').value = '';
    await refreshTotp();
    $('totpManagePanel').hidden = true;
    showTotpStatus(`✓ Сохранено локально (${res.account?.issuer}): ${res.code}`, 'ok');
  } catch (err) {
    showTotpStatus(err.message, 'err');
  } finally {
    $('totpSaveBtn').disabled = false;
  }
});

$('totpUnlockForm')?.addEventListener('submit', async event => {
  event.preventDefault();
  try {
    await manageTotp({ command: 'unlock', passphrase: $('totpPinInput').value });
    $('totpPinInput').value = '';
    showTotpStatus('');
    await refreshTotp();
  } catch (err) {
    showTotpStatus(err.message);
  }
});

$('totpLockBtn')?.addEventListener('click', async () => {
  await manageTotp({ command: 'lock' }).catch(() => {});
  await refreshTotp();
});

$('totpSetPinBtn')?.addEventListener('click', async () => {
  const pin = $('totpNewPin').value;
  try {
    const res = await manageTotp({ command: 'set_pin', newPassphrase: pin });
    $('totpNewPin').value = '';
    await refreshTotp();
    showTotpStatus(res.pinProtected ? '✓ PIN-защита для 2FA включена.' : 'PIN-защита 2FA снята.');
  } catch (err) {
    showTotpStatus(err.message);
  }
});

$('connect').addEventListener('click', async () => {
  const provider = $('provider').value;
  $('connect').disabled = true;
  try {
    if (provider === 'gmail') {
      const accounts = await listAccounts();
      const email = accounts.primaryEmail ? await connectAdditional() : await connectPrimary();
      await refreshAccounts();
      $('accounts').textContent = `Connected ${email}. Looking for your code…`;
      void searchLatest();
    } else {
      const res = await manageLocalMail({ command: 'connect', provider });
      await refreshAccounts();
      $('accounts').textContent = `Готово: ${res.account?.email ?? LOCAL_MAIL_PROVIDERS[provider]?.name}. Войдите в почту в открытой вкладке.`;
    }
  } catch (error) {
    show(provider === 'gmail' ? describeAuthError(error) : error.message);
  } finally {
    $('connect').disabled = false;
  }
});

$('provider').addEventListener('change', configureProvider);

$('localApiForm').addEventListener('submit', async event => {
  event.preventDefault();
  $('saveLocalApi').disabled = true;
  const provider = $('provider').value;
  try {
    let payload;
    if (provider === 'fastmail') {
      const apiToken = $('fastmailToken').value.trim();
      $('fastmailToken').value = '';
      payload = { command: 'connect', provider: 'fastmail_jmap', apiToken };
    } else if (provider === 'outlook') {
      const clientId = $('outlookClientId').value.trim();
      payload = { command: 'connect', provider: 'outlook_pkce', clientId };
    }
    if (payload) {
      const res = await manageLocalMail(payload);
      await refreshAccounts();
      $('accounts').textContent = `Подключено локально: ${res.account.email}`;
      void searchLatest();
    }
  } catch (error) {
    $('accounts').textContent = error.message;
  } finally {
    $('saveLocalApi').disabled = false;
  }
});

$('account').addEventListener('change', async () => {
  const { accountSelections = {} } = await chrome.storage.local.get('accountSelections');
  accountSelections[origin] = $('account').value;
  await chrome.storage.local.set({ accountSelections });
  $('removeAccount').hidden = !/^(?:extra|local):/.test($('account').value) || $('account').value.startsWith('local:tab:');
  void searchLatest();
});

$('removeAccount').addEventListener('click', async () => {
  const value = $('account').value;
  if (value.startsWith('local:')) await manageLocalMail({ command: 'remove', id: value });
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

$('localWebmailEnabled').addEventListener('change', async () => {
  searchGeneration++; current = null;
  await chrome.storage.local.set({ localWebmailEnabled: $('localWebmailEnabled').checked });
  await refreshAccounts();
  void searchLatest();
});

$('detailedPopup').addEventListener('change', async () => {
  await chrome.storage.local.set({ detailedPopup: $('detailedPopup').checked });
});

$('autoClearClipboard')?.addEventListener('change', async () => {
  await chrome.storage.local.set({ autoClearClipboard: $('autoClearClipboard').checked });
});

$('search').addEventListener('click', () => { void searchLatest(); });

async function searchLatest(refreshField = true) {
  if (!origin?.startsWith('https://')) return;
  const generation = ++searchGeneration;
  current = null;
  $('search').hidden = true;
  if (refreshField) await refreshFieldStatus();
  if (generation !== searchGeneration) return;
  if (fieldStatus?.channel === 'authenticator') {
    if (totpSiteMatch?.status === 'found') {
      show('2FA-код готов ниже ↓ Нажмите для вставки.');
    } else if (totpSiteMatch?.status === 'choose') {
      show('Выберите нужный 2FA-аккаунт ниже ↓');
    } else if ((totpVault?.count ?? 0) > 0) {
      show('Поле 2FA (Google Authenticator). Откройте «🔐 Аутентификатор» выше, чтобы вставить или привязать ключ к сайту.');
    } else {
      show('Это поле для приложения 2FA (Google Authenticator). Добавьте или импортируйте ключ 2FA ниже.');
    }
    return;
  }
  if (fieldStatus?.channel === 'sms') { show('This field needs a different kind of code.'); return; }
  const accounts = await listAccounts();
  if (generation !== searchGeneration) return;
  const hasActiveLocal = (accounts.mailAccounts ?? []).some(a => a.active);
  if (!accounts.primaryEmail && !accounts.extras.length && !hasActiveLocal) {
    show('Connect Gmail or keep a webmail tab open (Yandex, Outlook, Yahoo, Mail.ru, Proton, etc.).');
    return;
  }
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
        showResult(result);
        chrome.tabs.sendMessage(tab.id, { ...result, type: 'CODE_FOUND', fieldId: fieldStatus?.fieldId }).catch(() => {});
        if (result.accountEmail && totpSiteMatch?.status === 'choose') void refreshTotp();
        break;
      }
      if (result.status === 'webmail_unread') {
        const root = $('result');
        root.replaceChildren();
        const msg = document.createElement('p'); msg.className = 'supporting'; msg.textContent = result.message;
        const focusBtn = document.createElement('button'); focusBtn.type = 'button'; focusBtn.className = 'secondary';
        focusBtn.style.marginTop = '8px';
        focusBtn.textContent = 'Открыть вкладку почты ↗';
        focusBtn.addEventListener('click', () => {
          void chrome.runtime.sendMessage({ type: 'FOCUS_WEBMAIL', origin, webmailTabId: result.webmailTabId });
        });
        root.append(msg, focusBtn);
        $('search').hidden = false;
        break;
      }
      if (result.status === 'ambiguous') {
        const root = $('result'); root.textContent = 'Choose the email you requested:';
        for (const candidate of result.candidates) {
          const button = document.createElement('button'); button.type = 'button'; button.className = 'choice';
          const label = candidate.code || `🔗 ${candidate.link?.label || candidate.link?.host}`;
          button.textContent = `${label} · ${candidate.accountEmail ?? 'Mail'} · ${Math.max(0, Math.floor((Date.now() - candidate.timestamp) / 1000))} sec ago`;
          button.addEventListener('click', async () => {
            const selected = await chrome.runtime.sendMessage({ type: 'SELECT_CANDIDATE', tabId: tab.id, origin, sessionId: result.sessionId, index: candidate.index });
            if (selected.status === 'found') {
              showResult(selected);
              chrome.tabs.sendMessage(tab.id, { ...selected, type: 'CODE_FOUND', fieldId: fieldStatus?.fieldId }).catch(() => {});
            } else show(selected.message ?? 'Search again.');
          });
          root.append(button);
        }
        break;
      }
      if (result.status !== 'none') { show(result.message ?? 'No code or link found.', true); break; }
      if (delay === delays.at(-1)) show(result.message ?? 'No recent verification email found.', true);
    }
  } catch { if (generation === searchGeneration) show('Search failed. Check again.', true); }
  finally { if (generation === searchGeneration) { polling = false; $('search').disabled = false; } }
}

init().catch(() => show('Could not open this tab.'));
