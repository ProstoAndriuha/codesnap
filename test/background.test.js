import test from 'node:test';
import assert from 'node:assert/strict';

test('iframe insertion is routed only to the frame that requested the code', async () => {
  const prior = { chrome: globalThis.chrome, fetch: globalThis.fetch, setInterval: globalThis.setInterval };
  let listener;
  const delivered = [];
  globalThis.setInterval = () => 1;
  globalThis.chrome = {
    storage: { local: { get: async () => ({ primaryEmail: 'owner@example.com', accountSelections: {} }), set: async () => {} }, session: { get: async () => ({ extraAccounts: [] }), set: async () => {} } },
    identity: { getAuthToken: async () => ({ token: 'token' }), removeCachedAuthToken: async () => {} },
    tabs: {
      get: async () => ({ url: 'https://parent.test/login' }),
      sendMessage: async (_id, message, options) => {
        delivered.push({ type: message.type, frameId: options?.frameId });
        if (message.type === 'FIELD_STATUS') return { origin: 'https://auth.example.com', fieldId: 'email-otp' };
        return { status: 'inserted' };
      },
      onRemoved: { addListener() {} }, onUpdated: { addListener() {} }
    },
    runtime: { onMessage: { addListener(fn) { listener = fn; } } }
  };
  globalThis.fetch = async url => {
    const path = new URL(url).pathname;
    const data = path.endsWith('/messages') ? { messages: [{ id: 'mail-1' }] } :
      { id: 'mail-1', internalDate: String(Date.now()), payload: { headers: [{ name: 'From', value: 'codes@example.com' }, { name: 'Subject', value: 'Example code' }], mimeType: 'text/plain', body: { data: Buffer.from('Your verification code is 483921').toString('base64url') } } };
    return { ok: true, status: 200, json: async () => data };
  };
  try {
    await import(`../src/background.js?frame=${Math.random()}`);
    const send = (request, sender) => new Promise(resolve => listener(request, sender, resolve));
    const sender = { tab: { id: 8 }, frameId: 4, url: 'https://auth.example.com/login' };
    const found = await send({ type: 'SEARCH_INLINE', origin: 'https://auth.example.com', fieldId: 'email-otp', channel: 'email', detectedAt: Date.now() - 1000 }, sender);
    assert.equal(found.code, '483921');
    assert.equal((await send({ type: 'INSERT_INLINE', origin: 'https://auth.example.com', sessionId: found.sessionId }, sender)).status, 'inserted');
    assert.deepEqual(delivered.filter(item => item.type === 'INSERT_CODE'), [{ type: 'INSERT_CODE', frameId: 4 }]);
    assert.equal((await send({ type: 'INSERT_INLINE', origin: 'https://auth.example.com', sessionId: found.sessionId }, { ...sender, frameId: 0 })).status, 'expired');
  } finally { globalThis.chrome = prior.chrome; globalThis.fetch = prior.fetch; globalThis.setInterval = prior.setInterval; }
});

