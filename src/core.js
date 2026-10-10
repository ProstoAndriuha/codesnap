export const CODE_MAX_AGE_SECONDS = 180;
export const SITES = Object.freeze({
  binance: { name: 'Binance', origins: ['https://www.binance.com', 'https://accounts.binance.com'], subject: /(?:verification|security|confirm|code|otp|auth|login|sign|withdraw|payout|transfer|вывод|средств|подтвержд|верификац|безопасн|вход|парол|авториз)/i },
  bybit: { name: 'Bybit', origins: ['https://www.bybit.com'], subject: /(?:verification|security|confirm|code|otp|auth|login|sign|withdraw|payout|transfer|вывод|средств|подтвержд|верификац|безопасн|вход|парол|авториз)/i },
  okx: { name: 'OKX', origins: ['https://www.okx.com'], subject: /(?:verification|security|confirm|code|otp|auth|login|sign|withdraw|payout|transfer|вывод|средств|подтвержд|верификац|безопасн|вход|парол|авториз)/i }
});

export function siteForOrigin(origin) {
  return Object.entries(SITES).find(([, site]) => site.origins.includes(origin))?.[0] ?? null;
}

export function trustedOrigin(origin, siteId) {
  return Boolean(SITES[siteId]?.origins.includes(origin));
}

export function normalizeSender(value) {
  const match = /(?:^|<)([a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,})(?:>|$)/i.exec(value?.trim() ?? '');
  return match?.[1].toLowerCase() ?? null;
}

export function senderMatches(header, trustedAddress) {
  const actual = normalizeSender(header);
  const expected = normalizeSender(trustedAddress);
  return Boolean(actual && expected && actual === expected);
}

const UNIVERSAL_SUBJECT_PATTERN = /(?:verification|security|confirm|code|otp|auth|login|sign|pass|pin|token|alert|notice|action|device|access|withdraw|payout|transfer|pay|order|код|вывод|средств|подтвержд|верификац|безопасн|вход|сброс|парол|авториз|устройств|сесси|секретн|транзакц|платеж|счет|доступ|verificare|confirmare|securitate|autentificare|conexiun|accesa|código|seguridad|clave|acceso|retir|vérification|sécurité|mot\s*de\s*passe|connexion|retrait|sicherheit|bestätigung|anmeldung|abhebung|验证码|安全|登录|提现)/i;

export function subjectMatches(subject, siteId) {
  const text = String(subject ?? '');
  if (siteId === 'generic') return UNIVERSAL_SUBJECT_PATTERN.test(text);
  if (SITES[siteId]?.subject.test(text)) return true;
  return UNIVERSAL_SUBJECT_PATTERN.test(text);
}

export const SEARCH_WINDOW_SECONDS = 15 * 60;

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

const KEYWORDS = /(?:verification|verify|security|confirm(?:ation)?|one[\s-]*time|authentication|authorization|email\s*code|\botp\b|\b2fa\b|\bpin\b|passcode|pass\s*code|access\s*code|withdrawal(?:\s*code)?|transfer(?:\s*code)?|payout(?:\s*code)?|код(?:\s*(?:подтверждения|верификации|безопасности|для\s*(?:входа|вывода|доступа)|вывода|авторизации))?|подтверд(?:ите|ение)(?:\s*(?:вывод|вход|действие|операцию))?|одноразов(?:ый|ого)\s*(?:код|пароль)|проверочн(?:ый|ого)\s*код|пароль(?:\s*для\s*(?:входа|вывода))?|пин(?:\s*код)?|введите\s*код|ваш\s*код|verificare|confirmare|securitate|autentificare|código(?:\s*de\s*(?:verificación|confirmación|seguridad|acceso))?|code(?:\s*de\s*(?:vérification|confirmation|sécurité))?|bestätigungscode|sicherheitscode|验证码|提现验证码|\bcode\b)/gi;
const CODE_PATTERN = /\b(?:\d{4,8}|(?=[A-Z0-9]{5,8}\b)(?=[A-Z0-9]*[A-Z])(?=[A-Z0-9]*\d)[A-Z0-9]{5,8})\b/g;

