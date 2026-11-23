import { siteForOrigin, trustedOrigin, normalizeSender, rankCandidates, candidateIsFresh, siteIdentity, subjectMatches, SEARCH_WINDOW_SECONDS, checkPhishingRisk } from './core.js';
import { findMessages, findHistoryMessages, getGmailHistoryId } from './gmail.js';
import { SessionStore } from './sessions.js';
import { getAccessTokens, forgetAdditional } from './auth.js';
import {
  scanLocalMail,
  listLocalMailAccounts,
  registerWebmailTab,
  unregisterWebmailTab,
  connectLocalProvider,
  removeLocalAccount,
  focusWebmailTab,
  describeLocalMailError,
  isLocalWebmailEnabled,
  detectWebmailProviderFromUrl
} from './local-mail.js';
import {
  getTotpVaultStatus,
  unlockTotpVault,
  lockTotpVault,
  setTotpPassphrase,
  addTotpAccount,
  updateTotpAccount,
  removeTotpAccount,
  getTotpForSite,
  getTotpCandidatesForSite,
  getTotpById,
  listAllTotpCodes,
  importTotpPayload,
  exportTotpVault,
  exportTotpAccountUri,
  getTotpClockState,
  setTotpTimeOffset,
  measureServerClockSkew,
  refreshTotpSiteHints,
  TOTP_GRACE_SECONDS,
  awaitFreshTotpResult,
  describeTotpError
} from './totp.js';
import { decodeCroppedQrDataUrl, classifyQrStringsForTotp } from './qr-scanner.js';
import { getProStatus, activateProLicense, deactivateProLicense, FREE_TOTP_LIMIT } from './license.js';

const protectLocalStorage = chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
const contentSettingsKeys = [
  'autoWatch', 'detailedPopup', 'showWithdrawalDetails', 'totpTimeOffsetSeconds', 'totpEnabled',
  'totpSiteHints', 'mutedOrigins', 'phishingTrustedOrigins', 'customFieldSelectors', 'localWebmailEnabled'
];

let hintsRefreshed = false;
async function ensureTotpHintsFresh() {
  if (hintsRefreshed) return;
  hintsRefreshed = true;
  await refreshTotpSiteHints().catch(() => {});
}

async function getOriginPhishingAlert(origin) {
  if (!origin?.startsWith('https://')) return { suspicious: false };
  const { totpSiteHints = [], phishingTrustedOrigins = [] } = await chrome.storage.local.get(['totpSiteHints', 'phishingTrustedOrigins']);
  const extraDomains = (Array.isArray(totpSiteHints) ? totpSiteHints : []).flatMap(h => [h.domain, ...(h.matchDomains ?? [])]).filter(Boolean);
  return checkPhishingRisk(origin, extraDomains, Array.isArray(phishingTrustedOrigins) ? phishingTrustedOrigins : []);
}

function phishingBlockedPayload(alert) {
  return {
    status: 'phishing_blocked',
    phishingAlert: alert,
    message: `⚠️ Внимание! Домен ${alert.hostname} похож на фишинговый клон ${alert.targetDomain}. Вставка заблокирована.`
  };
}

const sessions = new SessionStore();
const errors = {
  AUTH_EXPIRED: 'Gmail authorization expired. Connect again in the popup.',
  PERMISSION_DENIED: 'Gmail access was denied. Check OAuth setup and permissions.',
  RATE_LIMIT: 'Gmail rate limit reached. Try again later.',
  GMAIL_UNAVAILABLE: 'Gmail is unavailable. Try again later.'
};

function originOf(url) { try { return new URL(url).origin; } catch { return null; } }
const sessionKey = (tabId, frameId = 0) => `${tabId}:${frameId}`;
const isWebmailCandidate = item => item?.localSource === 'webmail';

async function candidateEnabled(item) {
  return !isWebmailCandidate(item) || await isLocalWebmailEnabled();
}

function candidatePayload(candidate, sessionId, inline = false) {
  return {
    status: inline && candidate.requiresReview ? 'review' : 'found',
    kind: candidate.kind ?? (candidate.code && candidate.link ? 'both' : candidate.link ? 'link' : 'code'),
    code: candidate.code ?? null,
    link: candidate.link ?? null,
    withdrawalInfo: candidate.withdrawalInfo ?? null,
    timestamp: candidate.timestamp,
    lifetimeSeconds: candidate.lifetimeSeconds,
    from: candidate.from,
    subject: candidate.subject,
    requiresReview: candidate.requiresReview,
    accountEmail: candidate.accountEmail,
    accountProvider: candidate.accountProvider,
    sessionId
  };
}

async function tabMatches(tabId, origin, fieldId = null, frameId = 0) {
  let tab;
  try { tab = await chrome.tabs.get(tabId); } catch { return false; }
  if (!fieldId && frameId === 0) return originOf(tab.url) === origin;
  try {
    const status = await chrome.tabs.sendMessage(tabId, { type: 'FIELD_STATUS' }, { frameId });
    return status?.origin === origin && (!fieldId || status.fieldId === fieldId);
  } catch { return false; }
}

async function rememberedSenders(siteId, origin) {
  const { senders = {}, learnedSenders = {} } = await chrome.storage.local.get(['senders', 'learnedSenders']);
  const key = siteId === 'generic' ? origin : siteId;
  return [...new Set([senders[key], ...(Array.isArray(learnedSenders[key]) ? learnedSenders[key] : [])].map(normalizeSender).filter(Boolean))];
}

function matchingUnreadHint(hints, origin, siteId, siteContext) {
  if (!hints?.length) return null;
  const identity = siteIdentity(origin, siteContext);
  return hints.find(hint => {
    const text = `${hint.from ?? ''} ${hint.subject ?? ''}`.toLowerCase();
    const fromAddr = normalizeSender(hint.from);
    const domain = fromAddr?.split('@')[1] ?? '';
    const domainHit = Boolean(identity.siteDomain && domain && (domain === identity.siteDomain || domain.endsWith(`.${identity.siteDomain}`)));
    const brandHit = identity.names.some(name => text.includes(name));
    return (domainHit || brandHit) && subjectMatches(hint.subject ?? '', siteId);
  }) ?? null;
}

