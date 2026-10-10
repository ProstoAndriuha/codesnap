import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, readdir, unlink } from 'node:fs/promises';
import path from 'node:path';

export const ownerId = token => createHash('sha256').update(token).digest('hex');
export class Vault {
  constructor(directory, key) {
    if (!Buffer.isBuffer(key) || key.length !== 32) throw new Error('VAULT_KEY_INVALID');
    this.directory = directory; this.key = key; this.queue = Promise.resolve();
  }
  async init() { await mkdir(this.directory, { recursive: true, mode: 0o700 }); }
  file(owner) {
    if (!/^[a-f0-9]{64}$/.test(owner)) throw new Error('MAIL_AUTH_FAILED');
    return path.join(this.directory, `${owner}.enc`);
  }
  async read(owner) {
    let raw;
    try { raw = await readFile(this.file(owner)); }
    catch (error) { if (error.code === 'ENOENT') return []; throw new Error('MAIL_STORAGE_FAILED'); }
    try {
      const decipher = createDecipheriv('aes-256-gcm', this.key, raw.subarray(0, 12));
      decipher.setAAD(Buffer.from(owner)); decipher.setAuthTag(raw.subarray(12, 28));
      return JSON.parse(Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString());
    } catch { throw new Error('MAIL_STORAGE_FAILED'); }
  }
  update(owner, mutate) {
    const run = this.queue.then(async () => {
      const records = await this.read(owner);
      const result = await mutate(records);
      if (!records.length) { await unlink(this.file(owner)).catch(error => { if (error.code !== 'ENOENT') throw error; }); return result; }
      const count = (await readdir(this.directory)).filter(name => name.endsWith('.enc')).length;
      if (count >= 2000 && !(await this.read(owner)).length) throw new Error('MAIL_CAPACITY');
      const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', this.key, iv);
      cipher.setAAD(Buffer.from(owner));
      const encrypted = Buffer.concat([cipher.update(JSON.stringify(records)), cipher.final()]);
      const target = this.file(owner), temporary = `${target}.tmp`;
      await writeFile(temporary, Buffer.concat([iv, cipher.getAuthTag(), encrypted]), { mode: 0o600 });
      await rename(temporary, target);
      return result;
    });
    this.queue = run.catch(() => {}); return run;
  }
}
