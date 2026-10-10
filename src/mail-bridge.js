export const MAIL_API = 'https://codesnap.fundingbotsecret.pp.ua/api/mail';
export const MAIL_PROVIDERS = Object.freeze({
  yahoo: { name: 'Yahoo', host: 'imap.mail.yahoo.com', port: 993 },
  yandex: { name: 'Яндекс', host: 'imap.yandex.ru', port: 993 },
  mailru: { name: 'Mail.ru', host: 'imap.mail.ru', port: 993 },
  imap: { name: 'IMAP', host: '', port: 993 }
});
let tokenPending;
async function deviceToken() {
  const stored = await chrome.storage.local.get('mailCloudToken');
  if (/^[A-Za-z0-9_-]{43}$/.test(stored.mailCloudToken ?? '')) return stored.mailCloudToken;
  tokenPending ??= (async () => {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    const token = btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
    await chrome.storage.local.set({ mailCloudToken: token }); return token;
  })().finally(() => { tokenPending = null; });
  return tokenPending;
}
export async function mailHost(request) {
  const { mailCloudEnabled } = await chrome.storage.local.get('mailCloudEnabled');
  if (mailCloudEnabled !== true) {
    if (request.command === 'list') return { ok: true, accounts: [] };
    throw new Error('MAIL_CLOUD_DISABLED');
  }
  const token = await deviceToken();
  let response;
  try {
    response = await fetch(MAIL_API, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(request), cache: 'no-store', credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(35000) });
  } catch { throw new Error('MAIL_UNAVAILABLE'); }
  if (response.headers?.get('cf-mitigated') === 'challenge') throw new Error('MAIL_EDGE_BLOCKED');
  let result;
  try { result = await response.json(); } catch { throw new Error('MAIL_UNAVAILABLE'); }
  if (!response.ok || !result?.ok) throw new Error(response.status === 429 ? 'MAIL_RATE_LIMIT' : result?.error || 'MAIL_UNAVAILABLE');
  return result;
}
export async function listMailAccounts(strict = false) {
  try { return (await mailHost({ command: 'list' })).accounts ?? []; }
  catch (error) { if (strict) throw error; return []; }
}
export function describeMailError(error) {
  const messages = {
    MAIL_CLOUD_DISABLED: 'Включите «Почта через CodeSnap Cloud» в настройках.',
    MAIL_EDGE_BLOCKED: 'Защита адреса CodeSnap Cloud не пропускает API. Это настройка сервера — повторный ввод пароля не поможет.',
    MAIL_AUTH_FAILED: 'Почта отклонила вход. Проверьте адрес, пароль приложения и доступ по IMAP.',
    MAIL_UNAVAILABLE: 'Не удалось связаться с CodeSnap Cloud или почтовым сервером. Попробуйте снова.',
    MAIL_TLS_FAILED: 'Не удалось проверить защищённое соединение с почтовым сервером.',
    MAIL_CONFIG_INVALID: 'Проверьте адрес и сервер IMAP. Поддерживаются TLS:993 и STARTTLS:143, только публичные серверы.',
    MAIL_STORAGE_FAILED: 'Не удалось открыть защищённое хранилище CodeSnap Cloud.',
    MAIL_CONSENT_REQUIRED: 'Подтвердите использование CodeSnap Cloud в форме подключения.',
    MAIL_ACCOUNT_MISSING: 'Этот аккаунт отключён. Подключите его снова.',
    MAIL_RATE_LIMIT: 'Слишком много запросов. Подождите и повторите.',
    MAIL_BUSY: 'Почта ещё проверяется. Повторите через несколько секунд.',
    MAIL_OAUTH_STATE: 'Вход в Яндекс истёк или был отменён. Подключитесь снова.',
    MAIL_OAUTH_UNAVAILABLE: 'Вход через Яндекс сейчас недоступен. Используйте пароль приложения.',
    MAIL_CAPACITY: 'Достигнут лимит CodeSnap Cloud. Отключите ненужный аккаунт.'
  };
  return messages[error?.message] ?? 'Не удалось подключить почту. Проверьте настройки.';
}

export async function connectYandex() {
  const redirect = chrome.identity.getRedirectURL('yandex');
  const started = await mailHost({ command: 'yandex-start', consent: true, redirect });
  let response;
  try { response = await chrome.identity.launchWebAuthFlow({ url: started.url, interactive: true }); }
  catch { throw new Error('MAIL_OAUTH_STATE'); }
  const callback = new URL(response);
  if (`${callback.origin}${callback.pathname}` !== redirect || callback.searchParams.get('state') !== started.state || !callback.searchParams.get('code')) throw new Error('MAIL_OAUTH_STATE');
  return mailHost({ command: 'yandex-finish', consent: true, state: started.state, code: callback.searchParams.get('code') });
}