async function search({ tabId, frameId = 0, origin, siteId, fieldId = null, detectedAt = null, siteContext = {}, accountSelection = null, channel = 'unknown', automatic = false, inline = false }) {
  const key = sessionKey(tabId, frameId);
  if (!origin?.startsWith('https://') || !(await tabMatches(tabId, origin, fieldId, frameId))) return { status: 'changed', message: 'The verification page changed. Try again.' };
  if (channel === 'authenticator' || channel === 'sms') return { status: 'not_email', message: channel === 'authenticator' ? 'This field requests an authenticator-app code, not an email code.' : 'This field requests an SMS code, not an email code.' };
  const actualSite = siteForOrigin(origin);
  if (actualSite && siteId !== actualSite) return { status: 'untrusted', message: 'Site identity changed. Search again.' };
  const trusted = trustedOrigin(origin, siteId);
  if (!trusted && siteId !== 'generic') return { status: 'untrusted', message: 'Untrusted website — insertion disabled.' };
  if (trusted && siteForOrigin(origin) !== siteId) return { status: 'untrusted', message: 'Untrusted website — insertion disabled.' };
  const learnedSenders = await rememberedSenders(siteId, origin);
  const startedAt = Number.isFinite(detectedAt) && detectedAt <= Date.now() + 30_000 && detectedAt > Date.now() - 300_000 ? detectedAt : null;
  const { accountSelections = {}, learnedAccounts = {} } = await chrome.storage.local.get(['accountSelections', 'learnedAccounts']);
  const preferredAccount = learnedAccounts?.[origin] ?? null;
  const webmailOn = await isLocalWebmailEnabled();
  let selected = accountSelection ?? accountSelections[origin] ?? 'all';
  if ((selected.startsWith('local:tab:') || selected.startsWith('local:pin:')) && !webmailOn) selected = 'all';
  const searchKeyBase = `${siteId}|${learnedSenders.join(',')}|${selected}`;
  const searchKey = `${searchKeyBase}|${automatic ? 'auto' : 'manual'}`;
  let previous = sessions.get(key);
  if (previous && !await candidateEnabled(previous)) { sessions.delete(key); previous = null; }
  const codeNotReplaced = !previous?.used && (!detectedAt || !previous?.timestamp || previous.timestamp >= detectedAt - 5000);
  const sameContext = previous?.origin === origin && (previous.fieldId === fieldId || !fieldId || !previous.fieldId) && previous.searchKeyBase === searchKeyBase && Date.now() - previous.created < SEARCH_WINDOW_SECONDS * 1000;
  if (sameContext && previous.status === 'found' && codeNotReplaced && candidateIsFresh(previous)) {
    return candidatePayload(previous, previous.sessionId, inline);
  }
  const reusable = sameContext && previous.searchKey === searchKey;
  const session = reusable && previous.status === 'waiting' ? previous : sessions.start(key, origin, siteId, { startedAt, fieldId, siteContext });
  session.searchKeyBase = searchKeyBase;
  session.searchKey = searchKey;
  session.seen ??= {};
  const searchSeq = session.searchSeq = (session.searchSeq ?? 0) + 1;
  const { sessionId } = session;
  try {
    let accounts = [];
    let googleError = null;
    if (selected === 'all' || selected === 'primary' || selected.startsWith('extra:')) {
      try { accounts = await getAccessTokens(selected); } catch (error) { googleError = error; }
    }
    let localAccounts = [];
    if (selected === 'all' || selected.startsWith('local:')) {
      localAccounts = await listLocalMailAccounts();
      if (selected.startsWith('local:')) {
        localAccounts = localAccounts.filter(item => `local:${item.id}` === selected);
      }
    }
    const hasActiveLocal = localAccounts.some(item => item.active);
    if (!accounts.length && !hasActiveLocal) {
      if (selected.startsWith('local:') && localAccounts.length) {
        return { status: 'none', message: 'Откройте вкладку выбранной почты, чтобы CodeSnap прочитал свежее письмо локально.' };
      }
      throw googleError ?? new Error('AUTH_EXPIRED');
    }

    let lastUnreadHints = [];
    async function fetchAccounts(broad = false) {
      const localPending = (selected === 'all' || selected.startsWith('local:'))
        ? scanLocalMail({ selected, excludeTabId: tabId, maxAgeSeconds: SEARCH_WINDOW_SECONDS })
        : Promise.resolve({ messages: [], unreadHints: [] });

      const results = await Promise.allSettled(accounts.map(async account => {
        try {
          session.historyIds ??= {};
          let messages;
          if (automatic && !broad && session.historyIds[account.email]) {
            try {
              const update = await findHistoryMessages(account.token, session.historyIds[account.email], session.seen[account.email] ?? []);
              messages = update.messages;
              session.historyIds[account.email] = update.historyId;
            } catch (error) {
              if (error.message !== 'HISTORY_EXPIRED') throw error;
              delete session.historyIds[account.email];
              session.historyReset = true;
            }
          }
          if (!messages) {
            if (automatic && !broad && !session.historyIds[account.email]) {
              try { session.historyIds[account.email] = await getGmailHistoryId(account.token); }
              catch { /* Ordinary recent-mail search remains available. */ }
            }
            messages = await findMessages(account.token, null, session.seen[account.email] ?? [], SEARCH_WINDOW_SECONDS, broad);
          }
          session.seen[account.email] = [...new Set([...(session.seen[account.email] ?? []), ...messages.map(message => message.id)])].slice(-80);
          return messages.map(message => ({ ...message, accountEmail: account.email }));
        } catch (error) {
          if (error.message === 'AUTH_EXPIRED') {
            if (account.kind === 'primary') await chrome.identity.removeCachedAuthToken({ token: account.token });
            else await forgetAdditional(account.email);
          }
          throw error;
        }
      }));

      const localScan = await localPending;
      lastUnreadHints = localScan.unreadHints ?? [];
      if (accounts.length > 0 && !hasActiveLocal && results.every(result => result.status === 'rejected')) {
        throw results[0].reason;
      }
      const gmailMessages = results.flatMap(result => result.status === 'fulfilled' ? result.value : []);
      return [...gmailMessages, ...(localScan.messages ?? [])];
    }

    const messages = await fetchAccounts();
    if (sessions.get(key)?.sessionId !== sessionId || session.searchSeq !== searchSeq || !(await tabMatches(tabId, origin, fieldId, frameId))) {
      return { status: 'changed', message: 'Tab changed. Search again.' };
    }
    const rank = async items => {
      const enabledNow = await isLocalWebmailEnabled();
      return rankCandidates(items.filter(item => !isWebmailCandidate(item) || enabledNow), {
        siteId,
        learnedSenders,
        preferredAccount,
        origin,
        siteContext,
        startedAt: automatic ? startedAt : null,
        startToleranceMs: 180_000
      });
    };
    let ranked = await rank(messages);
    if ((ranked.status === 'none' || ranked.status === 'old') && (!automatic || searchSeq === 1 || session.historyReset || !Object.keys(session.historyIds ?? {}).length)) {
      const more = await fetchAccounts(true);
      session.historyReset = false;
      if (sessions.get(key)?.sessionId !== sessionId || session.searchSeq !== searchSeq || !(await tabMatches(tabId, origin, fieldId, frameId))) {
        return { status: 'changed', message: 'Tab changed. Search again.' };
      }
      ranked = await rank([...messages, ...more]);
    }
    if (ranked.status === 'found') {
      sessions.set(key, { ...session, status: 'found', ...ranked.candidate });
      return candidatePayload(ranked.candidate, sessionId, inline);
    }
    if (ranked.status === 'ambiguous') {
      sessions.set(key, { ...session, status: 'ambiguous', candidates: ranked.candidates });
      return {
        status: 'ambiguous',
        message: 'Several recent matches found. Choose the email you requested.',
        candidates: ranked.candidates.map(({ kind, code, link, withdrawalInfo, timestamp, accountEmail, accountProvider, from, subject, lifetimeSeconds, requiresReview }, index) => ({
          kind,
          code,
          link,
          withdrawalInfo: withdrawalInfo ?? null,
          timestamp,
          accountEmail,
          accountProvider,
          from,
          subject,
          lifetimeSeconds,
          requiresReview,
          index
        })),
        sessionId
      };
    }
    sessions.set(key, { ...session, status: 'waiting' });
    const unreadHint = ranked.status === 'none' ? matchingUnreadHint(lastUnreadHints, origin, siteId, siteContext) : null;
    if (unreadHint) {
      return {
        status: 'webmail_unread',
        webmailTabId: unreadHint.tabId,
        accountProvider: unreadHint.provider,
        accountEmail: unreadHint.accountEmail ?? null,
        from: unreadHint.from,
        subject: unreadHint.subject,
        message: 'В открытой вкладке почты есть свежее письмо. Откройте вкладку или письмо для чтения.'
      };
    }
    return { status: ranked.status, message: ranked.status === 'old' ? 'Old code.' : `No recent ${siteId === 'generic' ? '' : siteId + ' '}verification email.` };
  } catch (error) {
    if (sessions.get(key)?.sessionId === sessionId && session.searchSeq === searchSeq) sessions.delete(key);
    return { status: 'error', message: errors[error.message] ?? (error.message.startsWith('LOCAL_') ? describeLocalMailError(error) : 'Connect a mail account in CodeSnap.') };
  }
}

