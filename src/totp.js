import { ECOSYSTEMS, SITES, rootDomainOf, siteIdentity, matchesMaskedEmail, checkPhishingRisk } from './core.js';

export const TOTP_GRACE_SECONDS = 3;

export async function awaitFreshTotpResult(getterFn, {
  graceSeconds = TOTP_GRACE_SECONDS,
  sleepFn = ms => new Promise(resolve => setTimeout(resolve, ms)),
  nowFn = () => Date.now()
} = {}) {
  const now = nowFn();
  const first = await getterFn(now);
  if (!first || first.status !== 'found') return first;
  const periodMs = (first.period || 30) * 1000;
  const remMs = periodMs - (((now % periodMs) + periodMs) % periodMs);
  if (first.remainingSeconds > graceSeconds && remMs > graceSeconds * 1000) {
    return { ...first, waitedForNextWindow: false };
  }
  await sleepFn(Math.min(graceSeconds * 1000 + 250, remMs + 60));
  const fresh = await getterFn(nowFn());
  return { ...fresh, waitedForNextWindow: true };
}

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const PBKDF2_ITERATIONS = 150_000;

const BRAND_NOISE = new Set([
  'com', 'net', 'org', 'io', 'ru', 'me', 'co', 'totp', '2fa', 'mfa', 'otp', 'auth', 'ga',
  'account', 'acc', 'website', 'site', 'web', 'login', 'main', 'mail', 'email', 'user', 'app', 'exchange'
]);

function stripEmailsFromText(text) {
  return String(text ?? '').replace(/[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}/gi, ' ');
}

export function extractBrandFromAccountLabel(rawAccount) {
  const raw = String(rawAccount ?? '').trim();
  if (!raw) return '';

  const parts = raw.split(/(?:--|[:/|()\s,;])+/).map(s => s.trim()).filter(Boolean);
  const nonEmailTokens = [];
  for (const part of parts) {
    const atIdx = part.indexOf('@');
    if (atIdx < 0) {
      if (!BRAND_NOISE.has(part.toLowerCase())) nonEmailTokens.push(part);
      continue;
    }
    const beforeAt = part.slice(0, atIdx);
    const afterAt = part.slice(atIdx + 1);
    const domMatch = /^([a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,})[-_]+(.+)$/i.exec(afterAt);
    if (domMatch?.[2]) {
      for (const tok of domMatch[2].split(/[-_]+/)) {
        if (tok.length >= 2 && !BRAND_NOISE.has(tok.toLowerCase())) nonEmailTokens.push(tok);
      }
    }
    for (const prefixTok of beforeAt.split(/[-_.]+/)) {
      if (prefixTok.length >= 3 && !BRAND_NOISE.has(prefixTok.toLowerCase()) && inferDomainFromIssuer(prefixTok, '')) {
        const root = prefixTok.replace(/\d+$/, '');
        return (root.length >= 4 ? root : prefixTok).slice(0, 60);
      }
    }
  }

  const best = nonEmailTokens.find(t => t.replace(/\d+$/g, '').length >= 3) ?? nonEmailTokens.find(t => t.length >= 3);
  if (!best) return '';
  const root = best.replace(/\d+$/, '');
  return (root.length >= 4 ? root : best).slice(0, 60);
}

export function extractAccountEmail(rawAccount, rawIssuer = '') {
  const sources = [rawAccount, rawIssuer];
  for (const source of sources) {
    const text = String(source ?? '').trim();
    if (!text || !text.includes('@')) continue;
    const parts = text.split(/(?:--|[:/|()\s,;])+/).filter(Boolean);
    for (const part of parts) {
      const stripped = part.replace(/^[a-z0-9.-]+\.(?:com|net|org|io|ru|me|co|exchange)-+/i, '');
      const match = /([a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,})(?=$|[^a-z])/i.exec(stripped);
      if (match) return match[1].toLowerCase();
    }
  }
  return null;
}

function toBase64(bytes) {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let bin = '';
  for (let i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i]);
  return btoa(bin);
}

function fromBase64(str) {
  const bin = atob(String(str ?? ''));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function normalizeBase32(raw) {
  const clean = String(raw ?? '')
    .toUpperCase()
    .replace(/[\s\-=]+/g, '');
  if (!/^[A-Z2-7]{8,128}$/.test(clean)) {
    throw new Error('TOTP_INVALID_SECRET');
  }
  return clean;
}

export function decodeBase32(raw) {
  const clean = normalizeBase32(raw);
  const bytes = [];
  let buffer = 0;
  let bits = 0;
  for (const ch of clean) {
    const val = BASE32_ALPHABET.indexOf(ch);
    if (val < 0) throw new Error('TOTP_INVALID_SECRET');
    buffer = (buffer << 5) | val;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >>> bits) & 0xff);
    }
  }
  if (!bytes.length) throw new Error('TOTP_INVALID_SECRET');
  return new Uint8Array(bytes);
}

