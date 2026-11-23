import { SEARCH_WINDOW_SECONDS } from './core.js';

export const LOCAL_MAIL_PROVIDERS = Object.freeze({
  yandex: { name: 'Яндекс Почта', webmailUrl: 'https://mail.yandex.ru/', hosts: ['mail.yandex.ru', 'mail.yandex.com', 'mail.yandex.by', 'mail.yandex.kz', '360.yandex.ru'] },
  outlook: { name: 'Outlook / Hotmail', webmailUrl: 'https://outlook.live.com/mail/', hosts: ['outlook.live.com', 'outlook.office.com', 'outlook.office365.com', 'outlook.cloud.microsoft'] },
  yahoo: { name: 'Yahoo Mail', webmailUrl: 'https://mail.yahoo.com/', hosts: ['mail.yahoo.com'] },
  mailru: { name: 'Mail.ru', webmailUrl: 'https://e.mail.ru/inbox/', hosts: ['e.mail.ru', 'octavius.mail.ru'] },
  proton: { name: 'Proton Mail', webmailUrl: 'https://mail.proton.me/', hosts: ['mail.proton.me'] },
  icloud: { name: 'iCloud Mail', webmailUrl: 'https://www.icloud.com/mail/', hosts: ['www.icloud.com', 'icloud.com'] },
  zoho: { name: 'Zoho Mail', webmailUrl: 'https://mail.zoho.com/', hosts: ['mail.zoho.com', 'mail.zoho.eu', 'mail.zoho.in', 'mail.zoho.com.au'] },
  rambler: { name: 'Рамблер/почта', webmailUrl: 'https://mail.rambler.ru/', hosts: ['mail.rambler.ru'] },
  fastmail: { name: 'Fastmail', webmailUrl: 'https://app.fastmail.com/', hosts: ['app.fastmail.com', 'www.fastmail.com'] },
  aol: { name: 'AOL Mail', webmailUrl: 'https://mail.aol.com/', hosts: ['mail.aol.com'] },
  gmx: { name: 'GMX / Mail.com', webmailUrl: 'https://www.gmx.com/', hosts: ['3c.gmx.net', '3c-bap.gmx.com', '3c-bap.mail.com', 'navigator.gmx.com', 'navigator-bs.gmx.com'] },
  gmail: { name: 'Gmail (вкладка)', webmailUrl: 'https://mail.google.com/', hosts: ['mail.google.com'] }
});

const registeredTabs = new Map();

export function detectWebmailProviderFromUrl(urlString) {
  let parsed;
  try { parsed = new URL(urlString); } catch { return null; }
  if (parsed.protocol !== 'https:') return null;
  const host = parsed.hostname.toLowerCase();
  const path = parsed.pathname.toLowerCase();
  if (/^p\d+-mailweb\.icloud\.com$/.test(host)) return 'icloud';
  for (const [id, info] of Object.entries(LOCAL_MAIL_PROVIDERS)) {
    if (info.hosts.some(h => host === h || host.endsWith(`.${h}`))) {
      if (id === 'icloud' && host.endsWith('icloud.com') && !host.startsWith('p') && !path.startsWith('/mail')) return null;
      return id;
    }
  }
  return null;
}

export function registerWebmailTab({ tabId, frameId = 0, provider, accountEmail = null }) {
  if (!Number.isInteger(tabId) || !LOCAL_MAIL_PROVIDERS[provider]) return;
  registeredTabs.set(`${tabId}:${frameId}`, { tabId, frameId, provider, accountEmail: accountEmail || null, updatedAt: Date.now() });
}

export function unregisterWebmailTab(tabId) {
  for (const [key, item] of registeredTabs) {
    if (item.tabId === tabId) registeredTabs.delete(key);
  }
}

export async function isLocalWebmailEnabled() {
  const { localWebmailEnabled } = await chrome.storage.local.get('localWebmailEnabled');
  return localWebmailEnabled !== false;
}