async function insert({ tabId, frameId = 0, origin, sessionId }) {
  const phishingAlert = await getOriginPhishingAlert(origin);
  if (phishingAlert.suspicious) return phishingBlockedPayload(phishingAlert);
  const key = sessionKey(tabId, frameId);
  const item = sessions.valid(key, origin, sessionId);
  if (!item || !item.code) return { status: 'expired', message: 'Code expired. Search again.' };
  if (!await candidateEnabled(item)) { sessions.delete(key); return { status: 'expired', message: 'Local webmail is disabled.' }; }
  if (!(await tabMatches(tabId, origin, item.fieldId, frameId))) return { status: 'changed', message: 'Tab changed. Search again.' };
  if (item.siteId !== 'generic' && !trustedOrigin(origin, item.siteId)) return { status: 'untrusted', message: 'Untrusted website — insertion disabled.' };
  try {
    const result = await chrome.tabs.sendMessage(tabId, { type: 'INSERT_CODE', code: item.code, origin, sessionId, fieldId: item.fieldId }, { frameId });
    if (result?.status === 'inserted') {
      try { await rememberSender(item); } catch { /* Insertion has already succeeded. */ }
      sessions.delete(key);
    }
    return result ?? { status: 'error', message: 'Verification field not found.' };
  } catch { return { status: 'error', message: 'Open the website and try again.' }; }
}

async function openLink({ tabId, frameId = 0, origin, sessionId }) {
  const phishingAlert = await getOriginPhishingAlert(origin);
  if (phishingAlert.suspicious) return phishingBlockedPayload(phishingAlert);
  const key = sessionKey(tabId, frameId);
  const item = sessions.valid(key, origin, sessionId);
  if (!item || !item.link?.url) return { status: 'expired', message: 'Link expired. Search again.' };
  if (!await candidateEnabled(item)) { sessions.delete(key); return { status: 'expired', message: 'Local webmail is disabled.' }; }
  if (!(await tabMatches(tabId, origin, item.fieldId, frameId))) return { status: 'changed', message: 'Tab changed. Search again.' };
  if (item.siteId !== 'generic' && !trustedOrigin(origin, item.siteId)) return { status: 'untrusted', message: 'Untrusted website — action disabled.' };
  let parsed;
  try { parsed = new URL(item.link.url); } catch { return { status: 'error', message: 'Invalid verification link.' }; }
  if (parsed.protocol !== 'https:') return { status: 'error', message: 'Only HTTPS links are supported.' };
  try { await rememberSender(item); } catch { /* Best effort. */ }
  sessions.delete(key);
  await chrome.tabs.create({ url: parsed.href, active: true });
  return { status: 'opened', url: parsed.href };
}

async function rememberSender(item) {
  const address = normalizeSender(item.from);
  const accountEmail = normalizeSender(item.accountEmail);
  if (!address && !accountEmail) return;
  const key = item.siteId === 'generic' ? item.origin : item.siteId;
  const { learnedSenders = {}, learnedAccounts = {} } = await chrome.storage.local.get(['learnedSenders', 'learnedAccounts']);
  const payload = {};
  if (address) {
    learnedSenders[key] = [...new Set([...(Array.isArray(learnedSenders[key]) ? learnedSenders[key] : []).map(normalizeSender).filter(Boolean), address])].slice(-5);
    payload.learnedSenders = learnedSenders;
  }
  if (item.origin && accountEmail) {
    learnedAccounts[item.origin] = accountEmail;
    payload.learnedAccounts = learnedAccounts;
  }
  if (Object.keys(payload).length) {
    await chrome.storage.local.set(payload);
  }
}

async function insertDual({ tabId, frameId = 0, origin, sessionId, siteContext = {}, totpId = null }) {
  const phishingAlert = await getOriginPhishingAlert(origin);
  if (phishingAlert.suspicious) return phishingBlockedPayload(phishingAlert);
  const key = sessionKey(tabId, frameId);
  const item = sessions.valid(key, origin, sessionId);
  if (!item || !item.code) return { status: 'expired', message: 'Email code expired. Search again.' };
  if (!await candidateEnabled(item)) { sessions.delete(key); return { status: 'expired', message: 'Local webmail is disabled.' }; }
  if (!(await tabMatches(tabId, origin, item.fieldId, frameId))) return { status: 'changed', message: 'Tab changed. Search again.' };
  if (item.siteId !== 'generic' && !trustedOrigin(origin, item.siteId)) return { status: 'untrusted', message: 'Untrusted website — insertion disabled.' };
  const mergedCtx = { ...(siteContext ?? item.siteContext ?? {}), matchedEmailAccount: item.accountEmail ?? null };
  const totp = await awaitFreshTotpResult(now =>
    totpId ? getTotpById(totpId, now) : getTotpCandidatesForSite(origin, mergedCtx, now)
  );
  if (totp.status === 'choose') {
    return { status: 'choose_totp', candidates: totp.candidates, message: 'Выберите нужный аккаунт 2FA.' };
  }
  if (totp.status !== 'found') {
    return { status: totp.status === 'locked' ? 'locked' : 'error', message: totp.status === 'locked' ? 'Unlock 2FA in CodeSnap popup.' : 'No matching 2FA secret found.' };
  }
  try {
    const result = await chrome.tabs.sendMessage(tabId, {
      type: 'INSERT_DUAL',
      emailCode: item.code,
      totpCode: totp.code,
      origin,
      sessionId,
      fieldId: item.fieldId
    }, { frameId });
    if (result?.status === 'inserted_dual' || result?.status === 'inserted_email_only') {
      try { await rememberSender(item); } catch { /* Best effort. */ }
      sessions.delete(key);
    }
    return result ?? { status: 'error', message: 'Verification fields not found.' };
  } catch {
    return { status: 'error', message: 'Open the website and try again.' };
  }
}

