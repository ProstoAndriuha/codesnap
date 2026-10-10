export const MAIL_HOST = 'com.codesnap.mail';
export const MAIL_PROVIDERS = Object.freeze({
  yahoo: { name: 'Yahoo', host: 'imap.mail.yahoo.com', port: 993 },
  yandex: { name: 'Яндекс', host: 'imap.yandex.ru', port: 993 },
  mailru: { name: 'Mail.ru', host: 'imap.mail.ru', port: 993 },
  imap: { name: 'IMAP', host: '', port: 993 }
});

export async function mailHost(request) {
  if (!chrome.runtime?.sendNativeMessage) throw new Error('MAIL_HELPER_MISSING');
  let result;
  try { result = await chrome.runtime.sendNativeMessage(MAIL_HOST, request); }
  catch { throw new Error('MAIL_HELPER_MISSING'); }
  if (!result?.ok) throw new Error(result?.error || 'MAIL_UNAVAILABLE');
  return result;
}

export async function listMailAccounts() {
  try { return (await mailHost({ command: 'list' })).accounts ?? []; }
  catch { return []; }
}

export function describeMailError(error) {
  const messages = {
    MAIL_HELPER_MISSING: 'Локальный почтовый модуль не установлен. Откройте инструкцию подключения IMAP.',
    MAIL_AUTH_FAILED: 'Почта отклонила вход. Проверьте адрес, пароль приложения и доступ по IMAP.',
    MAIL_UNAVAILABLE: 'Не удалось связаться с почтовым сервером. Проверьте настройки и попробуйте снова.',
    MAIL_TLS_FAILED: 'Не удалось проверить защищённое соединение с почтовым сервером.',
    MAIL_CONFIG_INVALID: 'Проверьте адрес почты, сервер и порт IMAP.',
    OUTLOOK_CLIENT_REQUIRED: 'Для Outlook сначала настройте приложение Microsoft в настройках CodeSnap.',
    OUTLOOK_AUTH_FAILED: 'Вход Microsoft не завершён. Попробуйте подключить Outlook снова.',
    MAIL_STORAGE_FAILED: 'Не удалось открыть защищённое хранилище почтовых аккаунтов.'
  };
  return messages[error?.message] ?? 'Не удалось подключить почту. Проверьте настройки.';
}
