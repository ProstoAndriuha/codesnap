import { siteForOrigin, trustedOrigin, normalizeSender, rankCandidates, candidateIsFresh, SEARCH_WINDOW_SECONDS } from './core.js';
import { findMessages, findHistoryMessages, getGmailHistoryId } from './gmail.js';
import { SessionStore } from './sessions.js';
import { getAccessTokens, forgetAdditional } from './auth.js';
import { mailHost, listMailAccounts, describeMailError, connectYandex } from './mail-bridge.js';

const sessions = new SessionStore();
const errors = {
  AUTH_EXPIRED: 'Gmail authorization expired. Connect again in the popup.',
  PERMISSION_DENIED: 'Gmail access was denied. Check OAuth setup and permissions.',
  RATE_LIMIT: 'Gmail rate limit reached. Try again later.',
  GMAIL_UNAVAILABLE: 'Gmail is unavailable. Try again later.'
};

function originOf(url) { try { return new URL(url).origin; } catch { return null; } }
const sessionKey = (tabId, frameId = 0) => `${tabId}:${frameId}`;

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
  const { accountSelections = {} } = await chrome.storage.local.get('accountSelections');
  const selected = accountSelection ?? accountSelections[origin] ?? 'all';
  const searchKeyBase = `${siteId}|${learnedSenders.join(',')}|${selected}`;
  const searchKey = `${searchKeyBase}|${automatic ? 'auto' : 'manual'}`;
  const previous = sessions.get(key);
  const codeNotReplaced = !previous?.used && (!detectedAt || !previous?.timestamp || previous.timestamp >= detectedAt - 5000);
  const sameContext = previous?.origin === origin && (previous.fieldId === fieldId || !fieldId || !previous.fieldId) && previous.searchKeyBase === searchKeyBase && Date.now() - previous.created < SEARCH_WINDOW_SECONDS * 1000;
  if (sameContext && previous.status === 'found' && codeNotReplaced && candidateIsFresh(previous)) return { status: inline && previous.requiresReview ? 'review' : 'found', code: previous.code, timestamp: previous.timestamp, lifetimeSeconds: previous.lifetimeSeconds, from: previous.from, subject: previous.subject, requiresReview: previous.requiresReview, accountEmail: previous.accountEmail, accountProvider: previous.accountProvider, sessionId: previous.sessionId };
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
    let mailAccounts = [], mailError = null;
    if (selected === 'all' || selected.startsWith('mail:')) {
      try { mailAccounts = (await listMailAccounts(true)).filter(account => selected === 'all' || selected === `mail:${account.id}`); }
      catch (error) { mailError = error; }
    }
    if (!accounts.length && !mailAccounts.length) throw mailError ?? googleError ?? new Error(selected.startsWith('mail:') ? 'MAIL_AUTH_FAILED' : 'AUTH_EXPIRED');
    async function fetchAccounts(broad = false) {
      const nativePending = Promise.allSettled(mailAccounts.map(async account => {
        const result = await mailHost({ command: 'search', id: account.id, maxAgeSeconds: SEARCH_WINDOW_SECONDS });
        return result.messages.map(message => ({ ...message, accountEmail: account.email, accountProvider: account.provider }));
      }));
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
      const nativeResults = await nativePending;
      const combined = [...results, ...nativeResults];
      if (combined.every(result => result.status === 'rejected')) throw combined[0].reason;
      return combined.flatMap(result => result.status === 'fulfilled' ? result.value : []);
    }
    const messages = await fetchAccounts();
    if (sessions.get(key)?.sessionId !== sessionId || session.searchSeq !== searchSeq || !(await tabMatches(tabId, origin, fieldId, frameId))) {
      return { status: 'changed', message: 'Tab changed. Search again.' };
    }
    const rank = items => rankCandidates(items, { siteId, learnedSenders, origin, siteContext, startedAt: automatic ? startedAt : null, startToleranceMs: 180_000 });
    let ranked = rank(messages);
    if ((ranked.status === 'none' || ranked.status === 'old') && (!automatic || searchSeq === 1 || session.historyReset || !Object.keys(session.historyIds ?? {}).length)) {
      const more = await fetchAccounts(true);
      session.historyReset = false;
      if (sessions.get(key)?.sessionId !== sessionId || session.searchSeq !== searchSeq || !(await tabMatches(tabId, origin, fieldId, frameId))) {
        return { status: 'changed', message: 'Tab changed. Search again.' };
      }
      ranked = rank([...messages, ...more]);
    }
    if (ranked.status === 'found') {
      sessions.set(key, { ...session, status: 'found', ...ranked.candidate });
      return { status: inline && ranked.candidate.requiresReview ? 'review' : 'found', code: ranked.candidate.code, timestamp: ranked.candidate.timestamp, lifetimeSeconds: ranked.candidate.lifetimeSeconds, from: ranked.candidate.from, subject: ranked.candidate.subject, requiresReview: ranked.candidate.requiresReview, accountEmail: ranked.candidate.accountEmail, accountProvider: ranked.candidate.accountProvider, sessionId };
    }
    if (ranked.status === 'ambiguous') {
      sessions.set(key, { ...session, status: 'ambiguous', candidates: ranked.candidates });
      return { status: 'ambiguous', message: 'Several recent codes found. Choose the email you requested.', candidates: ranked.candidates.map(({ code, timestamp, accountEmail, accountProvider, from, subject, lifetimeSeconds, requiresReview }, index) => ({ code, timestamp, accountEmail, accountProvider, from, subject, lifetimeSeconds, requiresReview, index })), sessionId };
    }
    sessions.set(key, { ...session, status: 'waiting' });
    return { status: ranked.status, message: ranked.status === 'old' ? 'Old code.' : `No recent ${siteId === 'generic' ? '' : siteId + ' '}verification email.` };
  } catch (error) {
    if (sessions.get(key)?.sessionId === sessionId && session.searchSeq === searchSeq) sessions.delete(key);
    return { status: 'error', message: errors[error.message] ?? (error.message.startsWith('MAIL_') ? describeMailError(error) : 'Connect a mail account in CodeSnap.') };
  }
}

