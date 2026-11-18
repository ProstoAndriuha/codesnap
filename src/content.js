(() => {
  if (globalThis.__verificationCodesLoaded || location.protocol !== 'https:') return;
  if (globalThis.CodeSnapWebmail?.detectProvider?.(location.hostname, location.pathname)) return;
  globalThis.__verificationCodesLoaded = true;
  const detector = globalThis.VerificationFields;
  let field = null;
  let fieldId = null;
  let detectedAt = null;
  let code = null;
  let link = null;
  let webmailHint = null;
  let sessionId = null;
  let chip = null;
  let panel = null;
  let review = null;
  let notice = null;
  let searchMode = null;
  let debounceTimer = null;
  let watchGeneration = 0;
  let searching = false;
  let autoWatch = false;
  let completedFieldId = null;
  let requestedAt = null;
  let paddedInput = null;
  let originalPadding = '';
  let reloadRequired = false;
  let detailedPopup = false;
  let totpEnabled = false;
  let totpSiteHints = [];
  let mutedOrigins = [];
  let codeDetails = null;
  let choices = null;
  let totpDetails = null;
  let totpFetching = false;
  let totpTimer = null;
  let chipExpiryTimer = null;
  let panelTimer = null;
  let toastEl = null;
  let toastTimer = null;
  const t = (key, fallback) => chrome.i18n?.getMessage(key) || fallback;
  const observedRoots = new WeakSet();

  const delays = [0, 1500, 2500, 4000, 4000];
  const reloadMessage = 'CodeSnap was updated. Reload this page to reconnect it.';

  function safeInterval(fn, ms) {
    if (!document.defaultView) return null;
    const id = setInterval(() => {
      if (!document.defaultView) { clearInterval(id); return; }
      fn();
    }, ms);
    id?.unref?.();
    return id;
  }

  function stopPanelTimer() { clearInterval(panelTimer); panelTimer = null; }
  function stopTotpTimer() { clearInterval(totpTimer); totpTimer = null; }
  function stopChipExpiryTimer() { clearInterval(chipExpiryTimer); chipExpiryTimer = null; }

  function closePanel() { stopPanelTimer(); panel?.remove(); panel = null; }

  function contextInvalidated(error = null) {
    return /(?:extension context invalidated|context.*(?:destroyed|invalidated))/i.test(String(error?.message ?? ''));
  }

  function isOriginMuted() {
    return Array.isArray(mutedOrigins) && mutedOrigins.includes(location.origin);
  }

  function siteHasTotpHint() {
    if (!Array.isArray(totpSiteHints) || !totpSiteHints.length) return false;
    const host = location.hostname.toLowerCase();
    return totpSiteHints.some(hint => {
      const dom = String(hint.domain ?? '').toLowerCase();
      if (dom && (host === dom || host.endsWith(`.${dom}`))) return true;
      if (Array.isArray(hint.matchDomains) && hint.matchDomains.some(d => host === d || host.endsWith(`.${d}`))) return true;
      if (Array.isArray(hint.matchNames) && hint.matchNames.some(n => n.length >= 3 && (host === n || host.startsWith(`${n}.`) || host.includes(`.${n}.`)))) return true;
      return false;
    });
  }

  function formatMMSS(seconds) {
    const s = Math.max(0, Math.floor(seconds));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }

  function showToast(text) {
    clearTimeout(toastTimer);
    toastEl?.remove();
    if (!document.documentElement) return;
    const dark = isDarkTheme();
    const host = document.createElement('div');
    host.id = 'codesnap-toast';
    host.style.cssText = 'position:fixed;right:18px;bottom:18px;z-index:2147483647;pointer-events:none;font:650 13px/1.35 system-ui,sans-serif';
    const root = host.attachShadow({ mode: 'open' });
    const pill = document.createElement('div');
    pill.style.cssText = dark
      ? 'padding:10px 14px;border:1px solid #415185;border-radius:11px;background:#151c30f2;color:#eef2ff;box-shadow:0 10px 28px rgba(0,0,0,.55)'
      : 'padding:10px 14px;border:1px solid #c7d2f7;border-radius:11px;background:#fffffffa;color:#1d2942;box-shadow:0 10px 28px rgba(17,28,62,.22)';
    pill.textContent = `⚡ ${text}`;
    root.append(pill);
    document.documentElement.append(host);
    toastEl = host;
    toastTimer = setTimeout(() => { host.remove(); if (toastEl === host) toastEl = null; }, 3200);
  }

  async function muteCurrentOrigin() {
    try {
      const data = (await chrome.storage.local.get('mutedOrigins')) ?? {};
      const next = [...new Set([...(Array.isArray(data.mutedOrigins) ? data.mutedOrigins : []), location.origin])];
      mutedOrigins = next;
      await chrome.storage.local.set?.({ mutedOrigins: next });
      closePanel();
      paint();
      showToast(`CodeSnap скрыт на ${location.hostname}`);
    } catch { /* Ignore storage errors in sandboxed tests. */ }
  }

  function showReloadRequired() {
    reloadRequired = true;
    watchGeneration++; searching = false; searchMode = null; autoWatch = false;
    stopTotpTimer(); stopChipExpiryTimer();
    code = null; link = null; webmailHint = null; sessionId = null; review = null; codeDetails = null; choices = null; totpDetails = null; closePanel();
    notice = reloadMessage;
    if (chip) { chip.textContent = 'Reload'; chip.title = notice; }
    position();
  }

  function isDarkTheme() {
    let rgb;
    for (let element = field?.anchor?.parentElement; element && !rgb; element = element.parentElement) {
      const color = getComputedStyle(element).backgroundColor;
      const match = color?.match(/rgba?\((\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,\s/]+([\d.]+))?/);
      if (match && Number(match[4] ?? 1) > .25) rgb = match;
    }
    if (rgb) {
      return (Number(rgb[1]) * .2126 + Number(rgb[2]) * .7152 + Number(rgb[3]) * .0722) < 125;
    }
    const html = document.documentElement;
    const body = document.body;
    const darkAttr = /(?:dark|night|black)/i.test(`${html?.getAttribute('data-theme') ?? ''} ${html?.getAttribute('theme') ?? ''} ${body?.getAttribute('data-theme') ?? ''} ${html?.className ?? ''} ${body?.className ?? ''}`);
    if (darkAttr) return true;
    return Boolean(globalThis.matchMedia?.('(prefers-color-scheme: dark)').matches);
  }

  function appendMuteFooter(box, dark) {
    const footer = document.createElement('div');
    footer.style.cssText = `margin-top:10px;padding-top:8px;border-top:1px solid ${dark ? '#2b3657' : '#edf0f7'};display:flex;justify-content:flex-end`;
    const muteBtn = document.createElement('button');
    muteBtn.type = 'button';
    muteBtn.className = 'panel-mute-btn';
    muteBtn.textContent = `× ${t('muteSiteInline', 'Hide on this site')}`;
    muteBtn.style.cssText = `border:0;background:none;padding:0;color:${dark ? '#8a97ba' : '#7f8ca4'};font:600 10px system-ui,sans-serif;cursor:pointer;text-decoration:underline`;
    muteBtn.addEventListener('click', event => { if (event.isTrusted) void muteCurrentOrigin(); });
    footer.append(muteBtn);
    box.append(footer);
  }

  function showPanel(title, detail, action = null) {
    closePanel();
    if (!field?.anchor?.isConnected) return;
    const dark = isDarkTheme();
    const host = document.createElement('div');
    host.id = 'codesnap-inline-panel';
    host.style.cssText = `position:fixed;z-index:2147483647;width:256px;max-width:calc(100vw - 16px);font:13px/1.4 system-ui,sans-serif;color:${dark ? '#e8ebff' : '#1d2942'}`;
    const rect = field.anchor.getBoundingClientRect();
    host.style.left = `${Math.max(8, Math.min(innerWidth - 264, rect.right - 256))}px`;
    host.style.top = `${rect.bottom + 150 < innerHeight ? rect.bottom + 7 : Math.max(8, rect.top - 150)}px`;
    const root = host.attachShadow({ mode: 'open' });
    const box = document.createElement('div');
    box.style.cssText = dark
      ? 'padding:13px;border:1px solid #334066;border-radius:13px;background:#151c30;box-shadow:0 12px 32px rgba(0,0,0,.6);color:#e8ebff'
      : 'padding:13px;border:1px solid #ced6ef;border-radius:13px;background:#fff;box-shadow:0 12px 32px #0d153a40;color:#1d2942';
    const heading = document.createElement('div');
    heading.style.cssText = 'display:flex;justify-content:space-between;align-items:center;gap:8px;font-weight:750';
    const label = document.createElement('span'); label.textContent = title;
    const dismiss = document.createElement('button'); dismiss.type = 'button'; dismiss.textContent = '×'; dismiss.setAttribute('aria-label', 'Close CodeSnap');
    dismiss.style.cssText = `border:0;background:none;color:${dark ? '#9aa7c7' : '#68758d'};font-size:18px;cursor:pointer`;
    dismiss.addEventListener('click', closePanel);
    heading.append(label, dismiss); box.append(heading);
    if (detail) {
      const description = document.createElement('p'); description.textContent = detail;
      description.style.cssText = `margin:7px 0 0;color:${dark ? '#a5b4d4' : '#586780'};font-size:11px;overflow-wrap:anywhere`;
      box.append(description);
    }
    if (action) {
      const button = document.createElement('button'); button.type = 'button';
      button.textContent = action.label;
      button.style.cssText = 'display:block;width:100%;margin-top:10px;padding:9px;border:0;border-radius:8px;background:#5369e8;color:white;font:700 14px system-ui,sans-serif;cursor:pointer';
      button.addEventListener('click', action.run);
      box.append(button);
    }
    appendMuteFooter(box, dark);
    root.append(box); document.documentElement.append(host); panel = host;
  }

  function updateChipDisplay() {
    if (!chip || reloadRequired || completedFieldId === fieldId) return;
    if (field?.channel === 'authenticator') {
      if (totpDetails?.status === 'found') {
        const rem = totpDetails.remainingSeconds ?? 30;
        chip.textContent = `${totpDetails.code} · ${rem}s`;
        chip.title = `2FA (${totpDetails.issuer}) · ${rem}s · Click once to insert`;
      } else if (totpDetails?.status === 'locked') {
        chip.textContent = '🔒 2FA';
        chip.title = 'Unlock 2FA in CodeSnap popup';
      }
      return;
    }
    if (code && totpDetails?.status === 'found' && detector.detect2FA?.(document) && siteHasTotpHint()) {
      chip.textContent = `${code} + 2FA`;
      chip.title = `Click once to insert Email + 2FA (${totpDetails.remainingSeconds}s)`;
    } else if (code) {
      chip.textContent = code;
      const remSec = codeDetails?.timestamp
        ? Math.max(0, Math.ceil((codeDetails.timestamp + (codeDetails.lifetimeSeconds ?? 180) * 1000 - Date.now()) / 1000))
        : null;
      chip.title = remSec !== null ? `Click once to insert (${formatMMSS(remSec)})` : 'Click once to insert';
    } else if (link) {
      chip.textContent = '🔗 Open';
      chip.title = `Open link: ${link.host}`;
    }
  }

  function startChipExpiryTimer() {
    stopChipExpiryTimer();
    if (!codeDetails?.timestamp) return;
    chipExpiryTimer = safeInterval(() => {
      if (!codeDetails?.timestamp || reloadRequired || completedFieldId === fieldId) {
        stopChipExpiryTimer();
        return;
      }
      const lifeSec = codeDetails.lifetimeSeconds ?? (codeDetails.code ? 180 : 600);
      const remMs = codeDetails.timestamp + lifeSec * 1000 - Date.now();
      if (remMs <= 0) {
        stopChipExpiryTimer();
        code = null; link = null; sessionId = null; codeDetails = null;
        if (chip && field?.channel !== 'authenticator') {
          chip.textContent = 'Retry';
          chip.title = t('inlineExpired', 'Code expired. Search again.');
        } else {
          updateChipDisplay();
        }
        position();
        return;
      }
      updateChipDisplay();
    }, 1000);
  }

  function startTotpTimer(expectedFieldId) {
    stopTotpTimer();
    if (!totpDetails || totpDetails.status !== 'found') return;
    totpTimer = safeInterval(() => {
      if (fieldId !== expectedFieldId || !totpDetails || totpDetails.status !== 'found' || reloadRequired) {
        stopTotpTimer();
        return;
      }
      const period = totpDetails.period || 30;
      const epochSec = Math.floor(Date.now() / 1000);
      const counter = Math.floor(epochSec / period);
      if (counter !== totpDetails.counter) {
        void refreshInlineTotp(expectedFieldId);
        return;
      }
      totpDetails.remainingSeconds = period - (((epochSec % period) + period) % period);
      updateChipDisplay();
      const liveEl = panel?.shadowRoot?.querySelector?.('.totp-live');
      if (liveEl) liveEl.textContent = `${totpDetails.code.replace(/^(.{3})(.{3})$/, '$1 $2')} · ${totpDetails.remainingSeconds}s`;
    }, 1000);
  }

  async function refreshInlineTotp(expectedFieldId) {
    if (!expectedFieldId || totpFetching || reloadRequired || isOriginMuted() || !siteHasTotpHint()) return;
    totpFetching = true;
    try {
      const res = await chrome.runtime.sendMessage({ type: 'GET_TOTP_INLINE', origin: location.origin, siteContext: context() });
      if (!document.defaultView || fieldId !== expectedFieldId) return;
      if (res?.status === 'found') {
        totpDetails = { ...res };
        updateChipDisplay();
        startTotpTimer(expectedFieldId);
        if (detailedPopup && field?.channel === 'authenticator' && !panel) showCodePanel();
      } else if (res?.status === 'locked') {
        totpDetails = { status: 'locked', account: res.account };
        stopTotpTimer();
        updateChipDisplay();
      } else {
        totpDetails = null;
        stopTotpTimer();
        if (field?.channel === 'authenticator') {
          closePanel();
          chip?.remove(); chip = null; clearPadding();
        }
      }
      position();
    } catch (error) {
      if (contextInvalidated(error)) showReloadRequired();
    } finally {
      totpFetching = false;
    }
  }

  async function insertTotpInline(expectedFieldId) {
    if (fieldId !== expectedFieldId || reloadRequired) return;
    try {
      const res = await chrome.runtime.sendMessage({ type: 'INSERT_TOTP_INLINE', origin: location.origin, siteContext: context() });
      if (fieldId !== expectedFieldId) return;
      if (res?.status === 'inserted') {
        completedFieldId = fieldId;
        stopTotpTimer();
        closePanel();
        if (chip) { chip.textContent = '✓'; chip.title = '2FA code inserted'; }
      } else if (totpDetails?.code) {
        try {
          await navigator.clipboard.writeText(totpDetails.code);
          chrome.runtime.sendMessage({ type: 'CLIPBOARD_COPIED' }).catch(() => {});
          if (chip) { chip.textContent = 'Copied'; chip.title = '2FA code copied.'; }
        } catch {
          if (chip) { chip.textContent = 'Retry'; chip.title = res?.message ?? 'Could not insert 2FA code'; }
        }
      }
    } catch (error) {
      if (contextInvalidated(error)) showReloadRequired();
    }
  }

  async function insertDualInline(expectedFieldId) {
    if (fieldId !== expectedFieldId || reloadRequired || !sessionId) return;
    try {
      const res = await chrome.runtime.sendMessage({
        type: 'INSERT_DUAL_INLINE',
        origin: location.origin,
        sessionId,
        siteContext: context()
      });
      if (fieldId !== expectedFieldId) return;
      if (res?.status === 'inserted_dual') {
        completedFieldId = fieldId;
        code = null; link = null; sessionId = null; review = null; choices = null; codeDetails = null;
        stopChipExpiryTimer(); stopTotpTimer();
        closePanel();
        if (chip) { chip.textContent = '✓✓'; chip.title = t('dualInserted', 'Both Email and 2FA codes inserted.'); }
        showToast(t('dualInserted', 'Both Email and 2FA codes inserted.'));
      } else {
        showPanel(t('inlineFailed', 'Could not insert'), res?.message ?? 'Try inserting each code separately.');
      }
    } catch (error) {
      if (contextInvalidated(error)) showReloadRequired();
      else showPanel(t('inlineFailed', 'Could not insert'), 'Could not reach CodeSnap.');
    }
  }

  function showReview() {
    if (!review || !fieldId || !review.sessionId) return;
    const item = review;
    if (Date.now() - item.timestamp > (item.lifetimeSeconds ?? 180) * 1000) {
      review = null; chip.textContent = 'Retry'; chip.title = 'Code expired. Click to search again.'; return;
    }
    const isLinkOnly = !item.code && item.link?.url;
    const detailText = isLinkOnly
      ? `From: ${item.from ?? 'unknown sender'}. Subject: ${item.subject || 'unknown'}. Destination: ${item.link.host}. Make sure this link belongs to ${location.hostname}.`
      : `From: ${item.from ?? 'unknown sender'}. Subject: ${item.subject || 'unknown'}. Make sure this message belongs to ${location.hostname}.`;
    showPanel('Check this email', detailText, {
      label: isLinkOnly ? `🔗 ${t('inlineOpenLink', 'Open link')} (${item.link.host}) ↗` : `${item.code}  ·  Insert code`,
      run: async event => {
        if (!event.isTrusted || fieldId !== item.fieldId) return;
        let result;
        try {
          result = await chrome.runtime.sendMessage({
            type: isLinkOnly ? 'OPEN_LINK_INLINE' : 'INSERT_INLINE',
            origin: location.origin,
            sessionId: item.sessionId
          });
        } catch (error) {
          if (contextInvalidated(error)) showReloadRequired();
          else showPanel('Could not complete', 'Could not reach CodeSnap. Try again.');
          return;
        }
        if (result.status === 'inserted' || result.status === 'opened') {
          completedFieldId = fieldId; review = null; code = null; link = null; codeDetails = null; choices = null; stopChipExpiryTimer(); closePanel();
          chip.textContent = '✓'; chip.title = result.status === 'opened' ? 'Link opened' : 'Code inserted';
        } else showPanel('Could not insert', result.message ?? 'Try searching again.');
      }
    });
  }

  async function openInlineLink(item, expectedFieldId, button) {
    if (fieldId !== expectedFieldId || reloadRequired || !item.link?.url) return;
    if (item.timestamp && Date.now() - item.timestamp > (item.lifetimeSeconds ?? 600) * 1000) {
      showPanel('CodeSnap', t('inlineExpired', 'Code expired. Search again.')); return;
    }
    button.disabled = true;
    try {
      let selected = item;
      if (Number.isInteger(item.index)) {
        selected = await chrome.runtime.sendMessage({ type: 'SELECT_INLINE_CANDIDATE', origin: location.origin, sessionId: item.sessionId, index: item.index });
        if (fieldId !== expectedFieldId) return;
        if (selected.status !== 'found') { showPanel('CodeSnap', selected.message ?? 'Search again.'); return; }
      }
      const result = await chrome.runtime.sendMessage({ type: 'OPEN_LINK_INLINE', origin: location.origin, sessionId: selected.sessionId });
      if (fieldId !== expectedFieldId) return;
      if (result.status === 'opened') {
        completedFieldId = fieldId; code = null; link = null; sessionId = null; review = null; choices = null; codeDetails = null;
        stopChipExpiryTimer(); closePanel(); chip.textContent = '✓'; chip.title = 'Link opened';
      } else showPanel(t('inlineFailed', 'Could not open link'), result.message ?? 'Try searching again.');
    } catch (error) {
      if (contextInvalidated(error)) showReloadRequired();
      else showPanel(t('inlineFailed', 'Could not open link'), 'Could not reach CodeSnap. Try again.');
    } finally { button.disabled = false; }
  }

  async function insertDetailed(item, expectedFieldId, button) {
    if (fieldId !== expectedFieldId || reloadRequired) return;
    if (item.timestamp && Date.now() - item.timestamp > (item.lifetimeSeconds ?? 180) * 1000) {
      showPanel('CodeSnap', t('inlineExpired', 'Code expired. Search again.')); return;
    }
    button.disabled = true;
    try {
      let selected = item;
      if (Number.isInteger(item.index)) {
        selected = await chrome.runtime.sendMessage({ type: 'SELECT_INLINE_CANDIDATE', origin: location.origin, sessionId: item.sessionId, index: item.index });
        if (fieldId !== expectedFieldId) return;
        if (selected.status !== 'found') { showPanel('CodeSnap', selected.message ?? 'Search again.'); return; }
      }
      const result = await chrome.runtime.sendMessage({ type: 'INSERT_INLINE', origin: location.origin, sessionId: selected.sessionId });
      if (fieldId !== expectedFieldId) return;
      if (result.status === 'inserted') {
        completedFieldId = fieldId; code = null; link = null; sessionId = null; review = null; choices = null; codeDetails = null;
        stopChipExpiryTimer(); closePanel(); chip.textContent = '✓'; chip.title = 'Code inserted';
      } else showPanel(t('inlineFailed', 'Could not insert'), result.message ?? 'Try searching again.');
    } catch (error) {
      if (contextInvalidated(error)) showReloadRequired();
      else showPanel(t('inlineFailed', 'Could not insert'), 'Could not reach CodeSnap. Try again.');
    } finally { button.disabled = false; }
  }

  function showCodePanel() {
    const items = choices?.candidates?.map(item => ({ ...item, sessionId: choices.sessionId })) ?? (review ? [review] : codeDetails ? [codeDetails] : []);
    const hasTotp = totpDetails?.status === 'found' && siteHasTotpHint();
    if ((!items.length && !hasTotp) || !fieldId) return;
    const expectedFieldId = fieldId;
    showPanel('CodeSnap', choices ? t('inlineChoose', 'Choose the email you requested') : '');
    panel.dataset.kind = 'codes';
    panel.style.width = '328px';
    const root = panel.shadowRoot;
    const box = root.firstElementChild;
    const muteFooter = box.querySelector(':scope > div:last-child');
    muteFooter?.remove();
    const label = box.firstElementChild.firstElementChild;
    const mark = document.createElement('span'); mark.textContent = 'ϟ';
    mark.style.cssText = 'display:inline-grid;place-items:center;width:21px;height:21px;margin-right:7px;border-radius:6px;background:linear-gradient(145deg,#9ab8ff,#6b71f3);color:white;font:800 19px/1 system-ui;vertical-align:middle';
    label.prepend(mark);
    const dark = isDarkTheme();
    const style = document.createElement('style');
    style.textContent = `.code-row{display:flex;align-items:center;gap:10px;margin:12px -13px 0;padding:13px;border-top:1px solid ${dark ? '#334066' : '#e5eaf4'};border-left:3px solid transparent}.code-row:first-of-type{border-left-color:#7387f4}.code-info{flex:1;min-width:0}.digits{font:800 23px/1.25 system-ui;letter-spacing:1.5px;font-variant-numeric:tabular-nums;color:${dark ? '#f2f4ff' : '#263752'}}.link-title{font:700 13px/1.35 system-ui;color:${dark ? '#f2f4ff' : '#263752'};overflow-wrap:anywhere}.latest{display:inline-block;margin-left:7px;color:${dark ? '#a6b3ff' : '#5369e8'};font:800 9px system-ui;letter-spacing:.7px;vertical-align:middle}.timer-badge{display:inline-block;margin-left:6px;padding:1px 6px;border-radius:999px;background:${dark ? '#233052' : '#edf1ff'};color:${dark ? '#b6c3ef' : '#4056c5'};font:700 10px system-ui;font-variant-numeric:tabular-nums}.timer-badge.expired{background:${dark ? '#49252d' : '#ffecef'};color:${dark ? '#ff9eaa' : '#b42336'}}.meta{margin-top:4px;color:${dark ? '#a5b4d4' : '#738096'};font-size:11px;overflow-wrap:anywhere}.row-actions{display:flex;flex-direction:column;gap:5px;flex:none}.fill{flex:none;padding:8px 12px;border:1px solid ${dark ? '#52629b' : '#c8d1f4'};border-radius:8px;background:${dark ? '#263354' : '#edf1ff'};color:${dark ? '#e8ebff' : '#4056c5'};font:700 12px system-ui;cursor:pointer}.fill:disabled{opacity:.5;cursor:wait}.fill:focus-visible{outline:2px solid #7387f4;outline-offset:2px}.link-mini{padding:5px 8px;border:1px solid ${dark ? '#43517d' : '#d6def8'};border-radius:7px;background:transparent;color:${dark ? '#b6c3ef' : '#4a5ec9'};font:650 11px system-ui;cursor:pointer}.warning{color:${dark ? '#ffc978' : '#8b5418'};font-size:11px;margin-top:6px}.totp-box{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:10px 0 0;padding:10px 11px;border:1px solid ${dark ? '#3a4b7d' : '#d4ddfb'};border-radius:10px;background:${dark ? '#1c2542' : '#f4f7ff'}}.totp-live{font:800 18px/1.2 system-ui;letter-spacing:1.2px;font-variant-numeric:tabular-nums}.dual-cta{display:block;width:100%;margin-top:10px;padding:9px 11px;border:0;border-radius:9px;background:linear-gradient(135deg,#5b6ef5,#6d55e8);color:#fff;font:700 12px system-ui;cursor:pointer}`;
    root.append(style);

    if (hasTotp) {
      if (code && sessionId && detector.detect2FA?.(document)) {
        const dualBtn = document.createElement('button');
        dualBtn.type = 'button';
        dualBtn.className = 'dual-cta';
        dualBtn.textContent = t('dualFillAction', '⚡ Insert both codes (Email + 2FA)');
        dualBtn.addEventListener('click', event => { if (event.isTrusted) void insertDualInline(expectedFieldId); });
        box.append(dualBtn);
      }
      const totpBox = document.createElement('div');
      totpBox.className = 'totp-box';
      const tInfo = document.createElement('div');
      const tDigits = document.createElement('div');
      tDigits.className = 'totp-live';
      tDigits.textContent = `${totpDetails.code.replace(/^(.{3})(.{3})$/, '$1 $2')} · ${totpDetails.remainingSeconds}s`;
      const tMeta = document.createElement('div');
      tMeta.className = 'meta';
      tMeta.textContent = `2FA · ${totpDetails.issuer}${totpDetails.account ? ` (${totpDetails.account})` : ''}`;
      tInfo.append(tDigits, tMeta);
      const tBtn = document.createElement('button');
      tBtn.type = 'button';
      tBtn.className = 'fill';
      tBtn.textContent = t('inlineFill', 'Fill');
      tBtn.addEventListener('click', event => { if (event.isTrusted) void insertTotpInline(expectedFieldId); });
      totpBox.append(tInfo, tBtn);
      box.append(totpBox);
    }

    const newest = items.length ? Math.max(...items.map(item => item.timestamp || 0)) : 0;
    const providerNames = { gmail: 'Gmail', outlook: 'Outlook', yahoo: 'Yahoo', yandex: 'Яндекс', mailru: 'Mail.ru', proton: 'Proton', icloud: 'iCloud', zoho: 'Zoho', rambler: 'Rambler', fastmail: 'Fastmail', aol: 'AOL', gmx: 'GMX' };
    const rowTimers = [];
    for (const item of items.slice(0, 5)) {
      const row = document.createElement('div'); row.className = 'code-row';
      if (item.timestamp === newest) row.style.borderLeftColor = '#7387f4';
      const info = document.createElement('div'); info.className = 'code-info';
      const heading = document.createElement('div');
      if (item.code) {
        heading.className = 'digits';
        heading.append(document.createTextNode(item.code.replace(/^(.{3})(.{3})$/, '$1 $2')));
      } else if (item.link) {
        heading.className = 'link-title';
        heading.append(document.createTextNode(`🔗 ${item.link.label || item.link.host}`));
      }
      if (item.timestamp === newest) {
        const badge = document.createElement('span'); badge.className = 'latest'; badge.textContent = t('inlineLatest', 'LATEST'); heading.append(badge);
      }
      const lifeSec = item.lifetimeSeconds ?? (item.code ? 180 : 600);
      const remSec = item.timestamp ? Math.max(0, Math.ceil((item.timestamp + lifeSec * 1000 - Date.now()) / 1000)) : lifeSec;
      const timerBadge = document.createElement('span');
      timerBadge.className = remSec <= 0 ? 'timer-badge expired' : 'timer-badge';
      timerBadge.textContent = remSec <= 0 ? t('inlineExpiredShort', 'Expired') : `⏱ ${formatMMSS(remSec)}`;

      const age = Math.max(0, Math.floor((Date.now() - (item.timestamp || Date.now())) / 1000));
      const meta = document.createElement('div'); meta.className = 'meta';
      const providerName = providerNames[item.accountProvider] ?? 'Gmail';
      meta.append(document.createTextNode(`${item.from || location.hostname} · ${providerName} · ${age < 60 ? t('inlineJustNow', 'just now') : `${Math.floor(age / 60)} ${t('inlineMinutesAgo', 'min ago')}`}`), timerBadge);
      info.append(heading, meta);
      if (item.link && !item.code) {
        const hostMeta = document.createElement('div'); hostMeta.className = 'meta'; hostMeta.textContent = item.link.host; info.append(hostMeta);
      }
      if (item.accountEmail) { const account = document.createElement('div'); account.className = 'meta'; account.textContent = item.accountEmail; info.append(account); }
      if (item.requiresReview || review) { const warning = document.createElement('div'); warning.className = 'warning'; warning.textContent = `${t('inlineReview', 'Check sender and subject before inserting')}: ${item.subject || '—'}`; info.append(warning); }
      const actions = document.createElement('div'); actions.className = 'row-actions';
      const expired = remSec <= 0;
      const rowButtons = [];
      if (item.code) {
        const button = document.createElement('button'); button.type = 'button'; button.className = 'fill'; button.textContent = t('inlineFill', 'Fill');
        button.disabled = expired;
        button.addEventListener('click', event => { if (event.isTrusted) void insertDetailed(item, expectedFieldId, button); });
        actions.append(button);
        rowButtons.push(button);
        if (item.link?.url) {
          const linkBtn = document.createElement('button'); linkBtn.type = 'button'; linkBtn.className = 'link-mini';
          linkBtn.textContent = `🔗 ${t('inlineOpenShort', 'Link')} ↗`;
          linkBtn.title = `${item.link.label} (${item.link.host})`;
          linkBtn.disabled = expired;
          linkBtn.addEventListener('click', event => { if (event.isTrusted) void openInlineLink(item, expectedFieldId, linkBtn); });
          actions.append(linkBtn);
          rowButtons.push(linkBtn);
        }
      } else if (item.link?.url) {
        const button = document.createElement('button'); button.type = 'button'; button.className = 'fill'; button.textContent = `${t('inlineOpenLink', 'Open')} ↗`;
        button.disabled = expired;
        button.addEventListener('click', event => { if (event.isTrusted) void openInlineLink(item, expectedFieldId, button); });
        actions.append(button);
        rowButtons.push(button);
      }
      if (item.timestamp) rowTimers.push({ item, lifeSec, timerBadge, rowButtons });
      row.append(info, actions); box.append(row);
    }

    if (rowTimers.length) {
      panelTimer = safeInterval(() => {
        if (!panel || !panel.isConnected) { stopPanelTimer(); return; }
        let anyAlive = false;
        for (const entry of rowTimers) {
          const left = Math.max(0, Math.ceil((entry.item.timestamp + entry.lifeSec * 1000 - Date.now()) / 1000));
          if (left <= 0) {
            entry.timerBadge.textContent = t('inlineExpiredShort', 'Expired');
            entry.timerBadge.className = 'timer-badge expired';
            for (const btn of entry.rowButtons) btn.disabled = true;
          } else {
            anyAlive = true;
            entry.timerBadge.textContent = `⏱ ${formatMMSS(left)}`;
          }
        }
        if (!anyAlive) stopPanelTimer();
      }, 1000);
    }
    appendMuteFooter(box, dark);
    positionPanel();
  }

  function positionPanel() {
    if (!panel || !field?.anchor?.isConnected) return;
    const rect = field.anchor.getBoundingClientRect();
    const width = panel.offsetWidth || (panel.dataset.kind === 'codes' ? 320 : 256);
    const height = panel.offsetHeight || 160;
    panel.style.left = `${Math.max(8, Math.min(innerWidth - width - 8, rect.right - width))}px`;
    panel.style.top = `${rect.bottom + height + 8 < innerHeight ? rect.bottom + 7 : Math.max(8, rect.top - height - 7)}px`;
    panel.style.maxHeight = 'calc(100vh - 16px)'; panel.style.overflowY = 'auto';
  }

  async function timedSearch(payload) {
    let timer;
    try {
      return await Promise.race([
        chrome.runtime.sendMessage(payload),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('SEARCH_TIMEOUT')), 12000); })
      ]);
    } finally { clearTimeout(timer); }
  }

  async function watch(expectedFieldId, automatic = false) {
    if (reloadRequired || isOriginMuted()) return;
    if (field?.channel === 'authenticator') {
      if (siteHasTotpHint()) await refreshInlineTotp(expectedFieldId);
      return;
    }
    if (searching || !chip || !field || field.channel === 'sms') return;
    if (!automatic && completedFieldId === expectedFieldId) {
      completedFieldId = null;
      fieldId = expectedFieldId = crypto.randomUUID();
      detectedAt = Date.now();
      code = null; link = null; webmailHint = null; sessionId = null; codeDetails = null; choices = null; stopChipExpiryTimer(); closePanel();
    }
    searching = true;
    searchMode = automatic ? 'auto' : 'manual';
    const generation = ++watchGeneration;
    chip.textContent = 'Finding…'; chip.title = 'Checking mail. Click to search now.';
    if (siteHasTotpHint() && detector.detect2FA?.(document)) void refreshInlineTotp(expectedFieldId);
    const searchDelays = automatic ? delays : [0, 2000, 3000, 4000];
    try {
      for (const delay of searchDelays) {
        if (delay) await new Promise(resolve => setTimeout(resolve, delay));
        if (!document.defaultView || generation !== watchGeneration || fieldId !== expectedFieldId || !field?.anchor?.isConnected || isOriginMuted()) return;
        const result = await timedSearch({ type: 'SEARCH_INLINE', origin: location.origin, fieldId, detectedAt, channel: field.channel, automatic, siteContext: context() });
        if (!document.defaultView || generation !== watchGeneration || fieldId !== expectedFieldId) return;
        if (result.status === 'found') {
          code = result.code ?? null; link = result.link ?? null; sessionId = result.sessionId;
          codeDetails = result; choices = null; webmailHint = null;
          updateChipDisplay();
          startChipExpiryTimer();
          if (detailedPopup) showCodePanel();
          return;
        }
        if (result.status === 'review') {
          codeDetails = null; choices = null; webmailHint = null; stopChipExpiryTimer();
          review = { ...result, fieldId };
          chip.textContent = 'Review';
          chip.title = result.code
            ? `Code from ${result.from ?? 'another sender'}. Click to check it.`
            : `Link from ${result.from ?? 'another sender'}. Click to check it.`;
          if (detailedPopup) showCodePanel();
          return;
        }
        if (result.status === 'ambiguous') {
          code = null; link = null; webmailHint = null; sessionId = null; review = null; codeDetails = null; stopChipExpiryTimer(); choices = result;
          chip.textContent = t('inlineChooseShort', 'Choose'); chip.title = result.message;
          if (detailedPopup) showCodePanel();
          return;
        }
        if (result.status === 'webmail_unread') {
          code = null; link = null; sessionId = null; review = null; codeDetails = null; choices = null; stopChipExpiryTimer();
          webmailHint = result;
          chip.textContent = '✉ Mail'; chip.title = result.message;
          return;
        }
        if (result.status !== 'none' && result.status !== 'old') {
          notice = result.message ?? 'Open CodeSnap from the toolbar.';
          chip.textContent = 'Info'; chip.title = notice;
          return;
        }
      }
      chip.textContent = 'Retry'; chip.title = 'No recent email code or link. Click to search again.';
    } catch (error) {
      if (generation === watchGeneration && chip) {
        if (contextInvalidated(error)) showReloadRequired();
        else {
          notice = error.message === 'SEARCH_TIMEOUT' ? 'Mail search took too long. Click Retry to try again.' : 'Mail search failed. Click Retry to try again.';
          chip.textContent = 'Retry'; chip.title = notice;
        }
      }
    }
    finally { if (generation === watchGeneration) { searching = false; searchMode = null; position(); } }
  }

  function sameField(a, b) {
    return a?.type === b?.type && a?.channel === b?.channel && a?.inputs.length === b?.inputs.length && a?.inputs.every((input, i) => input === b.inputs[i]) && (a?.type !== 'link-prompt' || a?.anchor === b?.anchor);
  }

  function context() {
    const meta = document.querySelector('meta[property="og:site_name"],meta[name="application-name"]');
    const bodySnippet = `${field?.context ?? ''} ${document.body?.textContent?.slice(0, 1200) ?? ''}`;
    const maskedMatch = /\b[a-z0-9][a-z0-9._-]{0,12}[*•·]{1,10}[a-z0-9._-]{0,12}@[a-z0-9*•·.-]+\.[a-z]{2,}\b/i.exec(bodySnippet);
    return {
      hostname: location.hostname,
      title: String(document.title ?? '').slice(0, 120),
      siteName: String(meta?.content ?? '').slice(0, 80),
      verificationText: String(field?.context ?? '').slice(0, 180),
      expectedLength: field?.expectedLength ?? null,
      hasCodeField: Boolean(field && field.type !== 'link-prompt'),
      prefer: field?.type === 'link-prompt' ? 'link' : 'code',
      maskedEmail: maskedMatch?.[0] ?? null
    };
  }

  function clearPadding() {
    if (paddedInput) paddedInput.style.paddingRight = originalPadding;
    paddedInput = null; originalPadding = '';
  }

  function position() {
    if (!chip || !field?.anchor?.isConnected) return;
    const rect = field.anchor.getBoundingClientRect();
    const dark = isDarkTheme();
    chip.style.background = dark ? 'rgba(21,28,48,.92)' : 'rgba(255,255,255,.88)';
    chip.style.color = dark ? '#e8ebff' : '#3449be';
    chip.style.borderColor = dark ? 'rgba(99,122,230,.5)' : 'rgba(113,130,181,.35)';
    chip.style.boxShadow = dark ? '0 4px 18px rgba(0,0,0,.6)' : '0 4px 18px #14245536';
    const rightControl = [...(field.anchor.parentElement?.querySelectorAll('button,[role="button"]') ?? [])].some(control => {
      if (control === chip) return false;
      const controlRect = control.getBoundingClientRect();
      return controlRect.width > 0 && controlRect.left < rect.right && controlRect.right > rect.right - 65 &&
        controlRect.bottom > rect.top && controlRect.top < rect.bottom;
    });
    const inside = field.type === 'single' && field.anchor.tagName === 'INPUT' &&
      !rightControl && rect.width >= 150 && rect.height >= 28 && rect.right <= innerWidth && rect.left >= 0 &&
      getComputedStyle(field.anchor).direction !== 'rtl';
    if (inside) {
      if (paddedInput !== field.anchor) {
        clearPadding(); paddedInput = field.anchor; originalPadding = paddedInput.style.paddingRight;
      }
      const current = parseFloat(getComputedStyle(paddedInput).paddingRight) || 0;
      const needed = chip.offsetWidth + 13;
      if (current < needed) paddedInput.style.paddingRight = `${needed}px`;
      chip.style.left = `${Math.max(4, rect.right - chip.offsetWidth - 5)}px`;
      chip.style.top = `${Math.max(0, rect.top + (rect.height - chip.offsetHeight) / 2)}px`;
    } else {
      clearPadding();
      chip.style.left = `${Math.max(4, Math.min(innerWidth - chip.offsetWidth - 4, rect.right + 4))}px`;
      chip.style.top = `${Math.max(0, rect.top)}px`;
    }
    positionPanel();
  }

  function paint() {
    observeRoots();
    if (isOriginMuted()) {
      watchGeneration++; searching = false;
      stopTotpTimer(); stopChipExpiryTimer();
      field = null; fieldId = null; detectedAt = null; code = null; link = null; webmailHint = null; sessionId = null; review = null; notice = null; codeDetails = null; choices = null; totpDetails = null; closePanel();
      chip?.remove(); chip = null; clearPadding();
      return;
    }
    const allow2faHere = siteHasTotpHint();
    const found = detector.detect(document, { allow2fa: allow2faHere }) ?? detector.detectLinkPrompt?.(document) ?? null;
    if (!found) {
      watchGeneration++; searching = false;
      stopTotpTimer(); stopChipExpiryTimer();
      field = null; fieldId = null; detectedAt = null; code = null; link = null; webmailHint = null; sessionId = null; review = null; notice = null; codeDetails = null; choices = null; totpDetails = null; closePanel();
      chip?.remove(); chip = null; clearPadding();
      return;
    }
    if (!sameField(field, found)) {
      watchGeneration++; searching = false;
      stopTotpTimer(); stopChipExpiryTimer();
      closePanel(); review = null; notice = null; codeDetails = null; choices = null; totpDetails = null;
      field = found;
      fieldId = crypto.randomUUID();
      detectedAt = requestedAt && Date.now() - requestedAt < 300_000 ? requestedAt : Date.now();
      completedFieldId = null;
      code = null; link = null; webmailHint = null; sessionId = null;
      if (chip) { chip.textContent = '⚡'; chip.title = 'Click to find code'; }
    } else field = found;
    if ((field.channel === 'authenticator' && !allow2faHere) || field.channel === 'sms') {
      stopTotpTimer();
      closePanel(); review = null;
      chip?.remove(); chip = null; clearPadding();
      return;
    }
    if (!chip) {
      chip = document.createElement('button');
      chip.type = 'button';
      chip.setAttribute('aria-label', 'Find verification code');
      chip.style.cssText = 'position:fixed;z-index:2147483646;min-width:28px;min-height:27px;padding:4px 8px;border:1px solid rgba(113,130,181,.35);border-radius:999px;backdrop-filter:blur(12px);background:rgba(255,255,255,.88);color:#3449be;font:750 12px system-ui,sans-serif;font-variant-numeric:tabular-nums;letter-spacing:.8px;cursor:pointer;box-shadow:0 4px 18px #14245536;transition:opacity .18s,transform .18s,background .18s';
      chip.textContent = '⚡';
      chip.title = 'Click to find code';
      chip.addEventListener('click', async event => {
        if (!event.isTrusted) return;
        event.preventDefault(); event.stopPropagation();
        if (reloadRequired) { location.reload(); return; }
        const currentFieldId = fieldId;
        if (choices || (detailedPopup && (codeDetails || review || totpDetails?.status === 'found'))) { showCodePanel(); return; }
        if (review) { showReview(); return; }
        if (field?.channel === 'authenticator') {
          if (totpDetails?.status === 'found') { await insertTotpInline(currentFieldId); return; }
          if (totpDetails?.status === 'locked') {
            showPanel('CodeSnap 2FA', 'Хранилище 2FA заблокировано. Нажмите на иконку CodeSnap в панели браузера и введите PIN.');
            return;
          }
          await refreshInlineTotp(currentFieldId);
          return;
        }
        if (code && sessionId && totpDetails?.status === 'found' && detector.detect2FA?.(document) && siteHasTotpHint()) {
          await insertDualInline(currentFieldId);
          return;
        }
        if (webmailHint && !code && !link) {
          const hint = webmailHint;
          showPanel('Новое письмо в почте', `От: ${hint.from || 'почта'}. Тема: ${hint.subject || 'подтверждение'}. Откройте вкладку почты, чтобы CodeSnap прочитал код или ссылку.`, {
            label: 'Открыть вкладку почты ↗',
            run: async clickEvent => {
              if (!clickEvent.isTrusted) return;
              await chrome.runtime.sendMessage({ type: 'FOCUS_WEBMAIL', origin: location.origin, webmailTabId: hint.webmailTabId }).catch(() => {});
              closePanel();
            }
          });
          return;
        }
        if (!code && link && sessionId) {
          if (!codeDetails) codeDetails = { status: 'found', code: null, link, sessionId, timestamp: Date.now(), from: location.hostname };
          showCodePanel();
          return;
        }
        if (code && sessionId) {
          let result;
          try { result = await chrome.runtime.sendMessage({ type: 'INSERT_INLINE', origin: location.origin, sessionId }); }
          catch (error) {
            if (contextInvalidated(error)) showReloadRequired();
            else { chip.textContent = 'Retry'; chip.title = 'Could not reach CodeSnap. Try again.'; }
            return;
          }
          if (result.status === 'inserted') {
            completedFieldId = fieldId; code = null; link = null; sessionId = null; codeDetails = null; choices = null; stopChipExpiryTimer(); closePanel();
            chip.textContent = '✓'; chip.title = 'Code inserted';
          } else {
            try {
              await navigator.clipboard.writeText(code);
              chrome.runtime.sendMessage({ type: 'CLIPBOARD_COPIED' }).catch(() => {});
              chip.textContent = 'Copied'; chip.title = 'Insertion failed; code copied instead.';
            } catch {
              const res = await chrome.runtime.sendMessage({ type: 'COPY_CLIPBOARD', text: code }).catch(() => null);
              if (res?.status === 'copied') { chip.textContent = 'Copied'; chip.title = 'Insertion failed; code copied instead.'; }
              else { chip.textContent = 'Retry'; chip.title = result.message ?? 'Could not insert code'; }
            }
          }
          return;
        }
        if (searching && searchMode === 'manual') { showPanel('Searching mail', 'Still checking for a recent code.'); return; }
        if (searching) { watchGeneration++; searching = false; searchMode = null; }
        if (notice && chip.textContent === 'Info') {
          const message = notice; notice = null;
          showPanel('CodeSnap', message, { label: 'Try again', run: () => { closePanel(); void watch(currentFieldId, false); } });
          return;
        }
        void watch(currentFieldId, false);
      });
      document.documentElement.append(chip);
    }
    position();
    if (reloadRequired) { chip.textContent = 'Reload'; chip.title = reloadMessage; return; }
    if (field.channel === 'authenticator' && allow2faHere && !totpDetails && !totpFetching && completedFieldId !== fieldId) {
      void refreshInlineTotp(fieldId);
      return;
    }
    if (autoWatch && (field.channel === 'email' || field.channel === 'unknown') && !code && !link && !webmailHint && !searching && fieldId && completedFieldId !== fieldId && chip.textContent === '⚡') {
      void watch(fieldId, true);
    }
  }

  function collectVisualQrDataUrls() {
    const urls = [];
    const seen = new Set();
    const pushUrl = url => {
      if (!url || seen.has(url) || urls.length >= 8) return;
      seen.add(url);
      urls.push(url);
    };

    for (const root of detector.roots(document)) {
      for (const svg of root.querySelectorAll?.('svg') ?? []) {
        const rect = svg.getBoundingClientRect?.() ?? { width: 0, height: 0 };
        const hasQrSize = (rect.width >= 48 && rect.height >= 48 && rect.width <= 700 && rect.height <= 700) ||
          /\bviewBox=/i.test(svg.outerHTML ?? '');
        if (!hasQrSize) continue;
        if ((svg.querySelectorAll?.('rect, path, polygon, use')?.length ?? 0) < 2) continue;
        try {
          const clone = svg.cloneNode(true);
          clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
          const dim = Math.max(240, Math.min(600, Math.round(rect.width || 240)));
          if (!clone.getAttribute('width')) clone.setAttribute('width', String(dim));
          if (!clone.getAttribute('height')) clone.setAttribute('height', String(dim));
          const serialized = typeof XMLSerializer === 'function' ? new XMLSerializer().serializeToString(clone) : clone.outerHTML;
          if (serialized && serialized.length < 400_000) {
            pushUrl(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(serialized)}`);
          }
        } catch { /* Ignore non-serializable SVG. */ }
      }

      for (const canvas of root.querySelectorAll?.('canvas') ?? []) {
        if (canvas.width < 48 || canvas.height < 48 || canvas.width > 900) continue;
        try { pushUrl(canvas.toDataURL('image/png')); } catch { /* Ignore tainted canvas. */ }
      }

      for (const img of root.querySelectorAll?.('img') ?? []) {
        const src = img.currentSrc || img.getAttribute?.('src') || '';
        if (src.startsWith('data:image/')) {
          pushUrl(src);
          continue;
        }
        if (img.complete && img.naturalWidth >= 48 && img.naturalWidth <= 900 && img.naturalHeight >= 48) {
          try {
            const c = document.createElement('canvas');
            c.width = img.naturalWidth;
            c.height = img.naturalHeight;
            c.getContext('2d')?.drawImage(img, 0, 0);
            pushUrl(c.toDataURL('image/png'));
          } catch { /* Cross-origin image without CORS — covered by captureVisibleTab. */ }
        }
      }
    }
    return urls;
  }

  async function scanPageTotp() {
    for (const root of detector.roots(document)) {
      const otpLink = root.querySelector?.('a[href^="otpauth://" i], a[href^="otpauth-migration://" i]');
      if (otpLink) {
        return { status: 'found', uri: otpLink.getAttribute('href'), source: 'link' };
      }
    }

    if (typeof globalThis.BarcodeDetector === 'function') {
      try {
        const bd = new globalThis.BarcodeDetector({ formats: ['qr_code'] });
        const visuals = detector.roots(document)
          .flatMap(root => [...(root.querySelectorAll?.('img, canvas') ?? [])])
          .filter(el => el.tagName !== 'IMG' || (el.complete && el.naturalWidth > 0))
          .slice(0, 12);
        for (const el of visuals) {
          try {
            const found = await bd.detect(el);
            const raw = found?.[0]?.rawValue;
            if (raw && /^otpauth(?:-migration)?:\/\//i.test(raw)) {
              return { status: 'found', uri: raw, source: 'qr' };
            }
          } catch { /* Tainted or undecodable visual element. */ }
        }
      } catch { /* BarcodeDetector unavailable in current runtime. */ }
    }

    const setupKeywords = /(?:secret|setup\s*key|manual|can'?t\s*scan|authenticator|totp|2fa|ключ|секрет|вручную|настройк|qr)/i;
    const base32Re = /(?:^|[^A-Za-z0-9])([A-Za-z2-7]{4}(?:[\s-][A-Za-z2-7]{4}){3,15}|[A-Za-z2-7]{16,64})(?=$|[^A-Za-z0-9])/;
    for (const root of detector.roots(document)) {
      const candidates = root.querySelectorAll?.('code, kbd, pre, input[readonly], [data-clipboard-text], [data-secret], [data-key], [class*="secret" i], [class*="setup" i], span, p, div') ?? [];
      for (const el of candidates) {
        const rawVal = el.tagName === 'INPUT'
          ? (el.value ?? '')
          : (el.getAttribute?.('data-secret') || el.getAttribute?.('data-key') || el.getAttribute?.('data-clipboard-text') || el.textContent || '');
        const trimmed = rawVal.trim();
        if (!trimmed || trimmed.length > 260) continue;
        const containerText = `${el.parentElement?.textContent ?? ''} ${trimmed}`;
        const strictCodeEl = el.matches?.('code, kbd, pre, input[readonly], [data-clipboard-text], [data-secret], [data-key], [class*="secret" i], [class*="setup" i]');
        if (!strictCodeEl && !setupKeywords.test(containerText)) continue;
        const m = base32Re.exec(trimmed);
        if (!m) continue;
        const token = m[1];
        const compact = token.replace(/[\s-]+/g, '').toUpperCase();
        if (compact.length < 16 || compact.length > 64) continue;
        if (!/[2-7]/.test(compact) && token !== token.toUpperCase() && !strictCodeEl) continue;
        return {
          status: 'found',
          secret: compact,
          issuer: (document.title?.split(/[|—–-]/)[0] || location.hostname).trim(),
          domain: location.hostname,
          source: 'text'
        };
      }
    }
    return {
      status: 'none',
      visualDataUrls: collectVisualQrDataUrls(),
      message: 'На открытой странице не найден QR-код 2FA или текстовый секретный ключ.'
    };
  }

  async function forceInsertIntoActiveElement(value) {
    let active = document.activeElement;
    while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
    if (!active || active.disabled || active.readOnly || active.isConnected === false) return false;

    const allGroups = detector.detectAll?.(document, { allow2fa: true }) ?? [];
    const matchingGroup = allGroups.find(c => c.inputs?.includes(active));
    if (matchingGroup) {
      return detector.insert(matchingGroup, value);
    }
    if (active.tagName === 'INPUT' && /^(?:text|tel|number|password|search|email)$/i.test(active.type || 'text')) {
      return detector.insert({ type: 'group' === active ? 'group' : 'single', inputs: [active], anchor: active }, value);
    }
    if (active.tagName === 'TEXTAREA') {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
      if (!setter) return false;
      active.focus();
      setter.call(active, value);
      active.dispatchEvent(new Event('input', { bubbles: true }));
      active.dispatchEvent(new Event('change', { bubbles: true }));
      return active.value === value;
    }
    if (active.isContentEditable || active.getAttribute?.('contenteditable') === 'true' || active.getAttribute?.('contenteditable') === '') {
      active.focus();
      active.textContent = value;
      active.dispatchEvent(new Event('input', { bubbles: true }));
      active.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }
    return false;
  }

  chrome.runtime.onMessage.addListener((request, _sender, respond) => {
    if (request.type === 'CODE_FOUND') {
      if (request.fieldId && request.fieldId !== fieldId) { respond?.({ status: 'changed' }); return; }
      watchGeneration++; searching = false; searchMode = null;
      codeDetails = request; choices = null; webmailHint = null;
      if (request.requiresReview) {
        review = { ...request, fieldId: request.fieldId || fieldId };
        code = null; link = null; sessionId = null;
        if (chip) { chip.textContent = 'Review'; chip.title = `From ${request.from ?? 'another sender'}. Click to check it.`; }
      } else {
        code = request.code ?? null; link = request.link ?? null; sessionId = request.sessionId; review = null;
        updateChipDisplay();
      }
      startChipExpiryTimer();
      position();
      if (detailedPopup) showCodePanel();
      respond?.({ status: 'ok' });
      return;
    }
    if (request.type === 'WEBMAIL_UNREAD_PUSH') {
      if (request.fieldId && request.fieldId !== fieldId) { respond?.({ status: 'ignored' }); return; }
      if (!code && !link) {
        watchGeneration++; searching = false; searchMode = null;
        webmailHint = request;
        if (chip) { chip.textContent = '✉ Mail'; chip.title = request.message; }
        position();
      }
      respond?.({ status: 'ok' });
      return;
    }
    if (request.type === 'FIELD_STATUS') {
      paint();
      const rawEmail = detector.detect(document, { allow2fa: false });
      const raw2fa = detector.detect2FA?.(document) ?? null;
      const isDualField = Boolean(rawEmail && (rawEmail.channel === 'email' || rawEmail.channel === 'unknown') && raw2fa && raw2fa.channel === 'authenticator');
      const statusField = field ?? (isOriginMuted() ? (detector.detect(document, { allow2fa: siteHasTotpHint() }) ?? detector.detectLinkPrompt?.(document) ?? null) : null);
      respond({
        origin: location.origin,
        muted: isOriginMuted(),
        detected: Boolean(statusField),
        fieldType: statusField?.type ?? null,
        fieldId,
        detectedAt,
        siteContext: context(),
        type: statusField?.type ?? null,
        channel: statusField?.channel ?? null,
        subchannel: statusField?.subchannel ?? null,
        providerHint: statusField?.providerHint ?? null,
        confidence: statusField?.confidence ?? null,
        has2faField: Boolean(raw2fa),
        isDualField
      });
      return;
    }
    if (request.type === 'SHOW_INLINE_TOAST') {
      if (request.text) showToast(request.text);
      respond?.({ status: 'ok' });
      return;
    }
    if (request.type === 'SCAN_PAGE_TOTP') {
      void scanPageTotp().then(respond, () => respond({ status: 'none' }));
      return true;
    }
    if (request.type === 'FORCE_INSERT_ACTIVE') {
      if (request.origin && request.origin !== location.origin) { respond({ status: 'changed' }); return; }
      void forceInsertIntoActiveElement(request.code).then(ok => respond({ status: ok ? 'inserted' : 'no_active_input' }));
      return true;
    }
    if (request.type === 'INSERT_TOTP') {
      if (request.origin && request.origin !== location.origin) { respond({ status: 'changed' }); return; }
      const target2fa = detector.detect2FA?.(document) ?? detector.detect(document, { allow2fa: true });
      if (!target2fa) { respond({ status: 'missing', message: '2FA field not found.' }); return; }
      void detector.insert(target2fa, request.code).then(inserted => {
        if (inserted) {
          completedFieldId = fieldId;
          stopTotpTimer();
          closePanel();
          if (chip) { chip.textContent = '✓'; chip.title = '2FA code inserted'; }
        }
        respond(inserted ? { status: 'inserted' } : { status: 'missing', message: 'The website did not retain the 2FA code.' });
      }).catch(() => respond({ status: 'missing', message: 'The website rejected 2FA insertion.' }));
      return true;
    }
    if (request.type === 'INSERT_DUAL') {
      if (request.origin !== location.origin || (request.fieldId && request.fieldId !== fieldId)) {
        respond({ status: 'changed', message: 'Verification field changed. Search again.' });
        return;
      }
      const all = detector.detectAll(document, { allow2fa: true });
      const emailTarget = all.find(c => c.channel === 'email' || c.channel === 'unknown') ?? null;
      const totpTarget = all.find(c => c.channel === 'authenticator') ?? null;
      (async () => {
        const emailOk = emailTarget && request.emailCode ? await detector.insert(emailTarget, request.emailCode) : false;
        const totpOk = totpTarget && request.totpCode ? await detector.insert(totpTarget, request.totpCode) : false;
        if (emailOk && totpOk) {
          completedFieldId = fieldId;
          code = null; link = null; sessionId = null; review = null; codeDetails = null; choices = null;
          stopChipExpiryTimer(); stopTotpTimer(); closePanel();
          if (chip) { chip.textContent = '✓✓'; chip.title = t('dualInserted', 'Both Email and 2FA codes inserted.'); }
          respond({ status: 'inserted_dual' });
        } else if (emailOk) {
          respond({ status: 'inserted_email_only', message: 'Email code inserted, but 2FA field failed.' });
        } else if (totpOk) {
          respond({ status: 'inserted_totp_only', message: '2FA code inserted, but email field failed.' });
        } else {
          respond({ status: 'missing', message: 'Could not insert into both fields.' });
        }
      })().catch(() => respond({ status: 'missing', message: 'Dual insertion failed.' }));
      return true;
    }
    if (request.type !== 'INSERT_CODE') return;
    if (request.origin !== location.origin || request.fieldId !== fieldId) {
      respond({ status: 'changed', message: 'Verification field changed. Search again.' });
      return;
    }
    const latest = detector.detect(document, { allow2fa: siteHasTotpHint() });
    if (!sameField(field, latest)) {
      paint();
      respond({ status: 'changed', message: 'Verification field changed. Search again.' });
      return;
    }
    void detector.insert(latest, request.code).then(inserted => {
      if (inserted) completedFieldId = request.fieldId;
      respond(inserted ? { status: 'inserted' } : { status: 'missing', message: 'The website did not retain the complete code. Try again.' });
      if (inserted) {
        code = null; link = null; sessionId = null; review = null; codeDetails = null; choices = null; stopChipExpiryTimer(); closePanel();
        if (chip) chip.textContent = '✓';
      }
    }).catch(() => respond({ status: 'missing', message: 'The website rejected code insertion.' }));
    return true;
  });

  const observer = new MutationObserver(records => {
    const relevant = records.some(record => {
      const target = record.target.nodeType === 1 ? record.target : record.target.parentElement;
      if (target === chip || target?.closest?.('#codesnap-inline-panel') || target?.getRootNode?.().host?.id === 'codesnap-inline-panel' || target?.id === 'codesnap-toast') return false;
      return record.type === 'attributes' || record.type === 'characterData' || [...record.addedNodes, ...record.removedNodes].some(node =>
        node.nodeType === 1 && node.id !== 'codesnap-inline-panel' && node.id !== 'codesnap-toast' && (node.matches?.('input,label,fieldset,[role="group"],[role="dialog"],dialog,[class*="verify" i],[class*="confirm" i]') || node.querySelector?.('input,label,fieldset,[role="group"],[role="dialog"],dialog') || node.shadowRoot));
    });
    if (!relevant) return;
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(paint, 120);
  });
  function observeRoots() {
    for (const root of detector.roots(document)) {
      const target = root === document ? document.documentElement : root;
      if (observedRoots.has(target)) continue;
      observedRoots.add(target);
      observer.observe(target, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['placeholder', 'aria-label', 'aria-labelledby', 'aria-describedby', 'aria-hidden', 'maxlength', 'autocomplete', 'type', 'inputmode', 'pattern', 'disabled', 'readonly', 'hidden', 'inert', 'style', 'class', 'contenteditable'] });
    }
  }
  document.addEventListener('focusin', () => { clearTimeout(debounceTimer); debounceTimer = setTimeout(paint, 40); }, true);
  document.addEventListener('click', event => {
    if (!event.isTrusted) return;
    if (reloadRequired) return;
    const button = event.target?.closest?.('button,[role="button"],input[type="button"],input[type="submit"]');
    if (!button || button === chip) return;
    const label = `${button.textContent ?? ''} ${button.getAttribute('aria-label') ?? ''} ${button.value ?? ''}`.trim();
    if (!/(?:\b(?:send|resend|request|get)\b.*\b(?:code|link)\b|\bresend\b|получить.*(?:код|ссылк)|запросить.*(?:код|ссылк)|отправить.*(?:код|ссылк)|выслать.*(?:код|ссылк)|повторно.*(?:код|ссылк)|trimite.*cod|retrimit)/i.test(label)) return;
    const nearby = `${label} ${button.closest('form,section,[role="group"]')?.textContent ?? ''}`.slice(0, 450);
    if (/(?:\bsms\b|text message|authenticator|\btotp\b|смс|аутентификатор)/i.test(label) ||
      (!/(?:email|e-mail|mail|почт|courriel|[a-z0-9._%*+-]+@(?:[a-z0-9*.-]+\.)+[a-z*]{2,})/i.test(nearby) && field?.channel !== 'email' && field?.channel !== 'unknown')) return;
    requestedAt = Date.now();
    watchGeneration++; searching = false; stopChipExpiryTimer();
    code = null; link = null; webmailHint = null; sessionId = null; review = null; codeDetails = null; choices = null; closePanel();
    fieldId = crypto.randomUUID(); detectedAt = requestedAt; completedFieldId = null;
    if (chip) { chip.textContent = '⚡'; chip.title = 'Click to find code'; }
    clearTimeout(debounceTimer); debounceTimer = setTimeout(paint, 80);
  }, true);
  document.addEventListener('input', event => {
    if (reloadRequired) return;
    if (field?.inputs.includes(event.target) && !event.target.value) {
      stopChipExpiryTimer();
      code = null; link = null; webmailHint = null; sessionId = null; review = null; completedFieldId = null; codeDetails = null; choices = null; closePanel();
      if (chip && chip.textContent !== '⚡' && chip.textContent !== 'Finding…' && field?.channel !== 'authenticator') { chip.textContent = '⚡'; chip.title = 'Click to find code'; }
    }
  }, true);
  addEventListener('scroll', position, { passive: true });
  addEventListener('resize', position);
  document.addEventListener('keydown', event => { if (event.key === 'Escape') closePanel(); });
  document.addEventListener('pointerdown', event => { if (panel && !event.composedPath().includes(panel) && event.target !== chip) closePanel(); }, true);
  chrome.storage.local.get(['autoWatch', 'detailedPopup', 'totpEnabled', 'totpSiteHints', 'mutedOrigins']).then(settings => {
    detailedPopup = settings.detailedPopup === true;
    totpEnabled = settings.totpEnabled === true;
    totpSiteHints = Array.isArray(settings.totpSiteHints) ? settings.totpSiteHints : [];
    mutedOrigins = Array.isArray(settings.mutedOrigins) ? settings.mutedOrigins : [];
    autoWatch = settings.autoWatch !== false;
    if (autoWatch || siteHasTotpHint()) paint();
  }).catch(error => {
    if (contextInvalidated(error)) showReloadRequired();
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.totpEnabled) {
      totpEnabled = changes.totpEnabled.newValue === true;
      paint();
    }
    if (area === 'local' && changes.totpSiteHints) {
      totpSiteHints = Array.isArray(changes.totpSiteHints.newValue) ? changes.totpSiteHints.newValue : [];
      totpDetails = null; stopTotpTimer();
      paint();
    }
    if (area === 'local' && changes.mutedOrigins) {
      mutedOrigins = Array.isArray(changes.mutedOrigins.newValue) ? changes.mutedOrigins.newValue : [];
      paint();
    }
    if (area === 'local' && changes.localWebmailEnabled) {
      watchGeneration++; searching = false; stopChipExpiryTimer();
      code = null; link = null; webmailHint = null; sessionId = null; review = null; codeDetails = null; choices = null; closePanel();
      if (chip) { chip.textContent = '⚡'; chip.title = ''; }
      if (autoWatch) paint();
    }
    if (area === 'local' && changes.detailedPopup) {
      detailedPopup = changes.detailedPopup.newValue === true;
      if (detailedPopup) showCodePanel(); else if (panel?.dataset.kind === 'codes') closePanel();
    }
    if (area === 'local' && changes.autoWatch) {
      autoWatch = changes.autoWatch.newValue === true;
      if (!autoWatch) { watchGeneration++; searching = false; if (chip && !code) chip.textContent = '⚡'; }
      else paint();
    }
    if (autoWatch && ((area === 'local' && changes.primaryEmail) || (area === 'session' && changes.extraAccounts))) paint();
  });
  paint();
})();