export function encodeBase32(bytes) {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let bits = 0;
  let value = 0;
  let out = '';
  for (let i = 0; i < arr.length; i++) {
    value = (value << 8) | arr[i];
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += BASE32_ALPHABET[(value >>> bits) & 31];
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

function readProtobufFields(bytes) {
  let pos = 0;
  const readVarint = () => {
    let res = 0;
    let factor = 1;
    while (pos < bytes.length) {
      const b = bytes[pos++];
      res += (b & 0x7f) * factor;
      if ((b & 0x80) === 0) return res;
      factor *= 128;
    }
    throw new Error('TOTP_INVALID_SECRET');
  };
  const fields = [];
  while (pos < bytes.length) {
    const tag = readVarint();
    const fieldNum = tag >>> 3;
    const wireType = tag & 7;
    if (wireType === 0) {
      fields.push({ fieldNum, wireType, value: readVarint() });
    } else if (wireType === 2) {
      const len = readVarint();
      if (pos + len > bytes.length) throw new Error('TOTP_INVALID_SECRET');
      fields.push({ fieldNum, wireType, value: bytes.subarray(pos, pos + len) });
      pos += len;
    } else if (wireType === 1) {
      pos += 8;
    } else if (wireType === 5) {
      pos += 4;
    } else {
      throw new Error('TOTP_INVALID_SECRET');
    }
  }
  return fields;
}

export function parseOtpAuthMigrationUri(rawUri, fallback = {}) {
  let parsed;
  try { parsed = new URL(String(rawUri ?? '').trim()); } catch { throw new Error('TOTP_INVALID_SECRET'); }
  if (parsed.protocol.toLowerCase() !== 'otpauth-migration:') throw new Error('TOTP_UNSUPPORTED_URI');
  const dataParam = parsed.searchParams.get('data');
  if (!dataParam) throw new Error('TOTP_INVALID_SECRET');
  const b64 = dataParam.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
  const payloadBytes = fromBase64(padded);
  const entries = [];
  const decoder = new TextDecoder();

  for (const field of readProtobufFields(payloadBytes)) {
    if (field.fieldNum !== 1 || field.wireType !== 2) continue;
    let secretBytes = null;
    let name = '';
    let issuer = '';
    let algorithm = 'SHA1';
    let digits = 6;
    let otpType = 2;

    for (const sub of readProtobufFields(field.value)) {
      if (sub.fieldNum === 1 && sub.wireType === 2) secretBytes = sub.value;
      else if (sub.fieldNum === 2 && sub.wireType === 2) name = decoder.decode(sub.value).trim();
      else if (sub.fieldNum === 3 && sub.wireType === 2) issuer = decoder.decode(sub.value).trim();
      else if (sub.fieldNum === 4 && sub.wireType === 0) {
        algorithm = sub.value === 2 ? 'SHA256' : sub.value === 3 ? 'SHA512' : 'SHA1';
      } else if (sub.fieldNum === 5 && sub.wireType === 0) {
        digits = (sub.value === 2 || sub.value === 8) ? 8 : 6;
      } else if (sub.fieldNum === 6 && sub.wireType === 0) {
        otpType = sub.value;
      }
    }

    if (otpType === 1 || !secretBytes?.length) continue;
    const secret = normalizeBase32(encodeBase32(secretBytes));
    let labelIssuer = '';
    let account = name;
    if (name.includes(':')) {
      const idx = name.indexOf(':');
      labelIssuer = name.slice(0, idx).trim();
      account = name.slice(idx + 1).trim();
    }
    const finalIssuer = (issuer || labelIssuer || fallback.issuer || fallback.domain || 'Account').slice(0, 60);
    const domain = fallback.explicitDomain
      ? rootDomainOf(fallback.explicitDomain)
      : inferDomainFromIssuer(finalIssuer, fallback.domain || '');
    entries.push({ secret, issuer: finalIssuer, account: account.slice(0, 80), domain, algorithm, digits, period: 30 });
  }

  if (!entries.length) throw new Error('TOTP_INVALID_SECRET');
  return entries;
}

export function extractTotpFromScannedText(rawText, fallback = {}) {
  const raw = String(rawText ?? '').trim();
  if (!raw) return { kind: 'empty' };
  if (/^otpauth:\/\/totp/i.test(raw)) {
    return { kind: 'totp', entries: [parseTotpInput(raw, fallback)] };
  }
  if (/^otpauth:\/\/hotp/i.test(raw)) {
    return { kind: 'unsupported_hotp' };
  }
  if (/^otpauth-migration:\/\//i.test(raw)) {
    return { kind: 'totp', entries: parseOtpAuthMigrationUri(raw, fallback) };
  }
  if (/^https?:\/\//i.test(raw)) {
    let url;
    try { url = new URL(raw); } catch { return { kind: 'non_totp_qr', preview: raw.slice(0, 40) }; }
    const hashParams = new URLSearchParams(url.hash.replace(/^#/, ''));
    const secretParam = url.searchParams.get('secret') || hashParams.get('secret');
    if (secretParam && /^[A-Z2-7\s\-=]{16,64}$/i.test(secretParam)) {
      return {
        kind: 'totp',
        entries: [parseTotpInput(secretParam, {
          ...fallback,
          issuer: url.searchParams.get('issuer') || fallback.issuer || url.hostname,
          domain: fallback.domain || url.hostname
        })]
      };
    }
    return { kind: 'non_totp_qr', preview: url.hostname };
  }
  if (/^[A-Z2-7\s\-=]{16,64}$/i.test(raw)) {
    return { kind: 'totp', entries: [parseTotpInput(raw, fallback)] };
  }
  return { kind: 'non_totp_qr', preview: raw.slice(0, 40) };
}

function inferDomainFromIssuer(issuer, fallbackDomain = '') {
  const raw = String(issuer ?? '').trim();
  const norm = raw.toLowerCase();
  const compact = norm.replace(/[\s_-]+/g, '');
  const noDigits = compact.replace(/\d+$/, '');
  if (!norm || norm === 'account' || norm === 'website') {
    return fallbackDomain ? rootDomainOf(fallbackDomain) : '';
  }
  for (const [, site] of Object.entries(SITES)) {
    const sName = site.name.toLowerCase();
    if (norm === sName || compact === sName || norm.includes(sName) || compact.includes(sName)) {
      try { return rootDomainOf(new URL(site.origins[0]).hostname); } catch { /* ignore */ }
    }
  }
  if (/\bgoogle\b/i.test(norm)) return 'google.com';
  for (const eco of ECOSYSTEMS) {
    const ecoHit =
      eco.siteDomains.some(d => norm === d || compact === d || norm === d.split('.')[0] || compact === d.split('.')[0] || noDigits === d.split('.')[0]) ||
      eco.aliases.some(a => norm === a || compact === a || noDigits === a || (a.length >= 4 && (norm.includes(a) || compact.includes(a))));
    if (ecoHit) return eco.siteDomains[0];
  }
  const domainMatch = /\b([a-z0-9-]+(?:\.[a-z0-9-]+)+)\b/i.exec(norm);
  if (domainMatch) return rootDomainOf(domainMatch[1]);
  return fallbackDomain ? rootDomainOf(fallbackDomain) : '';
}

export function parseTotpInput(rawInput, fallback = {}) {
  const raw = String(rawInput ?? '').trim();
  if (!raw) throw new Error('TOTP_INVALID_SECRET');

  if (/^otpauth:\/\//i.test(raw)) {
    let parsed;
    try { parsed = new URL(raw); } catch { throw new Error('TOTP_INVALID_SECRET'); }
    if (parsed.protocol.toLowerCase() !== 'otpauth:') throw new Error('TOTP_UNSUPPORTED_URI');
    const hostType = parsed.hostname.toLowerCase();
    const pathClean = decodeURIComponent(parsed.pathname.replace(/^\/+/, ''));
    let mode = hostType;
    let label = pathClean;
    if (!mode) {
      const firstSlash = pathClean.indexOf('/');
      mode = (firstSlash >= 0 ? pathClean.slice(0, firstSlash) : pathClean).toLowerCase();
      label = firstSlash >= 0 ? pathClean.slice(firstSlash + 1) : '';
    }
    if (mode !== 'totp') throw new Error('TOTP_UNSUPPORTED_URI');

    let issuerFromLabel = '';
    let accountFromLabel = '';
    if (label.includes(':')) {
      const idx = label.indexOf(':');
      issuerFromLabel = label.slice(0, idx).trim();
      accountFromLabel = label.slice(idx + 1).trim();
    } else if (label.includes('@')) {
      accountFromLabel = label.trim();
    } else {
      issuerFromLabel = label.trim();
    }

    const secret = normalizeBase32(parsed.searchParams.get('secret') ?? '');
    const accountPrefixDomain = !parsed.searchParams.get('issuer') && !issuerFromLabel && accountFromLabel.includes('--')
      ? accountFromLabel.split('--')[0].trim()
      : '';
    const brandFromAccount = !parsed.searchParams.get('issuer') && !issuerFromLabel
      ? (accountPrefixDomain || extractBrandFromAccountLabel(accountFromLabel))
      : '';
    const issuer = (parsed.searchParams.get('issuer') || issuerFromLabel || brandFromAccount || fallback.issuer || fallback.domain || 'Account').trim().slice(0, 60);
    const account = (accountFromLabel || fallback.account || '').trim().slice(0, 80);

    const rawAlgo = String(parsed.searchParams.get('algorithm') || fallback.algorithm || 'SHA1').toUpperCase().replace(/[^A-Z0-9]/g, '');
    const algorithm = rawAlgo === 'SHA256' || rawAlgo === 'SHA512' ? rawAlgo : 'SHA1';

    const rawDigits = Number(parsed.searchParams.get('digits') ?? fallback.digits ?? 6);
    const digits = Number.isInteger(rawDigits) && rawDigits >= 6 && rawDigits <= 8 ? rawDigits : 6;

    const rawPeriod = Number(parsed.searchParams.get('period') ?? fallback.period ?? 30);
    const period = Number.isFinite(rawPeriod) && rawPeriod >= 15 && rawPeriod <= 120 ? Math.round(rawPeriod) : 30;

    const domain = fallback.explicitDomain
      ? rootDomainOf(fallback.explicitDomain)
      : (inferDomainFromIssuer(issuer, '') || inferDomainFromIssuer(extractBrandFromAccountLabel(account), fallback.domain || ''));
    return { secret, issuer, account, domain, algorithm, digits, period };
  }

  const secret = normalizeBase32(raw);
  const issuer = String(fallback.issuer || fallback.domain || 'Website').trim().slice(0, 60);
  const account = String(fallback.account || '').trim().slice(0, 80);
  const rawAlgo = String(fallback.algorithm || 'SHA1').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const algorithm = rawAlgo === 'SHA256' || rawAlgo === 'SHA512' ? rawAlgo : 'SHA1';
  const rawDigits = Number(fallback.digits ?? 6);
  const digits = Number.isInteger(rawDigits) && rawDigits >= 6 && rawDigits <= 8 ? rawDigits : 6;
  const rawPeriod = Number(fallback.period ?? 30);
  const period = Number.isFinite(rawPeriod) && rawPeriod >= 15 && rawPeriod <= 120 ? Math.round(rawPeriod) : 30;
  const domain = fallback.explicitDomain ? rootDomainOf(fallback.explicitDomain) : inferDomainFromIssuer(issuer, fallback.domain || '');
  return { secret, issuer, account, domain, algorithm, digits, period };
}

export async function generateTotpCode(entryOrSecret, now = Date.now()) {
  const entry = typeof entryOrSecret === 'string'
    ? { secret: entryOrSecret, algorithm: 'SHA1', digits: 6, period: 30 }
    : entryOrSecret;
  const algorithm = entry?.algorithm === 'SHA256' || entry?.algorithm === 'SHA512' ? entry.algorithm : 'SHA1';
  const digits = Number.isInteger(entry?.digits) && entry.digits >= 6 && entry.digits <= 8 ? entry.digits : 6;
  const period = Number.isFinite(entry?.period) && entry.period >= 15 && entry.period <= 120 ? Math.round(entry.period) : 30;

  const keyBytes = decodeBase32(entry?.secret ?? '');
  const hashName = algorithm === 'SHA256' ? 'SHA-256' : algorithm === 'SHA512' ? 'SHA-512' : 'SHA-1';

  const epochSec = Math.floor(Number(now) / 1000);
  const counter = Math.floor(epochSec / period);
  const counterBytes = new Uint8Array(8);
  const view = new DataView(counterBytes.buffer);
  view.setUint32(0, Math.floor(counter / 0x100000000), false);
  view.setUint32(4, counter >>> 0, false);

  const cryptoKey = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: hashName }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, counterBytes));
  const offset = sig[sig.length - 1] & 0x0f;
  const binary =
    ((sig[offset] & 0x7f) << 24) |
    ((sig[offset + 1] & 0xff) << 16) |
    ((sig[offset + 2] & 0xff) << 8) |
    (sig[offset + 3] & 0xff);
  const code = String(binary % (10 ** digits)).padStart(digits, '0');
  const remainingSeconds = period - (((epochSec % period) + period) % period);

  return { code, remainingSeconds, period, digits, counter };
}

async function importRawAesKey(rawBytes) {
  return crypto.subtle.importKey('raw', rawBytes, { name: 'AES-GCM' }, true, ['encrypt', 'decrypt']);
}

async function derivePinAesKey(passphrase, saltBytes) {
  const baseKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(String(passphrase ?? '')),
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: saltBytes, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt']
  );
}

