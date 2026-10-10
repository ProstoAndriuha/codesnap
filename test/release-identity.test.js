import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

test('canonical Chrome package retains the previously configured Google OAuth identity', () => {
  const manifest = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
  const digest = createHash('sha256').update(Buffer.from(manifest.key, 'base64')).digest('hex').slice(0, 32);
  const id = [...digest].map(char => String.fromCharCode(97 + parseInt(char, 16))).join('');
  assert.equal(id, 'ongiekgidmkffdhgmjmlnjjgoggojoak');
  assert.equal(manifest.oauth2.client_id, '134116028146-e8kuhu4o1s5fgege6m3lgjf82o749pbq.apps.googleusercontent.com');
  assert.deepEqual(manifest.oauth2.scopes, ['https://www.googleapis.com/auth/gmail.readonly']);
});
