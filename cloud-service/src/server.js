import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { Vault, ownerId } from './vault.js';
import { configuration, withMailbox, readRecent } from './mail.js';
import { YandexAuth } from './yandex.js';

export const API_PREFIX = '/api/mail';
const visible = ({ id, provider, email }) => ({ id, provider, email });
export function createService({ vault, origins, oauth = new YandexAuth('',[]), check = account => withMailbox(account, async () => true), search = readRecent }) {
  const limits = new Map(), active = new Set(), cache = new Map();
  let running = 0;
  const cleanup = setInterval(() => { for (const [key,value] of cache) if (Date.now()-value.at>3000) cache.delete(key); },3000); cleanup.unref();
  function limited(key, max, window = 60000) {
    const now = Date.now();
    if (limits.size > 10000) for (const [id, value] of limits) if (value.until < now) limits.delete(id);
    if (limits.size > 10000 && !limits.has(key)) return true;
    let entry = limits.get(key);
    if (!entry || entry.until < now) { entry = { count: 0, until: now + window }; limits.set(key, entry); }
    return ++entry.count > max;
  }
  async function run(key, work) {
    if (running >= 16 || active.has(key)) throw new Error('MAIL_BUSY');
    running++; active.add(key);
    try { return await work(); } finally { running--; active.delete(key); }
  }
  return http.createServer(async (req, res) => {
    res.setHeader('Cache-Control','no-store'); res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Content-Type','application/json; charset=utf-8');
    const send = (status, result) => { res.writeHead(status); res.end(JSON.stringify(result)); };
    const origin = req.headers.origin;
    if (origin && !origins.includes(origin)) return send(403, { ok: false, error: 'MAIL_FORBIDDEN' });
    if (origin) { res.setHeader('Access-Control-Allow-Origin',origin); res.setHeader('Vary','Origin'); }
    if (req.url === `${API_PREFIX}/health` && req.method === 'GET') return send(200,{ ok:true, service:'CodeSnap Cloud', version:'0.8.1', yandexOAuth:Boolean(oauth.clientId) });
    if (req.url !== API_PREFIX) return send(404,{ ok:false, error:'MAIL_NOT_FOUND' });
    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Methods','POST, OPTIONS'); res.setHeader('Access-Control-Allow-Headers','Authorization, Content-Type');
      return send(204,{});
    }
    if (req.method !== 'POST') return send(405,{ ok:false, error:'MAIL_METHOD' });
    const token = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(req.headers.authorization ?? '')?.[1];
    if (!token) return send(401,{ ok:false, error:'MAIL_AUTH_REQUIRED' });
    const owner = ownerId(token);
    const ip = req.headers['x-real-ip'] ?? req.socket.remoteAddress;
    if (limited(`ip:${ip}`,300) || limited(owner,120)) return send(429,{ ok:false,error:'MAIL_RATE_LIMIT' });
    if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] ?? '')) return send(415,{ ok:false,error:'MAIL_CONFIG_INVALID' });
    try {
      let size = 0, raw = '';
      for await (const chunk of req) { size += chunk.length; if (size > 8192) { send(413,{ok:false,error:'MAIL_CONFIG_INVALID'}); req.destroy(); return; } raw += chunk; }
      let input; try { input = JSON.parse(raw); } catch { throw new Error('MAIL_CONFIG_INVALID'); }
      if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('MAIL_CONFIG_INVALID');
      if (input.command === 'list') return send(200,{ ok:true, accounts:(await vault.read(owner)).map(visible) });
      if (input.command === 'yandex-start') {
        if (input.consent !== true) throw new Error('MAIL_CONSENT_REQUIRED');
        if (limited(`oauth:${ip}`,12,3600000)) throw new Error('MAIL_RATE_LIMIT');
        return send(200,{ok:true,...oauth.start(owner,input.redirect)});
      }
      if (['connect','yandex-finish'].includes(input.command)) {
        if (input.consent !== true) throw new Error('MAIL_CONSENT_REQUIRED');
        if (limited(`connect:${ip}`,12,3600000)) throw new Error('MAIL_RATE_LIMIT');
        const account = input.command === 'connect' ? configuration(input) : await oauth.finish(owner,input.state,input.code);
        await run(owner, async () => {
          try { await check(account); }
          catch (error) {
            if (input.command === 'yandex-finish' && error.message === 'MAIL_AUTH_FAILED') throw new Error('MAIL_YANDEX_IMAP');
            throw error;
          }
        });
        const result = await vault.update(owner, records => {
          const existing = records.find(item => item.email === account.email && item.provider === account.provider);
          if (!existing && records.length >= 20) throw new Error('MAIL_CAPACITY');
          const next = { ...account, id:existing?.id ?? randomUUID() };
          if (existing) records.splice(records.indexOf(existing),1,next); else records.push(next);
          cache.delete(`${owner}:${next.id}`); return visible(next);
        });
        return send(200,{ ok:true, account:result });
      }
      if (!['remove','search'].includes(input.command) || typeof input.id !== 'string') throw new Error('MAIL_CONFIG_INVALID');
      const record = (await vault.read(owner)).find(item => item.id === input.id);
      if (!record) return send(404,{ ok:false,error:'MAIL_ACCOUNT_MISSING' });
      const key = `${owner}:${record.id}`;
      if (input.command === 'remove') {
        await vault.update(owner, records => { const i = records.findIndex(item => item.id === record.id); if (i >= 0) records.splice(i,1); });
        cache.delete(key); return send(200,{ ok:true });
      }
      const saved = cache.get(key);
      if (saved && Date.now() - saved.at < 3000) return send(200,{ ok:true,messages:saved.messages });
      const messages = await run(key, async () => {
        const refreshed=await oauth.refresh(record);
        if (refreshed!==record) await vault.update(owner,records=>{ const i=records.findIndex(item=>item.id===record.id); if (i<0) throw new Error('MAIL_ACCOUNT_MISSING'); records.splice(i,1,refreshed); });
        return search(refreshed);
      });
      // A disconnect that happened during a fetch must not return the mailbox afterwards.
      if (!(await vault.read(owner)).some(item => item.id === record.id)) throw new Error('MAIL_ACCOUNT_MISSING');
      if (cache.size >= 1000) cache.delete(cache.keys().next().value);
      cache.set(key,{at:Date.now(),messages}); return send(200,{ok:true,messages});
    } catch (error) {
      const allowed = ['MAIL_CONFIG_INVALID','MAIL_AUTH_FAILED','MAIL_TLS_FAILED','MAIL_UNAVAILABLE','MAIL_STORAGE_FAILED','MAIL_BUSY','MAIL_CAPACITY','MAIL_RATE_LIMIT','MAIL_CONSENT_REQUIRED','MAIL_ACCOUNT_MISSING','MAIL_OAUTH_STATE','MAIL_OAUTH_UNAVAILABLE','MAIL_OAUTH_CLIENT','MAIL_OAUTH_TOKEN','MAIL_OAUTH_SCOPE','MAIL_YANDEX_IMAP'];
      const code = allowed.includes(error.message) ? error.message : 'MAIL_UNAVAILABLE';
      send(code === 'MAIL_RATE_LIMIT' ? 429 : code === 'MAIL_BUSY' ? 503 : 400,{ok:false,error:code});
    }
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const key = Buffer.from(process.env.VAULT_KEY ?? '', 'base64');
  const vault = new Vault(process.env.DATA_DIR ?? '/var/lib/codesnap-mail',key); await vault.init();
  const origins = (process.env.EXTENSION_ORIGINS ?? 'chrome-extension://ongiekgidmkffdhgmjmlnjjgoggojoak').split(',');
  const redirects=origins.filter(origin=>/^chrome-extension:\/\/[a-p]{32}$/.test(origin)).map(origin=>`https://${origin.slice(19)}.chromiumapp.org/yandex`);
  const oauth=new YandexAuth(process.env.YANDEX_CLIENT_ID,redirects,fetch,process.env.YANDEX_CLIENT_SECRET);
  const server = createService({vault,origins,oauth});
  server.requestTimeout = 30000; server.headersTimeout = 10000;
  server.listen(Number(process.env.PORT ?? 8787),'127.0.0.1', () => console.log('CodeSnap Cloud 0.8.1 ready'));
  for (const signal of ['SIGTERM','SIGINT']) process.on(signal, () => server.close(() => process.exit(0)));
}
