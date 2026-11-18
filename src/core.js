export const CODE_MAX_AGE_SECONDS = 180;
export const SEARCH_WINDOW_SECONDS = 15 * 60;

export const SITES = Object.freeze({
  binance: { name: 'Binance', origins: ['https://www.binance.com', 'https://accounts.binance.com'], subject: /(?:verification|security|confirm|code|otp|auth|login|sign|withdraw|payout|transfer|вывод|средств|подтвержд|верификац|безопасн|вход|парол|авториз)/i },
  bybit: { name: 'Bybit', origins: ['https://www.bybit.com'], subject: /(?:verification|security|confirm|code|otp|auth|login|sign|withdraw|payout|transfer|вывод|средств|подтвержд|верификац|безопасн|вход|парол|авториз)/i },
  okx: { name: 'OKX', origins: ['https://www.okx.com'], subject: /(?:verification|security|confirm|code|otp|auth|login|sign|withdraw|payout|transfer|вывод|средств|подтвержд|верификац|безопасн|вход|парол|авториз)/i }
});

export const ECOSYSTEMS = Object.freeze([
  { siteDomains: ['live.com', 'microsoftonline.com', 'microsoft.com', 'xbox.com', 'skype.com'], mailDomains: ['accountprotection.microsoft.com', 'microsoft.com', 'microsoftsupport.com', 'live.com'], aliases: ['microsoft', 'майкрософт', 'outlook', 'xbox'] },
  { siteDomains: ['openai.com', 'chatgpt.com'], mailDomains: ['openai.com', 'tm.openai.com', 'email.openai.com', 'chatgpt.com'], aliases: ['openai', 'chatgpt'] },
  { siteDomains: ['anthropic.com', 'claude.ai'], mailDomains: ['anthropic.com', 'mail.anthropic.com', 'claude.ai'], aliases: ['anthropic', 'claude'] },
  { siteDomains: ['x.com', 'twitter.com'], mailDomains: ['x.com', 'twitter.com', 'e.twitter.com', 'info.twitter.com'], aliases: ['twitter', 'x'] },
  { siteDomains: ['facebook.com', 'instagram.com', 'threads.net', 'meta.com', 'whatsapp.com'], mailDomains: ['facebookmail.com', 'facebook.com', 'instagram.com', 'mail.instagram.com', 'meta.com', 'metamail.com'], aliases: ['facebook', 'instagram', 'threads', 'meta'] },
  { siteDomains: ['apple.com', 'icloud.com'], mailDomains: ['apple.com', 'id.apple.com', 'email.apple.com', 'icloud.com'], aliases: ['apple', 'icloud'] },
  { siteDomains: ['yandex.ru', 'yandex.com', 'ya.ru', 'yandex.by', 'yandex.kz'], mailDomains: ['yandex.ru', 'yandex.com', 'passport.yandex.ru', 'yandex-team.ru', 'ya.ru'], aliases: ['yandex', 'яндекс'] },
  { siteDomains: ['vk.com', 'vk.ru', 'mail.ru', 'ok.ru'], mailDomains: ['vk.com', 'vk.ru', 'mail.ru', 'corp.mail.ru', 'id.vk.ru', 'ok.ru'], aliases: ['vk', 'вконтакте', 'mail.ru', 'vk id'] },
  { siteDomains: ['steampowered.com', 'steamcommunity.com'], mailDomains: ['steampowered.com', 'valvesoftware.com'], aliases: ['steam', 'valve'] },
  { siteDomains: ['epicgames.com', 'fortnite.com'], mailDomains: ['epicgames.com', 'acct.epicgames.com'], aliases: ['epic games', 'epicgames'] },
  { siteDomains: ['playstation.com', 'sonyentertainmentnetwork.com'], mailDomains: ['playstation.com', 'sony.com', 'txn-email.playstation.com', 'email.playstation.com'], aliases: ['playstation', 'sony'] },
  { siteDomains: ['reddit.com'], mailDomains: ['reddit.com', 'redditmail.com'], aliases: ['reddit'] },
  { siteDomains: ['twitch.tv'], mailDomains: ['twitch.tv', 'mail.twitch.tv'], aliases: ['twitch'] },
  { siteDomains: ['discord.com', 'discordapp.com'], mailDomains: ['discord.com', 'discordapp.com'], aliases: ['discord'] },
  { siteDomains: ['github.com'], mailDomains: ['github.com'], aliases: ['github'] },
  { siteDomains: ['gitlab.com'], mailDomains: ['gitlab.com', 'mg.gitlab.com'], aliases: ['gitlab'] },
  { siteDomains: ['linkedin.com'], mailDomains: ['linkedin.com', 'e.linkedin.com'], aliases: ['linkedin'] },
  { siteDomains: ['paypal.com'], mailDomains: ['paypal.com', 'e.paypal.com', 'mail.paypal.com'], aliases: ['paypal'] },
  { siteDomains: ['stripe.com', 'link.com'], mailDomains: ['stripe.com', 'link.com'], aliases: ['stripe', 'link'] },
  { siteDomains: ['amazon.com', 'aws.amazon.com', 'amazon.de', 'amazon.co.uk'], mailDomains: ['amazon.com', 'amazon.de', 'amazon.co.uk', 'amazonses.com'], aliases: ['amazon', 'aws'] },
  { siteDomains: ['telegram.org', 'fragment.com'], mailDomains: ['telegram.org', 'fragment.com'], aliases: ['telegram', 'fragment'] },
  { siteDomains: ['gosuslugi.ru'], mailDomains: ['gosuslugi.ru'], aliases: ['госуслуги', 'gosuslugi'] },
  { siteDomains: ['ozon.ru'], mailDomains: ['ozon.ru', 'info.ozon.ru'], aliases: ['ozon', 'озон'] },
  { siteDomains: ['avito.ru'], mailDomains: ['avito.ru', 'mail.avito.ru'], aliases: ['avito', 'авито'] },
  { siteDomains: ['tbank.ru', 'tinkoff.ru'], mailDomains: ['tbank.ru', 'tinkoff.ru'], aliases: ['t-bank', 'т-банк', 'tinkoff', 'тинькофф'] },
  { siteDomains: ['binance.com'], mailDomains: ['binance.com', 'ses.binance.com', 'mail.binance.com', 'post.binance.com'], aliases: ['binance'] },
  { siteDomains: ['bybit.com'], mailDomains: ['bybit.com', 'mail.bybit.com', 'notification.bybit.com'], aliases: ['bybit'] },
  { siteDomains: ['okx.com', 'okex.com'], mailDomains: ['okx.com', 'mail.okx.com', 'okex.com'], aliases: ['okx', 'okex'] },
  { siteDomains: ['kcex.com'], mailDomains: ['kcex.com', 'mail.kcex.com'], aliases: ['kcex'] },
  { siteDomains: ['onebullex.com'], mailDomains: ['onebullex.com', 'mail.onebullex.com'], aliases: ['onebullex'] },
  { siteDomains: ['bitget.com'], mailDomains: ['bitget.com', 'mail.bitget.com'], aliases: ['bitget'] },
  { siteDomains: ['mexc.com'], mailDomains: ['mexc.com', 'mail.mexc.com'], aliases: ['mexc'] },
  { siteDomains: ['gate.io'], mailDomains: ['gate.io', 'mail.gate.io'], aliases: ['gate.io', 'gate'] },
  { siteDomains: ['kucoin.com'], mailDomains: ['kucoin.com', 'mail.kucoin.com'], aliases: ['kucoin'] },
  { siteDomains: ['bingx.com'], mailDomains: ['bingx.com', 'mail.bingx.com'], aliases: ['bingx'] },
  { siteDomains: ['htx.com', 'huobi.com'], mailDomains: ['htx.com', 'huobi.com', 'mail.htx.com'], aliases: ['htx', 'huobi'] },
  { siteDomains: ['kraken.com'], mailDomains: ['kraken.com', 'email.kraken.com'], aliases: ['kraken'] },
  { siteDomains: ['coinbase.com'], mailDomains: ['coinbase.com', 'mail.coinbase.com'], aliases: ['coinbase'] }
]);