async function encryptEntries(entries, aesKey) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plain = new TextEncoder().encode(JSON.stringify(entries));
  const cipherBuf = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aesKey, plain);
  return { iv: toBase64(iv), ciphertext: toBase64(cipherBuf) };
}

async function decryptEntries(vault, aesKey) {
  const plainBuf = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64(vault.iv) },
    aesKey,
    fromBase64(vault.ciphertext)
  );
  const parsed = JSON.parse(new TextDecoder().decode(plainBuf));
  return Array.isArray(parsed) ? parsed : [];
}

function tokenizeHintLabel(raw) {
  const text = String(raw ?? '').trim();
  if (!text) return [];
  const expanded = text
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[._-]+/g, ' ');
  const lower = text.toLowerCase();
  const compact = lower.replace(/[\s_-]+/g, '');
  const words = `${lower} ${expanded.toLowerCase()}`
    .split(/[^a-z0-9а-яё]+/i)
    .filter(w => w.length >= 3 && !BRAND_NOISE.has(w));
  const out = new Set([lower, ...words]);
  if (compact.length >= 3 && compact.length <= 30 && !compact.includes('@')) out.add(compact);
  for (const w of words) {
    const noDigits = w.replace(/\d+$/, '');
    if (noDigits.length >= 4) out.add(noDigits);
  }
  return [...out].filter(w => w.length >= 3 && w.length <= 40 && !w.includes('@'));
}

