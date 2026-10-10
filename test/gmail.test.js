import test from 'node:test';
import assert from 'node:assert/strict';
import { findMessages, findHistoryMessages, getGmailHistoryId } from '../src/gmail.js';

test('expired OAuth maps to a non-sensitive error', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => ({ status: 401, ok: false });
  try { await assert.rejects(findMessages('fake-token', 'notice@example.com'), { message: 'AUTH_EXPIRED' }); }
  finally { globalThis.fetch = original; }
});

test('Gmail query limits sender, time and result count', async () => {
  const original = globalThis.fetch;
  let requested;
  globalThis.fetch = async url => { requested = new URL(url); return { ok: true, status: 200, json: async () => ({ messages: [] }) }; };
  try {
    assert.deepEqual(await findMessages('fake-token', 'notice@example.com'), []);
    assert.match(requested.searchParams.get('q'), /^from:notice@example\.com after:\d+$/);
    assert.equal(requested.searchParams.get('maxResults'), '8');
    assert.equal(requested.searchParams.get('includeSpamTrash'), 'true');
  } finally { globalThis.fetch = original; }
});

test('findMessages includes spam messages and excludes trash', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async url => {
    const parsed = new URL(url);
    if (parsed.searchParams.has('q')) {
      assert.equal(parsed.searchParams.get('includeSpamTrash'), 'true');
      return { ok: true, status: 200, json: async () => ({ messages: [{ id: 'spam-msg' }, { id: 'trash-msg' }] }) };
    }
    if (parsed.pathname.endsWith('/spam-msg')) {
      return {
        ok: true, status: 200,
        json: async () => ({
          id: 'spam-msg',
          labelIds: ['SPAM'],
          internalDate: String(Date.now()),
          payload: { headers: [{ name: 'From', value: 'service@example.com' }, { name: 'Subject', value: 'Security Code' }], mimeType: 'text/plain', body: { data: Buffer.from('Your code is 849201').toString('base64url') } }
        })
      };
    }
    if (parsed.pathname.endsWith('/trash-msg')) {
      return {
        ok: true, status: 200,
        json: async () => ({
          id: 'trash-msg',
          labelIds: ['TRASH'],
          internalDate: String(Date.now()),
          payload: { headers: [{ name: 'From', value: 'old@example.com' }], mimeType: 'text/plain', body: { data: Buffer.from('Old code').toString('base64url') } }
        })
      };
    }
    return { ok: false, status: 404 };
  };
  try {
    const messages = await findMessages('fake-token', 'service@example.com');
    assert.equal(messages.length, 1);
    assert.equal(messages[0].id, 'spam-msg');
    assert.match(messages[0].body, /849201/);
  } finally { globalThis.fetch = original; }
});

test('Gmail query can cover a six-minute provider message when its email states a longer lifetime', async () => {
  const original = globalThis.fetch;
  let query;
  globalThis.fetch = async url => { query = new URL(url).searchParams.get('q'); return { ok: true, status: 200, json: async () => ({ messages: [] }) }; };
  try {
    const now = Date.now();
    await findMessages('fake-token', 'no-reply@mail.privy.io', [], 540);
    const cutoff = Number(query.match(/after:(\d+)/)?.[1]);
    assert.match(query, /^from:no-reply@mail\.privy\.io after:\d+$/);
    assert.ok(cutoff * 1000 <= now - 6 * 60_000);
  } finally { globalThis.fetch = original; }
});

test('generic Gmail search stays bounded to recent verification messages', async () => {
  const original = globalThis.fetch;
  let requested;
  globalThis.fetch = async url => { requested = new URL(url); return { ok: true, status: 200, json: async () => ({ messages: [] }) }; };
  try {
    await findMessages('fake-token');
    assert.match(requested.searchParams.get('q'), /^after:\d+ \{verification code otp /);
    assert.equal(requested.searchParams.get('maxResults'), '20');
  } finally { globalThis.fetch = original; }
});

test('broad Gmail fallback searches recent mail when wording does not match keywords', async () => {
  const original = globalThis.fetch;
  let requested;
  globalThis.fetch = async url => { requested = new URL(url); return { ok: true, status: 200, json: async () => ({ messages: [] }) }; };
  try {
    await findMessages('fake-token', null, [], 900, true);
    assert.match(requested.searchParams.get('q'), /^after:\d+$/);
    assert.equal(requested.searchParams.get('maxResults'), '40');
  } finally { globalThis.fetch = original; }
});

test('active-session search skips message bodies already inspected', async () => {
  const original = globalThis.fetch;
  let detailRequests = 0;
  globalThis.fetch = async url => {
    const detail = new URL(url).pathname.endsWith('/old-id');
    if (detail) detailRequests++;
    return { ok: true, status: 200, json: async () => detail ? { id: 'old-id', internalDate: String(Date.now()), payload: { headers: [], mimeType: 'text/plain', body: { data: '' } } } : { messages: [{ id: 'old-id' }] } };
  };
  try {
    assert.equal((await findMessages('test-token', null, ['old-id'])).length, 0);
    assert.equal(detailRequests, 0);
  } finally { globalThis.fetch = original; }
});

test('active history loads only unseen added messages and advances its cursor', async () => {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async url => {
    const path = new URL(url).pathname;
    calls.push(path);
    const data = path.endsWith('/profile') ? { historyId: '100' } :
      path.endsWith('/history') ? { historyId: '103', history: [{ messagesAdded: [{ message: { id: 'seen' } }, { message: { id: 'fresh' } }] }] } :
      { id: 'fresh', internalDate: String(Date.now()), payload: { headers: [], mimeType: 'text/plain', body: { data: Buffer.from('Code: 483921').toString('base64url') } } };
    return { ok: true, status: 200, json: async () => data };
  };
  try {
    assert.equal(await getGmailHistoryId('token'), '100');
    const update = await findHistoryMessages('token', '100', ['seen']);
    assert.equal(update.historyId, '103');
    assert.deepEqual(update.messages.map(item => item.id), ['fresh']);
    assert.equal(calls.filter(path => path.endsWith('/fresh')).length, 1);
    assert.equal(calls.filter(path => path.endsWith('/seen')).length, 0);
  } finally { globalThis.fetch = original; }
});

test('expired Gmail history triggers a full-search fallback signal', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: false, status: 404 });
  try { await assert.rejects(findHistoryMessages('token', '1'), { message: 'HISTORY_EXPIRED' }); }
  finally { globalThis.fetch = original; }
});

test('apiFetch retries on 429 rate limit with backoff and succeeds on next attempt', async () => {
  const original = globalThis.fetch;
  let attempts = 0;
  globalThis.fetch = async () => {
    attempts++;
    if (attempts === 1) return { ok: false, status: 429, headers: new Headers() };
    return { ok: true, status: 200, json: async () => ({ messages: [] }) };
  };
  try {
    const res = await findMessages('token', 'test@example.com');
    assert.equal(attempts, 2);
    assert.deepEqual(res, []);
  } finally { globalThis.fetch = original; }
});

