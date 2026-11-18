import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { toBase64Url, fromBase64Url, verifyProLicenseKey } from '../src/license.js';

export async function signProLicenseKey(payload, privateKeyPkcs8B64u) {
  const pkcs8 = fromBase64Url(privateKeyPkcs8B64u);
  const privateKey = await crypto.subtle.importKey('pkcs8', pkcs8, { name: 'Ed25519' }, false, ['sign']);
  const cleanPayload = {
    v: 1,
    plan: 'pro',
    id: String(payload.id || 'PRO-1'),
    iat: Number(payload.iat ?? Math.floor(Date.now() / 1000)),
    ...(payload.exp ? { exp: Number(payload.exp) } : {}),
    ...(payload.tag ? { tag: String(payload.tag) } : {})
  };
  const payloadB64u = toBase64Url(new TextEncoder().encode(JSON.stringify(cleanPayload)));
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'Ed25519' }, privateKey, new TextEncoder().encode(payloadB64u)));
  return `CS1-${payloadB64u}.${toBase64Url(sig)}`;
}

function parseArgs(argv) {
  const opts = { count: 1, days: 0, prefix: 'VIP', tag: 'codesnap-pro', out: null, keyFile: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--count') opts.count = Math.max(1, Number(argv[++i]) || 1);
    else if (a === '--days') opts.days = Math.max(0, Number(argv[++i]) || 0);
    else if (a === '--prefix') opts.prefix = String(argv[++i] || 'VIP').trim();
    else if (a === '--tag') opts.tag = String(argv[++i] || 'codesnap-pro').trim();
    else if (a === '--out') opts.out = String(argv[++i] || '');
    else if (a === '--key-file') opts.keyFile = String(argv[++i] || '');
  }
  return opts;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const opts = parseArgs(process.argv.slice(2));
  const keyFilePath = opts.keyFile
    ? resolve(opts.keyFile)
    : resolve('..', 'CodeSnap-Owner-Keys-DO-NOT-SHARE.json');
  const privKey = process.env.CODESNAP_PRIVATE_KEY ||
    JSON.parse(readFileSync(keyFilePath, 'utf8')).privateKeyPkcs8B64u;
  const nowSec = Math.floor(Date.now() / 1000);
  const expSec = opts.days > 0 ? nowSec + opts.days * 86_400 : null;

  const lines = [];
  for (let i = 1; i <= opts.count; i++) {
    const id = `${opts.prefix}-${String(i).padStart(2, '0')}`;
    const key = await signProLicenseKey({ id, iat: nowSec, exp: expSec, tag: opts.tag }, privKey);
    const check = await verifyProLicenseKey(key);
    if (!check.valid) throw new Error(`Self-verification failed for ${id}: ${check.reason}`);
    lines.push(`${id}: ${key}`);
  }

  if (opts.out) {
    const outAbs = resolve(opts.out);
    writeFileSync(outAbs, lines.join('\n') + '\n', 'utf8');
    console.log(`Generated & verified ${lines.length} key(s) -> ${outAbs}`);
  } else {
    console.log(lines.join('\n'));
  }
}
