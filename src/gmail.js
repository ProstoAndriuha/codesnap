import { CODE_MAX_AGE_SECONDS } from './core.js';

const API = 'https://gmail.googleapis.com/gmail/v1/users/me/messages';
const PROFILE_API = 'https://gmail.googleapis.com/gmail/v1/users/me/profile';
const HISTORY_API = 'https://gmail.googleapis.com/gmail/v1/users/me/history';

function decodeBase64Url(input) {
  const binary = atob(input.replace(/-/g, '+').replace(/_/g, '/'));
  return new TextDecoder().decode(Uint8Array.from(binary, char => char.charCodeAt(0)));
}

function bodyText(payload) {
  if (!payload) return '';
  if (payload.mimeType === 'text/plain' && payload.body?.data) return decodeBase64Url(payload.body.data);
  const plain = (payload.parts ?? []).map(bodyText).filter(Boolean).join('\n');
  if (plain) return plain;
  if (payload.mimeType === 'text/html' && payload.body?.data) {
    return decodeBase64Url(payload.body.data).replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]*>/g, ' ');
  }
  return '';
}

export async function apiFetch(url, token, retries = 3) {
  let attempt = 0;
  while (true) {
    let response;
    try {
      response = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
    } catch {
      if (attempt < retries) {
        attempt++;
        const delay = Math.min(3000, 150 * Math.pow(2, attempt) + Math.random() * 50);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      throw new Error('GMAIL_UNAVAILABLE');
    }

    if (response.status === 429 || (response.status >= 500 && response.status <= 504)) {
      if (attempt < retries) {
        attempt++;
        const retryAfter = response.headers?.get?.('Retry-After');
        const delay = retryAfter && !isNaN(Number(retryAfter))
          ? Number(retryAfter) * 1000
          : Math.min(3000, 150 * Math.pow(2, attempt) + Math.random() * 50);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      if (response.status === 429) throw new Error('RATE_LIMIT');
      throw new Error('GMAIL_UNAVAILABLE');
    }

    if (response.status === 401) throw new Error('AUTH_EXPIRED');
    if (response.status === 403) throw new Error('PERMISSION_DENIED');
    if (response.status === 404 && url.startsWith(HISTORY_API)) throw new Error('HISTORY_EXPIRED');
    if (!response.ok) throw new Error('GMAIL_UNAVAILABLE');
    return response.json();
  }
}

export async function findMessages(token, sender = null, seenIds = [], maxAgeSeconds = CODE_MAX_AGE_SECONDS, broad = false) {
  const cutoff = Math.floor((Date.now() - (maxAgeSeconds + 60) * 1000) / 1000);
  const query = sender ? `from:${sender} after:${cutoff}` : broad ? `after:${cutoff}` : `after:${cutoff} {verification code otp security confirmation login sign-in authentication код verificare withdrawal вывод подтверждение пароль auth pin token}`;
  const list = await apiFetch(`${API}?${new URLSearchParams({ q: query, maxResults: sender ? '8' : broad ? '40' : '20', includeSpamTrash: 'true' })}`, token);
  const seen = new Set(seenIds);
  return loadMessages(token, (list.messages ?? []).map(({ id }) => id), seen);
}

async function loadMessages(token, ids, seen) {
  const loaded = await Promise.all([...new Set(ids)].filter(id => !seen.has(id)).map(async id => {
    const message = await apiFetch(`${API}/${encodeURIComponent(id)}?format=full`, token);
    if (message.labelIds?.includes('TRASH')) return null;
    const headers = Object.fromEntries((message.payload?.headers ?? []).map(h => [h.name.toLowerCase(), h.value]));
    return { id, from: headers.from ?? '', subject: headers.subject ?? '', timestamp: Number(message.internalDate), body: bodyText(message.payload) };
  }));
  return loaded.filter(Boolean);
}

export async function getGmailHistoryId(token) {
  const profile = await apiFetch(PROFILE_API, token);
  if (!/^\d+$/.test(String(profile.historyId ?? ''))) throw new Error('GMAIL_UNAVAILABLE');
  return String(profile.historyId);
}

export async function findHistoryMessages(token, historyId, seenIds = []) {
  const ids = [];
  let pageToken;
  let latestId = historyId;
  for (let page = 0; page < 3; page++) {
    const params = new URLSearchParams({ startHistoryId: historyId, historyTypes: 'messageAdded', maxResults: '100' });
    if (pageToken) params.set('pageToken', pageToken);
    const result = await apiFetch(`${HISTORY_API}?${params}`, token);
    for (const change of result.history ?? []) for (const added of change.messagesAdded ?? []) {
      if (added.message?.id) ids.push(added.message.id);
    }
    latestId = String(result.historyId ?? latestId);
    pageToken = result.nextPageToken;
    if (!pageToken) return { messages: await loadMessages(token, ids, new Set(seenIds)), historyId: latestId };
  }
  throw new Error('HISTORY_EXPIRED');
}

export async function getGmailProfile(token) {
  const profile = await apiFetch(PROFILE_API, token);
  if (!profile.emailAddress || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(profile.emailAddress)) throw new Error('GMAIL_UNAVAILABLE');
  return profile.emailAddress.toLowerCase();
}