async function handleWebmailPush(request, sender) {
  if (!sender.tab?.id) return { status: 'ignored' };
  const senderProvider = detectWebmailProviderFromUrl(sender.url || '');
  if (!senderProvider || senderProvider !== request.provider) return { status: 'ignored' };
  registerWebmailTab({ tabId: sender.tab.id, frameId: sender.frameId ?? 0, provider: request.provider, accountEmail: request.accountEmail });
  if (!request.messages?.length && !request.unreadHints?.length) return { status: 'ok' };
  if (!(await isLocalWebmailEnabled())) return { status: 'disabled' };

  const { accountSelections = {}, mutedOrigins = [], learnedAccounts = {} } = await chrome.storage.local.get(['accountSelections', 'mutedOrigins', 'learnedAccounts']);
  let pushedCount = 0;

  for (const [key, session] of sessions.entries()) {
    const keyStr = String(key);
    const [tabStr, frameStr] = keyStr.includes(':') ? keyStr.split(':') : [keyStr, '0'];
    const targetTabId = Number(tabStr);
    const targetFrameId = Number(frameStr || 0);
    if (!Number.isInteger(targetTabId) || targetTabId === sender.tab.id) continue;
    if (Array.isArray(mutedOrigins) && mutedOrigins.includes(session.origin)) continue;
    if (session.status === 'found' && !session.used && candidateIsFresh(session)) continue;
    if (Date.now() - session.created > SEARCH_WINDOW_SECONDS * 1000) continue;

    const selected = accountSelections[session.origin] ?? 'all';
    if (selected !== 'all' && selected !== `local:tab:${sender.tab.id}` && selected !== `local:pin:${request.provider}`) continue;

    const normalized = (request.messages ?? []).map(msg => ({
      ...msg,
      id: `${sender.tab.id}:${sender.frameId ?? 0}:${msg.id}`,
      accountProvider: msg.accountProvider || request.provider,
      accountEmail: msg.accountEmail || request.accountEmail || null,
      localSource: 'webmail',
      webmailTabId: sender.tab.id
    }));

    const learnedSenders = await rememberedSenders(session.siteId, session.origin);
    const ranked = rankCandidates(normalized, {
      siteId: session.siteId,
      learnedSenders,
      preferredAccount: learnedAccounts?.[session.origin] ?? null,
      origin: session.origin,
      siteContext: session.siteContext ?? {},
      startedAt: session.startedAt,
      startToleranceMs: 180_000
    });

    if (ranked.status === 'found') {
      if (!(await tabMatches(targetTabId, session.origin, session.fieldId, targetFrameId))) continue;
      const latest = sessions.get(key);
      if (!latest || latest.sessionId !== session.sessionId) continue;
      sessions.set(key, { ...latest, status: 'found', ...ranked.candidate });
      chrome.tabs.sendMessage(
        targetTabId,
        { ...candidatePayload(ranked.candidate, latest.sessionId, true), type: 'CODE_FOUND', fieldId: latest.fieldId },
        { frameId: targetFrameId }
      ).catch(() => {});
      pushedCount++;
    } else if (ranked.status === 'none' && request.unreadHints?.length && session.status === 'waiting') {
      const hint = matchingUnreadHint(request.unreadHints, session.origin, session.siteId, session.siteContext ?? {});
      if (hint && await tabMatches(targetTabId, session.origin, session.fieldId, targetFrameId)) {
        chrome.tabs.sendMessage(
          targetTabId,
          {
            type: 'WEBMAIL_UNREAD_PUSH',
            fieldId: session.fieldId,
            webmailTabId: sender.tab.id,
            accountProvider: request.provider,
            accountEmail: request.accountEmail ?? null,
            from: hint.from,
            subject: hint.subject,
            message: 'В открытой вкладке почты появилось новое письмо. Откройте вкладку или письмо для чтения.'
          },
          { frameId: targetFrameId }
        ).catch(() => {});
      }
    }
  }
  return { status: 'ok', pushed: pushedCount };
}

async function scheduleClipboardClear() {
  const { autoClearClipboard } = await chrome.storage.local.get('autoClearClipboard');
  if (autoClearClipboard === false) return false;
  await chrome.storage.session?.set?.({ clipboardClearActive: true });
  chrome.alarms?.create?.('codesnap-clear-clipboard', { delayInMinutes: 0.75 });
  return true;
}

async function notifyInlineToast(tabId, frameId, text) {
  try {
    await chrome.tabs.sendMessage(tabId, { type: 'SHOW_INLINE_TOAST', text }, { frameId });
  } catch { /* Page might not accept messages. */ }
}

async function triggerQuickFill(tab, info = null) {
  const tabId = tab?.id;
  if (!Number.isInteger(tabId)) return { status: 'error', message: 'No active tab.' };
  const frameId = info?.frameId ?? 0;
  const status = await chrome.tabs.sendMessage(tabId, { type: 'FIELD_STATUS' }, { frameId }).catch(() => null);
  const origin = status?.origin || originOf(info?.frameUrl || tab?.url || '');
  if (!origin?.startsWith('https://')) return { status: 'unsupported', message: 'Open an HTTPS website first.' };

  const siteId = siteForOrigin(origin) ?? 'generic';
  const phishingAlert = await getOriginPhishingAlert(origin);
  if (phishingAlert.suspicious) {
    await notifyInlineToast(tabId, frameId, `⚠️ Блокировка фишинга: похоже на клон ${phishingAlert.targetDomain}!`);
    return { status: 'phishing_blocked', phishingAlert };
  }
  const siteContext = status?.siteContext ?? {};
  const totp = await getTotpForSite(origin, siteContext);

  if (status?.isDualField && totp.status === 'found') {
    const emailRes = await search({ tabId, frameId, origin, siteId, fieldId: status.fieldId, detectedAt: status.detectedAt, siteContext, channel: 'email', automatic: false, inline: false });
    if (emailRes.status === 'found' && emailRes.code) {
      if (totp.remainingSeconds <= TOTP_GRACE_SECONDS) {
        await notifyInlineToast(tabId, frameId, '⏳ До смены 2FA ≤3с — ждём свежий код…');
      }
      const dual = await insertDual({ tabId, frameId, origin, sessionId: emailRes.sessionId, siteContext });
      if (dual?.status === 'inserted_dual') {
        await notifyInlineToast(tabId, frameId, '✓ Оба кода (Почта + 2FA) вставлены');
        return dual;
      }
    }
  }

  if (status?.channel === 'authenticator') {
    if (totp.status === 'choose') {
      await chrome.tabs.sendMessage(tabId, { type: 'SHOW_TOTP_CHOOSER', candidates: totp.candidates }, { frameId }).catch(() => {});
      await notifyInlineToast(tabId, frameId, `Найдено ${totp.candidates.length} 2FA-аккаунта — выберите нужную почту`);
      return { status: 'choose', count: totp.candidates.length };
    }
    if (totp.status === 'found') {
      let freshTotp = totp;
      if (totp.remainingSeconds <= TOTP_GRACE_SECONDS) {
        await notifyInlineToast(tabId, frameId, '⏳ До смены 2FA ≤3с — ждём свежий 30-сек код…');
        freshTotp = await awaitFreshTotpResult(now => getTotpById(totp.id, now));
      }
      const inserted = await chrome.tabs.sendMessage(tabId, { type: 'INSERT_TOTP', code: freshTotp.code, origin }, { frameId }).catch(() => null);
      if (inserted?.status === 'inserted') {
        await notifyInlineToast(tabId, frameId, freshTotp.waitedForNextWindow ? '✓ Свежий код 2FA вставлен' : '✓ Код 2FA вставлен');
        return { status: 'inserted_totp', code: freshTotp.code, waitedForNextWindow: Boolean(freshTotp.waitedForNextWindow) };
      }
      if (await copyViaOffscreen(freshTotp.code)) {
        await scheduleClipboardClear();
        await notifyInlineToast(tabId, frameId, `✓ Код 2FA ${freshTotp.code} скопирован`);
        return { status: 'copied_totp', code: freshTotp.code, waitedForNextWindow: Boolean(freshTotp.waitedForNextWindow) };
      }
      return { status: 'error' };
    }
    await notifyInlineToast(tabId, frameId, totp.status === 'locked' ? '🔒 Разблокируйте 2FA в окне CodeSnap' : 'Добавьте секрет 2FA для этого сайта в CodeSnap');
    return { status: totp.status };
  }

  const emailRes = await search({
    tabId,
    frameId,
    origin,
    siteId,
    fieldId: status?.fieldId ?? null,
    detectedAt: status?.detectedAt ?? null,
    siteContext,
    channel: 'email',
    automatic: false,
    inline: false
  });

  if (emailRes.status === 'found' && emailRes.code) {
    if (status?.detected && status.fieldType !== 'link-prompt') {
      const ins = await insert({ tabId, frameId, origin, sessionId: emailRes.sessionId });
      if (ins?.status === 'inserted') {
        await notifyInlineToast(tabId, frameId, '✓ Код подтверждения вставлен');
        return ins;
      }
    }
    const forced = await chrome.tabs.sendMessage(tabId, { type: 'FORCE_INSERT_ACTIVE', code: emailRes.code, origin }, { frameId }).catch(() => null);
    if (forced?.status === 'inserted') {
      const sessionItem = sessions.get(sessionKey(tabId, frameId));
      if (sessionItem) {
        try { await rememberSender(sessionItem); } catch { /* Best effort. */ }
        sessions.delete(sessionKey(tabId, frameId));
      }
      await notifyInlineToast(tabId, frameId, '✓ Код вставлен в активное поле');
      return { status: 'inserted', code: emailRes.code };
    }
    if (await copyViaOffscreen(emailRes.code)) {
      const sessionItem = sessions.get(sessionKey(tabId, frameId));
      if (sessionItem) {
        try { await rememberSender(sessionItem); } catch { /* Best effort. */ }
      }
      await scheduleClipboardClear();
      await notifyInlineToast(tabId, frameId, `✓ Код ${emailRes.code} скопирован в буфер`);
      return { status: 'copied', code: emailRes.code };
    }
  }

  if (emailRes.status === 'found' && emailRes.link?.url) {
    chrome.tabs.sendMessage(tabId, { ...emailRes, type: 'CODE_FOUND', fieldId: status?.fieldId ?? null }, { frameId }).catch(() => {});
    await notifyInlineToast(tabId, frameId, '🔗 Ссылка активации найдена — нажмите на чип для открытия');
    return { status: 'link_ready', link: emailRes.link };
  }

  if (totp.status === 'found') {
    const forced = await chrome.tabs.sendMessage(tabId, { type: 'FORCE_INSERT_ACTIVE', code: totp.code, origin }, { frameId }).catch(() => null);
    if (forced?.status === 'inserted') {
      await notifyInlineToast(tabId, frameId, '✓ Код 2FA вставлен');
      return { status: 'inserted_totp', code: totp.code };
    }
    if (await copyViaOffscreen(totp.code)) {
      await scheduleClipboardClear();
      await notifyInlineToast(tabId, frameId, `✓ Код 2FA ${totp.code} скопирован`);
      return { status: 'copied_totp', code: totp.code };
    }
  }

  await notifyInlineToast(tabId, frameId, emailRes.message || 'Свежий код подтверждения не найден');
  return { status: emailRes.status ?? 'none' };
}