function buildHint(entry) {
  const normIssuer = String(entry.issuer ?? '').trim().toLowerCase();
  const normDomain = String(entry.domain ?? '').trim().toLowerCase();
  const accountEmail = extractAccountEmail(entry.account, entry.issuer);
  const accountBrand = extractBrandFromAccountLabel(entry.account);
  const accountRemainder = [stripEmailsFromText(entry.account), accountBrand].filter(Boolean).join(' ');
  const issuerWords = tokenizeHintLabel(entry.issuer);
  const accountWords = tokenizeHintLabel(accountRemainder);
  const allLabelWords = [...new Set([...issuerWords, ...accountWords])];
  const effectiveDomain = normDomain || inferDomainFromIssuer(entry.issuer, '') || inferDomainFromIssuer(accountRemainder, '');

  const matchingEcos = ECOSYSTEMS.filter(eco =>
    eco.siteDomains.some(d =>
      effectiveDomain === d ||
      effectiveDomain.endsWith(`.${d}`) ||
      (d.split('.')[0].length >= 4 && allLabelWords.some(w => w === d.split('.')[0] || w.includes(d.split('.')[0])))
    ) ||
    eco.aliases.some(a =>
      normIssuer === a ||
      allLabelWords.includes(a) ||
      (a.length >= 4 && (normIssuer.includes(a) || allLabelWords.some(w => w.includes(a))))
    )
  );
  const matchDomains = [...new Set([effectiveDomain, ...matchingEcos.flatMap(e => e.siteDomains)].filter(Boolean))];
  if ((normIssuer.includes('google') || accountWords.includes('google')) && !matchDomains.includes('google.com')) {
    matchDomains.push('google.com');
  }
  const matchNames = [...new Set([
    ...allLabelWords,
    ...matchingEcos.flatMap(e => e.aliases),
    ...(effectiveDomain ? [rootDomainOf(effectiveDomain).split('.')[0]] : [])
  ].filter(w => w.length >= 3 && w.length <= 40))];
  const unattributed = matchDomains.length === 0 && (!normIssuer || /^(?:account|website|totp|2fa)$/i.test(normIssuer) || normIssuer === accountEmail);
  return {
    id: entry.id,
    issuer: entry.issuer,
    account: entry.account ?? '',
    accountEmail,
    domain: effectiveDomain,
    digits: entry.digits ?? 6,
    period: entry.period ?? 30,
    matchDomains,
    matchNames,
    unattributed
  };
}

async function readVaultAndKey() {
  const { totpVault = null, totpSiteHints = [] } = await chrome.storage.local.get(['totpVault', 'totpSiteHints']);
  if (!totpVault) return { vault: null, hints: Array.isArray(totpSiteHints) ? totpSiteHints : [], key: null, entries: [] };
  if (totpVault.mode === 'pin') {
    const session = (await chrome.storage.session?.get?.('totpSessionKey')) ?? {};
    if (!session.totpSessionKey) {
      throw new Error('TOTP_LOCKED');
    }
    const key = await importRawAesKey(fromBase64(session.totpSessionKey));
    const entries = await decryptEntries(totpVault, key);
    return { vault: totpVault, hints: Array.isArray(totpSiteHints) ? totpSiteHints : [], key, entries };
  }
  const key = await importRawAesKey(fromBase64(totpVault.localKey));
  const entries = await decryptEntries(totpVault, key);
  return { vault: totpVault, hints: Array.isArray(totpSiteHints) ? totpSiteHints : [], key, entries };
}

async function saveVaultEntries(entries, existingVault) {
  let nextVault;
  if (existingVault?.mode === 'pin') {
    const session = (await chrome.storage.session?.get?.('totpSessionKey')) ?? {};
    if (!session.totpSessionKey) throw new Error('TOTP_LOCKED');
    const key = await importRawAesKey(fromBase64(session.totpSessionKey));
    const encrypted = await encryptEntries(entries, key);
    nextVault = { v: 1, mode: 'pin', salt: existingVault.salt, ...encrypted };
  } else {
    const rawKey = existingVault?.localKey ? fromBase64(existingVault.localKey) : crypto.getRandomValues(new Uint8Array(32));
    const key = await importRawAesKey(rawKey);
    const encrypted = await encryptEntries(entries, key);
    nextVault = { v: 1, mode: 'local', localKey: toBase64(rawKey), ...encrypted };
  }
  const hints = entries.map(buildHint);
  await chrome.storage.local.set({
    totpVault: nextVault,
    totpSiteHints: hints,
    totpEnabled: hints.length > 0
  });
  return hints;
}

