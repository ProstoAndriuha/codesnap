import { lookup } from 'node:dns/promises';
import ipaddr from 'ipaddr.js';
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';

export const presets = Object.freeze({ yandex: 'imap.yandex.ru', yahoo: 'imap.mail.yahoo.com', mailru: 'imap.mail.ru' });
export function publicAddress(address) {
  try { const ip = ipaddr.process(address); return ip.range() === 'unicast'; } catch { return false; }
}
export function configuration(input) {
  const provider = input.provider;
  if (!Object.hasOwn(presets, provider) && provider !== 'imap') throw new Error('MAIL_CONFIG_INVALID');
  const email = String(input.email ?? '').trim().toLowerCase();
  const host = presets[provider] ?? String(input.host ?? '').trim().toLowerCase();
  const login = String(input.login || email).trim();
  const security = provider === 'imap' ? input.security ?? 'tls' : 'tls';
  const port = provider === 'imap' ? Number(input.port ?? 993) : 993;
  if (!/^[^\s@\x00-\x1f]+@[^\s@\x00-\x1f]+\.[^\s@\x00-\x1f]+$/.test(email) || email.length > 254 || !/^(?=.{1,253}$)[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(host) || !host.includes('.') || /\.\./.test(host) || !login || login.length > 254 || /[\x00-\x1f]/.test(login) || !['tls','starttls'].includes(security) || (security === 'tls' ? port !== 993 : port !== 143)) throw new Error('MAIL_CONFIG_INVALID');
  const password = input.password;
  if (typeof password !== 'string' || !password || password.length > 1024 || /[\x00-\x1f]/.test(password)) throw new Error('MAIL_CONFIG_INVALID');
  return { provider, email, host, port, security, login, password };
}
export async function resolvePublic(host, resolver = lookup) {
  const addresses = await resolver(host, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(({ address }) => !publicAddress(address))) throw new Error('MAIL_CONFIG_INVALID');
  // Pin the checked IP for the connection; TLS still verifies the original hostname.
  return addresses[0].address;
}
export async function withMailbox(account, operation, { resolver = lookup, Client = ImapFlow } = {}) {
  const address = await resolvePublic(account.host, resolver);
  const client = new Client({ host: address, servername: account.host, port: account.port,
    secure: account.security === 'tls', ...(account.security === 'starttls' ? { doSTARTTLS: true } : {}),
    tls: { servername: account.host, rejectUnauthorized: true, minVersion: 'TLSv1.2' },
    auth: { user: account.login, ...(account.accessToken ? { accessToken: account.accessToken } : { pass: account.password }) },
    logger: false, logRaw: false, disableAutoIdle: true, disableCompression: true, connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000 });
  client.on('error', () => {});
  const deadline = setTimeout(() => client.close(), 25000); deadline.unref();
  try {
    await client.connect(); await client.mailboxOpen('INBOX', { readOnly: true });
    return await operation(client);
  } catch (error) {
    if (error.authenticationFailed || error.responseStatus === 'NO') throw new Error('MAIL_AUTH_FAILED');
    if (/CERT|TLS|SSL|SELF_SIGNED/.test(error.code ?? '')) throw new Error('MAIL_TLS_FAILED');
    throw new Error('MAIL_UNAVAILABLE');
  } finally { clearTimeout(deadline); client.close(); }
}
export async function readRecent(account, options) {
  const cutoff = Date.now() - 15 * 60 * 1000;
  return withMailbox(account, async client => {
    const ids = await client.search({ since: new Date(cutoff) }, { uid: true });
    if (!ids?.length) return [];
    const metadata = await client.fetchAll(ids.slice(-40), { uid: true, size: true, internalDate: true }, { uid: true });
    const messages = [];
    for (const item of metadata) {
      const timestamp = new Date(item.internalDate).getTime();
      if (timestamp < cutoff || timestamp > Date.now() + 30000 || !item.size || item.size > 256 * 1024) continue;
      const message = await client.fetchOne(item.uid, { source: true }, { uid: true });
      if (!message?.source || message.source.length > 256 * 1024) continue;
      const parsed = await simpleParser(message.source, { skipHtmlToText: true, skipTextToHtml: true, skipImageLinks: true });
      const body = parsed.text || String(parsed.html || '').replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]*>/g,' ');
      messages.push({ id: `imap:${client.mailbox.uidValidity}:${item.uid}`, from: parsed.from?.text?.slice(0,500) ?? '', subject: parsed.subject?.slice(0,500) ?? '', body: body.slice(0,32000), timestamp });
    }
    return messages;
  }, options);
}