async function trustCandidate({ tabId, origin, sessionId }) {
  const item = sessions.valid(sessionKey(tabId), origin, sessionId);
  if (!await candidateEnabled(item)) return { status: 'expired', message: 'Local webmail is disabled.' };
  if (!item || !(await tabMatches(tabId, origin, item.fieldId))) return { status: 'expired', message: 'Search again.' };
  await rememberSender(item);
  item.used = true;
  return { status: 'remembered' };
}

async function selectCandidate({ tabId, frameId = 0, origin, sessionId, index }) {
  const key = sessionKey(tabId, frameId);
  const item = sessions.get(key);
  if (!item || item.sessionId !== sessionId || item.origin !== origin || !Array.isArray(item.candidates)) return { status: 'expired', message: 'Search again.' };
  if (!(await tabMatches(tabId, origin, item.fieldId, frameId))) return { status: 'changed', message: 'Tab changed. Search again.' };
  const candidate = item.candidates[index];
  if (!Number.isInteger(index) || index < 0 || !candidate || !candidateIsFresh(candidate)) return { status: 'old', message: 'Old code.' };
  if (!await candidateEnabled(candidate)) return { status: 'expired', message: 'Local webmail is disabled.' };
  sessions.set(key, { ...item, status: 'found', candidates: undefined, ...candidate });
  return candidatePayload(candidate, sessionId, false);
}