export async function getTotpVaultStatus() {
  const { totpVault = null, totpSiteHints = [] } = await chrome.storage.local.get(['totpVault', 'totpSiteHints']);
  const hints = Array.isArray(totpSiteHints) ? totpSiteHints : [];
  const pinProtected = totpVault?.mode === 'pin';
  let unlocked = !pinProtected;
  if (pinProtected) {
    const session = (await chrome.storage.session?.get?.('totpSessionKey')) ?? {};
    unlocked = Boolean(session.totpSessionKey);
  }
  return {
    hasAccounts: hints.length > 0,
    count: hints.length,
    pinProtected,
    unlocked,
    accounts: hints
  };
}

export async function unlockTotpVault(passphrase) {
  const { totpVault = null } = await chrome.storage.local.get('totpVault');
  if (!totpVault || totpVault.mode !== 'pin') return { ok: true };
  let key;
  try {
    key = await derivePinAesKey(passphrase, fromBase64(totpVault.salt));
    await decryptEntries(totpVault, key);
  } catch {
    throw new Error('TOTP_WRONG_PIN');
  }
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', key));
  await chrome.storage.session?.set?.({ totpSessionKey: toBase64(raw) });
  return { ok: true };
}

export async function lockTotpVault() {
  await chrome.storage.session?.set?.({ totpSessionKey: null });
  return { ok: true };
}

export async function setTotpPassphrase(newPassphrase, currentPassphrase = '') {
  const { totpVault = null } = await chrome.storage.local.get('totpVault');
  let entries = [];
  if (totpVault) {
    if (totpVault.mode === 'pin') {
      const session = (await chrome.storage.session?.get?.('totpSessionKey')) ?? {};
      let key;
      if (session.totpSessionKey) {
        key = await importRawAesKey(fromBase64(session.totpSessionKey));
      } else if (currentPassphrase) {
        key = await derivePinAesKey(currentPassphrase, fromBase64(totpVault.salt));
      } else {
        throw new Error('TOTP_LOCKED');
      }
      try {
        entries = await decryptEntries(totpVault, key);
      } catch {
        throw new Error('TOTP_WRONG_PIN');
      }
    } else {
      const key = await importRawAesKey(fromBase64(totpVault.localKey));
      entries = await decryptEntries(totpVault, key);
    }
  }

  const nextPin = String(newPassphrase ?? '');
  const hints = entries.map(buildHint);
  if (nextPin) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const pinKey = await derivePinAesKey(nextPin, salt);
    const encrypted = await encryptEntries(entries, pinKey);
    const raw = new Uint8Array(await crypto.subtle.exportKey('raw', pinKey));
    await chrome.storage.session?.set?.({ totpSessionKey: toBase64(raw) });
    await chrome.storage.local.set({
      totpVault: { v: 1, mode: 'pin', salt: toBase64(salt), ...encrypted },
      totpSiteHints: hints,
      totpEnabled: hints.length > 0
    });
  } else {
    const rawKey = crypto.getRandomValues(new Uint8Array(32));
    const localKey = await importRawAesKey(rawKey);
    const encrypted = await encryptEntries(entries, localKey);
    await chrome.storage.session?.set?.({ totpSessionKey: null });
    await chrome.storage.local.set({
      totpVault: { v: 1, mode: 'local', localKey: toBase64(rawKey), ...encrypted },
      totpSiteHints: hints,
      totpEnabled: hints.length > 0
    });
  }
  return { ok: true, pinProtected: Boolean(nextPin) };
}

export async function addTotpAccount(rawInput, fallback = {}, now = Date.now()) {
  const parsed = parseTotpInput(rawInput, fallback);
  const { vault, entries } = await readVaultAndKey();
  const existingIdx = entries.findIndex(item => item.secret === parsed.secret);
  const id = existingIdx >= 0 ? entries[existingIdx].id : crypto.randomUUID();
  const nextEntry = { id, ...parsed, createdAt: now };
  const nextEntries = existingIdx >= 0
    ? entries.map((item, idx) => idx === existingIdx ? nextEntry : item)
    : [...entries, nextEntry];

  const hints = await saveVaultEntries(nextEntries, vault);
  const hint = hints.find(item => item.id === id);
  const generated = await generateTotpCode(nextEntry, now);
  return { account: hint, ...generated };
}

export async function removeTotpAccount(id) {
  const { vault, entries } = await readVaultAndKey();
  const nextEntries = entries.filter(item => item.id !== id);
  await saveVaultEntries(nextEntries, vault);
  return { ok: true, count: nextEntries.length };
}

export async function updateTotpAccount(id, patch = {}) {
  const { vault, entries } = await readVaultAndKey();
  const idx = entries.findIndex(item => item.id === id);
  if (idx < 0) throw new Error('TOTP_NOT_FOUND');
  const prev = entries[idx];
  const nextIssuer = patch.issuer !== undefined ? String(patch.issuer).trim().slice(0, 60) || prev.issuer : prev.issuer;
  const nextAccount = patch.account !== undefined ? String(patch.account).trim().slice(0, 80) : prev.account;
  const nextDomain = patch.domain !== undefined
    ? (String(patch.domain).trim() ? rootDomainOf(patch.domain) : '')
    : (patch.issuer !== undefined ? inferDomainFromIssuer(nextIssuer, prev.domain) : prev.domain);
  const updated = { ...prev, issuer: nextIssuer, account: nextAccount, domain: nextDomain };
  const nextEntries = entries.map((item, i) => i === idx ? updated : item);
  const hints = await saveVaultEntries(nextEntries, vault);
  return { ok: true, account: hints.find(h => h.id === id) };
}