test('inline email choice is scoped to its iframe and rejects foreign origins', async () => {
  const prior = { chrome: globalThis.chrome, fetch: globalThis.fetch, setInterval: globalThis.setInterval };
  let listener;
  const delivered = [];
  globalThis.setInterval = () => 1;
  globalThis.chrome = {
    storage: { local: { get: async () => ({ primaryEmail: 'owner@example.com', accountSelections: {} }), set: async () => {} }, session: { get: async () => ({ extraAccounts: [] }), set: async () => {} } },
    identity: { getAuthToken: async () => ({ token: 'token' }), removeCachedAuthToken: async () => {} },
    tabs: { get: async () => ({ url: 'https://parent.test/login' }), sendMessage: async (_id, message, options) => {
      delivered.push({ type: message.type, frameId: options?.frameId });
      return message.type === 'FIELD_STATUS' ? { origin: 'https://auth.example.com', fieldId: 'email-otp' } : { status: 'inserted' };
    }, onRemoved: { addListener() {} }, onUpdated: { addListener() {} } },
    runtime: { onMessage: { addListener(fn) { listener = fn; } } }
  };
  const now = Date.now();
  globalThis.fetch = async url => {
    const path = new URL(url).pathname;
    const id = path.split('/').at(-1);
    return { ok: true, status: 200, json: async () => path.endsWith('/messages') ? { messages: [{ id: 'mail-1' }, { id: 'mail-2' }] } :
      { id, internalDate: String(now), payload: { headers: [{ name: 'From', value: 'codes@example.com' }, { name: 'Subject', value: 'Example code' }], mimeType: 'text/plain', body: { data: Buffer.from(`Your verification code is ${id === 'mail-1' ? '483921' : '275521'}`).toString('base64url') } } } };
  };
  try {
    await import(`../src/background.js?choice=${Math.random()}`);
    const send = (request, sender) => new Promise(resolve => listener(request, sender, resolve));
    const sender = { tab: { id: 8 }, frameId: 4, url: 'https://auth.example.com/login' };
    const result = await send({ type: 'SEARCH_INLINE', origin: 'https://auth.example.com', fieldId: 'email-otp', channel: 'email', detectedAt: now - 1000 }, sender);
    assert.equal(result.status, 'ambiguous');
    assert.equal(result.candidates[1].from, 'codes@example.com');
    const request = { type: 'SELECT_INLINE_CANDIDATE', origin: 'https://auth.example.com', sessionId: result.sessionId, index: 1 };
    assert.equal((await send(request, { ...sender, frameId: 0 })).status, 'expired');
    assert.equal((await send(request, { ...sender, url: 'https://foreign.test' })).status, 'untrusted');
    assert.equal((await send(request, sender)).code, result.candidates[1].code);
    assert.equal((await send({ type: 'INSERT_INLINE', origin: request.origin, sessionId: result.sessionId }, sender)).status, 'inserted');
    assert.equal(delivered.find(item => item.type === 'INSERT_CODE').frameId, 4);
  } finally { globalThis.chrome = prior.chrome; globalThis.fetch = prior.fetch; globalThis.setInterval = prior.setInterval; }
});

test('generic Gmail search and insertion stay isolated by tab and field', async () => {
  const prior = { chrome: globalThis.chrome, fetch: globalThis.fetch, setInterval: globalThis.setInterval };
  const tabs = new Map([[1, { url: 'https://example.com/login' }], [2, { url: 'https://other.test/verify' }]]);
  const inserted = [];
  let listener;
  globalThis.setInterval = () => 1;
  globalThis.chrome = {
    storage: { local: { get: async () => ({ senders: {}, primaryEmail: 'primary@example.com', accountSelections: {} }) }, session: { get: async () => ({ extraAccounts: [] }), set: async () => {} } },
    identity: { getAuthToken: async () => ({ token: 'test-token' }), removeCachedAuthToken: async () => {} },
    tabs: {
      get: async id => tabs.get(id),
      sendMessage: async (id, message) => {
        if (message.type === 'FIELD_STATUS') return { origin: new URL(tabs.get(id).url).origin, fieldId: id === 1 ? 'field-a' : 'field-b' };
        inserted.push({ id, message }); return { status: 'inserted' };
      },
      onRemoved: { addListener() {} }, onUpdated: { addListener() {} }
    },
    runtime: { onMessage: { addListener(fn) { listener = fn; } } }
  };
  const now = Date.now();
  const messages = {
    a: { id: 'a', internalDate: String(now - 1000), payload: { headers: [{ name: 'From', value: 'codes@example.com' }, { name: 'Subject', value: 'Example verification code' }], mimeType: 'text/plain', body: { data: Buffer.from('Your verification code is 483921').toString('base64url') } } },
    b: { id: 'b', internalDate: String(now - 1000), payload: { headers: [{ name: 'From', value: 'codes@other.test' }, { name: 'Subject', value: 'Other verification code' }], mimeType: 'text/plain', body: { data: Buffer.from('Your verification code is 847291').toString('base64url') } } }
  };
  globalThis.fetch = async url => {
    const id = new URL(url).pathname.split('/').at(-1);
    return { ok: true, status: 200, json: async () => id === 'messages' ? { messages: [{ id: 'a' }, { id: 'b' }] } : messages[id] };
  };
  try {
    await import(`../src/background.js?test=${Math.random()}`);
    const send = request => new Promise(resolve => listener(request, {}, resolve));
    const a = await send({ type: 'SEARCH_POPUP', tabId: 1, origin: 'https://example.com', siteId: 'generic', fieldId: 'field-a', detectedAt: now - 2000, siteContext: { title: 'Example' } });
    const b = await send({ type: 'SEARCH_POPUP', tabId: 2, origin: 'https://other.test', siteId: 'generic', fieldId: 'field-b', detectedAt: now - 2000, siteContext: { title: 'Other' } });
    assert.equal(a.code, '483921');
    assert.equal(b.code, '847291');
    assert.equal((await send({ type: 'INSERT_POPUP', tabId: 1, origin: 'https://example.com', sessionId: b.sessionId })).status, 'expired');
    assert.equal((await send({ type: 'INSERT_POPUP', tabId: 1, origin: 'https://example.com', sessionId: a.sessionId })).status, 'inserted');
    assert.equal((await send({ type: 'INSERT_POPUP', tabId: 2, origin: 'https://other.test', sessionId: b.sessionId })).status, 'inserted');
    assert.deepEqual(inserted.map(x => [x.id, x.message.code, x.message.fieldId]), [[1, '483921', 'field-a'], [2, '847291', 'field-b']]);
  } finally {
    globalThis.chrome = prior.chrome; globalThis.fetch = prior.fetch; globalThis.setInterval = prior.setInterval;
  }
});