chrome.runtime.onMessage.addListener((request, sender, respond) => {
  (async () => {
    await protectLocalStorage;
    const pageOrigin = sender.tab?.id != null ? originOf(sender.url) : null;
    if (pageOrigin?.startsWith('https://')) {
      if (request.type === 'GET_WEBMAIL_ENABLED') {
        return { enabled: Boolean(detectWebmailProviderFromUrl(sender.url)) && await isLocalWebmailEnabled() };
      }
      if (request.type === 'GET_CONTENT_SETTINGS') {
        return chrome.storage.local.get(contentSettingsKeys);
      }
      if (request.type === 'MUTE_CONTENT_ORIGIN') {
        const { mutedOrigins = [] } = await chrome.storage.local.get('mutedOrigins');
        await chrome.storage.local.set({ mutedOrigins: [...new Set([...mutedOrigins, pageOrigin])] });
        return { status: 'ok' };
      }
      if (request.type === 'SAVE_CONTENT_FIELD') {
        const { descriptor } = request;
        if (!['email', 'authenticator'].includes(descriptor?.channel)) return { status: 'error' };
        const { customFieldSelectors = {} } = await chrome.storage.local.get('customFieldSelectors');
        await chrome.storage.local.set({ customFieldSelectors: {
          ...customFieldSelectors, [pageOrigin]: { ...descriptor, updatedAt: Date.now() }
        } });
        return { status: 'ok' };
      }
    }
    if (request.type === 'WEBMAIL_READY' || request.type === 'WEBMAIL_PUSH') {
      return handleWebmailPush(request, sender);
    }
    if (request.type === 'LICENSE_ACTION') {
      const isExtPage = sender.url?.startsWith(`chrome-extension://${chrome.runtime?.id}/src/`) || (!sender.tab && !sender.url);
      if (!isExtPage) return { status: 'untrusted', message: 'Invalid page.' };
      const payload = request.payload ?? {};
      const command = payload.command;
      if (command === 'status') return { ...(await getProStatus()), status: 'ok' };
      if (command === 'activate') {
        const res = await activateProLicense(payload.key);
        return res.ok ? { ...res, status: 'ok' } : { ...res, status: 'error' };
      }
      if (command === 'deactivate') return { ...(await deactivateProLicense()), status: 'ok' };
      return { status: 'untrusted', message: 'Invalid request.' };
    }
    if (request.type === 'TOTP_ACTION') {
      const isPopup = sender.url?.startsWith(`chrome-extension://${chrome.runtime?.id}/src/`) || (!sender.tab && !sender.url);
      if (!isPopup) return { status: 'untrusted', message: 'Invalid page.' };
      const payload = request.payload ?? {};
      const command = payload.command;
      try {
        if (command === 'status') {
          await ensureTotpHintsFresh();
          const vaultStatus = await getTotpVaultStatus();
          const tabSession = Number.isInteger(payload.tabId) ? sessions.get(sessionKey(payload.tabId, 0)) : null;
          const mergedCtx = {
            ...(payload.siteContext ?? {}),
            matchedEmailAccount: payload.matchedEmailAccount || (tabSession?.status === 'found' ? tabSession.accountEmail : null)
          };
          const siteMatch = payload.origin ? await getTotpCandidatesForSite(payload.origin, mergedCtx) : { status: 'none', candidates: [] };
          const phishingAlert = payload.origin ? await getOriginPhishingAlert(payload.origin) : { suspicious: false };
          const clockState = await getTotpClockState();
          const proStatus = await getProStatus();
          return { status: 'ok', ...vaultStatus, siteMatch, phishingAlert, clockState, proStatus };
        }
        if (command === 'list_all') {
          await ensureTotpHintsFresh();
          const tabSession = Number.isInteger(payload.tabId) ? sessions.get(sessionKey(payload.tabId, 0)) : null;
          const mergedCtx = {
            ...(payload.siteContext ?? {}),
            matchedEmailAccount: payload.matchedEmailAccount || (tabSession?.status === 'found' ? tabSession.accountEmail : null)
          };
          const list = await listAllTotpCodes(payload.origin || '', mergedCtx);
          const phishingAlert = payload.origin ? await getOriginPhishingAlert(payload.origin) : { suspicious: false };
          const clockState = await getTotpClockState();
          const proStatus = await getProStatus();
          return { ...list, status: 'ok', vaultLocked: list.status === 'locked', phishingAlert, clockState, proStatus };
        }
        if (command === 'add') {
          const pro = await getProStatus();
          if (!pro.isPro) {
            const vaultStatus = await getTotpVaultStatus();
            if ((vaultStatus.count ?? 0) >= FREE_TOTP_LIMIT) {
              return { status: 'pro_required', message: `В бесплатной версии доступно до ${FREE_TOTP_LIMIT} ключей 2FA. Активируйте ключ CodeSnap Pro (CS1-…) для безлимитного сейфа!` };
            }
          }
          return { status: 'ok', ...await addTotpAccount(payload.input, payload.meta ?? {}) };
        }
        if (command === 'update') return await updateTotpAccount(payload.id, payload.patch ?? {});
        if (command === 'import') {
          const pro = await getProStatus();
          return await importTotpPayload(payload.text, payload.meta ?? {}, Date.now(), {
            maxTotal: pro.isPro ? Infinity : FREE_TOTP_LIMIT
          });
        }
        if (command === 'export') return { status: 'ok', data: await exportTotpVault(payload.format || 'txt') };
        if (command === 'export_uri') return { status: 'ok', ...await exportTotpAccountUri(payload.id) };
        if (command === 'set_time_offset') return { status: 'ok', clockState: await setTotpTimeOffset(payload.offsetSeconds) };
        if (command === 'check_clock_skew') return { status: 'ok', ...await measureServerClockSkew({ autoApply: Boolean(payload.autoApply) }) };
        if (command === 'add_entries') {
          const list = Array.isArray(payload.entries) ? payload.entries : [];
          if (!list.length) return { status: 'error', message: 'Не найдено ни одной 2FA-записи.' };
          const pro = await getProStatus();
          if (!pro.isPro) {
            const vaultStatus = await getTotpVaultStatus();
            if ((vaultStatus.count ?? 0) + list.length > FREE_TOTP_LIMIT) {
              return { status: 'pro_required', message: `В бесплатной версии доступно до ${FREE_TOTP_LIMIT} ключей 2FA. Активируйте ключ CodeSnap Pro (CS1-…) для добавления всех ключей!` };
            }
          }
          const added = [];
          for (const item of list) {
            added.push(await addTotpAccount(item.secret, {
              issuer: item.issuer,
              account: item.account,
              domain: item.domain,
              algorithm: item.algorithm,
              digits: item.digits,
              period: item.period
            }));
          }
          return { status: 'ok', count: added.length, first: added[0], added };
        }
        if (command === 'scan_add') {
          const pro = await getProStatus();
          if (!pro.isPro) {
            const vaultStatus = await getTotpVaultStatus();
            if ((vaultStatus.count ?? 0) >= FREE_TOTP_LIMIT) {
              return { status: 'pro_required', message: `В бесплатной версии доступно до ${FREE_TOTP_LIMIT} ключей 2FA. Активируйте ключ CodeSnap Pro (CS1-…)!` };
            }
          }
          if (!Number.isInteger(payload.tabId)) return { status: 'error', message: 'Откройте вкладку с настройкой 2FA.' };
          const scan = await chrome.tabs.sendMessage(payload.tabId, { type: 'SCAN_PAGE_TOTP' }, { frameId: 0 }).catch(() => null);
          if (scan?.status !== 'found') {
            return { status: 'error', message: scan?.message || 'На странице не найден QR-код или секретный ключ 2FA.' };
          }
          const added = await addTotpAccount(scan.uri || scan.secret, { issuer: scan.issuer, domain: scan.domain });
          return { status: 'ok', source: scan.source, ...added };
        }
        if (command === 'remove') return { status: 'ok', ...await removeTotpAccount(payload.id) };
        if (command === 'unlock') return { status: 'ok', ...await unlockTotpVault(payload.passphrase) };
        if (command === 'lock') return { status: 'ok', ...await lockTotpVault() };
        if (command === 'set_pin') return { status: 'ok', ...await setTotpPassphrase(payload.newPassphrase, payload.currentPassphrase) };
        if (command === 'code_by_id') return { status: 'ok', ...await getTotpById(payload.id) };
        if (command === 'fresh_code_by_id') {
          const fresh = await awaitFreshTotpResult(now => getTotpById(payload.id, now));
          return { status: 'ok', ...fresh };
        }
        if (command === 'insert_totp') {
          const phishingAlert = await getOriginPhishingAlert(payload.origin);
          if (phishingAlert.suspicious) return phishingBlockedPayload(phishingAlert);
          const totp = await awaitFreshTotpResult(now =>
            payload.id ? getTotpById(payload.id, now) : getTotpForSite(payload.origin, payload.siteContext ?? {}, now)
          );
          if (totp.status !== 'found') return { status: 'error', message: totp.status === 'locked' ? 'Разблокируйте 2FA PIN-кодом.' : 'Подходящий 2FA-секрет не найден.' };
          if (!Number.isInteger(payload.tabId) || !(await tabMatches(payload.tabId, payload.origin))) {
            return { status: 'changed', message: 'The verification page changed.' };
          }
          const res = await chrome.tabs.sendMessage(payload.tabId, { type: 'INSERT_TOTP', code: totp.code, origin: payload.origin }, { frameId: 0 });
          return { ...(res ?? { status: 'error', message: '2FA field not found.' }), code: totp.code, remainingSeconds: totp.remainingSeconds, waitedForNextWindow: Boolean(totp.waitedForNextWindow) };
        }
        return { status: 'untrusted', message: 'Invalid request.' };
      } catch (error) {
        return { status: error?.message === 'TOTP_PRO_LIMIT' ? 'pro_required' : 'error', message: describeTotpError(error) };
      }
    }
    if (request.type === 'TRUST_PHISHING_ORIGIN') {
      const isExtPage = sender.url?.startsWith(`chrome-extension://${chrome.runtime?.id}/src/`) || (!sender.tab && !sender.url);
      const fromMatchingTab = Boolean(sender.tab?.id && originOf(sender.url) === request.origin);
      if ((!isExtPage && !fromMatchingTab) || !request.origin?.startsWith('https://')) {
        return { status: 'untrusted', message: 'Invalid request.' };
      }
      const { phishingTrustedOrigins = [] } = await chrome.storage.local.get('phishingTrustedOrigins');
      const next = [...new Set([...(Array.isArray(phishingTrustedOrigins) ? phishingTrustedOrigins : []), request.origin])];
      await chrome.storage.local.set({ phishingTrustedOrigins: next });
      return { status: 'ok', trustedOrigins: next };
    }
    if (request.type === 'START_QR_SNIPER') {
      const isExtPage = sender.url?.startsWith(`chrome-extension://${chrome.runtime?.id}/src/`) || (!sender.tab && !sender.url);
      if (!isExtPage || !Number.isInteger(request.tabId)) return { status: 'untrusted', message: 'Invalid tab.' };
      const res = await chrome.tabs.sendMessage(request.tabId, { type: 'BEGIN_QR_SNIPER' }, { frameId: 0 }).catch(() => null);
      return res ?? { status: 'error', message: 'Обновите страницу (F5) и попробуйте снова.' };
    }
    if (request.type === 'FINISH_QR_SNIPER') {
      if (!sender.tab?.id || !request.origin?.startsWith('https://')) return { status: 'untrusted', message: 'Invalid page.' };
      if (sender.url && originOf(sender.url) !== request.origin) return { status: 'untrusted', message: 'Invalid origin.' };
      const [active] = await chrome.tabs.query({ active: true, windowId: sender.tab.windowId });
      if (active?.id !== sender.tab.id || sender.frameId !== 0 || (active.url && originOf(active.url) !== request.origin)) {
        return { status: 'changed', message: 'The verification page changed.' };
      }
      const shot = await chrome.tabs.captureVisibleTab(sender.tab.windowId, { format: 'png' }).catch(() => null);
      const [stillActive] = await chrome.tabs.query({ active: true, windowId: sender.tab.windowId });
      if (stillActive?.id !== active.id || stillActive.url !== active.url) return { status: 'changed' };
      const host = new URL(request.origin).hostname.replace(/^www\./, '');
      const decoded = new Set();
      if (shot) {
        for (const str of await decodeCroppedQrDataUrl(shot, request.rect)) decoded.add(str);
      }
      let classified = classifyQrStringsForTotp([...decoded], { issuer: host, domain: host });
      if (classified.status !== 'found' && Array.isArray(request.regionVisualUrls)) {
        const domDecoded = [];
        for (const vUrl of request.regionVisualUrls.slice(0, 6)) {
          if (typeof vUrl !== 'string' || !vUrl.startsWith('data:image/')) continue;
          domDecoded.push(...await decodeCroppedQrDataUrl(vUrl, null));
        }
        classified = classifyQrStringsForTotp(domDecoded, { issuer: host, domain: host });
      }
      if (classified.status !== 'found') {
        await notifyInlineToast(sender.tab.id, sender.frameId ?? 0, classified.message || 'QR-код 2FA в выделении не найден.');
        return classified;
      }
      const added = [];
      for (const item of classified.entries) {
        added.push(await addTotpAccount(item.secret, {
          issuer: item.issuer || host,
          account: item.account,
          domain: item.domain || host,
          algorithm: item.algorithm,
          digits: item.digits,
          period: item.period
        }));
      }
      await notifyInlineToast(sender.tab.id, sender.frameId ?? 0, '✓ Ключ 2FA добавлен');
      return { status: 'ok', count: added.length };
    }
    if (request.type === 'START_FIELD_PICKER') {
      const isExtPage = sender.url?.startsWith(`chrome-extension://${chrome.runtime?.id}/src/`) || (!sender.tab && !sender.url);
      if (!isExtPage || !Number.isInteger(request.tabId)) return { status: 'untrusted', message: 'Invalid tab.' };
      const res = await chrome.tabs.sendMessage(request.tabId, { type: 'BEGIN_FIELD_PICKER', defaultChannel: request.defaultChannel || 'email' }, { frameId: 0 }).catch(() => null);
      return res ?? { status: 'error', message: 'Обновите страницу (F5) и попробуйте снова.' };
    }
    if (request.type === 'CLEAR_CUSTOM_FIELD') {
      const isExtPage = sender.url?.startsWith(`chrome-extension://${chrome.runtime?.id}/src/`) || (!sender.tab && !sender.url);
      if (!isExtPage || !request.origin?.startsWith('https://')) return { status: 'untrusted', message: 'Invalid request.' };
      const { customFieldSelectors = {} } = await chrome.storage.local.get('customFieldSelectors');
      const next = { ...(customFieldSelectors ?? {}) };
      delete next[request.origin];
      await chrome.storage.local.set({ customFieldSelectors: next });
      return { status: 'ok' };
    }
    if (request.type === 'GET_TOTP_INLINE') {
      if (!sender.tab?.id || originOf(sender.url) !== request.origin) return { status: 'untrusted', message: 'Invalid page.' };
      await ensureTotpHintsFresh();
      const tabSession = sessions.get(sessionKey(sender.tab.id, sender.frameId ?? 0));
      const mergedCtx = {
        ...(request.siteContext ?? {}),
        matchedEmailAccount: request.matchedEmailAccount || (tabSession?.status === 'found' ? tabSession.accountEmail : null),
        preferredTotpId: request.preferredTotpId || null
      };
      return getTotpCandidatesForSite(request.origin, mergedCtx);
    }
    if (request.type === 'INSERT_TOTP_INLINE') {
      if (!sender.tab?.id || originOf(sender.url) !== request.origin) return { status: 'untrusted', message: 'Invalid page.' };
      const phishingAlert = await getOriginPhishingAlert(request.origin);
      if (phishingAlert.suspicious) return phishingBlockedPayload(phishingAlert);
      const totp = await awaitFreshTotpResult(now =>
        request.totpId
          ? getTotpById(request.totpId, now)
          : getTotpCandidatesForSite(request.origin, { ...(request.siteContext ?? {}), matchedEmailAccount: request.matchedEmailAccount || null }, now)
      );
      if (totp.status === 'choose') return { status: 'choose', candidates: totp.candidates };
      if (totp.status !== 'found') return { status: totp.status === 'locked' ? 'locked' : 'expired', message: '2FA code unavailable.' };
      const ins = await chrome.tabs.sendMessage(sender.tab.id, { type: 'INSERT_TOTP', code: totp.code, origin: request.origin }, { frameId: sender.frameId ?? 0 });
      return { ...(ins ?? { status: 'error' }), code: totp.code, remainingSeconds: totp.remainingSeconds, counter: totp.counter, waitedForNextWindow: Boolean(totp.waitedForNextWindow) };
    }
    if (request.type === 'INSERT_DUAL_INLINE') {
      if (!sender.tab?.id || originOf(sender.url) !== request.origin) return { status: 'untrusted', message: 'Invalid page.' };
      return insertDual({ tabId: sender.tab.id, frameId: sender.frameId ?? 0, origin: request.origin, sessionId: request.sessionId, siteContext: request.siteContext ?? {}, totpId: request.totpId ?? null });
    }
    if (request.type === 'INSERT_DUAL_POPUP' && !sender.tab) {
      return insertDual(request);
    }
    if (request.type === 'SPLIT_PASTE_POPUP' && !sender.tab) {
      if (!Number.isInteger(request.tabId) || !request.origin?.startsWith('https://')) {
        return { status: 'error', message: 'Open an HTTPS website first.' };
      }
      const phishingAlert = await getOriginPhishingAlert(request.origin);
      if (phishingAlert.suspicious) return phishingBlockedPayload(phishingAlert);
      const res = await chrome.tabs.sendMessage(
        request.tabId,
        { type: 'INSERT_SPLIT_CODE', code: request.code, origin: request.origin },
        { frameId: 0 }
      ).catch(() => null);
      return res ?? { status: 'error', message: 'Подходящие ячейки для вставки не найдены.' };
    }
    if (request.type === 'TRIGGER_QUICK_FILL' && !sender.tab) {
      const targetTab = request.tab ?? (Number.isInteger(request.tabId) ? await chrome.tabs.get(request.tabId).catch(() => null) : null);
      return triggerQuickFill(targetTab, request.frameId ? { frameId: request.frameId } : null);
    }
    if (request.type === 'LOCAL_MAIL_ACTION') {
      if (sender.url !== `chrome-extension://${chrome.runtime.id}/src/popup.html`) return { status: 'untrusted', message: 'Invalid page.' };
      const command = request.payload?.command;
      if (command === 'list') return { status: 'ok', accounts: await listLocalMailAccounts() };
      if (command === 'connect') {
        try { return { status: 'ok', ...await connectLocalProvider(request.payload) }; }
        catch (error) { return { status: 'error', message: describeLocalMailError(error) }; }
      }
      if (command === 'remove') return await removeLocalAccount(request.payload.id);
      if (command === 'focus') return { status: await focusWebmailTab(request.payload.tabId) ? 'ok' : 'error' };
      return { status: 'untrusted', message: 'Invalid request.' };
    }
    if (request.type === 'FOCUS_WEBMAIL') {
      const fromPopup = sender.url === `chrome-extension://${chrome.runtime.id}/src/popup.html`;
      const fromTab = Boolean(sender.tab?.id && originOf(sender.url) === request.origin);
      if (!fromPopup && !fromTab) return { status: 'untrusted', message: 'Invalid page.' };
      const accounts = await listLocalMailAccounts();
      const target = accounts.find(a => a.kind === 'webmail-tab' && a.tabId === request.webmailTabId);
      if (!target) return { status: 'error', message: 'Webmail tab is closed.' };
      return { status: await focusWebmailTab(target.tabId) ? 'ok' : 'error' };
    }
    if (request.type === 'SEARCH_INLINE') {
      if (!sender.tab?.id || originOf(sender.url) !== request.origin) return { status: 'untrusted', message: 'Invalid page.' };
      const siteId = siteForOrigin(request.origin) ?? 'generic';
      return search({ tabId: sender.tab.id, frameId: sender.frameId ?? 0, origin: request.origin, siteId, fieldId: request.fieldId, detectedAt: request.detectedAt, siteContext: request.siteContext, channel: request.channel, automatic: request.automatic === true, inline: true });
    }
    if (request.type === 'SEARCH_POPUP' && !sender.tab) return search(request);
    if (request.type === 'INSERT_POPUP' && !sender.tab) return insert(request);
    if (request.type === 'OPEN_LINK_POPUP' && !sender.tab) return openLink(request);
    if (request.type === 'TRUST_CANDIDATE' && !sender.tab) return trustCandidate(request);
    if (request.type === 'SELECT_CANDIDATE' && !sender.tab) return selectCandidate(request);
    if (request.type === 'SELECT_INLINE_CANDIDATE') {
      if (!sender.tab?.id || originOf(sender.url) !== request.origin) return { status: 'untrusted', message: 'Invalid page.' };
      return selectCandidate({ tabId: sender.tab.id, frameId: sender.frameId ?? 0, origin: request.origin, sessionId: request.sessionId, index: request.index });
    }
    if (request.type === 'INSERT_INLINE') {
      if (!sender.tab?.id || originOf(sender.url) !== request.origin) return { status: 'untrusted', message: 'Invalid page.' };
      return insert({ tabId: sender.tab.id, frameId: sender.frameId ?? 0, origin: request.origin, sessionId: request.sessionId });
    }
    if (request.type === 'OPEN_LINK_INLINE') {
      if (!sender.tab?.id || originOf(sender.url) !== request.origin) return { status: 'untrusted', message: 'Invalid page.' };
      return openLink({ tabId: sender.tab.id, frameId: sender.frameId ?? 0, origin: request.origin, sessionId: request.sessionId });
    }
    if (request.type === 'COPY_CLIPBOARD') {
      const ok = await copyViaOffscreen(request.text);
      if (ok && request.text) await scheduleClipboardClear();
      return { status: ok ? 'copied' : 'error' };
    }
    if (request.type === 'CLIPBOARD_COPIED') {
      await scheduleClipboardClear();
      return { status: 'scheduled' };
    }
    return { status: 'error', message: 'Unknown request.' };
  })().then(respond, () => respond({ status: 'error', message: 'Request failed.' }));
  return true;
});

