// 100% offline cryptographic license verification using Web Crypto Ed25519.
// Only the public key lives inside the extension; keys can only be signed by the owner's private key.

export const CODESNAP_PRO_PUBLIC_KEY_B64U = 'ZJ-gUCOHapw9O8nGW47vpGkl3cdiZ2zUFqgmpak3-Xc';
export const FREE_TOTP_LIMIT = 5;

const cachedKeys = new Map();

export function toBase64Url(bytes) {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let bin = '';
  for (let i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export function fromBase64Url(str) {
  const raw = String(str ?? '').trim();
  if (!/^[A-Za-z0-9_-]+$/.test(raw)) throw new Error('BAD_BASE64URL');
  const b64 = raw.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function importPublicVerifyKey(publicKeyB64u) {
  if (cachedKeys.has(publicKeyB64u)) return cachedKeys.get(publicKeyB64u);
  const raw = fromBase64Url(publicKeyB64u);
  if (raw.length !== 32) throw new Error('INVALID_PUBLIC_KEY');
  const key = await crypto.subtle.importKey('raw', raw, { name: 'Ed25519' }, false, ['verify']);
  cachedKeys.set(publicKeyB64u, key);
  return key;
}

export async function verifyProLicenseKey(rawKey, {
  now = Date.now(),
  publicKeyB64u = CODESNAP_PRO_PUBLIC_KEY_B64U
} = {}) {
  const clean = String(rawKey ?? '').trim();
  const match = /^CS1-([A-Za-z0-9_-]{8,512})\.([A-Za-z0-9_-]{80,92})$/.exec(clean);
  if (!match) {
    return {
      valid: false,
      reason: 'FORMAT',
      message: 'Ключ должен начинаться с CS1- и быть скопирован целиком.'
    };
  }

  const [, payloadB64u, sigB64u] = match;
  let sigBytes;
  let payload;
  try {
    sigBytes = fromBase64Url(sigB64u);
    if (sigBytes.length !== 64) {
      return { valid: false, reason: 'FORMAT', message: 'Некорректная длина подписи ключа.' };
    }
    const cryptoKey = await importPublicVerifyKey(publicKeyB64u);
    const dataBytes = new TextEncoder().encode(payloadB64u);
    const verified = await crypto.subtle.verify({ name: 'Ed25519' }, cryptoKey, sigBytes, dataBytes);
    if (!verified) {
      return {
        valid: false,
        reason: 'SIGNATURE',
        message: 'Недействительный ключ CodeSnap Pro (подпись не совпадает).'
      };
    }
    const jsonBytes = fromBase64Url(payloadB64u);
    payload = JSON.parse(new TextDecoder().decode(jsonBytes));
  } catch {
    return {
      valid: false,
      reason: 'SIGNATURE',
      message: 'Не удалось проверить криптографическую подпись ключа.'
    };
  }

  if (!payload || payload.v !== 1 || payload.plan !== 'pro') {
    return {
      valid: false,
      reason: 'PAYLOAD',
      message: 'Неподдерживаемый формат лицензии CodeSnap.'
    };
  }

  const expSec = payload.exp !== null && payload.exp !== undefined ? Number(payload.exp) : null;
  if (expSec && Number.isFinite(expSec) && expSec > 0 && Math.floor(now / 1000) > expSec) {
    return {
      valid: false,
      reason: 'EXPIRED',
      keyId: payload.id ?? null,
      expiresAt: expSec * 1000,
      message: 'Срок действия этого ключа CodeSnap Pro истёк.'
    };
  }

  return {
    valid: true,
    plan: 'pro',
    keyId: String(payload.id ?? 'PRO'),
    tag: payload.tag ? String(payload.tag) : null,
    lifetime: !expSec,
    issuedAt: payload.iat ? Number(payload.iat) * 1000 : null,
    expiresAt: expSec ? expSec * 1000 : null,
    key: clean
  };
}

export async function getProStatus({ now = Date.now(), publicKeyB64u = CODESNAP_PRO_PUBLIC_KEY_B64U } = {}) {
  const data = (await chrome?.storage?.local?.get?.('proLicenseKey')) ?? {};
  const proLicenseKey = data.proLicenseKey;
  if (!proLicenseKey) {
    return { isPro: false, status: 'free', freeTotpLimit: FREE_TOTP_LIMIT };
  }
  const verified = await verifyProLicenseKey(proLicenseKey, { now, publicKeyB64u });
  if (!verified.valid) {
    return {
      isPro: false,
      status: verified.reason === 'EXPIRED' ? 'expired' : 'invalid',
      reason: verified.reason,
      message: verified.message,
      freeTotpLimit: FREE_TOTP_LIMIT
    };
  }
  return {
    isPro: true,
    status: 'pro',
    keyId: verified.keyId,
    tag: verified.tag,
    lifetime: verified.lifetime,
    issuedAt: verified.issuedAt,
    expiresAt: verified.expiresAt,
    freeTotpLimit: FREE_TOTP_LIMIT
  };
}

export async function activateProLicense(rawKey, options = {}) {
  const verified = await verifyProLicenseKey(rawKey, options);
  if (!verified.valid) {
    return { ok: false, isPro: false, freeTotpLimit: FREE_TOTP_LIMIT, ...verified };
  }
  await chrome?.storage?.local?.set?.({
    proLicenseKey: verified.key,
    proActivatedAt: Date.now()
  });
  return {
    ok: true,
    isPro: true,
    status: 'pro',
    freeTotpLimit: FREE_TOTP_LIMIT,
    ...verified
  };
}

export async function deactivateProLicense() {
  await chrome?.storage?.local?.set?.({ proLicenseKey: null, proActivatedAt: null });
  return { ok: true, isPro: false, status: 'free', freeTotpLimit: FREE_TOTP_LIMIT };
}