test('automatic watch finds a provider code when Chrome hides the tab URL; popup reuses it', async () => {
  const prior = { chrome: globalThis.chrome, fetch: globalThis.fetch, setInterval: globalThis.setInterval };
  let listener;
  let gmailQuery;
  let currentOrigin = 'https://www.alphax.com';
  const stored = { senders: {}, learnedSenders: {}, primaryEmail: 'primary@example.com', accountSelections: {} };
  globalThis.setInterval = () => 1;
  globalThis.chrome = {
    storage: { local: { get: async () => stored, set: async value => Object.assign(stored, value) }, session: { get: async () => ({ extraAccounts: [] }), set: async () => {} } },
    identity: { getAuthToken: async () => ({ token: 'test-token' }), removeCachedAuthToken: async () => {} },
    tabs: {
      get: async () => ({}),
      sendMessage: async (_tabId, request) => request.type === 'FIELD_STATUS' ? { origin: currentOrigin, fieldId: 'six-cells', detected: true } : { status: 'inserted' },
      onRemoved: { addListener() {} }, onUpdated: { addListener() {} }
    },
    runtime: { onMessage: { addListener(fn) { listener = fn; } } }
  };
  globalThis.fetch = async url => {
    const parsed = new URL(url);
    if (parsed.pathname.endsWith('/messages')) {
      gmailQuery = parsed.searchParams.get('q');
      return { ok: true, status: 200, json: async () => ({ messages: [{ id: 'privy-login' }] }) };
    }
    const message = { id: 'privy-login', internalDate: String(Date.now() - 6 * 60_000), payload: { headers: [{ name: 'From', value: 'no-reply@mail.privy.io' }, { name: 'Subject', value: 'Your login code for AlphaX' }], mimeType: 'text/plain', body: { data: Buffer.from('AlphaX. Log in to AlphaX. Your code is 483921. This code expires in 10 minutes.').toString('base64url') } } };
    return { ok: true, status: 200, json: async () => message };
  };
  try {
    await import(`../src/background.js?provider=${Math.random()}`);
    const request = { tabId: 3, origin: 'https://www.alphax.com', siteId: 'generic', fieldId: 'six-cells' };
    const automatic = await new Promise(resolve => listener({ type: 'SEARCH_INLINE', origin: request.origin, fieldId: request.fieldId, automatic: true }, { tab: { id: 3 }, url: 'https://www.alphax.com/en-us/login' }, resolve));
    assert.equal(automatic.status, 'review');
    assert.equal(automatic.code, '483921');
    assert.equal(automatic.from, 'no-reply@mail.privy.io');
    const result = await new Promise(resolve => listener({ type: 'SEARCH_POPUP', ...request }, {}, resolve));
    assert.equal(result.status, 'found');
    assert.equal(result.code, '483921');
    assert.equal(result.requiresReview, true);
    assert.equal(result.from, 'no-reply@mail.privy.io');
    assert.match(gmailQuery, /^after:\d+ \{/);
    assert.equal(automatic.sessionId, result.sessionId);
    const trusted = await new Promise(resolve => listener({ type: 'TRUST_CANDIDATE', tabId: 3, origin: request.origin, sessionId: result.sessionId }, {}, resolve));
    assert.equal(trusted.status, 'remembered');
    assert.deepEqual(stored.learnedSenders['https://www.alphax.com'], ['no-reply@mail.privy.io']);
    const later = await new Promise(resolve => listener({ type: 'SEARCH_INLINE', origin: request.origin, fieldId: request.fieldId, automatic: true }, { tab: { id: 3 }, url: 'https://www.alphax.com/en-us/login' }, resolve));
    assert.equal(later.status, 'found');
    currentOrigin = 'https://other.example';
    assert.equal((await new Promise(resolve => listener({ type: 'INSERT_POPUP', tabId: 3, origin: request.origin, sessionId: later.sessionId }, {}, resolve))).status, 'changed');
  } finally {
    globalThis.chrome = prior.chrome; globalThis.fetch = prior.fetch; globalThis.setInterval = prior.setInterval;
  }
});

test('automatic watch falls back to recent mail for an unknown site and generic login subject', async () => {
  const prior = { chrome: globalThis.chrome, fetch: globalThis.fetch, setInterval: globalThis.setInterval };
  let listener;
  const queries = [];
  globalThis.setInterval = () => 1;
  globalThis.chrome = {
    storage: { local: { get: async () => ({ senders: {}, learnedSenders: {}, primaryEmail: 'primary@example.com', accountSelections: {} }) }, session: { get: async () => ({ extraAccounts: [] }), set: async () => {} } },
    identity: { getAuthToken: async () => ({ token: 'test-token' }), removeCachedAuthToken: async () => {} },
    tabs: { get: async () => ({}), sendMessage: async (_id, request) => request.type === 'FIELD_STATUS' ? { origin: 'https://www.bitbase.com', fieldId: 'email-code' } : { status: 'inserted' }, onRemoved: { addListener() {} }, onUpdated: { addListener() {} } },
    runtime: { onMessage: { addListener(fn) { listener = fn; } } }
  };
  globalThis.fetch = async url => {
    const parsed = new URL(url);
    if (parsed.pathname.endsWith('/messages')) {
      const query = parsed.searchParams.get('q');
      queries.push(query);
      return { ok: true, status: 200, json: async () => ({ messages: query.includes('{') ? [] : [{ id: 'bitbase-login' }] }) };
    }
    return { ok: true, status: 200, json: async () => ({ id: 'bitbase-login', internalDate: String(Date.now() - 1000), payload: { headers: [{ name: 'From', value: 'Bitbase <no-reply@mail.bitbase.com>' }, { name: 'Subject', value: 'Login' }], mimeType: 'text/plain', body: { data: Buffer.from('Dear Bitbase user: Your email verification code for login is 360069. Verification code is valid for 5 minutes.').toString('base64url') } } }) };
  };
  try {
    await import(`../src/background.js?bitbase=${Math.random()}`);
    const result = await new Promise(resolve => listener({ type: 'SEARCH_INLINE', origin: 'https://www.bitbase.com', fieldId: 'email-code', automatic: true, channel: 'email' }, { tab: { id: 7 }, url: 'https://www.bitbase.com/verify' }, resolve));
    assert.equal(result.status, 'found');
    assert.equal(result.code, '360069');
    assert.equal(queries.length, 2);
    assert.match(queries[1], /^after:\d+$/);
  } finally {
    globalThis.chrome = prior.chrome; globalThis.fetch = prior.fetch; globalThis.setInterval = prior.setInterval;
  }
});