async function discoverOpenWebmailTabs() {
  if (typeof chrome.tabs?.query !== 'function') return [];
  let tabs = [];
  try { tabs = await chrome.tabs.query({}); } catch { return []; }
  const found = new Map();
  const tabsById = new Map(tabs.map(tab => [tab.id, tab]));
  for (const [key, entry] of registeredTabs) {
    const tab = tabsById.get(entry.tabId);
    if (tab && (!tab.url || detectWebmailProviderFromUrl(tab.url) === entry.provider)) found.set(key, { ...entry });
  }
  for (const tab of tabs) {
    if (!Number.isInteger(tab?.id) || !tab.url) continue;
    const provider = detectWebmailProviderFromUrl(tab.url);
    if (!provider) continue;
    const key = `${tab.id}:0`;
    const existing = found.get(key);
    found.set(key, {
      tabId: tab.id,
      frameId: existing?.frameId ?? 0,
      provider,
      accountEmail: existing?.accountEmail ?? null,
      title: tab.title ?? '',
      active: Boolean(tab.active)
    });
  }
  return [...found.values()];
}

export async function listLocalMailAccounts() {
  const { localWebmailEnabled, enabledMailProviders = [], localApiAccounts = [] } =
    await chrome.storage.local.get(['localWebmailEnabled', 'enabledMailProviders', 'localApiAccounts']);
  const webmailOn = localWebmailEnabled !== false;
  const accounts = [];
  const activeProviders = new Set();

  if (webmailOn) {
    const openTabs = await discoverOpenWebmailTabs();
    const seenTabIds = new Set();
    for (const item of openTabs) {
      if (seenTabIds.has(item.tabId)) continue;
      seenTabIds.add(item.tabId);
      activeProviders.add(item.provider);
      const label = LOCAL_MAIL_PROVIDERS[item.provider]?.name ?? item.provider;
      accounts.push({
        id: `tab:${item.tabId}`,
        kind: 'webmail-tab',
        tabId: item.tabId,
        provider: item.provider,
        email: item.accountEmail || `${label} (вкладка)`,
        active: true
      });
    }
    for (const provider of Array.isArray(enabledMailProviders) ? enabledMailProviders : []) {
      if (!LOCAL_MAIL_PROVIDERS[provider]) continue;
      const active = activeProviders.has(provider);
      accounts.push({
        id: `pin:${provider}`,
        kind: 'pinned',
        provider,
        email: `${LOCAL_MAIL_PROVIDERS[provider].name} ${active ? '(любая открытая вкладка)' : '(откройте вкладку)'}`,
        active
      });
    }
  }

  for (const account of Array.isArray(localApiAccounts) ? localApiAccounts : []) {
    accounts.push({
      id: account.id,
      kind: 'api',
      provider: account.provider,
      email: account.email,
      active: true
    });
  }
  return accounts;
}

function sendWithTimeout(tabId, frameId, payload, timeoutMs = 1500) {
  let timer;
  return Promise.race([
    chrome.tabs.sendMessage(tabId, payload, { frameId }),
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('WEBMAIL_TIMEOUT')), timeoutMs); })
  ]).finally(() => clearTimeout(timer));
}