const SHARED_SUFFIX_REGEX = /(?:^|\.)(?:github\.io|pages\.dev|vercel\.app|netlify\.app|web\.app|appspot\.com|herokuapp\.com|onrender\.com|railway\.app|fly\.dev|supabase\.co|firebaseapp\.com|workers\.dev)$/;
const MULTIPART_TLDS = new Set([
  'co.uk', 'org.uk', 'ac.uk', 'gov.uk',
  'com.au', 'net.au', 'org.au',
  'co.jp', 'ne.jp', 'or.jp',
  'com.ua', 'pp.ua', 'in.ua', 'org.ua', 'net.ua', 'kiev.ua',
  'com.br', 'com.mx', 'com.ar', 'com.tr',
  'co.in', 'co.kr', 'com.sg', 'com.hk', 'co.nz', 'co.za', 'com.cn', 'com.tw'
]);

const SOCIAL_DOMAINS = new Set(['facebook.com', 'twitter.com', 'x.com', 'instagram.com', 'linkedin.com', 'youtube.com', 't.me', 'tiktok.com', 'discord.gg', 'vk.com']);

export function siteForOrigin(origin) {
  return Object.entries(SITES).find(([, site]) => site.origins.includes(origin))?.[0] ?? null;
}

export function trustedOrigin(origin, siteId) {
  return Boolean(SITES[siteId]?.origins.includes(origin));
}

export function normalizeSender(value) {
  const match = /(?:^|<|\s)([a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,})(?:>|$|\s)/i.exec(String(value ?? '').trim());
  return match?.[1].toLowerCase() ?? null;
}

export function senderMatches(header, trustedAddress) {
  const actual = normalizeSender(header);
  const expected = normalizeSender(trustedAddress);
  return Boolean(actual && expected && actual === expected);
}

export function rootDomainOf(hostname) {
  const host = String(hostname ?? '').toLowerCase().replace(/\.$/, '');
  const parts = host.split('.').filter(Boolean);
  if (parts.length <= 2) return host;
  const lastTwo = parts.slice(-2).join('.');
  if (MULTIPART_TLDS.has(lastTwo) && parts.length >= 3) return parts.slice(-3).join('.');
  return lastTwo;
}

function domainBelongsTo(domain, targetDomain) {
  if (!domain || !targetDomain) return false;
  return domain === targetDomain || domain.endsWith(`.${targetDomain}`);
}

export function dkimDomains(authResults) {
  const text = String(authResults ?? '');
  if (!text) return [];
  const domains = new Set();
  for (const match of text.matchAll(/dkim=pass\b[^;]*?\bheader\.d=([a-z0-9.-]+\.[a-z]{2,})/gi)) {
    domains.add(match[1].toLowerCase());
  }
  return [...domains];
}

