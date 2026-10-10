(() => {
  if (globalThis.__verificationCodesLoaded || location.protocol !== 'https:') return;
  globalThis.__verificationCodesLoaded = true;
  const detector = globalThis.VerificationFields;
  let field = null;
  let fieldId = null;
  let detectedAt = null;
  let code = null;
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
  let codeDetails = null;
  let choices = null;
  const t = (key, fallback) => chrome.i18n?.getMessage(key) || fallback;
  const observedRoots = new WeakSet();

  const delays = [0, 1500, 2500, 4000, 4000];
  const reloadMessage = 'CodeSnap was updated. Reload this page to reconnect it.';

  function closePanel() { panel?.remove(); panel = null; }

  function contextInvalidated(error = null) {
    return /(?:extension context invalidated|context.*(?:destroyed|invalidated))/i.test(String(error?.message ?? ''));
  }

  function showReloadRequired() {
    reloadRequired = true;
    watchGeneration++; searching = false; searchMode = null; autoWatch = false;
    code = null; sessionId = null; review = null; codeDetails = null; choices = null; closePanel();
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
    const description = document.createElement('p'); description.textContent = detail;
    description.style.cssText = `margin:7px 0 0;color:${dark ? '#a5b4d4' : '#586780'};font-size:11px;overflow-wrap:anywhere`;
    box.append(description);
    if (action) {
      const button = document.createElement('button'); button.type = 'button';
      button.textContent = action.label;
      button.style.cssText = 'display:block;width:100%;margin-top:10px;padding:9px;border:0;border-radius:8px;background:#5369e8;color:white;font:700 14px system-ui,sans-serif;cursor:pointer';
      button.addEventListener('click', action.run);
      box.append(button);
    }
    root.append(box); document.documentElement.append(host); panel = host;
  }

  function showReview() {
    if (!review || !fieldId || !review.sessionId) return;
    const item = review;
    if (Date.now() - item.timestamp > (item.lifetimeSeconds ?? 180) * 1000) {
      review = null; chip.textContent = 'Retry'; chip.title = 'Code expired. Click to search again.'; return;
    }
    showPanel('Check this email', `From: ${item.from ?? 'unknown sender'}. Subject: ${item.subject || 'unknown'}. Make sure this message belongs to ${location.hostname}.`, {
      label: `${item.code}  ·  Insert code`,
      run: async event => {
        if (!event.isTrusted || fieldId !== item.fieldId) return;
        let result;
        try { result = await chrome.runtime.sendMessage({ type: 'INSERT_INLINE', origin: location.origin, sessionId: item.sessionId }); }
        catch (error) {
          if (contextInvalidated(error)) showReloadRequired();
          else showPanel('Could not insert', 'Could not reach CodeSnap. Try again.');
          return;
        }
        if (result.status === 'inserted') {
          completedFieldId = fieldId; review = null; codeDetails = null; choices = null; closePanel();
          chip.textContent = '✓'; chip.title = 'Code inserted';
        } else showPanel('Could not insert', result.message ?? 'Try searching again.');
      }
    });
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
        completedFieldId = fieldId; code = null; sessionId = null; review = null; choices = null; codeDetails = null;
        closePanel(); chip.textContent = '✓'; chip.title = 'Code inserted';
      } else showPanel(t('inlineFailed', 'Could not insert'), result.message ?? 'Try searching again.');
    } catch (error) {
      if (contextInvalidated(error)) showReloadRequired();
      else showPanel(t('inlineFailed', 'Could not insert'), 'Could not reach CodeSnap. Try again.');
    } finally { button.disabled = false; }
  }

  function showCodePanel() {
    const items = choices?.candidates?.map(item => ({ ...item, sessionId: choices.sessionId })) ?? (review ? [review] : codeDetails ? [codeDetails] : []);
    if (!items.length || !fieldId) return;
    const expectedFieldId = fieldId;
    showPanel('CodeSnap', choices ? t('inlineChoose', 'Choose the email you requested') : '');
    panel.dataset.kind = 'codes';
    panel.style.width = '320px';
    const root = panel.shadowRoot;
    const box = root.firstElementChild;
    const label = box.firstElementChild.firstElementChild;
    const mark = document.createElement('span'); mark.textContent = 'ϟ';
    mark.style.cssText = 'display:inline-grid;place-items:center;width:21px;height:21px;margin-right:7px;border-radius:6px;background:linear-gradient(145deg,#9ab8ff,#6b71f3);color:white;font:800 19px/1 system-ui;vertical-align:middle';
    label.prepend(mark);
    const dark = isDarkTheme();
    const style = document.createElement('style');
    style.textContent = `.code-row{display:flex;align-items:center;gap:12px;margin:12px -13px 0;padding:13px;border-top:1px solid ${dark ? '#334066' : '#e5eaf4'};border-left:3px solid transparent}.code-row:first-of-type{border-left-color:#7387f4}.code-info{flex:1;min-width:0}.digits{font:800 23px/1.25 system-ui;letter-spacing:1.5px;font-variant-numeric:tabular-nums;color:${dark ? '#f2f4ff' : '#263752'}}.latest{display:inline-block;margin-left:7px;color:${dark ? '#a6b3ff' : '#5369e8'};font:800 9px system-ui;letter-spacing:.7px;vertical-align:middle}.meta{margin-top:4px;color:${dark ? '#a5b4d4' : '#738096'};font-size:11px;overflow-wrap:anywhere}.fill{flex:none;padding:8px 12px;border:1px solid ${dark ? '#52629b' : '#c8d1f4'};border-radius:8px;background:${dark ? '#263354' : '#edf1ff'};color:${dark ? '#e8ebff' : '#4056c5'};font:700 12px system-ui;cursor:pointer}.fill:disabled{opacity:.5;cursor:wait}.fill:focus-visible{outline:2px solid #7387f4;outline-offset:2px}.warning{color:${dark ? '#ffc978' : '#8b5418'};font-size:11px;margin-top:6px}`;
    root.append(style);
    const newest = Math.max(...items.map(item => item.timestamp || 0));
    for (const item of items.slice(0, 5)) {
      const row = document.createElement('div'); row.className = 'code-row';
      if (item.timestamp === newest) row.style.borderLeftColor = '#7387f4';
      const info = document.createElement('div'); info.className = 'code-info';
      const digits = document.createElement('div'); digits.className = 'digits';
      digits.append(document.createTextNode(item.code.replace(/^(.{3})(.{3})$/, '$1 $2')));
      if (item.timestamp === newest) {
        const badge = document.createElement('span'); badge.className = 'latest'; badge.textContent = t('inlineLatest', 'LATEST'); digits.append(badge);
      }
      const age = Math.max(0, Math.floor((Date.now() - (item.timestamp || Date.now())) / 1000));
      const meta = document.createElement('div'); meta.className = 'meta';
      const providerName = { gmail: 'Gmail', outlook: 'Outlook', yahoo: 'Yahoo', yandex: 'Яндекс', mailru: 'Mail.ru', imap: 'IMAP' }[item.accountProvider] ?? 'Gmail';
      meta.textContent = `${item.from || location.hostname} · ${providerName} · ${age < 60 ? t('inlineJustNow', 'just now') : `${Math.floor(age / 60)} ${t('inlineMinutesAgo', 'min ago')}`}`;
      info.append(digits, meta);
      if (item.accountEmail) { const account = document.createElement('div'); account.className = 'meta'; account.textContent = item.accountEmail; info.append(account); }
      if (item.requiresReview || review) { const warning = document.createElement('div'); warning.className = 'warning'; warning.textContent = `${t('inlineReview', 'Check sender and subject before inserting')}: ${item.subject || '—'}`; info.append(warning); }
      const button = document.createElement('button'); button.type = 'button'; button.className = 'fill'; button.textContent = t('inlineFill', 'Fill');
      button.disabled = Boolean(item.timestamp && Date.now() - item.timestamp > (item.lifetimeSeconds ?? 180) * 1000);
      button.addEventListener('click', event => { if (event.isTrusted) void insertDetailed(item, expectedFieldId, button); });
      row.append(info, button); box.append(row);
    }
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
    if (reloadRequired) return;
    if (searching || !chip || !field || field.channel === 'authenticator' || field.channel === 'sms') return;
    if (!automatic && completedFieldId === expectedFieldId) {
      completedFieldId = null;
      fieldId = expectedFieldId = crypto.randomUUID();
      detectedAt = Date.now();
      code = null; sessionId = null; codeDetails = null; choices = null; closePanel();
    }
    searching = true;
    searchMode = automatic ? 'auto' : 'manual';
    const generation = ++watchGeneration;
    chip.textContent = 'Finding…'; chip.title = 'Checking mail. Click to search now.';
    const searchDelays = automatic ? delays : [0, 2000, 3000, 4000];
    try {
      for (const delay of searchDelays) {
        if (delay) await new Promise(resolve => setTimeout(resolve, delay));
        if (generation !== watchGeneration || fieldId !== expectedFieldId || !field?.anchor?.isConnected) return;
        const result = await timedSearch({ type: 'SEARCH_INLINE', origin: location.origin, fieldId, detectedAt, channel: field.channel, automatic, siteContext: context() });
        if (generation !== watchGeneration || fieldId !== expectedFieldId) return;
        if (result.status === 'found') {
          code = result.code; sessionId = result.sessionId;
          codeDetails = result; choices = null;
          chip.textContent = code; chip.title = 'Click once to insert';
          if (detailedPopup) showCodePanel();
          return;
        }
        if (result.status === 'review') {
          codeDetails = null; choices = null;
          review = { ...result, fieldId };
          chip.textContent = 'Review'; chip.title = `Code from ${result.from ?? 'another sender'}. Click to check it.`;
          if (detailedPopup) showCodePanel();
          return;
        }
        if (result.status === 'ambiguous') {
          code = null; sessionId = null; review = null; codeDetails = null; choices = result;
          chip.textContent = t('inlineChooseShort', 'Choose'); chip.title = result.message;
          if (detailedPopup) showCodePanel();
          return;
        }
        if (result.status !== 'none' && result.status !== 'old') {
          notice = result.message ?? 'Open CodeSnap from the toolbar.';
          chip.textContent = 'Info'; chip.title = notice;
          return;
        }
      }
      chip.textContent = 'Retry'; chip.title = 'No recent email code. Click to search again.';
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
    return a?.type === b?.type && a?.channel === b?.channel && a?.inputs.length === b?.inputs.length && a?.inputs.every((input, i) => input === b.inputs[i]);
  }

  function context() {
    const meta = document.querySelector('meta[property="og:site_name"],meta[name="application-name"]');
    return {
      hostname: location.hostname,
      title: String(document.title ?? '').slice(0, 120),
      siteName: String(meta?.content ?? '').slice(0, 80),
      verificationText: String(field?.context ?? '').slice(0, 180)
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
    const found = detector.detect(document);
    if (!found) {
      watchGeneration++; searching = false;
      field = null; fieldId = null; detectedAt = null; code = null; sessionId = null; review = null; notice = null; codeDetails = null; choices = null; closePanel();
      chip?.remove(); chip = null; clearPadding();
      return;
    }
    if (!sameField(field, found)) {
      watchGeneration++; searching = false;
      closePanel(); review = null; notice = null; codeDetails = null; choices = null;
      field = found;
      fieldId = crypto.randomUUID();
      detectedAt = requestedAt && Date.now() - requestedAt < 300_000 ? requestedAt : Date.now();
      completedFieldId = null;
      code = null; sessionId = null;
      if (chip) { chip.textContent = '⚡'; chip.title = 'Click to find code'; }
    } else field = found;
    if (field.channel === 'authenticator' || field.channel === 'sms') {
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
        if (choices || (detailedPopup && (codeDetails || review))) { showCodePanel(); return; }
        if (review) { showReview(); return; }
        if (code && sessionId) {
          let result;
          try { result = await chrome.runtime.sendMessage({ type: 'INSERT_INLINE', origin: location.origin, sessionId }); }
          catch (error) {
            if (contextInvalidated(error)) showReloadRequired();
            else { chip.textContent = 'Retry'; chip.title = 'Could not reach CodeSnap. Try again.'; }
            return;
          }
          if (result.status === 'inserted') {
            completedFieldId = fieldId; code = null; sessionId = null; codeDetails = null; choices = null; closePanel();
            chip.textContent = '✓'; chip.title = 'Code inserted';
          } else {
            try { await navigator.clipboard.writeText(code); chip.textContent = 'Copied'; chip.title = 'Insertion failed; code copied instead.'; }
            catch {
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
    if (autoWatch && (field.channel === 'email' || field.channel === 'unknown') && !code && !searching && fieldId && completedFieldId !== fieldId && chip.textContent === '⚡') void watch(fieldId, true);
  }

  chrome.runtime.onMessage.addListener((request, _sender, respond) => {
    if (request.type === 'CODE_FOUND') {
      if (request.fieldId && request.fieldId !== fieldId) { respond?.({ status: 'changed' }); return; }
      codeDetails = request; choices = null;
      if (request.requiresReview) {
        review = { ...request, fieldId: request.fieldId || fieldId };
        code = null; sessionId = null;
        if (chip) { chip.textContent = 'Review'; chip.title = `Code from ${request.from ?? 'another sender'}. Click to check it.`; }
      } else {
        code = request.code; sessionId = request.sessionId; review = null;
        if (chip) { chip.textContent = code; chip.title = 'Click once to insert'; }
      }
      position();
      if (detailedPopup) showCodePanel();
      respond?.({ status: 'ok' });
      return;
    }
    if (request.type === 'FIELD_STATUS') {
      paint();
      respond({ origin: location.origin, detected: Boolean(field), fieldId, detectedAt, siteContext: context(), type: field?.type ?? null, channel: field?.channel ?? null });
      return;
    }
    if (request.type !== 'INSERT_CODE') return;
    if (request.origin !== location.origin || request.fieldId !== fieldId) {
      respond({ status: 'changed', message: 'Verification field changed. Search again.' });
      return;
    }
    const latest = detector.detect(document);
    if (!sameField(field, latest)) {
      paint();
      respond({ status: 'changed', message: 'Verification field changed. Search again.' });
      return;
    }
    void detector.insert(latest, request.code).then(inserted => {
      if (inserted) completedFieldId = request.fieldId;
      respond(inserted ? { status: 'inserted' } : { status: 'missing', message: 'The website did not retain the complete code. Try again.' });
      if (inserted) {
        code = null; sessionId = null; review = null; codeDetails = null; choices = null; closePanel();
        if (chip) chip.textContent = '✓';
      }
    }).catch(() => respond({ status: 'missing', message: 'The website rejected code insertion.' }));
    return true;
  });

  const observer = new MutationObserver(records => {
    const relevant = records.some(record => {
      const target = record.target.nodeType === 1 ? record.target : record.target.parentElement;
      if (target === chip || target?.closest?.('#codesnap-inline-panel') || target?.getRootNode?.().host?.id === 'codesnap-inline-panel') return false;
      return record.type === 'attributes' || record.type === 'characterData' || [...record.addedNodes, ...record.removedNodes].some(node =>
        node.nodeType === 1 && node.id !== 'codesnap-inline-panel' && (node.matches?.('input,label,fieldset,[role="group"]') || node.querySelector?.('input,label,fieldset,[role="group"]') || node.shadowRoot));
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
    if (!/(?:\b(?:send|resend|request|get)\b.*\bcode\b|\bresend\b|получить.*код|запросить.*код|отправить.*код|выслать.*код|повторно.*код|trimite.*cod|retrimit)/i.test(label)) return;
    const nearby = `${label} ${button.closest('form,section,[role="group"]')?.textContent ?? ''}`.slice(0, 450);
    if (/(?:\bsms\b|text message|authenticator|\btotp\b|смс|аутентификатор)/i.test(label) ||
      (!/(?:email|e-mail|mail|почт|courriel|[a-z0-9._%*+-]+@(?:[a-z0-9*.-]+\.)+[a-z*]{2,})/i.test(nearby) && field?.channel !== 'email' && field?.channel !== 'unknown')) return;
    requestedAt = Date.now();
    watchGeneration++; searching = false; code = null; sessionId = null; review = null; codeDetails = null; choices = null; closePanel();
    fieldId = crypto.randomUUID(); detectedAt = requestedAt; completedFieldId = null;
    if (chip) { chip.textContent = '⚡'; chip.title = 'Click to find code'; }
    clearTimeout(debounceTimer); debounceTimer = setTimeout(paint, 80);
  }, true);
  document.addEventListener('input', event => {
    if (reloadRequired) return;
    if (field?.inputs.includes(event.target) && !event.target.value) {
    code = null; sessionId = null; review = null; completedFieldId = null; codeDetails = null; choices = null; closePanel();
      if (chip && chip.textContent !== '⚡' && chip.textContent !== 'Finding…') { chip.textContent = '⚡'; chip.title = 'Click to find code'; }
    }
  }, true);
  addEventListener('scroll', position, { passive: true });
  addEventListener('resize', position);
  document.addEventListener('keydown', event => { if (event.key === 'Escape') closePanel(); });
  document.addEventListener('pointerdown', event => { if (panel && !event.composedPath().includes(panel) && event.target !== chip) closePanel(); }, true);
  chrome.storage.local.get(['autoWatch', 'detailedPopup']).then(settings => { detailedPopup = settings.detailedPopup === true; autoWatch = settings.autoWatch !== false; if (autoWatch) paint(); }).catch(error => {
    if (contextInvalidated(error)) showReloadRequired();
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.mailCloudEnabled) {
      watchGeneration++; searching = false;
      code = null; sessionId = null; review = null; codeDetails = null; choices = null; closePanel();
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