async function fetchFastmailMessages(account, maxAgeSeconds = SEARCH_WINDOW_SECONDS) {
  const sessionRes = await fetch('https://api.fastmail.com/jmap/session', {
    headers: { Authorization: `Bearer ${account.token}` },
    cache: 'no-store'
  });
  if (sessionRes.status === 401) throw new Error('LOCAL_API_AUTH');
  if (!sessionRes.ok) throw new Error('LOCAL_API_UNAVAILABLE');
  const session = await sessionRes.json();
  const apiUrl = new URL(session.apiUrl || 'https://api.fastmail.com/jmap/api/');
  if (!['https://api.fastmail.com', 'https://jmap.fastmail.com'].includes(apiUrl.origin)) throw new Error('LOCAL_API_UNAVAILABLE');
  const accountId = session.primaryAccounts?.['urn:ietf:params:jmap:mail'];
  if (!accountId) throw new Error('LOCAL_API_UNAVAILABLE');
  const afterIso = new Date(Date.now() - (maxAgeSeconds + 60) * 1000).toISOString();
  const jmapRes = await fetch(apiUrl.href, {
    method: 'POST',
    headers: { Authorization: `Bearer ${account.token}`, 'Content-Type': 'application/json' },
    cache: 'no-store',
    redirect: 'error',
    body: JSON.stringify({
      using: ['urn:ietf:params:jmap:core', 'urn:ietf:params:jmap:mail'],
      methodCalls: [
        ['Email/query', { accountId, filter: { after: afterIso }, sort: [{ property: 'receivedAt', isAscending: false }], limit: 20 }, 'q0'],
        ['Email/get', {
          accountId,
          '#ids': { resultOf: 'q0', name: 'Email/query', path: '/ids' },
          properties: ['id', 'from', 'replyTo', 'subject', 'receivedAt', 'textBody', 'htmlBody', 'bodyValues', 'preview'],
          fetchTextBodyValues: true,
          fetchHTMLBodyValues: true
        }, 'g0']
      ]
    })
  });
  if (jmapRes.status === 401) throw new Error('LOCAL_API_AUTH');
  if (!jmapRes.ok) throw new Error('LOCAL_API_UNAVAILABLE');
  const jmapData = await jmapRes.json();
  const list = jmapData.methodResponses?.find(([name]) => name === 'Email/get')?.[1]?.list ?? [];
  return list.map(item => {
    const fromAddr = item.from?.[0] ? `${item.from[0].name ?? ''} <${item.from[0].email ?? ''}>`.trim() : '';
    const replyAddr = item.replyTo?.[0]?.email ?? '';
    const textIds = (item.textBody ?? []).map(p => p.partId);
    const htmlIds = (item.htmlBody ?? []).map(p => p.partId);
    const text = textIds.map(id => item.bodyValues?.[id]?.value ?? '').filter(Boolean).join('\n') || item.preview || '';
    const html = htmlIds.map(id => item.bodyValues?.[id]?.value ?? '').filter(Boolean).join('\n');
    return {
      id: `fastmail-${item.id}`,
      from: fromAddr,
      replyTo: replyAddr,
      subject: item.subject ?? '',
      body: text || html.replace(/<[^>]*>/g, ' '),
      html,
      timestamp: Date.parse(item.receivedAt) || Date.now(),
      accountEmail: account.email,
      accountProvider: 'fastmail',
      localSource: 'jmap'
    };
  });
}

async function refreshOutlookToken(account) {
  if (account.expiresAt && account.expiresAt > Date.now() + 60_000) return account;
  if (!account.refreshToken || !account.clientId) throw new Error('LOCAL_API_AUTH');
  const res = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: account.clientId,
      grant_type: 'refresh_token',
      refresh_token: account.refreshToken,
      scope: 'openid offline_access User.Read Mail.Read'
    })
  });
  const data = await res.json();
  if (!res.ok || !data.access_token) throw new Error('LOCAL_API_AUTH');
  const updated = {
    ...account,
    token: data.access_token,
    refreshToken: data.refresh_token ?? account.refreshToken,
    expiresAt: Date.now() + Number(data.expires_in ?? 3600) * 1000
  };
  const { localApiAccounts = [] } = await chrome.storage.local.get('localApiAccounts');
  await chrome.storage.local.set({
    localApiAccounts: localApiAccounts.map(item => item.id === account.id ? updated : item)
  });
  return updated;
}

