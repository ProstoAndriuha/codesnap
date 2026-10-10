import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { YandexAuth } from '../src/yandex.js';
const redirect='https://ongiekgidmkffdhgmjmlnjjgoggojoak.chromiumapp.org/yandex';
test('OAuth binds state to device, uses PKCE and readonly scope, never returns token to browser, rejects replay',async()=>{
  let authUrl;
  const oauth=new YandexAuth('test-app',[redirect],async(url,options)=>{
    if (url.endsWith('/token')) {
      const verifier=options.body.get('code_verifier');
      assert.equal(createHash('sha256').update(verifier).digest('base64url'),authUrl.searchParams.get('code_challenge'));
      assert.equal(options.body.get('code'),'test-code');
      return {ok:true,json:async()=>({access_token:'test-token',refresh_token:'test-refresh',expires_in:3600,scope:'login:email mail:imap_ro'})};
    }
    assert.equal(options.headers.Authorization,'OAuth test-token');
    return {ok:true,json:async()=>({default_email:'owner@yandex.ru'})};
  });
  assert.throws(()=>oauth.start('owner','https://evil.example/callback'),/MAIL_OAUTH_UNAVAILABLE/);
  const flow=oauth.start('owner',redirect); authUrl=new URL(flow.url);
  assert.equal(authUrl.searchParams.get('scope'),'login:email mail:imap_ro');
  await assert.rejects(oauth.finish('other-device',flow.state,'test-code'),/MAIL_OAUTH_STATE/);
  const record=await oauth.finish('owner',flow.state,'test-code'); assert.equal(record.email,'owner@yandex.ru'); assert.equal(record.accessToken,'test-token');
  await assert.rejects(oauth.finish('owner',flow.state,'test-code'),/MAIL_OAUTH_STATE/);
});
test('OAuth refresh preserves refresh token when provider omits a replacement',async()=>{
  const oauth=new YandexAuth('test-app',[redirect],async(_url,options)=>{
    assert.equal(options.body.get('grant_type'),'refresh_token'); assert.equal(options.body.get('client_secret'),'test-secret');
    return {ok:true,json:async()=>({access_token:'updated',expires_in:3600})};
  },'test-secret');
  const result=await oauth.refresh({accessToken:'old',refreshToken:'refresh',expiresAt:0});
  assert.equal(result.accessToken,'updated'); assert.equal(result.refreshToken,'refresh');
});
