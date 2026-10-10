import test from 'node:test';
import assert from 'node:assert/strict';
import { SessionStore } from '../src/sessions.js';

test('sessions isolate tabs, origins and request IDs', () => {
  const sessions = new SessionStore();
  const a = sessions.start(1, 'https://www.binance.com', 'binance', { fieldId: 'field-a' }, 1000);
  const b = sessions.start(2, 'https://www.bybit.com', 'bybit', { fieldId: 'field-b' }, 1000);
  sessions.set(1, { ...a, timestamp: 1000, code: '483921' });
  sessions.set(2, { ...b, timestamp: 1000, code: 'A7K92P' });
  assert.equal(sessions.valid(1, a.origin, a.sessionId, 2000).code, '483921');
  assert.equal(sessions.valid(2, b.origin, b.sessionId, 2000).code, 'A7K92P');
  assert.equal(sessions.valid(1, b.origin, a.sessionId, 2000), null);
  assert.equal(sessions.valid(1, a.origin, b.sessionId, 2000), null);
  assert.equal(sessions.valid(1, a.origin, a.sessionId, 200_000), null);
  assert.equal(sessions.get(1).fieldId, 'field-a');
  assert.equal(sessions.get(2).fieldId, 'field-b');
});
