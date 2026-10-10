import test from 'node:test';
import assert from 'node:assert/strict';
import { connectYandex, mailHost, listMailAccounts } from '../src/mail-bridge.js';
const redirect='https://ongiekgidmkffdhgmjmlnjjgoggojoak.chromiumapp.org/yandex';
test('disabling Cloud during a request discards its late account and code responses',async()=>{
  const prior={chrome:globalThis.chrome,fetch:globalThis.fetch}; let enabled=true;
  globalThis.chrome={storage:{local:{get:async()=>({mailCloudEnabled:enabled,mailCloudToken:'a'.repeat(43)})}}};
  globalThis.fetch=async()=>({ok:true,json:async()=>{enabled=false;return {ok:true,accounts:[{email:'private@example.com'}],messages:[{body:'private code'}]};}});
  try {
    assert.deepEqual((await mailHost({command:'list'})).accounts,[]);
    enabled=true;await assert.rejects(mailHost({command:'search',id:'private'}),/MAIL_CLOUD_DISABLED/);
  }finally{Object.assign(globalThis,prior);}
});
test('Yandex official auth callback is bound to exact redirect/state and exchange stays in service worker',async()=>{
  const prior={chrome:globalThis.chrome,fetch:globalThis.fetch};
  const requests=[]; const writes=[];
  globalThis.chrome={storage:{local:{get:async()=>({mailCloudEnabled:true,mailCloudToken:'a'.repeat(43)}),set:async value=>writes.push(value)}},identity:{getRedirectURL:()=>redirect,launchWebAuthFlow:async options=>{assert.equal(new URL(options.url).hostname,'oauth.yandex.ru');return `${redirect}?state=test-state&code=test-code`;}}};
  globalThis.fetch=async(_url,options)=>{
    const input=JSON.parse(options.body); requests.push(input);
    return {ok:true,json:async()=>input.command==='yandex-start'?{ok:true,url:'https://oauth.yandex.ru/authorize?response_type=code',state:'test-state'}:{ok:true,account:{id:'1',email:'owner@yandex.ru',provider:'yandex'}}};
  };
  try {
    assert.equal((await connectYandex()).account.provider,'yandex');
    assert.equal(requests[1].command,'yandex-finish'); assert.equal(requests[1].code,'test-code'); assert.equal(requests[1].consent,true); assert.deepEqual(writes,[]);
    for (const callback of ['https://evil.example/?state=test-state&code=test-code',`${redirect}?state=wrong&code=test-code`]) {
      globalThis.chrome.identity.launchWebAuthFlow=async()=>callback;
      const before=requests.length; await assert.rejects(connectYandex(),/MAIL_OAUTH_STATE/); assert.equal(requests.length,before+1);
    }
    globalThis.chrome.identity.launchWebAuthFlow=async()=>`${redirect}?state=test-state&error=access_denied`;
    const before=requests.length;
    await assert.rejects(connectYandex(),/MAIL_OAUTH_DENIED/);
    assert.equal(requests.length,before+1);
  } finally {Object.assign(globalThis,prior);}
});
test('edge challenge is explicit and strict mailbox list propagates connection failure',async()=>{
  const prior={chrome:globalThis.chrome,fetch:globalThis.fetch};
  globalThis.chrome={storage:{local:{get:async()=>({mailCloudEnabled:true,mailCloudToken:'a'.repeat(43)})}}};
  globalThis.fetch=async()=>({headers:{get:()=> 'challenge'}});
  try {await assert.rejects(mailHost({command:'list'}),/MAIL_EDGE_BLOCKED/);await assert.rejects(listMailAccounts(true),/MAIL_EDGE_BLOCKED/);assert.deepEqual(await listMailAccounts(),[]);}
  finally {Object.assign(globalThis,prior);}
});
