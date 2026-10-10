import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
// Keep extension tests separate from the independently installed Cloud service.
const files = readdirSync('test').filter(name => name.endsWith('.test.js')).map(name => `test/${name}`);
const result = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' });
process.exit(result.status ?? 1);