export async function refreshTotpSiteHints() {
  const { totpVault = null, totpSiteHints = [] } = await chrome.storage.local.get(['totpVault', 'totpSiteHints']);
  if (!totpVault) return { ok: true, updated: false, count: 0 };
  let vault, entries;
  try {
    const state = await readVaultAndKey();
    vault = state.vault;
    entries = state.entries;
  } catch {
    return { ok: false, locked: true, updated: false, count: Array.isArray(totpSiteHints) ? totpSiteHints.length : 0 };
  }
  let entriesChanged = false;
  const nextEntries = entries.map(entry => {
    let nextIssuer = entry.issuer;
    if (!nextIssuer || /^(?:account|website)$/i.test(nextIssuer.trim())) {
      const recovered = extractBrandFromAccountLabel(entry.account);
      if (recovered) nextIssuer = recovered;
    }
    const nextDomain = entry.domain || inferDomainFromIssuer(nextIssuer, '') || inferDomainFromIssuer(stripEmailsFromText(entry.account), '');
    if (nextIssuer !== entry.issuer || nextDomain !== entry.domain) {
      entriesChanged = true;
      return { ...entry, issuer: nextIssuer, domain: nextDomain };
    }
    return entry;
  });
  if (entriesChanged) {
    const hints = await saveVaultEntries(nextEntries, vault);
    return { ok: true, updated: true, count: hints.length };
  }
  const nextHints = nextEntries.map(buildHint);
  if (JSON.stringify(nextHints) !== JSON.stringify(totpSiteHints)) {
    await chrome.storage.local.set({ totpSiteHints: nextHints, totpEnabled: nextHints.length > 0 });
    return { ok: true, updated: true, count: nextHints.length };
  }
  return { ok: true, updated: false, count: nextHints.length };
}

export function matchAllTotpHintsForSite(hints, origin, siteContext = {}) {
  if (!Array.isArray(hints) || !hints.length || !origin?.startsWith('https://')) return [];
  const extraDomains = hints.flatMap(h => [h.domain, ...(h.matchDomains ?? [])]).filter(Boolean);
  if (checkPhishingRisk(origin, extraDomains, siteContext.phishingTrustedOrigins ?? []).suspicious) return [];
  const identity = siteIdentity(origin, siteContext);
  if (!identity.hostname) return [];
  const hostCore = rootDomainOf(identity.hostname).split('.')[0];
  const signalEmails = new Set(
    [siteContext.lastTypedEmail, siteContext.matchedEmailAccount, ...(Array.isArray(siteContext.pageEmails) ? siteContext.pageEmails : [])]
      .map(e => extractAccountEmail(e))
      .filter(Boolean)
  );

  const matches = [];
  for (const hint of hints) {
    let siteScore = 0;
    const hintDom = String(hint.domain ?? '').toLowerCase();
    if (hintDom && (identity.hostname === hintDom || identity.hostname.endsWith(`.${hintDom}`) || (identity.siteDomain && identity.siteDomain === rootDomainOf(hintDom)))) {
      siteScore += 10;
    }
    if (Array.isArray(hint.matchDomains) && hint.matchDomains.some(d => identity.hostname === d || identity.hostname.endsWith(`.${d}`) || (identity.siteDomain && identity.siteDomain === d))) {
      siteScore += 8;
    }
    const hintIssuer = String(hint.issuer ?? '').toLowerCase();
    const names = Array.isArray(hint.matchNames) ? hint.matchNames : [];
    if ((hintIssuer && (hintIssuer === identity.hostName || identity.names.includes(hintIssuer))) ||
        names.some(n => n.length >= 3 && (n === identity.hostName || identity.names.includes(n) || (hostCore.length >= 5 && (n.startsWith(hostCore) || (n.length >= 5 && hostCore.startsWith(n))))))) {
      siteScore += 6;
    }
    if (siteScore === 0 && hint.unattributed && hint.accountEmail && signalEmails.has(String(hint.accountEmail).toLowerCase())) {
      siteScore = 6;
    }
    if (siteScore >= 6) matches.push({ hint, siteScore });
  }
  matches.sort((a, b) => b.siteScore - a.siteScore);
  return matches;
}

export function matchTotpHintForSite(hints, origin, siteContext = {}) {
  return matchAllTotpHintsForSite(hints, origin, siteContext)[0]?.hint ?? null;
}

function scoreCandidateAccountMatch(entry, hint, siteContext = {}) {
  const acctEmail = hint?.accountEmail || extractAccountEmail(entry.account, entry.issuer);
  const matchedMailbox = extractAccountEmail(siteContext.matchedEmailAccount);
  const typedEmail = extractAccountEmail(siteContext.lastTypedEmail);
  const pageEmailSet = new Set((Array.isArray(siteContext.pageEmails) ? siteContext.pageEmails : []).map(e => extractAccountEmail(e)).filter(Boolean));

  let accountMatchScore = 0;
  if (siteContext.preferredTotpId && entry.id === siteContext.preferredTotpId) accountMatchScore += 40;
  if (acctEmail && matchedMailbox && acctEmail === matchedMailbox) accountMatchScore += 25;
  if (acctEmail && typedEmail && acctEmail === typedEmail) accountMatchScore += 20;
  if (acctEmail && !matchedMailbox && !typedEmail && pageEmailSet.has(acctEmail)) accountMatchScore += 15;
  if (acctEmail && !matchedMailbox && !typedEmail && siteContext.maskedEmail && matchesMaskedEmail(acctEmail, siteContext.maskedEmail)) {
    accountMatchScore += 10;
  }
  if (!acctEmail && siteContext.lastTypedIdentifier) {
    const needle = String(siteContext.lastTypedIdentifier).trim().toLowerCase();
    if (needle.length >= 3 && String(entry.account ?? '').toLowerCase().includes(needle)) {
      accountMatchScore += 8;
    }
  }
  return accountMatchScore;
}