async function fetchOutlookMessages(account, maxAgeSeconds = SEARCH_WINDOW_SECONDS) {
  const active = await refreshOutlookToken(account);
  const cutoffIso = new Date(Date.now() - (maxAgeSeconds + 60) * 1000).toISOString();
  const url = `https://graph.microsoft.com/v1.0/me/messages?$top=20&$orderby=receivedDateTime desc&$filter=receivedDateTime ge ${encodeURIComponent(cutoffIso)}&$select=id,subject,from,replyTo,receivedDateTime,body,bodyPreview`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${active.token}` },
    cache: 'no-store'
  });
  if (res.status === 401) throw new Error('LOCAL_API_AUTH');
  if (!res.ok) throw new Error('LOCAL_API_UNAVAILABLE');
  const data = await res.json();
  return (data.value ?? []).map(item => {
    const isHtml = item.body?.contentType === 'html';
    const rawContent = item.body?.content ?? item.bodyPreview ?? '';
    return {
      id: `outlook-${item.id}`,
      from: item.from?.emailAddress ? `${item.from.emailAddress.name ?? ''} <${item.from.emailAddress.address ?? ''}>`.trim() : '',
      replyTo: item.replyTo?.[0]?.emailAddress?.address ?? '',
      subject: item.subject ?? '',
      body: isHtml ? rawContent.replace(/<[^>]*>/g, ' ') : rawContent,
      html: isHtml ? rawContent : '',
      timestamp: Date.parse(item.receivedDateTime) || Date.now(),
      accountEmail: active.email,
      accountProvider: 'outlook',
      localSource: 'graph'
    };
  });
}

export async function scanLocalMail({ selected = 'all', excludeTabId = null, maxAgeSeconds = SEARCH_WINDOW_SECONDS } = {}) {
  const { localWebmailEnabled, localApiAccounts = [] } = await chrome.storage.local.get(['localWebmailEnabled', 'localApiAccounts']);
  const messages = [];
  const unreadHints = [];
  const webmailOn = localWebmailEnabled !== false;

  if (webmailOn && (selected === 'all' || selected.startsWith('local:tab:') || selected.startsWith('local:pin:'))) {
    const targets = await discoverOpenWebmailTabs();
    const filtered = targets.filter(target => {
      if (excludeTabId !== null && target.tabId === excludeTabId) return false;
      if (selected.startsWith('local:tab:')) return `local:tab:${target.tabId}` === selected;
      if (selected.startsWith('local:pin:')) return target.provider === selected.slice('local:pin:'.length);
      return true;
    });

    const settled = await Promise.allSettled(filtered.map(async target => {
      if (typeof chrome.tabs?.sendMessage !== 'function') return null;
      const response = await sendWithTimeout(target.tabId, target.frameId ?? 0, { type: 'SCAN_WEBMAIL' });
      if (!response?.ok || response.provider !== target.provider) return null;
      if (response.accountEmail) {
        registerWebmailTab({ tabId: target.tabId, frameId: target.frameId ?? 0, provider: target.provider, accountEmail: response.accountEmail });
      }
      return { target, response };
    }));

    for (const item of settled) {
      if (item.status !== 'fulfilled' || !item.value) continue;
      const { target, response } = item.value;
      for (const msg of response.messages ?? []) {
        messages.push({
          ...msg,
          id: `${target.tabId}:${target.frameId}:${msg.id}`,
          accountProvider: msg.accountProvider || target.provider,
          accountEmail: msg.accountEmail || response.accountEmail || null,
          localSource: 'webmail',
          webmailTabId: target.tabId
        });
      }
      for (const hint of response.unreadHints ?? []) {
        unreadHints.push({
          ...hint,
          provider: hint.provider || target.provider,
          tabId: target.tabId
        });
      }
    }
  }

  const matchingApis = (Array.isArray(localApiAccounts) ? localApiAccounts : []).filter(acc =>
    selected === 'all' || selected === `local:${acc.id}`
  );
  if (matchingApis.length) {
    const apiSettled = await Promise.allSettled(matchingApis.map(acc =>
      acc.kind === 'fastmail_jmap' ? fetchFastmailMessages(acc, maxAgeSeconds) :
      acc.kind === 'outlook_pkce' ? fetchOutlookMessages(acc, maxAgeSeconds) : Promise.resolve([])
    ));
    for (const item of apiSettled) {
      if (item.status === 'fulfilled') messages.push(...item.value);
    }
  }

  return { messages, unreadHints };
}

async function ensureHostPermission(origins) {
  if (typeof chrome.permissions?.request !== 'function') return true;
  const granted = await chrome.permissions.request({ origins });
  if (!granted) throw new Error('LOCAL_PERMISSION_DENIED');
  return true;
}

async function generatePkce() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const verifier = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  const challenge = btoa(String.fromCharCode(...new Uint8Array(digest))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return { verifier, challenge };
}

export async function connectLocalProvider({ provider, apiToken = '', clientId = '' }) {
  if (provider === 'fastmail_jmap') {
    const token = String(apiToken ?? '').trim();
    if (!token) throw new Error('LOCAL_API_CONFIG');
    await ensureHostPermission(['https://api.fastmail.com/*', 'https://jmap.fastmail.com/*']);
    const res = await fetch('https://api.fastmail.com/jmap/session', {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store'
    });
    if (res.status === 401) throw new Error('LOCAL_API_AUTH');
    if (!res.ok) throw new Error('LOCAL_API_UNAVAILABLE');
    const session = await res.json();
    const email = String(session.username ?? '').trim().toLowerCase();
    if (!email.includes('@')) throw new Error('LOCAL_API_UNAVAILABLE');
    const { localApiAccounts = [] } = await chrome.storage.local.get('localApiAccounts');
    const id = `fastmail:${email}`;
    const record = { id, kind: 'fastmail_jmap', provider: 'fastmail', email, token };
    const next = [...localApiAccounts.filter(a => a.id !== id), record];
    await chrome.storage.local.set({ localApiAccounts: next });
    return { account: { id, kind: 'api', provider: 'fastmail', email } };
  }

  if (provider === 'outlook_pkce') {
    const cid = String(clientId ?? '').trim();
    if (!/^[0-9a-f-]{32,40}$/i.test(cid)) throw new Error('LOCAL_API_CONFIG');
    if (typeof chrome.identity?.launchWebAuthFlow !== 'function') throw new Error('LOCAL_API_UNAVAILABLE');
    await ensureHostPermission(['https://graph.microsoft.com/*', 'https://login.microsoftonline.com/*']);
    const redirect = chrome.identity.getRedirectURL('outlook');
    const state = crypto.randomUUID();
    const { verifier, challenge } = await generatePkce();
    const params = new URLSearchParams({
      client_id: cid,
      response_type: 'code',
      redirect_uri: redirect,
      response_mode: 'query',
      scope: 'openid offline_access User.Read Mail.Read',
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      prompt: 'select_account'
    });
    const callbackUrl = await chrome.identity.launchWebAuthFlow({
      url: `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${params}`,
      interactive: true
    });
    const parsed = new URL(callbackUrl);
    if (`${parsed.origin}${parsed.pathname}` !== redirect || parsed.searchParams.get('state') !== state || !parsed.searchParams.get('code')) {
      throw new Error('LOCAL_OAUTH_FAILED');
    }
    const tokenRes = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: cid,
        grant_type: 'authorization_code',
        code: parsed.searchParams.get('code'),
        redirect_uri: redirect,
        code_verifier: verifier
      })
    });
    const tokenData = await tokenRes.json();
    if (!tokenRes.ok || !tokenData.access_token) throw new Error('LOCAL_OAUTH_FAILED');
    const meRes = await fetch('https://graph.microsoft.com/v1.0/me', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` }
    });
    const me = await meRes.json();
    const email = String(me.mail || me.userPrincipalName || '').trim().toLowerCase();
    if (!email.includes('@')) throw new Error('LOCAL_API_UNAVAILABLE');
    const id = `outlook:${email}`;
    const record = {
      id,
      kind: 'outlook_pkce',
      provider: 'outlook',
      email,
      clientId: cid,
      token: tokenData.access_token,
      refreshToken: tokenData.refresh_token ?? '',
      expiresAt: Date.now() + Number(tokenData.expires_in ?? 3600) * 1000
    };
    const { localApiAccounts = [] } = await chrome.storage.local.get('localApiAccounts');
    await chrome.storage.local.set({ localApiAccounts: [...localApiAccounts.filter(a => a.id !== id), record] });
    return { account: { id, kind: 'api', provider: 'outlook', email } };
  }

  const preset = LOCAL_MAIL_PROVIDERS[provider];
  if (!preset) throw new Error('LOCAL_API_CONFIG');
  const { enabledMailProviders = [] } = await chrome.storage.local.get('enabledMailProviders');
  const nextProviders = [...new Set([...(Array.isArray(enabledMailProviders) ? enabledMailProviders : []), provider])];
  await chrome.storage.local.set({ enabledMailProviders: nextProviders, localWebmailEnabled: true });

  const open = (await discoverOpenWebmailTabs()).find(item => item.provider === provider);
  if (open) {
    await focusWebmailTab(open.tabId);
    return { account: { id: `tab:${open.tabId}`, provider, email: open.accountEmail || preset.name }, tabId: open.tabId };
  }
  if (typeof chrome.tabs?.create === 'function') {
    const created = await chrome.tabs.create({ url: preset.webmailUrl, active: true });
    return { account: { id: `tab:${created?.id ?? provider}`, provider, email: preset.name }, tabId: created?.id ?? null };
  }
  return { account: { id: `pin:${provider}`, provider, email: preset.name } };
}