async function insert({ tabId, frameId = 0, origin, sessionId }) {
  const key = sessionKey(tabId, frameId);
  const item = sessions.valid(key, origin, sessionId);
  if (!item) return { status: 'expired', message: 'Code expired. Search again.' };
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

async function rememberSender(item) {
  const address = normalizeSender(item.from);
  if (!address) return;
  const key = item.siteId === 'generic' ? item.origin : item.siteId;
  const { learnedSenders = {} } = await chrome.storage.local.get('learnedSenders');
  learnedSenders[key] = [...new Set([...(Array.isArray(learnedSenders[key]) ? learnedSenders[key] : []).map(normalizeSender).filter(Boolean), address])].slice(-5);
  await chrome.storage.local.set({ learnedSenders });
}

async function trustCandidate({ tabId, origin, sessionId }) {
  const item = sessions.valid(sessionKey(tabId), origin, sessionId);
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
  sessions.set(key, { ...item, status: 'found', candidates: undefined, ...candidate });
  return { status: 'found', code: candidate.code, timestamp: candidate.timestamp, lifetimeSeconds: candidate.lifetimeSeconds, from: candidate.from, subject: candidate.subject, requiresReview: candidate.requiresReview, accountEmail: candidate.accountEmail, accountProvider: candidate.accountProvider, sessionId };
}

chrome.runtime.onMessage.addListener((request, sender, respond) => {
  (async () => {
    if (request.type === 'MAIL_YANDEX_CONNECT') {
      if (sender.url !== `chrome-extension://${chrome.runtime.id}/src/popup.html` || request.consent !== true) return { status: 'untrusted', message: 'Invalid page.' };
      try { return { status: 'ok', ...await connectYandex() }; } catch (error) { return { status: 'error', message: describeMailError(error) }; }
    }
    if (request.type === 'MAIL_ACCOUNT') {
      if (sender.url !== `chrome-extension://${chrome.runtime.id}/src/popup.html`) return { status: 'untrusted', message: 'Invalid page.' };
      if (!['list', 'connect', 'remove'].includes(request.payload?.command)) return { status: 'untrusted', message: 'Invalid request.' };
      try { return { status: 'ok', ...await mailHost(request.payload) }; }
      catch (error) { return { status: 'error', message: describeMailError(error) }; }
    }
    if (request.type === 'SEARCH_INLINE') {
      if (!sender.tab?.id || originOf(sender.url) !== request.origin) return { status: 'untrusted', message: 'Invalid page.' };
      const siteId = siteForOrigin(request.origin) ?? 'generic';
      return search({ tabId: sender.tab.id, frameId: sender.frameId ?? 0, origin: request.origin, siteId, fieldId: request.fieldId, detectedAt: request.detectedAt, siteContext: request.siteContext, channel: request.channel, automatic: request.automatic === true, inline: true });
    }
    if (request.type === 'SEARCH_POPUP' && !sender.tab) return search(request);
    if (request.type === 'INSERT_POPUP' && !sender.tab) return insert(request);
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
    if (request.type === 'COPY_CLIPBOARD') {
      const ok = await copyViaOffscreen(request.text);
      return { status: ok ? 'copied' : 'error' };
    }
    return { status: 'error', message: 'Unknown request.' };
  })().then(respond, () => respond({ status: 'error', message: 'Request failed.' }));
  return true;
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

chrome.tabs.onRemoved.addListener(tabId => sessions.deleteTab(tabId));
chrome.tabs.onUpdated.addListener((tabId, changes) => {
  if (changes.url) sessions.deleteTab(tabId);
});
setInterval(() => sessions.expire(), 60_000);