chrome.storage.onChanged.addListener((changes, area) => {
  const publicChanges = {};
  if (area === 'local') {
    for (const key of contentSettingsKeys) {
      if (changes[key]) publicChanges[key] = { newValue: changes[key].newValue };
    }
    if (changes.primaryEmail) publicChanges.primaryEmail = {};
  }
  if (area === 'session' && changes.extraAccounts) publicChanges.extraAccounts = {};
  if (!Object.keys(publicChanges).length) return;
  void chrome.tabs.query({}).then(tabs => {
    for (const { id } of tabs) {
      void chrome.tabs.sendMessage(id, { type: 'CONTENT_SETTINGS_CHANGED', area, changes: publicChanges }).catch(() => {});
    }
  }).catch(() => {});
});

async function copyViaOffscreen(text) {
  if (!chrome.offscreen?.createDocument) return false;
  const offscreenUrl = chrome.runtime.getURL('src/offscreen.html');
  try {
    const existing = await chrome.runtime.getContexts?.({
      contextTypes: ['OFFSCREEN_DOCUMENT'],
      documentUrls: [offscreenUrl]
    });
    if (!existing || existing.length === 0) {
      await chrome.offscreen.createDocument({
        url: offscreenUrl,
        reasons: ['CLIPBOARD'],
        justification: 'Copy verification code to clipboard'
      });
    }
    const res = await chrome.runtime.sendMessage({ type: 'OFFSCREEN_CLIPBOARD_WRITE', text });
    return Boolean(res?.ok);
  } catch {
    return false;
  }
}

