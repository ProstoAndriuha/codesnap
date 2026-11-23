// Classic content-script module for local webmail DOM reading (zero network, zero servers).
globalThis.CodeSnapWebmail = (() => {
  const PROVIDERS = {
    gmail: { name: 'Gmail Web', hosts: ['mail.google.com'] },
    yandex: { name: 'Яндекс Почта', hosts: ['mail.yandex.ru', 'mail.yandex.com', 'mail.yandex.by', 'mail.yandex.kz', '360.yandex.ru'] },
    outlook: { name: 'Outlook', hosts: ['outlook.live.com', 'outlook.office.com', 'outlook.office365.com', 'outlook.cloud.microsoft'] },
    yahoo: { name: 'Yahoo Mail', hosts: ['mail.yahoo.com'] },
    mailru: { name: 'Mail.ru', hosts: ['e.mail.ru', 'octavius.mail.ru'] },
    proton: { name: 'Proton Mail', hosts: ['mail.proton.me'] },
    icloud: { name: 'iCloud Mail', hosts: ['www.icloud.com', 'icloud.com'] },
    zoho: { name: 'Zoho Mail', hosts: ['mail.zoho.com', 'mail.zoho.eu', 'mail.zoho.in', 'mail.zoho.com.au'] },
    rambler: { name: 'Рамблер/почта', hosts: ['mail.rambler.ru'] },
    fastmail: { name: 'Fastmail', hosts: ['app.fastmail.com', 'www.fastmail.com'] },
    aol: { name: 'AOL Mail', hosts: ['mail.aol.com'] },
    gmx: { name: 'GMX / Mail.com', hosts: ['3c.gmx.net', '3c-bap.gmx.com', '3c-bap.mail.com', 'navigator.gmx.com', 'navigator-bs.gmx.com'] }
  };

  const SELECTORS = {
    gmail: {
      account: ['a[aria-label*="@"]', '[data-email]'],
      subject: ['h2.hP', '[data-legacy-thread-id] h2'],
      sender: ['[email]', '.gD', '.go'],
      time: ['.g3', 'span[title][alt]'],
      body: ['.a3s.aiL', '.a3s', '[data-message-id]'],
      rows: ['tr.zA', '[role="row"]'],
      rowSender: ['[email]', '.yW span', '.zF'],
      rowSubject: ['.bog', '.y6 span'],
      rowSnippet: ['.y2'],
      rowTime: ['.xW span', '.xW'],
      rowUnread: 'tr.zE, .zE'
    },
    yandex: {
      account: ['[data-testid="user-account-email"]', '.user-account__subname', '.mail-User-Name'],
      subject: ['.mail-Message-Toolbar-Subject', '[data-testid="message-subject"]', 'h1[class*="Subject"]'],
      sender: ['[data-testid="message-sender-email"]', '.mail-Message-Sender-Email', '[data-email]', '[class*="SenderEmail"]', '.ns-view-message-head-sender'],
      time: ['[data-testid="message-date"]', '.mail-Message-Head-RecievedDate', 'time', '[class*="MessageDate"]'],
      body: ['.mail-Message-Body-Content', '[data-testid="message-body"]', '.ns-view-message-body', '[class*="MessageBody"]'],
      rows: ['.mail-MessageSnippet', '[data-testid="messages-list_message-item"]', '.ns-view-messages-item-wrap', '[data-testid*="message-item"]'],
      rowSender: ['.mail-MessageSnippet-FromText', '[data-testid*="sender"]', '[title*="@"]'],
      rowSubject: ['.mail-MessageSnippet-Item_subject', '[data-testid*="subject"]'],
      rowSnippet: ['.mail-MessageSnippet-Item_firstline', '[data-testid*="firstline"]'],
      rowTime: ['.mail-MessageSnippet-Item_date', '[data-testid*="date"]', 'time'],
      rowUnread: '.is-unread, [data-testid*="unread"], [class*="unread" i]'
    },
    outlook: {
      account: ['[data-testid="mectrl_currentAccount_secondary"]', '#mectrl_currentAccount_secondary'],
      subject: ['[role="heading"][aria-level="2"]', '[data-testid="MessageSubject"]', '.allowTextSelection'],
      sender: ['[data-testid="SenderPersona"]', '.OZZZK', '.lDdSm', '[aria-label*="@"]'],
      time: ['[data-testid="SentReceivedTime"]', 'time', '[aria-label*="AM" i]', '[aria-label*="PM" i]'],
      body: ['[aria-label="Message body"]', '[aria-label="Текст сообщения"]', '.XbIp4', '[data-test-id="mail-message-body"]'],
      rows: ['[role="option"][aria-label]', '[data-convid]', '[role="listitem"]'],
      rowSender: ['[title*="@"]', 'span[title]'],
      rowSubject: ['[data-testid="subject"]', '.lvHighlightSubjectClass', 'span'],
      rowSnippet: ['.lvHighlightPreviewClass'],
      rowTime: ['time', '[title*=":"]'],
      rowUnread: '[aria-label*="Unread" i], [aria-label*="Непрочитан" i], [data-unread="true"]'
    },
    yahoo: {
      account: ['[data-test-id="account-menu-email"]', '#ybarAccountProfile'],
      subject: ['[data-test-id="message-group-subject"]', 'h1'],
      sender: ['[data-test-id="message-from"]', '[data-test-id="sender-email"]'],
      time: ['[data-test-id="message-date"]', 'time'],
      body: ['[data-test-id="message-view-body-content"]', '.msg-body', '[data-test-id="message-body"]'],
      rows: ['[data-test-id="message-list-item"]', '[role="listitem"]'],
      rowSender: ['[data-test-id="senders-span"]', '[title*="@"]'],
      rowSubject: ['[data-test-id="message-subject"]'],
      rowSnippet: ['[data-test-id="snippet"]'],
      rowTime: ['[data-test-id="time"]', 'time'],
      rowUnread: '[data-test-id="unread-indicator"], [aria-label*="unread" i], [data-unread="true"]'
    },
    mailru: {
      account: ['.ph-project__user-name', '[data-testid="whiteline-account"]'],
      subject: ['h2.thread-subject', '.thread__subject', '.letter__subject'],
      sender: ['.letter-contact', '[data-contact-informer-email]', '[title*="@"]'],
      time: ['.letter__date', 'time'],
      body: ['.letter-body', '.js-readmsg-msg__body', '.letter__body'],
      rows: ['a.llc', '.js-letter-list-item', '[data-uidl]'],
      rowSender: ['.ll-crpt', '[title*="@"]'],
      rowSubject: ['.ll-sj__normal', '.ll-sj'],
      rowSnippet: ['.ll-sp__normal', '.ll-sp'],
      rowTime: ['.llc__item_date', 'time'],
      rowUnread: '.llc_new, [class*="unread" i]'
    },
    proton: {
      account: ['[data-testid="heading:userdropdown"]', '.user-dropdown-email'],
      subject: ['[data-testid="conversation-header:subject"]', 'h1'],
      sender: ['[data-testid="message-header:from"]', '[data-testid="recipient-address"]'],
      time: ['[data-testid="item-date"]', 'time'],
      body: ['[data-testid="message-content:body"]', '.message-content'],
      rows: ['[data-testid^="message-item:"]', '[data-shortcut-target="item-container"]'],
      rowSender: ['[data-testid="message-column:sender-address"]'],
      rowSubject: ['[data-testid="message-column:subject"]'],
      rowSnippet: [],
      rowTime: ['[data-testid="item-date-simple"]', 'time'],
      rowUnread: '[data-testid*="unread"], .unread'
    }
  };

  function detectProvider(hostname, pathname = '/') {
    const host = String(hostname ?? '').toLowerCase();
    const path = String(pathname ?? '/').toLowerCase();
    if (/^p\d+-mailweb\.icloud\.com$/.test(host)) return 'icloud';
    for (const [id, info] of Object.entries(PROVIDERS)) {
      if (info.hosts.some(allowed => host === allowed || host.endsWith(`.${allowed}`))) {
        if (id === 'icloud' && host.endsWith('icloud.com') && !host.startsWith('p') && !path.startsWith('/mail')) {
          return null;
        }
        return id;
      }
    }
    return null;
  }

  function unwrapLink(rawUrl) {
    let parsed;
    try { parsed = new URL(rawUrl); } catch { return null; }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
    const host = parsed.hostname.toLowerCase();
    let candidate = rawUrl;
    if ((host === 'www.google.com' || host === 'google.com') && parsed.pathname === '/url') {
      candidate = parsed.searchParams.get('q') || parsed.searchParams.get('url') || rawUrl;
    } else if (host.endsWith('.safelinks.protection.outlook.com')) {
      candidate = parsed.searchParams.get('url') || rawUrl;
    } else if (host.endsWith('mail.yahoo.com') || host.endsWith('deref-gmx.com') || host.endsWith('deref-mail.com')) {
      candidate = parsed.searchParams.get('redirectUrl') || parsed.searchParams.get('url') || parsed.searchParams.get('u') || rawUrl;
    }
    try {
      const resolved = new URL(candidate);
      return resolved.protocol === 'https:' ? resolved.href : null;
    } catch {
      return null;
    }
  }

  function parseRelativeTimestamp(rawText, now = Date.now()) {
    const text = String(rawText ?? '').replace(/\s+/g, ' ').trim();
    if (!text) return null;
    if (/(?:вчера|yesterday|позавчера|hier|ayer|gestern|ieri)/i.test(text)) return null;

    if (/(?:только\s+что|сейчас|just\s*now|moments?\s+ago|<\s*1\s*(?:m|min|мин))/i.test(text)) return now - 5_000;
    const secMatch = /(?:^|\D)(\d{1,2})\s*(?:сек(?:унд[ауы]?)?|secs?|seconds?)(?=$|[^A-Za-zА-Яа-яЁё])/i.exec(text);
    if (secMatch) return now - Number(secMatch[1]) * 1000;
    const minMatch = /(?:^|\D)(\d{1,2})\s*(?:мин(?:ут[ауы]?)?|mins?|minutes?|m)(?=$|[^A-Za-zА-Яа-яЁё])/i.exec(text);
    if (minMatch) {
      const mins = Number(minMatch[1]);
      return mins <= 20 ? now - mins * 60_000 : null;
    }

    const hasMonthWord = /(?:^|[^A-Za-zА-Яа-яЁё])(?:янв|фев|мар|апр|мая|май|июн|июл|авг|сен|окт|ноя|дек|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i.test(text);
    const hasSlashDate = /\b\d{1,2}[./-]\d{1,2}(?:[./-]\d{2,4})?\b/.test(text);
    const clock = /\b(\d{1,2}):(\d{2})(?:\s*(AM|PM))?\b/i.exec(text);
    if (/^\d{4}-\d{2}-\d{2}T/.test(text) || (clock && (hasMonthWord || hasSlashDate))) {
      const ruMonths = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
      const enMonths = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      const byName = /(\d{1,2})\s+([а-яё]+)\.?\s*(\d{4})?(?:\s*г\.)?/i.exec(text);
      const byNumber = /\b(\d{1,2})\.(\d{1,2})\.(\d{4})\b/.exec(text);
      const month = byName ? ruMonths.indexOf(byName[2].toLowerCase().slice(0, 3)) : -1;
      let absolute = text.replace(/\s+at\s+/gi, ' ');
      if (month >= 0) absolute = `${enMonths[month]} ${byName[1]}, ${byName[3] || new Date(now).getFullYear()} ${clock[0]}`;
      if (byNumber) absolute = `${enMonths[Number(byNumber[2]) - 1]} ${byNumber[1]}, ${byNumber[3]} ${clock[0]}`;
      const ts = Date.parse(absolute);
      return Number.isFinite(ts) && now - ts >= -60_000 && now - ts <= 20 * 60_000 ? ts : null;
    }
    if (/(?:^|\D)\d+\s*(?:ч(?:ас(?:а|ов)?)?|h|hr|hrs|hours?|д(?:н(?:я|ей)?|ays?)?|нед|weeks?|мес|months?|г|years?)(?=$|[^A-Za-zА-Яа-яЁё])/i.test(text)) return null;
    if (clock && !hasMonthWord && !hasSlashDate) {
      let hours = Number(clock[1]);
      const minutes = Number(clock[2]);
      const meridiem = clock[3]?.toUpperCase();
      if (meridiem === 'PM' && hours < 12) hours += 12;
      if (meridiem === 'AM' && hours === 12) hours = 0;
      if (hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59) {
        const dt = new Date(now);
        dt.setHours(hours, minutes, 0, 0);
        const todayTs = dt.getTime();
        if (now - todayTs >= -60_000 && now - todayTs <= 20 * 60_000) return todayTs;
        const yesterdayTs = todayTs - 86_400_000;
        if (now - yesterdayTs >= 0 && now - yesterdayTs <= 20 * 60_000) return yesterdayTs;
        return null;
      }
    }

    if (!hasMonthWord && !hasSlashDate) {
      const parsed = Date.parse(text);
      if (Number.isFinite(parsed) && now - parsed >= -60_000 && now - parsed <= 20 * 60_000) return parsed;
    }
    return null;
  }

  function firstText(root, selectors) {
    for (const sel of selectors ?? []) {
      const el = root.querySelector?.(sel);
      if (!el) continue;
      const emailAttr = el.getAttribute?.('email') || el.getAttribute?.('data-email') || el.getAttribute?.('data-contact-informer-email');
      if (emailAttr && /@/.test(emailAttr)) return emailAttr.trim();
      const text = (el.textContent || el.getAttribute?.('title') || el.getAttribute?.('aria-label') || '').replace(/\s+/g, ' ').trim();
      if (text) return text;
    }
    return '';
  }

  function firstAttrOrText(root, selectors) {
    for (const sel of selectors ?? []) {
      const el = root.querySelector?.(sel);
      if (!el) continue;
      const candidate = el.getAttribute?.('datetime') || el.getAttribute?.('data-email') || el.getAttribute?.('title') || el.getAttribute?.('aria-label') || el.textContent;
      const clean = String(candidate ?? '').replace(/\s+/g, ' ').trim();
      if (clean) return clean;
    }
    return '';
  }

  function extractEmailAddress(text) {
    const match = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i.exec(String(text ?? ''));
    return match ? match[0].toLowerCase() : null;
  }

  function extractLinksFromContainer(container) {
    const links = [];
    const seen = new Set();
    const doc = container.ownerDocument;
    const collectFrom = root => {
      for (const a of root.querySelectorAll?.('a[href]') ?? []) {
        const raw = a.getAttribute('data-saferedirecturl') || a.getAttribute('data-origin-href') || a.getAttribute('href') || a.href;
        const resolved = unwrapLink(raw);
        if (!resolved || seen.has(resolved)) continue;
        seen.add(resolved);
        const text = (a.textContent || a.getAttribute('aria-label') || a.getAttribute('title') || '').replace(/\s+/g, ' ').trim().slice(0, 120);
        const parentText = (a.parentElement?.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 220);
        links.push({ url: resolved, text, preceding: parentText, surrounding: parentText });
      }
    };
    collectFrom(container);
    for (const frame of container.querySelectorAll?.('iframe') ?? []) {
      try {
        if (frame.contentDocument?.body) collectFrom(frame.contentDocument.body);
      } catch { /* Cross-origin frame ignored. */ }
    }
    return links;
  }

  function containerBodyText(container) {
    let text = (container.textContent || '').replace(/\s+/g, ' ').trim();
    for (const frame of container.querySelectorAll?.('iframe') ?? []) {
      try {
        const frameText = frame.contentDocument?.body?.textContent?.replace(/\s+/g, ' ').trim();
        if (frameText) text = `${text}\n${frameText}`.trim();
      } catch { /* Cross-origin frame ignored. */ }
    }
    return text.slice(0, 16_000);
  }

  function scanDocument(doc, hostname, now = Date.now(), seenTimestamps = new Map()) {
    const provider = detectProvider(hostname, doc.location?.pathname ?? '/');
    if (!provider) return { provider: null, accountEmail: null, messages: [], unreadHints: [] };

    const profile = SELECTORS[provider] ?? {};
    const accountRaw = firstAttrOrText(doc, profile.account ?? ['[aria-label*="@"]', '[title*="@"]']);
    const accountEmail = extractEmailAddress(accountRaw);
    const messages = [];
    const unreadHints = [];

    const bodyCandidates = [];
    for (const sel of profile.body ?? ['[role="main"] article', '[role="main"] [data-message-id]', '[role="main"]']) {
      for (const el of doc.querySelectorAll?.(sel) ?? []) {
        if (!bodyCandidates.includes(el)) bodyCandidates.push(el);
      }
      if (bodyCandidates.length) break;
    }

    for (const [idx, bodyEl] of bodyCandidates.slice(0, 4).entries()) {
      const body = containerBodyText(bodyEl);
      if (body.length < 8) continue;
      const scope = bodyEl.closest?.('[data-message-id], article, [role="region"], [role="main"]') || doc;
      const subject = firstText(scope, profile.subject ?? ['h1', 'h2']) || firstText(doc, profile.subject ?? ['h1', 'h2']);
      const from = firstText(scope, profile.sender ?? ['[email]', '[data-email]', '[title*="@"]']) || firstText(doc, profile.sender ?? []);
      const timeStr = firstAttrOrText(scope, profile.time ?? ['time']) || firstAttrOrText(doc, profile.time ?? []);
      const ts = parseRelativeTimestamp(timeStr, now);
      if (ts !== null) {
        messages.push({
          id: `webmail-${provider}-open-${idx}`,
          from,
          subject,
          body,
          html: String(bodyEl.innerHTML ?? '').slice(0, 80_000),
          links: extractLinksFromContainer(bodyEl),
          timestamp: ts,
          accountEmail,
          accountProvider: provider
        });
      }
    }

    const rowSelectors = profile.rows ?? ['[role="row"]', '[role="listitem"]'];
    const rowNodes = [];
    for (const sel of rowSelectors) {
      for (const row of doc.querySelectorAll?.(sel) ?? []) {
        if (!rowNodes.includes(row)) rowNodes.push(row);
      }
      if (rowNodes.length) break;
    }

    for (const [idx, row] of rowNodes.slice(0, 25).entries()) {
      const from = firstText(row, profile.rowSender ?? ['[email]', '[title*="@"]', 'span']) || '';
      const subject = firstText(row, profile.rowSubject ?? ['[role="link"]', 'a', 'span']) || '';
      const snippet = firstText(row, profile.rowSnippet ?? []) || '';
      const rowText = (row.textContent || '').replace(/\s+/g, ' ').trim();
      const timeStr = firstAttrOrText(row, profile.rowTime ?? ['time']);
      const sig = `row:${provider}:${from}:${subject}:${snippet.slice(0, 80)}`;
      let ts = parseRelativeTimestamp(timeStr, now);
      const isUnread = Boolean(
        (profile.rowUnread && (row.matches?.(profile.rowUnread) || row.querySelector?.(profile.rowUnread))) ||
        /unread|непрочитан/i.test(row.getAttribute?.('aria-label') ?? '')
      );
      if (!timeStr && seenTimestamps.has(sig)) {
        ts = seenTimestamps.get(sig);
      }
      if (ts === null) continue;
      const body = [subject, snippet, rowText].filter(Boolean).join('\n').slice(0, 4000);
      if (body.length >= 6) {
        messages.push({
          id: `webmail-${provider}-row-${idx}`,
          from,
          subject: subject || rowText.slice(0, 120),
          body,
          html: '',
          links: [],
          timestamp: ts,
          accountEmail,
          accountProvider: provider,
          snapshotKey: sig
        });
      }
      if (isUnread) {
        unreadHints.push({ provider, accountEmail, from, subject: subject || rowText.slice(0, 120), timestamp: ts });
      }
    }

    return { provider, accountEmail, messages, unreadHints };
  }

  if (typeof location !== 'undefined' && typeof document !== 'undefined') {
    const provider = detectProvider(location.hostname, location.pathname);
    if (provider) {
      let enabled = false;
      let settingRevision = 0;
      const seenTimestamps = new Map();
      const pushedSignatures = new Set();
      const rememberPush = sig => {
        if (pushedSignatures.size > 300) pushedSignatures.clear();
        pushedSignatures.add(sig);
      };
      const recordSnapshots = (pushNew = false) => {
        const now = Date.now();
        if (seenTimestamps.size > 200) seenTimestamps.clear();
        const scan = scanDocument(document, location.hostname, now, seenTimestamps);
        const newMessages = [];
        const newHints = [];
        for (const msg of scan.messages) {
          if (msg.snapshotKey && !seenTimestamps.has(msg.snapshotKey)) seenTimestamps.set(msg.snapshotKey, msg.timestamp);
          const pushSig = `${msg.id.includes('-open-') ? 'open' : 'row'}:${provider}:${msg.from}:${msg.subject}:${String(msg.body ?? '').slice(0, 140)}:${msg.links?.length ?? 0}`;
          if (!pushedSignatures.has(pushSig)) {
            rememberPush(pushSig);
            newMessages.push(msg);
          }
        }
        for (const hint of scan.unreadHints ?? []) {
          const hintSig = `unread:${provider}:${hint.from}:${hint.subject}`;
          if (!pushedSignatures.has(hintSig)) {
            rememberPush(hintSig);
            newHints.push(hint);
          }
        }
        if (pushNew && (newMessages.length > 0 || newHints.length > 0)) {
          globalThis.chrome?.runtime?.sendMessage?.({
            type: 'WEBMAIL_PUSH',
            provider,
            accountEmail: scan.accountEmail,
            messages: newMessages,
            unreadHints: scan.unreadHints ?? []
          })?.catch?.(() => {});
        }
        return scan;
      };
      let timer = null;
      const notifyReady = () => {
        if (!enabled) return;
        const scan = recordSnapshots(false);
        globalThis.chrome?.runtime?.sendMessage?.({
          type: 'WEBMAIL_READY',
          provider,
          accountEmail: scan.accountEmail,
          messages: scan.messages,
          unreadHints: scan.unreadHints ?? []
        })?.catch?.(() => {});
      };
      if (typeof MutationObserver === 'function') {
        const obs = new MutationObserver(() => {
          clearTimeout(timer);
          if (enabled) timer = setTimeout(() => { if (enabled) recordSnapshots(true); }, 140);
        });
        obs.observe(document.documentElement, { childList: true, characterData: true, subtree: true });
      }
      document.addEventListener('visibilitychange', () => { if (!document.hidden) notifyReady(); });
      const runtime = globalThis.chrome?.runtime;
      runtime?.onMessage?.addListener((request, sender, respond) => {
        const change = request?.type === 'CONTENT_SETTINGS_CHANGED' && request.area === 'local' && request.changes?.localWebmailEnabled;
        if (change && sender?.id === runtime.id) {
          settingRevision++;
          enabled = change.newValue !== false;
          if (enabled) notifyReady();
          else { seenTimestamps.clear(); pushedSignatures.clear(); }
        }
        if (request?.type === 'SCAN_WEBMAIL') {
          respond(enabled ? { ok: true, ...scanDocument(document, location.hostname, Date.now(), seenTimestamps) } : { ok: false });
          return false;
        }
      });
      runtime?.sendMessage?.({ type: 'GET_WEBMAIL_ENABLED' })?.then(result => {
        if (settingRevision || !result?.enabled) return;
        enabled = true;
        notifyReady();
      }).catch(() => {});
    }
  }

  return { PROVIDERS, detectProvider, scanDocument, parseRelativeTimestamp, unwrapLink };
})();
