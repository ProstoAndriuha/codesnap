import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

function walk(dir) { return readdirSync(dir, { withFileTypes: true }).flatMap(item => item.isDirectory() ? walk(join(dir, item.name)) : [join(dir, item.name)]); }
for (const file of [...walk('src'), ...walk('scripts'), ...walk('test')].filter(name => name.endsWith('.js'))) {
  const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
const manifest = JSON.parse(readFileSync('manifest.json', 'utf8'));
if (manifest.manifest_version !== 3 || manifest.host_permissions.some(p => p.includes('*://') || p.includes('<all_urls>'))) throw new Error('Manifest permissions too broad');
if (manifest.content_scripts?.[0]?.matches?.join() !== 'https://*/*') throw new Error('HTTPS content script coverage missing');
console.log('Syntax and manifest checks passed.');
