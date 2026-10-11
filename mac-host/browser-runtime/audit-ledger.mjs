import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fail } from './contracts.mjs';

/** Private append-only per-process chain. No page content, session IDs or input values. */
export class AuditLedger {
  constructor(directory, { maxBytes = 10_000_000 } = {}) {
    this.directory = directory;
    this.maxBytes = maxBytes;
    this.bytes = 0;
    this.sequence = 0;
    this.previous = '0'.repeat(64);
    this.file = null;
    this.tail = Promise.resolve();
    this.closed = false;
    this.poisoned = false;
  }
  async initialize() {
    if (this.file) return;
    await fs.mkdir(this.directory, { recursive: true, mode: 0o700 });
    const st = await fs.lstat(this.directory);
    if (!st.isDirectory() || st.isSymbolicLink() || (st.mode & 0o077) ||
        (process.getuid && st.uid !== process.getuid())) fail('UNSAFE_AUDIT_DIRECTORY');
    this.path = path.join(this.directory, 'browser-v2-' + crypto.randomUUID() + '.jsonl');
    this.file = await fs.open(this.path, 'wx', 0o600);
  }
  append(event) {
    const work = this.tail.then(async () => {
      if (this.closed) fail('AUDIT_CLOSED');
      if (this.poisoned) fail('AUDIT_POISONED');
      await this.initialize();
      const allowed = ['event', 'request_id', 'browser', 'tab_ref', 'revision', 'outcome', 'duration_ms'];
      const fields = Object.fromEntries(allowed.filter(k => event[k] !== undefined).map(k => [k, event[k]]));
      const entry = { seq: this.sequence + 1, at: new Date().toISOString(), previous: this.previous, ...fields };
      const hash = crypto.createHash('sha256').update(JSON.stringify(entry)).digest('hex');
      const line = JSON.stringify({ ...entry, hash }) + '\n';
      if (this.bytes + Buffer.byteLength(line) > this.maxBytes) fail('AUDIT_CAPACITY');
      const written = await this.file.write(line);
      if (written.bytesWritten !== Buffer.byteLength(line)) fail('AUDIT_SHORT_WRITE');
      await this.file.sync();
      this.sequence++;
      this.previous = hash;
      this.bytes += Buffer.byteLength(line);
      return { sequence: this.sequence, hash };
    }).catch(error => { this.poisoned = true; throw error; });
    this.tail = work.catch(() => {});
    return work;
  }
  async close() {
    await this.tail;
    this.closed = true;
    if (this.file) await this.file.close();
  }
}