function setupContextMenus() {
  if (!chrome.contextMenus?.create) return;
  const createItem = () => {
    try {
      chrome.contextMenus.create({
        id: 'codesnap-fill-code',
        title: chrome.i18n?.getMessage('contextMenuFill') || 'CodeSnap: Find & insert verification code',
        contexts: ['editable', 'page'],
        documentUrlPatterns: ['https://*/*']
      });
    } catch { /* Ignore duplicate or unsupported context menu creation. */ }
  };
  if (typeof chrome.contextMenus.removeAll === 'function') {
    try { chrome.contextMenus.removeAll(createItem); } catch { createItem(); }
  } else {
    createItem();
  }
}

chrome.runtime?.onInstalled?.addListener?.(() => {
  setupContextMenus();
  void refreshTotpSiteHints().catch(() => {});
});
chrome.runtime?.onStartup?.addListener?.(() => {
  setupContextMenus();
  void refreshTotpSiteHints().catch(() => {});
});
chrome.contextMenus?.onClicked?.addListener?.((info, tab) => {
  if (info?.menuItemId === 'codesnap-fill-code' && tab) {
    void triggerQuickFill(tab, info);
  }
});
chrome.commands?.onCommand?.addListener?.(async command => {
  if (command !== 'fill-verification-code') return;
  const tabs = await chrome.tabs?.query?.({ active: true, lastFocusedWindow: true }).catch(() => []);
  const tab = tabs?.[0] ?? (await chrome.tabs?.query?.({ active: true, currentWindow: true }).catch(() => []))?.[0];
  if (tab) await triggerQuickFill(tab);
});
chrome.alarms?.onAlarm?.addListener?.(async alarm => {
  if (alarm?.name !== 'codesnap-clear-clipboard') return;
  const { autoClearClipboard } = await chrome.storage.local.get('autoClearClipboard');
  if (autoClearClipboard === false) return;
  await copyViaOffscreen('');
  await chrome.storage.session?.set?.({ clipboardClearActive: false });
});

chrome.tabs.onRemoved.addListener(tabId => {
  sessions.deleteTab(tabId);
  unregisterWebmailTab(tabId);
});
chrome.tabs.onUpdated.addListener((tabId, changes) => {
  if (changes.url) sessions.deleteTab(tabId);
});
setInterval(() => sessions.expire(), 60_000);