export async function getTotpCandidatesForSite(origin, siteContext = {}, now = Date.now()) {
  const { totpVault = null, totpSiteHints = [], phishingTrustedOrigins = [] } = await chrome.storage.local.get(['totpVault', 'totpSiteHints', 'phishingTrustedOrigins']);
  const hints = Array.isArray(totpSiteHints) ? totpSiteHints : [];
  const mergedCtx = {
    ...siteContext,
    phishingTrustedOrigins: Array.isArray(siteContext.phishingTrustedOrigins) ? siteContext.phishingTrustedOrigins : phishingTrustedOrigins
  };
  const matched = matchAllTotpHintsForSite(hints, origin, mergedCtx);
  if (!matched.length || !totpVault) return { status: 'none', candidates: [] };

  let entries;
  try {
    const state = await readVaultAndKey();
    entries = state.entries;
  } catch (error) {
    if (error.message === 'TOTP_LOCKED') {
      return { status: 'locked', account: matched[0].hint, count: matched.length, candidates: [] };
    }
    return { status: 'none', candidates: [] };
  }

  const candidates = [];
  for (const { hint, siteScore } of matched) {
    const entry = entries.find(item => item.id === hint.id);
    if (!entry) continue;
    const generated = await generateTotpCode(entry, now);
    const accountEmail = hint.accountEmail || extractAccountEmail(entry.account, entry.issuer);
    const accountMatchScore = scoreCandidateAccountMatch(entry, { ...hint, accountEmail }, siteContext);
    candidates.push({
      id: entry.id,
      issuer: entry.issuer,
      account: entry.account ?? '',
      accountEmail,
      domain: entry.domain ?? '',
      siteScore,
      accountMatchScore,
      ...generated
    });
  }

  if (!candidates.length) return { status: 'none', candidates: [] };
  candidates.sort((a, b) => (b.accountMatchScore - a.accountMatchScore) || (b.siteScore - a.siteScore));

  if (candidates.length === 1) {
    return { status: 'found', ...candidates[0], candidates };
  }
  if (candidates[0].accountMatchScore > 0 && (candidates[0].accountMatchScore - candidates[1].accountMatchScore >= 5)) {
    return { status: 'found', resolvedByAccount: true, ...candidates[0], candidates };
  }
  return {
    status: 'choose',
    count: candidates.length,
    candidates,
    remainingSeconds: candidates[0].remainingSeconds,
    period: candidates[0].period,
    counter: candidates[0].counter
  };
}

export async function getTotpForSite(origin, siteContext = {}, now = Date.now()) {
  return getTotpCandidatesForSite(origin, siteContext, now);
}

export async function listAllTotpCodes(origin = '', siteContext = {}, now = Date.now()) {
  const { totpVault = null, totpSiteHints = [], phishingTrustedOrigins = [] } = await chrome.storage.local.get(['totpVault', 'totpSiteHints', 'phishingTrustedOrigins']);
  const hints = Array.isArray(totpSiteHints) ? totpSiteHints : [];
  const pinProtected = totpVault?.mode === 'pin';
  let entries;
  try {
    const state = await readVaultAndKey();
    entries = state.entries;
  } catch (error) {
    if (error.message === 'TOTP_LOCKED') {
      return { status: 'locked', pinProtected: true, count: hints.length, items: [] };
    }
    return { status: 'ok', pinProtected: false, count: 0, items: [] };
  }

  const mergedCtx = {
    ...siteContext,
    phishingTrustedOrigins: Array.isArray(siteContext.phishingTrustedOrigins) ? siteContext.phishingTrustedOrigins : phishingTrustedOrigins
  };
  const matchedMap = new Map(matchAllTotpHintsForSite(hints, origin, mergedCtx).map(m => [m.hint.id, m.siteScore]));
  const items = [];
  for (const entry of entries) {
    const hint = hints.find(h => h.id === entry.id);
    const siteScore = matchedMap.get(entry.id) ?? 0;
    const isCurrentSite = siteScore >= 6;
    const accountEmail = hint?.accountEmail || extractAccountEmail(entry.account, entry.issuer);
    const accountMatchScore = isCurrentSite ? scoreCandidateAccountMatch(entry, { accountEmail }, siteContext) : 0;
    const generated = await generateTotpCode(entry, now);
    items.push({
      id: entry.id,
      issuer: entry.issuer,
      account: entry.account ?? '',
      accountEmail,
      domain: entry.domain ?? '',
      isCurrentSite,
      siteScore,
      accountMatchScore,
      ...generated
    });
  }

  items.sort((a, b) =>
    Number(b.isCurrentSite) - Number(a.isCurrentSite) ||
    (b.accountMatchScore - a.accountMatchScore) ||
    (b.siteScore - a.siteScore) ||
    String(a.issuer).localeCompare(String(b.issuer))
  );

  return { status: 'ok', pinProtected, unlocked: true, count: items.length, items };
}

