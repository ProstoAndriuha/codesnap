import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm, readFile, readdir, copyFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Vault, ownerId } from '../src/vault.js';
import { createService } from '../src/server.js';
import { configuration, publicAddress, resolvePublic, withMailbox, readRecent } from '../src/mail.js';

test('private addresses, metadata and mixed public/private DNS targets are rejected', async () => {
  for (const ip of ['127.0.0.1','10.0.0.1','169.254.169.254','192.168.0.1','100.64.0.1','::1','fe80::1','fc00::1','::ffff:127.0.0.1']) assert.equal(publicAddress(ip),false,ip);
  assert.equal(publicAddress('8.8.8.8'),true);
  await assert.rejects(resolvePublic('imap.example.com',async () => [{address:'8.8.8.8'},{address:'127.0.0.1'}]),/MAIL_CONFIG_INVALID/);
  for (const change of [{host:'localhost'}, {host:'evil..com'}, {host:'https://example.com'}, {port:443}, {security:'plain'}]) assert.throws(() => configuration({provider:'imap',email:'a@example.com',host:'imap.example.com',port:993,password:'fake',...change}),/MAIL_CONFIG_INVALID/);
});
test('checked IP is pinned, certificates verified and INBOX is read only', async () => {
  let options, mailbox, closed=false;
  class Client { constructor(value) { options=value; } on() {} async connect() {} async mailboxOpen(name,value) { mailbox={name,...value}; } close() { closed=true; } }
  await withMailbox(configuration({provider:'yandex',email:'a@yandex.ru',password:'fake'}),async () => true,{resolver:async () => [{address:'8.8.8.8'}],Client});
  assert.equal(options.host,'8.8.8.8'); assert.equal(options.servername,'imap.yandex.ru'); assert.equal(options.tls.rejectUnauthorized,true);
  assert.deepEqual(mailbox,{name:'INBOX',readOnly:true}); assert.equal(options.logger,false); assert.ok(closed);
});
test('recent reader uses delivery date and MIME, skips old or oversized messages', async () => {
  const fetched=[];
  class Client { constructor() {this.mailbox={uidValidity:1};} on() {} async connect() {} async mailboxOpen() {} close() {}
    async search() {return [1,2,3];} async fetchAll() {return [{uid:1,size:100,internalDate:new Date()},{uid:2,size:100,internalDate:new Date(0)},{uid:3,size:999999,internalDate:new Date()}];}
    async fetchOne(uid) {fetched.push(uid); return {source:Buffer.from('From: codes@example.com\r\nSubject: Verification\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nYour code is 483921')};}
  }
  const messages=await readRecent({host:'imap.example.com',port:993,security:'tls',login:'a',password:'fake'},{resolver:async()=>[{address:'8.8.8.8'}],Client});
  assert.deepEqual(fetched,[1]); assert.equal(messages.length,1); assert.match(messages[0].body,/483921/); assert.ok(messages[0].timestamp>Date.now()-60000);
});
test('vault encrypts email/password and rejects swapped tenant files', async () => {
  const directory=await mkdtemp(path.join(os.tmpdir(),'codesnap-vault-'));
  try {
    const vault=new Vault(directory,randomBytes(32)); await vault.init();
    const a=ownerId('a'), b=ownerId('b'); await vault.update(a,records=>records.push({email:'private@example.com',password:'private-app-password'}));
    const raw=await readFile(vault.file(a)); assert.ok(!raw.includes(Buffer.from('private-app-password'))); assert.ok(!raw.includes(Buffer.from('private@example.com')));
    assert.equal((await vault.read(a))[0].email,'private@example.com'); await copyFile(vault.file(a),vault.file(b)); await assert.rejects(vault.read(b),/MAIL_STORAGE_FAILED/);
  } finally {await rm(directory,{recursive:true,force:true});}
});
test('API isolates devices, requires consent, hides secrets and disconnect deletes credentials', async () => {
  const directory=await mkdtemp(path.join(os.tmpdir(),'codesnap-service-'));
  const vault=new Vault(directory,randomBytes(32)); await vault.init(); let searches=0;
  const origin='chrome-extension://ongiekgidmkffdhgmjmlnjjgoggojoak';
  const server=createService({vault,origins:[origin],check:async()=>true,search:async()=>{searches++;return [{id:'1',body:'Code 483921',timestamp:Date.now()}];}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const url=`http://127.0.0.1:${server.address().port}/api/mail`;
  const a=randomBytes(32).toString('base64url'), b=randomBytes(32).toString('base64url');
  const send=async(body,token=a,from=origin)=>{const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`,Origin:from},body:JSON.stringify(body)});return {status:r.status,...await r.json()};};
  try {
    assert.equal((await send({command:'list'},'bad')).status,401); assert.equal((await send({command:'list'},a,'https://attacker.example')).status,403);
    const config={command:'connect',provider:'yandex',email:'a@yandex.ru',password:'fake-password'};
    assert.equal((await send(config)).error,'MAIL_CONSENT_REQUIRED');
    const connected=await send({...config,consent:true}); assert.equal(connected.ok,true); assert.ok(!JSON.stringify(connected).includes('fake-password'));
    assert.equal((await send({command:'list'},b)).accounts.length,0);
    assert.equal((await send({command:'search',id:connected.account.id},b)).status,404);
    assert.equal((await send({command:'search',id:connected.account.id})).messages.length,1);
    await send({command:'search',id:connected.account.id}); assert.equal(searches,1);
    await send({command:'remove',id:connected.account.id}); assert.equal((await readdir(directory)).filter(f=>f.endsWith('.enc')).length,0);
    assert.equal((await send({command:'search',id:connected.account.id})).status,404);
  } finally {server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await rm(directory,{recursive:true,force:true});}
});
