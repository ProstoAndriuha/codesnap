import test from 'node:test';
import assert from 'node:assert/strict';
import { connectAdditional, connectPrimary, getAccessTokens, listAccounts, forgetAdditional } from '../src/auth.js';

test('additional Gmail account is bound to OAuth state and kept in session storage', async () => {
  const before = { chrome: globalThis.chrome, fetch: globalThis.fetch };
  const memory = { extraAccounts: [] };
  globalThis.chrome = {
    identity: {
      getRedirectURL: () => 'https://extension-id.chromiumapp.org/',
      launchWebAuthFlow: async ({ url }) => {
        const request = new URL(url);
        assert.equal(request.searchParams.get('prompt'), 'select_account');
        assert.equal(request.searchParams.get('redirect_uri'), 'https://extension-id.chromiumapp.org/');
        return `https://extension-id.chromiumapp.org/#access_token=test-token&token_type=Bearer&expires_in=3600&scope=${encodeURIComponent('https://www.googleapis.com/auth/gmail.readonly')}&state=${request.searchParams.get('state')}`;
      },
      getAuthToken: async () => ({ token: 'primary-token' })
    },
    storage: {
      session: { get: async () => memory, set: async value => Object.assign(memory, value) },
      local: { get: async () => ({ primaryEmail: 'primary@example.com' }) }
    }
  };
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ emailAddress: 'second@example.com' }) });
  try {
    assert.equal(await connectAdditional('test-web-client.apps.googleusercontent.com'), 'second@example.com');
    assert.equal(memory.extraAccounts.length, 1);
    assert.equal((await listAccounts()).extras[0].email, 'second@example.com');
    assert.deepEqual((await getAccessTokens('all')).map(x => x.email), ['primary@example.com', 'second@example.com']);
    assert.deepEqual((await getAccessTokens('extra:second@example.com')).map(x => x.email), ['second@example.com']);
    assert.equal(await forgetAdditional('second@example.com', true), true);
    assert.equal(memory.extraAccounts.length, 0);
  } finally { globalThis.chrome = before.chrome; globalThis.fetch = before.fetch; }
});

test('additional-account OAuth rejects a mismatched state before using a token', async () => {
  const prior = globalThis.chrome;
  globalThis.chrome = { storage: { session: { get: async () => ({ extraAccounts: [] }) } }, identity: {
    getRedirectURL: () => 'https://extension-id.chromiumapp.org/',
    launchWebAuthFlow: async () => 'https://extension-id.chromiumapp.org/#access_token=bad&token_type=Bearer&expires_in=3600&scope=https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fgmail.readonly&state=wrong'
  } };
  try { await assert.rejects(connectAdditional('test-web-client.apps.googleusercontent.com'), { message: 'OAUTH_RESPONSE' }); }
  finally { globalThis.chrome = prior; }
});

test('Opera and Edge use the account chooser without Chrome profile tokens', async () => {
  const prior = { chrome: globalThis.chrome, fetch: globalThis.fetch, navigator: Object.getOwnPropertyDescriptor(globalThis, 'navigator') };
  const memory = { extraAccounts: [] };
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { userAgent: 'Mozilla/5.0 Chrome/130.0 OPR/115.0' } });
  const redirect = `https://${'a'.repeat(32)}.chromiumapp.org/`;
  globalThis.chrome = {
    runtime: { id: 'a'.repeat(32) },
    identity: {
      getAuthToken: async () => { throw new Error('Chrome-only API was called'); },
      launchWebAuthFlow: ({ url }, callback) => {
        assert.equal(new URL(url).searchParams.get('redirect_uri'), redirect);
        const state = new URL(url).searchParams.get('state');
        callback(`${redirect}#access_token=portable-token&token_type=Bearer&expires_in=3600&scope=${encodeURIComponent('https://www.googleapis.com/auth/gmail.readonly')}&state=${state}`);
      }
    },
    storage: {
      session: { get: async () => memory, set: async value => Object.assign(memory, value) },
      local: { get: async () => ({}) }
    }
  };
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ emailAddress: 'opera@example.com' }) });
  try {
    assert.equal(await connectPrimary(), 'opera@example.com');
    assert.deepEqual((await getAccessTokens('all')).map(item => item.email), ['opera@example.com']);
  } finally {
    globalThis.chrome = prior.chrome; globalThis.fetch = prior.fetch;
    if (prior.navigator) Object.defineProperty(globalThis, 'navigator', prior.navigator);
    else delete globalThis.navigator;
  }
});
