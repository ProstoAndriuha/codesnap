import { randomBytes, createHash } from 'node:crypto';

export class YandexAuth {
  constructor(clientId, redirects, request = fetch, secret = '') { this.clientId=clientId; this.redirects=redirects; this.request=request; this.secret=secret; this.pending=new Map(); }
  start(owner, redirect) {
    if (!this.clientId || !this.redirects.includes(redirect)) throw new Error('MAIL_OAUTH_UNAVAILABLE');
    const now=Date.now();
    for (const [state,item] of this.pending) if (now-item.created>300000 || item.owner===owner) this.pending.delete(state);
    if (this.pending.size>=100) throw new Error('MAIL_BUSY');
    const verifier=randomBytes(32).toString('base64url'), state=randomBytes(32).toString('base64url');
    this.pending.set(state,{owner,verifier,redirect,created:now});
    const params=new URLSearchParams({response_type:'code',client_id:this.clientId,redirect_uri:redirect,scope:'login:email mail:imap_ro',force_confirm:'yes',state,
      code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256'});
    return { url:`https://oauth.yandex.ru/authorize?${params}`, state };
  }
  async token(parameters) {
    const response=await this.request('https://oauth.yandex.ru/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:this.clientId,...(this.secret ? {client_secret:this.secret} : {}),...parameters}),signal:AbortSignal.timeout(10000),redirect:'error'});
    const result=await response.json();
    if (!response.ok || !result.access_token) throw new Error(['invalid_client','unauthorized_client','invalid_scope'].includes(result.error) ? 'MAIL_OAUTH_CLIENT' : 'MAIL_OAUTH_TOKEN');
    if (result.scope && !String(result.scope).split(' ').includes('mail:imap_ro')) throw new Error('MAIL_OAUTH_SCOPE');
    return {accessToken:result.access_token,refreshToken:result.refresh_token,expiresAt:Date.now()+Number(result.expires_in ?? 3600)*1000};
  }
  async finish(owner, state, code) {
    const entry=this.pending.get(state);
    if (!entry || entry.owner!==owner || Date.now()-entry.created>300000 || typeof code!=='string' || !code || code.length>2048) throw new Error('MAIL_OAUTH_STATE');
    this.pending.delete(state);
    const credentials=await this.token({grant_type:'authorization_code',code,code_verifier:entry.verifier});
    const response=await this.request('https://login.yandex.ru/info?format=json',{headers:{Authorization:`OAuth ${credentials.accessToken}`},signal:AbortSignal.timeout(10000),redirect:'error'});
    const profile=await response.json();
    const email=String(profile.default_email ?? '').trim().toLowerCase();
    if (!response.ok || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('MAIL_AUTH_FAILED');
    return {provider:'yandex',email,login:email,host:'imap.yandex.ru',port:993,security:'tls',...credentials};
  }
  async refresh(record) {
    if (!record.accessToken || record.expiresAt>Date.now()+60000) return record;
    if (!record.refreshToken) throw new Error('MAIL_AUTH_FAILED');
    const credentials=await this.token({grant_type:'refresh_token',refresh_token:record.refreshToken});
    return {...record,...credentials,refreshToken:credentials.refreshToken ?? record.refreshToken};
  }
}