export function extractCodeCandidates(text) {
  const normalized = String(text ?? '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;|&#160;/gi, ' ').replace(/\s+/g, ' ')
    .replace(/\b\d{2,4}\s*[-–—]\s*\d{2,4}\b/g, sequence => sequence.replace(/\D/g, ''))
    .replace(/\b\d(?:\s*[-–—]\s*\d){3,7}\b/g, sequence => sequence.replace(/\D/g, ''))
    .replace(/\b(?:\d\s+){3,7}\d\b/g, sequence => sequence.replace(/\s+/g, ''))
    .replace(/\bG-(\d{4,8})\b/g, '$1');
  const keywords = [...normalized.matchAll(KEYWORDS)].map(match => ({ index: match.index, end: match.index + match[0].length }));
  const found = new Map();
  for (const match of normalized.matchAll(CODE_PATTERN)) {
    const preceding = normalized.slice(Math.max(0, match.index - 38), match.index);
    const following = normalized.slice(match.index + match[0].length, match.index + match[0].length + 16);
    // Numbers beside commercial identifiers, anti-phishing codes, referral/promo codes, phones, postal codes, dates and amounts are not OTPs.
    if (/(?:anti[\s-]*phishing|анти[\s-]*фишинг|защит[а-я]*\s*от\s*фишинга|код\s*безопасности\s*от\s*фишинга)(?:[\s-]*code|[\s-]*код)?(?:\s*(?:is|это|:|=|-|#|no\.?|number|id))*[\s:]*$/i.test(preceding) ||
      /(?:(?:referral|ref|invite|invitation|реферал[а-я]*|пригласительн[а-я]*)(?:[\s-]*code|[\s-]*код)?|код\s*(?:приглашения|реферала))(?:\s*(?:is|это|:|=|-|#|no\.?|number|id))*[\s:]*$/i.test(preceding) ||
      /(?:(?:promo(?:tion)?|voucher|coupon|discount|промо|ваучер|купон|скидк[а-я]*|бонус)(?:[\s-]*code|[\s-]*код)?|код\s*скидки)(?:\s*(?:is|это|:|=|-|#|no\.?|number|id))*[\s:]*$/i.test(preceding) ||
      /(?:phone|mobile|cell|tel|telephone|телефон[а-я]*|номер\s*(?:моб(?:ильного)?|тел(?:ефона)?))(?:\s*(?:is|это|:|=|-|#|no\.?|number))*[\s:]*(?:[\d\s()+-]*)$/i.test(preceding) ||
      /(?:\+\d[\d\s()–-]{1,15})$/.test(preceding) ||
      /(?:zip|postal|postcode|почтов(?:ый|ого)\s*индекс|индекс)(?:[\s-]*code|[\s-]*код)?(?:\s*(?:is|это|:|=|-|#|no\.?|number|id))*[\s:]*$/i.test(preceding) ||
      /(?:order|tracking|ticket|invoice|receipt|заказ|сч[её]т|uid|user\s*id|txid|tx\s*id|tx|trans(?:action)?\s*id|ref(?:erence)?|account|аккаунт|id|ip|порт|port|amount|sum|сумма|баланс|balance|комиссия|fee|заявк[а-я]*|номер)(?:\s*(?:is|это|:|=|-|#|no\.?|number|id))*[\s:]*$/i.test(preceding) ||
      /(?:[$€£¥₹₽₴₸₩₿]\s*|\b(?:usd|eur|rub|usdt|btc|eth|bnb|trx|cny|gbp|cad|aud|uah|pln)\s*)$/i.test(preceding) ||
      /^\s*(?:[.,]\d{2}\b|(?:usd|eur|rub|usdt|btc|eth|bnb|trx|cny|gbp|cad|aud|uah|pln)\b)/i.test(following) ||
      /(?:^\s*\+[\d\s-]{1,5}$)/.test(preceding)) continue;
    if (/^(?:19|20)\d{2}$/.test(match[0]) && !/(?:code|otp|код|验证码)\s*(?:is|:|=)?\s*$/i.test(preceding)) continue;
    let score = 0;
    if (/(?:(?:verification|security|confirm(?:ation)?|auth(?:entication)?|one[\s-]*time|email|login|withdrawal|transfer)\s*code|код(?:\s*(?:подтверждения|верификации|безопасности|для\s*(?:входа|вывода)|вывода))?|ваш\s*код|your\s*code|\botp\b|\bpin\b)\s*(?:is|:|=|-|—)?\s*$/i.test(preceding)) {
      score += 5;
    }
    for (const keyword of keywords) {
      const after = match.index - keyword.end;
      const before = keyword.index - (match.index + match[0].length);
      if (after >= 0 && after <= 75) score = Math.max(score, 9 - after / 12);
      if (before >= 0 && before <= 25) score = Math.max(score, 3 - before / 15);
    }
    if (score >= 2) found.set(match[0], Math.max(score, found.get(match[0]) ?? 0));
  }
  return [...found].map(([code, score]) => ({ code, score })).sort((a, b) => b.score - a.score);
}

export function extractCodes(text) { return extractCodeCandidates(text).map(item => item.code); }

export function siteIdentity(origin, context = {}) {
  let hostname;
  try { hostname = new URL(origin).hostname.toLowerCase(); } catch { return { hostname: '', names: [] }; }
  const hostParts = hostname.split('.').filter(Boolean);
  const sharedSuffix = /(?:^|\.)(?:github\.io|pages\.dev|vercel\.app|netlify\.app|web\.app|appspot\.com|herokuapp\.com|co\.uk|com\.au|co\.jp)$/;
  const hostName = sharedSuffix.test(hostname) && hostParts.length >= 3 ? hostParts[hostParts.length - 3] : hostParts.length >= 2 ? hostParts[hostParts.length - 2] : hostParts[0];
  const supplied = [context.siteName, context.title?.split(/[|—–-]/)[0], SITES[siteForOrigin(origin)]?.name];
  const names = [...new Set([hostName, ...supplied].map(x => String(x ?? '').trim().toLowerCase()).filter(x => x.length >= 3 && x.length <= 35 && !/^(?:login|account|accounts|sign in|verification|security)$/.test(x)))];
  const siteDomain = sharedSuffix.test(hostname) ? '' : hostParts.slice(-2).join('.');
  return { hostname, hostName, siteDomain, names };
}

function siteRelation(message, identity) {
  const address = normalizeSender(message.from);
  const domain = address?.split('@')[1] ?? '';
  const senderRelated = Boolean(domain && identity.siteDomain &&
    (domain === identity.siteDomain || domain.endsWith(`.${identity.siteDomain}`) || identity.siteDomain.endsWith(`.${domain}`)) &&
    (identity.hostname === identity.siteDomain || identity.hostname.endsWith(`.${identity.siteDomain}`)));
  const subject = String(message.subject ?? '').toLowerCase();
  const body = String(message.body ?? '').slice(0, 1500).toLowerCase();
  const namedInSubject = identity.names.some(name => subject.includes(name));
  const namedInBody = identity.names.some(name => body.includes(name));
  const brand = identity.hostName;
  const brandMention = text => Boolean(brand?.length >= 3 && new RegExp(`(^|[^a-z0-9])${brand}($|[^a-z0-9])`).test(text));
  const fromName = String(message.from ?? '').toLowerCase();
  const namedInFrom = identity.names.some(name => fromName.includes(name)) || brandMention(fromName);
  // Microsoft account login and its security mail use different domains.
  // Keep these cross-domain candidates reviewable; a page title cannot grant this relation.
  const microsoftLogin = ['login.live.com', 'account.live.com', 'login.microsoftonline.com'].includes(identity.hostname);
  const microsoftMail = domain === 'accountprotection.microsoft.com';
  const bodyBrand = brandMention(body) || (microsoftLogin && microsoftMail);
  const exactBrand = brandMention(subject) && bodyBrand;
  return {
    score: (senderRelated ? 5 : 0) + (namedInSubject ? 4 : 0) + (namedInFrom ? 3 : 0) + (namedInBody ? 1 : 0),
    senderRelated,
    exactBrand,
    bodyBrand
  };
}

export function rankCandidates(messages, { siteId, sender = null, learnedSenders = [], origin = '', siteContext = {}, startedAt = null, startToleranceMs = 60_000, now = Date.now() }) {
  const valid = [];
  const identity = siteIdentity(origin, siteContext);
  let old = false;
  for (const message of messages) {
    if (sender && !senderMatches(message.from, sender)) continue;
    const relation = siteRelation(message, identity);
    const learned = learnedSenders.some(address => senderMatches(message.from, address));
    const subjectOk = subjectMatches(message.subject, siteId);
    if (!subjectOk && !relation.senderRelated && !learned && (!sender || !senderMatches(message.from, sender))) continue;
    const lifetime = lifetimeSeconds(message.body);
    if (!isFresh(message.timestamp, now, lifetime) || (startedAt && Number(message.timestamp) < startedAt - startToleranceMs)) { old = true; continue; }
    if (!sender && !learned && !relation.senderRelated && !relation.bodyBrand) continue;
    const codes = extractCodeCandidates(message.body);
    if (!codes.length) continue;
    const options = codes.length > 1 && codes[0].score - codes[1].score < 2 ? codes.slice(0, 3) : codes.slice(0, 1);
    const recency = Math.max(0, 3 - (now - Number(message.timestamp)) / 60_000);
    const afterSession = startedAt && Number(message.timestamp) >= startedAt ? 1 : 0;
    for (const option of options) valid.push({ code: option.code, timestamp: Number(message.timestamp), lifetimeSeconds: lifetime, from: normalizeSender(message.from), subject: String(message.subject ?? '').slice(0, 120), requiresReview: !sender && !learned && !relation.senderRelated, id: message.id, accountEmail: message.accountEmail ?? null, accountProvider: message.accountProvider ?? 'gmail', score: option.score + relation.score + (sender || learned ? 5 : 0) + recency + afterSession });
  }
  valid.sort((a, b) => {
    if (a.from === b.from && Math.abs(b.timestamp - a.timestamp) > 5000) {
      return b.timestamp - a.timestamp;
    }
    return b.score - a.score || b.timestamp - a.timestamp;
  });
  if (valid.length > 1 && valid[0].id !== valid[1].id && (valid[0].code !== valid[1].code || valid[0].accountEmail !== valid[1].accountEmail) && valid[0].score - valid[1].score < 2 && Math.abs(valid[0].timestamp - valid[1].timestamp) < 30_000) {
    return { status: 'ambiguous', candidates: valid.slice(0, 3) };
  }
  return valid.length ? { status: 'found', candidate: valid[0] } : { status: old ? 'old' : 'none' };
}