function parseImportItems(rawText, fallback = {}) {
  const raw = String(rawText ?? '').trim();
  if (!raw) throw new Error('TOTP_INVALID_SECRET');

  const parsedItems = [];
  let hadEncrypted = false;
  const pushParsed = (input, meta = {}) => {
    try {
      parsedItems.push(parseTotpInput(input, { ...fallback, ...meta }));
    } catch { /* Skip non-TOTP/invalid entry cleanly. */ }
  };

  if (/^[\[{]/.test(raw)) {
    let data;
    try { data = JSON.parse(raw); } catch { data = null; }
    if (data && typeof data === 'object') {
      if (Array.isArray(data.items)) {
        // Bitwarden export
        for (const item of data.items) {
          const totp = item?.login?.totp;
          if (!totp) continue;
          let domainHint = '';
          const firstUri = item.login?.uris?.[0]?.uri;
          if (firstUri) {
            try { domainHint = rootDomainOf(new URL(firstUri).hostname); } catch { /* ignore */ }
          }
          pushParsed(totp, {
            issuer: item.name || domainHint,
            account: item.login?.username || '',
            domain: domainHint
          });
        }
      } else if (Array.isArray(data.services)) {
        // 2FAS export
        for (const svc of data.services) {
          if (!svc?.secret || String(svc.otp?.tokenType ?? 'TOTP').toUpperCase() === 'HOTP') continue;
          pushParsed(svc.secret, {
            issuer: svc.name || svc.otp?.issuer || 'Account',
            account: svc.otp?.account || svc.otp?.label || '',
            algorithm: svc.otp?.algorithm,
            digits: svc.otp?.digits,
            period: svc.otp?.period
          });
        }
      } else if (Array.isArray(data.db?.entries)) {
        // Aegis export
        for (const entry of data.db.entries) {
          if (entry?.type && String(entry.type).toLowerCase() !== 'totp') continue;
          if (!entry?.info?.secret) continue;
          pushParsed(entry.info.secret, {
            issuer: entry.issuer || entry.name || 'Account',
            account: entry.name && entry.name !== entry.issuer ? entry.name : '',
            algorithm: entry.info?.algo,
            digits: entry.info?.digits,
            period: entry.info?.period
          });
        }
      } else if (Array.isArray(data.entries) || Array.isArray(data)) {
        // CodeSnap JSON or generic array
        const list = Array.isArray(data.entries) ? data.entries : data;
        for (const entry of list) {
          if (!entry || typeof entry !== 'object') continue;
          const secretInput = entry.uri || entry.totp || entry.secret;
          if (!secretInput) continue;
          pushParsed(secretInput, {
            issuer: entry.issuer || entry.name,
            account: entry.account || entry.label || '',
            domain: entry.domain || '',
            explicitDomain: entry.domain || '',
            algorithm: entry.algorithm,
            digits: entry.digits,
            period: entry.period
          });
        }
      } else {
        // Authenticator.cc (Authenticator Chrome extension) map export
        for (const val of Object.values(data)) {
          if (!val || typeof val !== 'object') continue;
          if (val.encrypted) { hadEncrypted = true; continue; }
          if (!val.secret || (val.type && !/totp/i.test(String(val.type)))) continue;
          pushParsed(val.secret, {
            issuer: val.issuer || val.account || 'Account',
            account: val.account || '',
            algorithm: val.algorithm,
            digits: val.digits,
            period: val.period
          });
        }
      }
      if (!parsedItems.length) {
        throw new Error(hadEncrypted ? 'TOTP_IMPORT_ENCRYPTED_JSON' : 'TOTP_IMPORT_EMPTY');
      }
      return parsedItems;
    }
  }

  for (const rawLine of raw.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    if (/^otpauth:\/\/totp/i.test(line)) {
      pushParsed(line);
      continue;
    }
    if (/^otpauth-migration:\/\//i.test(line)) {
      try {
        parsedItems.push(...parseOtpAuthMigrationUri(line, fallback));
      } catch { /* Ignore invalid migration URI line. */ }
      continue;
    }
    if (/[,;\t]/.test(line)) {
      const cells = line.split(/[,;\t]/).map(s => s.trim().replace(/^["']|["']$/g, ''));
      let secretCol = -1;
      for (let i = 0; i < cells.length; i++) {
        try {
          const clean = normalizeBase32(cells[i]);
          if (clean.length >= 16) { secretCol = i; break; }
        } catch { /* not secret col */ }
      }
      if (secretCol >= 0) {
        const others = cells.filter((cell, idx) => idx !== secretCol && cell);
        pushParsed(cells[secretCol], {
          issuer: others[0] || fallback.issuer || 'Account',
          account: others[1] || ''
        });
      }
      continue;
    }
    if (/^[A-Z2-7\s\-=]{16,128}$/i.test(line)) {
      pushParsed(line);
    }
  }

  if (!parsedItems.length) throw new Error('TOTP_IMPORT_EMPTY');
  return parsedItems;
}

export async function importTotpPayload(rawText, fallback = {}, now = Date.now()) {
  const incoming = parseImportItems(rawText, fallback);
  const { vault, entries } = await readVaultAndKey();
  const nextEntries = [...entries];
  let imported = 0;
  let updated = 0;

  for (const item of incoming) {
    const existingIdx = nextEntries.findIndex(e =>
      e.secret === item.secret && String(e.account ?? '').toLowerCase() === String(item.account ?? '').toLowerCase()
    );
    if (existingIdx >= 0) {
      nextEntries[existingIdx] = { ...nextEntries[existingIdx], ...item };
      updated++;
    } else {
      nextEntries.push({ id: crypto.randomUUID(), ...item, createdAt: now });
      imported++;
    }
  }

  await saveVaultEntries(nextEntries, vault);
  return { ok: true, imported, updated, total: nextEntries.length };
}

export async function exportTotpVault(format = 'txt') {
  const { entries } = await readVaultAndKey();
  if (format === 'json') {
    return JSON.stringify({
      format: 'codesnap-totp',
      version: 1,
      exportedAt: new Date().toISOString(),
      entries: entries.map(({ issuer, account, domain, secret, algorithm, digits, period }) => ({
        issuer, account, domain, secret, algorithm, digits, period
      }))
    }, null, 2);
  }
  return entries.map(e => {
    const label = e.account ? `${e.issuer}:${e.account}` : e.issuer;
    const params = new URLSearchParams({
      secret: e.secret,
      issuer: e.issuer,
      algorithm: e.algorithm || 'SHA1',
      digits: String(e.digits || 6),
      period: String(e.period || 30)
    });
    return `otpauth://totp/${encodeURIComponent(label)}?${params.toString()}`;
  }).join('\n');
}

export async function getTotpById(id, now = Date.now()) {
  const { entries } = await readVaultAndKey();
  const entry = entries.find(item => item.id === id);
  if (!entry) throw new Error('TOTP_NOT_FOUND');
  const generated = await generateTotpCode(entry, now);
  return {
    status: 'found',
    id: entry.id,
    issuer: entry.issuer,
    account: entry.account ?? '',
    domain: entry.domain ?? '',
    ...generated
  };
}

export function describeTotpError(error) {
  const map = {
    TOTP_INVALID_SECRET: 'Неверный секретный ключ Base32 или ссылка otpauth://.',
    TOTP_UNSUPPORTED_URI: 'Поддерживаются только TOTP-ключи (otpauth://totp/...).',
    TOTP_LOCKED: 'Хранилище 2FA заблокировано PIN-кодом.',
    TOTP_WRONG_PIN: 'Неверный PIN-код для разблокировки 2FA.',
    TOTP_NOT_FOUND: 'Запись 2FA не найдена.',
    TOTP_IMPORT_EMPTY: 'Не найдено ни одной 2FA-записи для импорта.',
    TOTP_IMPORT_ENCRYPTED_JSON: 'Этот JSON-файл зашифрован паролем Authenticator. Экспортируйте незашифрованную копию (.txt с otpauth:// или обычный JSON) и импортируйте её.'
  };
  return map[error?.message] ?? 'Не удалось обработать 2FA-ключ локально.';
}