export function matchesMaskedEmail(accountEmail, maskedEmail) {
  const account = normalizeSender(accountEmail);
  const masked = String(maskedEmail ?? '').trim().toLowerCase();
  if (!account || !masked || !masked.includes('@')) return false;
  const [accLocal, accDom] = account.split('@');
  const [maskLocal, maskDom] = masked.split('@');
  if (!accLocal || !accDom || !maskLocal || !maskDom) return false;
  const domMatch = maskDom.includes('*') || maskDom.includes('•') || maskDom.includes('·')
    ? new RegExp(`^${maskDom.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/[*•·]+/g, '.*')}$`).test(accDom)
    : accDom === maskDom;
  if (!domMatch) return false;
  const prefixMatch = /^[a-z0-9._-]+/.exec(maskLocal)?.[0] ?? '';
  const suffixMatch = /[a-z0-9._-]+$/.exec(maskLocal)?.[0] ?? '';
  if (prefixMatch && !accLocal.startsWith(prefixMatch)) return false;
  if (suffixMatch && suffixMatch !== maskLocal && !accLocal.endsWith(suffixMatch)) return false;
  return Boolean(prefixMatch || suffixMatch);
}

const UNIVERSAL_SUBJECT_PATTERN = /(?:verification|verify|security|confirm|code|otp|auth|login|sign|pass|pin|token|alert|notice|action|device|access|withdraw|payout|transfer|pay|order|activate|activation|magic\s*link|welcome|complete|approve|authorize|код|вывод|средств|подтвержд|верификац|безопасн|вход|сброс|парол|авториз|устройств|сесси|секретн|транзакц|платеж|счет|доступ|регистрац|активац|ссылк|verificare|confirmare|securitate|autentificare|conexiun|accesa|código|seguridad|clave|acceso|retir|vérification|sécurité|mot\s*de\s*passe|connexion|retrait|sicherheit|bestätigung|anmeldung|abhebung|验证码|安全|登录|提现)/i;

export function subjectMatches(subject, siteId) {
  const text = String(subject ?? '');
  if (siteId === 'generic') return UNIVERSAL_SUBJECT_PATTERN.test(text);
  if (SITES[siteId]?.subject.test(text)) return true;
  return UNIVERSAL_SUBJECT_PATTERN.test(text);
}

export function lifetimeSeconds(body) {
  const value = String(body ?? '').slice(0, 3000);
  const match = /(?:expir(?:es|ing)|valid\s+(?:for|within)|good\s+for|active\s+for|истекает\s+через|действителен\s+(?:в\s+течение|ещ[её])|срок\s+(?:действия\s+)?(?:кода\s+)?истекает\s+через|действует\s+в\s+течение|expiră\s+în|valabil\s+(?:timp\s+de|pentru)|válido\s+(?:durante|por)|caduca\s+en|valable\s+(?:pendant|pour)|gültig\s+(?:für|in)|läuft\s+in|有效期\s*为?)\D{0,25}(\d{1,2})\s*(minutes?|mins?|минут(?:ы|у)?|minute?|minutos?|minuten?|seconds?|secs?|секунд(?:ы|у)?|segundos?|sekunden?|分钟)/i.exec(value);
  if (!match) {
    if (/(?:вывод|средств|withdrawal|transfer|payout)/i.test(value)) return Math.min(SEARCH_WINDOW_SECONDS, 600);
    return CODE_MAX_AGE_SECONDS;
  }
  const seconds = Number(match[1]) * (/^(?:s|сек)/i.test(match[2]) ? 1 : 60);
  return Math.max(CODE_MAX_AGE_SECONDS, Math.min(SEARCH_WINDOW_SECONDS, seconds));
}

export function candidateIsFresh(candidate, now = Date.now()) {
  return isFresh(candidate?.timestamp, now, candidate?.lifetimeSeconds ?? CODE_MAX_AGE_SECONDS);
}

export function isFresh(timestamp, now = Date.now(), maxAgeSeconds = CODE_MAX_AGE_SECONDS) {
  const age = now - Number(timestamp);
  return Number.isFinite(age) && age >= -30_000 && age <= maxAgeSeconds * 1000;
}

const KEYWORDS = /(?:verification|verify|security|confirm(?:ation)?|one[\s-]*time|authentication|authorization|email\s*code|sign[\s-]*in|log[\s-]*in|\botp\b|\b2fa\b|\bpin\b|passcode|pass\s*code|access\s*code|withdrawal(?:\s*code)?|transfer(?:\s*code)?|payout(?:\s*code)?|код(?:\s*(?:подтверждения|верификации|безопасности|для\s*(?:входа|вывода|доступа)|вывода|авторизации))?|подтверд(?:ите|ение)(?:\s*(?:вывод|вход|действие|операцию))?|одноразов(?:ый|ого)\s*(?:код|пароль)|проверочн(?:ый|ого)\s*код|пароль(?:\s*для\s*(?:входа|вывода))?|пин(?:\s*код)?|введите\s*код|ваш\s*код|verificare|confirmare|securitate|autentificare|código(?:\s*de\s*(?:verificación|confirmación|seguridad|acceso))?|code(?:\s*de\s*(?:vérification|confirmation|sécurité))?|bestätigungscode|sicherheitscode|验证码|提现验证码|\bcode\b)/gi;
const CODE_PATTERN = /\b(?:\d{4,8}|(?=[A-Z0-9]{5,8}\b)(?=[A-Z0-9]*[A-Z])(?=[A-Z0-9]*\d)[A-Z0-9]{5,8})\b/g;