export async function removeLocalAccount(rawId) {
  const id = String(rawId ?? '').replace(/^local:/, '');
  if (id.startsWith('pin:')) {
    const provider = id.slice(4);
    const { enabledMailProviders = [] } = await chrome.storage.local.get('enabledMailProviders');
    await chrome.storage.local.set({
      enabledMailProviders: enabledMailProviders.filter(item => item !== provider)
    });
    return { ok: true };
  }
  if (id.startsWith('tab:')) {
    const tabId = Number(id.slice(4));
    for (const [key, item] of registeredTabs) {
      if (item.tabId === tabId) registeredTabs.delete(key);
    }
    return { ok: true };
  }
  const { localApiAccounts = [] } = await chrome.storage.local.get('localApiAccounts');
  await chrome.storage.local.set({
    localApiAccounts: localApiAccounts.filter(item => item.id !== id)
  });
  return { ok: true };
}

export async function focusWebmailTab(tabId) {
  if (!Number.isInteger(tabId) || typeof chrome.tabs?.update !== 'function') return false;
  try {
    const tab = await chrome.tabs.update(tabId, { active: true });
    if (tab?.windowId && typeof chrome.windows?.update === 'function') {
      await chrome.windows.update(tab.windowId, { focused: true });
    }
    return true;
  } catch {
    return false;
  }
}

export function describeLocalMailError(error) {
  const map = {
    LOCAL_PERMISSION_DENIED: 'Разрешите доступ к API почты в окне браузера.',
    LOCAL_API_CONFIG: 'Проверьте настройки или токен подключения.',
    LOCAL_API_AUTH: 'Почтовый сервис отклонил токен доступа. Создайте новый или войдите заново.',
    LOCAL_API_UNAVAILABLE: 'Не удалось связаться с почтовым API. Проверьте подключение к интернету.',
    LOCAL_OAUTH_FAILED: 'Вход через Microsoft не завершился. Проверьте Client ID и redirect URI.'
  };
  return map[error?.message] ?? 'Не удалось подключить почту локально.';
}