function decodeBasicEntities(value) {
  return String(value ?? '')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;|&#38;/gi, '&')
    .replace(/&lt;|&#60;/gi, '<')
    .replace(/&gt;|&#62;/gi, '>')
    .replace(/&quot;|&#34;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'");
}

function normalizeCodeSequence(raw) {
  const base = decodeBasicEntities(raw)
    .replace(/https?:\/\/[^\s"'<>]+/gi, ' ')
    .replace(/mailto:[^\s"'<>]+/gi, ' ')
    .replace(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi, ' ')
    .replace(/\b0x[0-9a-f]{4,}\b/gi, ' ')
    .replace(/#(?=[0-9a-f]*[a-f])[0-9a-f]{6}\b/gi, ' ')
    .replace(/\b(?:19|20)\d{2}[-./]\d{1,2}[-./]\d{1,2}\b/g, ' ')
    .replace(/\b\d{1,2}[./-]\d{1,2}[./-](?:19|20)\d{2}\b/g, ' ')
    .replace(/\b\d{1,2}:\d{2}(?::\d{2})?\b/g, ' ')
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/(?:^|(?<=\s))(?:G|FB|VK|TG)-(\d{4,8})\b/g, '$1')
    .replace(/\b\d{2,4}\s*[-–—]\s*\d{2,4}\b/g, sequence => sequence.replace(/\D/g, ''))
    .replace(/\b(?=[A-Z0-9-]{7,9}\b)(?=[A-Z0-9-]*[A-Z])(?=[A-Z0-9-]*\d)(?:[A-Z0-9]{3}-[A-Z0-9]{3}|[A-Z0-9]{4}-[A-Z0-9]{4})\b/g, sequence => sequence.replace(/-/g, ''))
    .replace(/\b\d(?:\s*[-–—]\s*\d){3,7}\b/g, sequence => sequence.replace(/\D/g, ''))
    .replace(/\b(?:\d\s+){3,7}\d\b/g, sequence => sequence.replace(/\s+/g, ''));

  return base.replace(/\b(\d{3})\s+(\d{3})\b|\b(\d{2})\s+(\d{2})\s+(\d{2})\b/g, (full, a, b, c, d, e, offset, str) => {
    const before = str.slice(Math.max(0, offset - 45), offset);
    const after = str.slice(offset + full.length, offset + full.length + 12);
    if (/(?:phone|mobile|cell|tel|telephone|телефон[а-я]*|номер|\+\d[\d\s()-]{0,12}|\d)\s*$/i.test(before) || /^\s*\d/.test(after)) {
      return full;
    }
    return a ? `${a}${b}` : `${c}${d}${e}`;
  });
}

function collectStructuralTokens(text, html) {
  const standalone = new Set();
  const emphasized = new Set();
  const lineAware = decodeBasicEntities(text)
    .replace(/<\/(?:p|div|tr|li|h[1-6]|td|br\s*\/?)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]*>/g, ' ');
  for (const rawLine of lineAware.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.length > 16) continue;
    const compact = line.replace(/^(?:G|FB|VK|TG)-/i, '').replace(/[\s-]/g, '');
    if (/^(?:19|20)\d{2}$/.test(compact)) continue;
    if (/^(?:\d{4,8}|(?=[A-Z0-9]{5,8}$)(?=[A-Z0-9]*[A-Z])(?=[A-Z0-9]*\d)[A-Z0-9]{5,8})$/.test(compact)) {
      standalone.add(compact);
    }
  }
  const markup = String(html || (/<[a-z]/i.test(String(text ?? '')) ? text : ''));
  for (const match of markup.matchAll(/<(?:b|strong|code|h1|h2|h3|td|span)[^>]*>\s*([^<]{4,16}?)\s*<\/(?:b|strong|code|h1|h2|h3|td|span)>/gi)) {
    const raw = decodeBasicEntities(match[1]).trim();
    const compact = raw.replace(/^(?:G|FB|VK|TG)-/i, '').replace(/[\s-]/g, '');
    if (/^(?:19|20)\d{2}$/.test(compact)) continue;
    if (/^(?:\d{4,8}|(?=[A-Z0-9]{5,8}$)(?=[A-Z0-9]*[A-Z])(?=[A-Z0-9]*\d)[A-Z0-9]{5,8})$/.test(compact)) {
      emphasized.add(compact);
    }
  }
  return { standalone, emphasized };
}

function isExcludedContext(preceding, following) {
  return /(?:anti[\s-]*phishing|анти[\s-]*фишинг|защит[а-я]*\s*от\s*фишинга|код\s*безопасности\s*от\s*фишинга)(?:[\s-]*code|[\s-]*код)?(?:\s*(?:is|это|:|=|-|#|no\.?|number|id))*[\s:]*$/i.test(preceding) ||
    /(?:(?:referral|ref|invite|invitation|реферал[а-я]*|пригласительн[а-я]*)(?:[\s-]*code|[\s-]*код)?|код\s*(?:приглашения|реферала))(?:\s*(?:is|это|:|=|-|#|no\.?|number|id))*[\s:]*$/i.test(preceding) ||
    /(?:(?:promo(?:tion)?|voucher|coupon|discount|промо|ваучер|купон|скидк[а-я]*|бонус)(?:[\s-]*code|[\s-]*код)?|код\s*скидки)(?:\s*(?:is|это|:|=|-|#|no\.?|number|id))*[\s:]*$/i.test(preceding) ||
    /(?:phone|mobile|cell|tel|telephone|телефон[а-я]*|номер\s*(?:моб(?:ильного)?|тел(?:ефона)?))(?:\s*(?:is|это|:|=|-|#|no\.?|number))*[\s:]*(?:[\d\s()+-]*)$/i.test(preceding) ||
    /(?:\+\d[\d\s()–-]{1,15})$/.test(preceding) ||
    /(?:zip|postal|postcode|почтов(?:ый|ого)\s*индекс|индекс)(?:[\s-]*code|[\s-]*код)?(?:\s*(?:is|это|:|=|-|#|no\.?|number|id))*[\s:]*$/i.test(preceding) ||
    /(?:order|tracking|ticket|invoice|receipt|заказ|сч[её]т|uid|user\s*id|txid|tx\s*id|tx|trans(?:action)?\s*id|ref(?:erence)?|account|аккаунт|id|ip|порт|port|amount|sum|сумма|баланс|balance|комиссия|fee|заявк[а-я]*|номер)(?:\s*(?:is|это|:|=|-|#|no\.?|number|id))*[\s:]*$/i.test(preceding) ||
    /(?:[$€£¥₹₽₴₸₩₿]\s*|\b(?:usd|eur|rub|usdt|btc|eth|bnb|trx|cny|gbp|cad|aud|uah|pln)\s*)$/i.test(preceding) ||
    /^\s*(?:[.,]\d{2}\b|(?:usd|eur|rub|usdt|btc|eth|bnb|trx|cny|gbp|cad|aud|uah|pln)\b)/i.test(following) ||
    /(?:^\s*\+[\d\s-]{1,5}$)/.test(preceding);
}

function scanTextForCodes(normalized, { standalone, emphasized }, expectedLength, baseBonus = 0, found = new Map()) {
  const keywords = [...normalized.matchAll(KEYWORDS)].map(match => ({ index: match.index, end: match.index + match[0].length }));
  for (const match of normalized.matchAll(CODE_PATTERN)) {
    const preceding = normalized.slice(Math.max(0, match.index - 46), match.index);
    const following = normalized.slice(match.index + match[0].length, match.index + match[0].length + 18);
    if (isExcludedContext(preceding, following)) continue;
    if (/^(?:19|20)\d{2}$/.test(match[0]) && !/(?:code|otp|pin|код|пароль|验证码)\s*(?:is|:|=)?\s*$/i.test(preceding)) continue;
    let score = 0;
    if (/(?:(?:verification|security|confirm(?:ation)?|auth(?:entication)?|one[\s-]*time|email|login|withdrawal|transfer)\s*code|код(?:\s*(?:подтверждения|верификации|безопасности|для\s*(?:входа|вывода)|вывода))?|ваш\s*код|your\s*code|\botp\b|\bpin\b)\s*(?:is|:|=|-|—)?\s*$/i.test(preceding)) {
      score += 5;
    }
    for (const keyword of keywords) {
      const after = match.index - keyword.end;
      const before = keyword.index - (match.index + match[0].length);
      if (after >= 0 && after <= 75) score = Math.max(score, 9 - after / 12);
      else if (after > 75 && after <= 180) score = Math.max(score, 4.5 - (after - 75) / 42);
      if (before >= 0 && before <= 35) score = Math.max(score, 3.5 - before / 15);
    }
    if (keywords.length > 0 && (emphasized.has(match[0]) || standalone.has(match[0]))) {
      score += 2.5;
    }
    if (score >= 2) {
      let total = score + baseBonus;
      if (Number.isInteger(expectedLength) && expectedLength >= 4 && expectedLength <= 8 && match[0].length === expectedLength) {
        total += 1.5;
      }
      found.set(match[0], Math.max(total, found.get(match[0]) ?? 0));
    }
  }
  return found;
}

export function extractCodeCandidates(text, options = {}) {
  const { html = '', subject = '', expectedLength = null } = options ?? {};
  const structural = collectStructuralTokens(text, html);
  const found = new Map();
  const normalizedBody = normalizeCodeSequence(text);
  scanTextForCodes(normalizedBody, structural, expectedLength, 0, found);
  if (subject) {
    const normalizedSubject = normalizeCodeSequence(subject);
    scanTextForCodes(normalizedSubject, { standalone: new Set(), emphasized: new Set() }, expectedLength, 2, found);
  }
  return [...found].map(([code, score]) => ({ code, score })).sort((a, b) => b.score - a.score);
}

export function extractCodes(text, options = {}) {
  return extractCodeCandidates(text, options).map(item => item.code);
}

const UNSUBSCRIBE_OR_LEGAL_URL = /(?:unsubscribe|opt[-_]?out|email[-_]?preferences|manage[-_]?subscriptions?|notification[-_]?settings|view[-_]?in[-_]?browser|privacy[-_\s]*policy|заявлени[ея]\s+о\s+конфиденциальност|конфиденциальност|terms[-_\s]*(?:of[-_\s]*(?:service|use)|and[-_\s]*conditions)|услови[яй]\s+использован|пользовательск[а-я]*\s+соглашени|cookie[-_\s]*policy|help[-_\s]*center|support[-_\s]*center|отписат|отписк|управлени[ея]\s+подписк|поддержк|справк|веб[-_\s]*верси)/i;
const TRAP_ACTION_TEXT = /(?:\bnot\s+you\b|\bwasn['’]?t\s+you\b|\bdidn['’]?t\s+(?:request|sign|try|attempt|authorize|create)\b|\block\s+(?:your\s+)?account\b|\bfreeze\b|\bdisable\s+(?:your\s+)?account\b|\brevoke\b|\breport\s+(?:this|suspicious|phishing|fraud)\b|\bcancel\s+(?:this|request|login|withdrawal|transfer|order)\b|\bdeny\b|\breject\b|не\s+вы\b|не\s+запрашивал|если\s+вы\s+не|заблокироват|отменит|отклонит|сообщит[еь]\s+о\s+взломе|пожаловат)/i;
const STATIC_ASSET_EXT = /\.(?:png|jpe?g|gif|svg|webp|ico|css|js|mjs|woff2?|ttf|eot|pdf|mp4|webm|zip)$/i;
const CTA_LABEL_PATTERN = /(?:verif(?:y|ication)|confirm(?:\s*(?:email|account|login|sign|your))?|activat(?:e|ion)|complete(?:\s*(?:registration|sign|setup))?|magic\s*link|sign\s*in|log\s*in|approve|authoriz(?:e|ation)|accept|continue|get\s*started|open\s*app|подтверд|активир|войти|заверш|верифицир|принять|перейти|открыть)/i;
const ACTION_PATH_PATTERN = /\/(?:verify|confirm|activate|activation|auth|callback|magic|login|signin|sign-in|approve|authorize|validate|email-verification|__\/auth\/action|account\/confirm|users\/confirmation)(?:[/?#]|$)/i;
const TOKEN_QUERY_OR_PATH = /(?:[?&](?:token|code|key|hash|ticket|otp|oobCode|token_hash|confirmation_token|magic_credential|auth_token|sig|signature|s|t)=[A-Za-z0-9._~-]{8,}|\/[A-Za-z0-9_-]{20,}(?:\/|$))/i;
const NEARBY_CTA_PATTERN = /(?:click\s+(?:the\s+)?(?:link|button)|tap\s+the\s+button|confirm\s+your\s+email|verify\s+your\s+email|activate\s+your\s+account|sign\s+in\s+to|magic\s+link|перейдите\s+по\s+ссылке|нажмите\s+(?:на\s+)?кнопку|подтвердите\s+(?:адрес|почту|аккаунт|регистрацию)|активируйте)/i;

function isPublicHttpsUrl(rawUrl) {
  let parsed;
  try { parsed = new URL(rawUrl); } catch { return null; }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) return null;
  const host = parsed.hostname.toLowerCase();
  if (!host || !host.includes('.') || host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) return null;
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host) || host.startsWith('[')) return null;
  if (STATIC_ASSET_EXT.test(parsed.pathname)) return null;
  return parsed;
}

function linkBelongsToSite(urlHost, identity) {
  const linkRoot = rootDomainOf(urlHost);
  if (identity.siteDomain && domainBelongsTo(urlHost, identity.siteDomain)) return true;
  if (identity.siteDomain && linkRoot === identity.siteDomain) return true;
  for (const eco of ECOSYSTEMS) {
    const siteMatch = eco.siteDomains.some(d => domainBelongsTo(identity.hostname, d) || identity.siteDomain === d);
    if (siteMatch && (eco.siteDomains.some(d => domainBelongsTo(urlHost, d)) || eco.mailDomains.some(d => domainBelongsTo(urlHost, d)))) {
      return true;
    }
  }
  return false;
}

export function extractActionLinks(message, identity = { hostname: '', siteDomain: '', names: [] }) {
  const entries = new Map();
  const addEntry = (rawUrl, label = '', preceding = '', surrounding = '') => {
    const cleanedUrl = decodeBasicEntities(String(rawUrl ?? '').trim()).replace(/[.,;:!?)]+$/, '');
    const parsed = isPublicHttpsUrl(cleanedUrl);
    if (!parsed) return;
    const cleanLabel = decodeBasicEntities(String(label ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()).slice(0, 120);
    const cleanPre = decodeBasicEntities(String(preceding ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim());
    const cleanSur = decodeBasicEntities(String(surrounding ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim());
    const prev = entries.get(parsed.href);
    if (!prev || cleanLabel.length > prev.label.length) {
      entries.set(parsed.href, { parsed, label: cleanLabel, preceding: cleanPre, surrounding: cleanSur });
    }
  };

  for (const item of message?.links ?? []) {
    addEntry(item?.url, item?.text ?? '', item?.preceding ?? '', item?.surrounding ?? '');
  }

  const html = String(message?.html ?? '');
  if (html) {
    for (const match of html.matchAll(/<a\b([^>]*?)href=(["'])(https?:\/\/[^"']+)\2([^>]*)>([\s\S]*?)<\/a>/gi)) {
      const attrs = `${match[1]} ${match[4]}`;
      const attrLabel = /(?:aria-label|title|alt)=(["'])(.*?)\1/i.exec(attrs)?.[2] ?? '';
      const imgAlt = /\balt=(["'])(.*?)\1/i.exec(match[5])?.[2] ?? '';
      const inner = match[5].replace(/<[^>]*>/g, ' ').trim();
      const label = inner || attrLabel || imgAlt;
      const beforeStart = Math.max(0, match.index - 220);
      const afterEnd = Math.min(html.length, match.index + match[0].length + 140);
      addEntry(match[3], label, html.slice(beforeStart, match.index), html.slice(beforeStart, afterEnd));
    }
  }

  const body = String(message?.body ?? '');
  if (body) {
    for (const match of body.matchAll(/https:\/\/[^\s<>"')\]}]+/gi)) {
      const start = Math.max(0, match.index - 110);
      const end = Math.min(body.length, match.index + match[0].length + 90);
      addEntry(match[0], '', body.slice(start, match.index), body.slice(start, end));
    }
  }

  const candidates = [];
  for (const { parsed, label, preceding, surrounding } of entries.values()) {
    const host = parsed.hostname.toLowerCase();
    const urlRoot = rootDomainOf(host);
    const domainRelated = linkBelongsToSite(host, identity);
    if (SOCIAL_DOMAINS.has(urlRoot) && !domainRelated) continue;
    const tightContext = `${parsed.pathname}${parsed.search} ${label} ${preceding.slice(-70)}`;
    if (UNSUBSCRIBE_OR_LEGAL_URL.test(`${parsed.href} ${label} ${preceding.slice(-45)}`)) continue;
    if (TRAP_ACTION_TEXT.test(tightContext)) continue;

    let score = 0;
    if (label && CTA_LABEL_PATTERN.test(label)) score += 9;
    if (ACTION_PATH_PATTERN.test(`${parsed.pathname}${parsed.search}`)) score += 5;
    if (TOKEN_QUERY_OR_PATH.test(`${parsed.pathname}${parsed.search}`)) score += 5;
    if (NEARBY_CTA_PATTERN.test(`${preceding.slice(-90)} ${surrounding.slice(0, 140)}`)) score += 4;
    if (domainRelated) score += 4;
    if (parsed.pathname === '/' && !parsed.search && !parsed.hash) score -= 8;

    if (score >= 8) {
      candidates.push({
        url: parsed.href,
        label: label || host,
        host,
        domainRelated,
        score
      });
    }
  }
  return candidates.sort((a, b) => b.score - a.score);
}

export function siteIdentity(origin, context = {}) {
  let hostname;
  try { hostname = new URL(origin).hostname.toLowerCase(); } catch { return { hostname: '', hostName: '', siteDomain: '', names: [] }; }
  const hostParts = hostname.split('.').filter(Boolean);
  const root = rootDomainOf(hostname);
  const rootParts = root.split('.').filter(Boolean);
  const isShared = SHARED_SUFFIX_REGEX.test(hostname);
  const hostName = isShared && hostParts.length >= 3 ? hostParts[hostParts.length - 3] : rootParts[0] ?? hostParts[0] ?? '';
  const ecosystemAliases = isShared ? [] : ECOSYSTEMS.filter(eco => eco.siteDomains.some(d => domainBelongsTo(hostname, d) || root === d)).flatMap(eco => eco.aliases);
  const supplied = [context.siteName, context.title?.split(/[|—–-]/)[0], SITES[siteForOrigin(origin)]?.name, ...ecosystemAliases];
  const names = [...new Set([hostName, ...supplied].map(x => String(x ?? '').trim().toLowerCase()).filter(x => x.length >= 3 && x.length <= 35 && !/^(?:login|account|accounts|sign in|verification|security)$/.test(x)))];
  const siteDomain = isShared ? '' : root;
  return { hostname, hostName, siteDomain, names };
}

function siteRelation(message, identity) {
  const address = normalizeSender(message.from);
  const domain = address?.split('@')[1] ?? '';
  const replyDomain = normalizeSender(message.replyTo)?.split('@')[1] ?? '';
  const verifiedDkim = dkimDomains(message.authResults);

  const sameSiteDomain = Boolean(domain && identity.siteDomain &&
    (domain === identity.siteDomain || domain.endsWith(`.${identity.siteDomain}`) || identity.siteDomain.endsWith(`.${domain}`)) &&
    (identity.hostname === identity.siteDomain || identity.hostname.endsWith(`.${identity.siteDomain}`)));
  const dkimSiteMatch = Boolean(identity.siteDomain && verifiedDkim.some(d => domainBelongsTo(d, identity.siteDomain)));
  const senderRelated = sameSiteDomain || dkimSiteMatch;

  const subject = String(message.subject ?? '').toLowerCase();
  const body = String(message.body ?? '').slice(0, 2000).toLowerCase();
  const namedInSubject = identity.names.some(name => subject.includes(name));
  const namedInBody = identity.names.some(name => body.includes(name));
  const brand = identity.hostName;
  const brandMention = text => Boolean(brand?.length >= 3 && new RegExp(`(^|[^a-z0-9])${brand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^a-z0-9])`).test(text));
  const fromName = String(message.from ?? '').toLowerCase();
  const namedInFrom = identity.names.some(name => fromName.includes(name)) || brandMention(fromName);

  const ecosystemMatch = ECOSYSTEMS.some(eco => {
    const siteHit = eco.siteDomains.some(d => domainBelongsTo(identity.hostname, d) || identity.siteDomain === d);
    if (!siteHit) return false;
    return eco.mailDomains.some(d => domainBelongsTo(domain, d) || domainBelongsTo(replyDomain, d) || verifiedDkim.some(dk => domainBelongsTo(dk, d)));
  });

  const replyRelated = Boolean(replyDomain && identity.siteDomain && domainBelongsTo(replyDomain, identity.siteDomain));

  let bodyHasSiteLink = false;
  if (identity.siteDomain) {
    const urlCorpus = `${body} ${String(message.html ?? '').slice(0, 12000)} ${(message.links ?? []).map(l => l.url).join(' ')}`;
    for (const m of urlCorpus.matchAll(/https:\/\/([a-z0-9.-]+\.[a-z]{2,})/gi)) {
      if (domainBelongsTo(m[1].toLowerCase(), identity.siteDomain)) {
        bodyHasSiteLink = true;
        break;
      }
    }
  }

  const bodyBrand = brandMention(body) || brandMention(subject) || ecosystemMatch || replyRelated || bodyHasSiteLink;
  const exactBrand = brandMention(subject) && bodyBrand;
  return {
    score: (senderRelated ? 5 : 0) + (ecosystemMatch ? 4 : 0) + (replyRelated ? 2 : 0) + (bodyHasSiteLink && !senderRelated ? 3 : 0) + (namedInSubject ? 4 : 0) + (namedInFrom ? 3 : 0) + (namedInBody ? 1 : 0),
    senderRelated,
    ecosystemRelated: ecosystemMatch,
    exactBrand,
    bodyBrand
  };
}

export function rankCandidates(messages, { siteId, sender = null, learnedSenders = [], preferredAccount = null, origin = '', siteContext = {}, startedAt = null, startToleranceMs = 60_000, now = Date.now() }) {
  const valid = [];
  const identity = siteIdentity(origin, siteContext);
  const normPreferred = normalizeSender(preferredAccount);
  let old = false;
  for (const message of messages) {
    if (sender && !senderMatches(message.from, sender)) continue;
    const relation = siteRelation(message, identity);
    const learned = learnedSenders.some(address => senderMatches(message.from, address));
    const subjectOk = subjectMatches(message.subject, siteId);
    if (!subjectOk && !relation.senderRelated && !relation.ecosystemRelated && !learned && (!sender || !senderMatches(message.from, sender))) continue;
    const bodyLifetime = lifetimeSeconds(message.body);
    const codes = extractCodeCandidates(message.body, { html: message.html, subject: message.subject, expectedLength: siteContext.expectedLength });
    const links = extractActionLinks(message, identity);
    if (!codes.length && !links.length) continue;
    const lifetime = codes.length ? bodyLifetime : Math.max(bodyLifetime, 600);
    if (!isFresh(message.timestamp, now, lifetime) || (startedAt && Number(message.timestamp) < startedAt - startToleranceMs)) { old = true; continue; }
    if (!sender && !learned && !relation.senderRelated && !relation.bodyBrand) continue;

    const bestLink = links[0] ?? null;
    const maskedBoost = matchesMaskedEmail(message.accountEmail, siteContext.maskedEmail) ? 2.5 : 0;
    const accountBoost = normPreferred && message.accountEmail && normalizeSender(message.accountEmail) === normPreferred ? 3 : 0;
    const recency = Math.max(0, 3 - (now - Number(message.timestamp)) / 60_000);
    const afterSession = startedAt && Number(message.timestamp) >= startedAt ? 1 : 0;
    const baseBonus = relation.score + (sender || learned ? 5 : 0) + recency + afterSession + maskedBoost + accountBoost;

    if (codes.length) {
      const options = codes.length > 1 && codes[0].score - codes[1].score < 2 ? codes.slice(0, 3) : codes.slice(0, 1);
      const codePreference = siteContext.prefer === 'link' ? 0 : 2;
      for (const option of options) {
        valid.push({
          kind: bestLink ? 'both' : 'code',
          code: option.code,
          link: bestLink ? { url: bestLink.url, label: bestLink.label, host: bestLink.host } : null,
          timestamp: Number(message.timestamp),
          lifetimeSeconds: lifetime,
          from: normalizeSender(message.from),
          subject: String(message.subject ?? '').slice(0, 120),
          requiresReview: !sender && !learned && !relation.senderRelated,
          id: message.id,
          accountEmail: message.accountEmail ?? null,
          accountProvider: message.accountProvider ?? 'gmail',
          localSource: message.localSource ?? null,
          score: option.score + codePreference + baseBonus
        });
      }
    } else if (bestLink) {
      const linkPreference = siteContext.prefer === 'link' ? 2 : 0;
      const linkTrusted = Boolean(sender || learned || (relation.senderRelated && bestLink.domainRelated));
      valid.push({
        kind: 'link',
        code: null,
        link: { url: bestLink.url, label: bestLink.label, host: bestLink.host },
        timestamp: Number(message.timestamp),
        lifetimeSeconds: lifetime,
        from: normalizeSender(message.from),
        subject: String(message.subject ?? '').slice(0, 120),
        requiresReview: !linkTrusted,
        id: message.id,
        accountEmail: message.accountEmail ?? null,
        accountProvider: message.accountProvider ?? 'gmail',
        localSource: message.localSource ?? null,
        score: bestLink.score + linkPreference + baseBonus
      });
    }
  }
  valid.sort((a, b) => {
    if (a.from === b.from && Math.abs(b.timestamp - a.timestamp) > 5000) {
      return b.timestamp - a.timestamp;
    }
    return b.score - a.score || b.timestamp - a.timestamp;
  });
  if (valid.length > 1 && valid[0].id !== valid[1].id &&
      (valid[0].code !== valid[1].code || valid[0].link?.url !== valid[1].link?.url || valid[0].accountEmail !== valid[1].accountEmail) &&
      valid[0].score - valid[1].score < 2 && Math.abs(valid[0].timestamp - valid[1].timestamp) < 30_000) {
    return { status: 'ambiguous', candidates: valid.slice(0, 3) };
  }
  return valid.length ? { status: 'found', candidate: valid[0] } : { status: old ? 'old' : 'none' };
}
