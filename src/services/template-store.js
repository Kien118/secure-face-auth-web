import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Map-like template store persisted to disk. Each template is sealed with AES-256-GCM and the
// account ID as additional authenticated data, so a template copied onto another account fails to decrypt.
// shortcut: one JSON file and a local key file are fine for a localhost demo; use a database and a KMS-held key in production.
export class EncryptedTemplateStore {
  #key;
  #records;
  constructor(dir, { key, modelVersion = 'face-api.js-0.22.2/faceRecognitionNet' } = {}) {
    mkdirSync(dir, { recursive: true });
    this.file = join(dir, 'templates.json');
    this.modelVersion = modelVersion;
    const keyFile = join(dir, 'template.key');
    if (key) this.#key = Buffer.from(key, 'hex');
    else if (existsSync(keyFile)) this.#key = readFileSync(keyFile);
    else { this.#key = randomBytes(32); writeFileSync(keyFile, this.#key, { mode: 0o600 }); }
    if (this.#key.length !== 32) throw new Error('TEMPLATE_KEY must be 32 bytes (64 hex characters).');
    this.#records = existsSync(this.file) ? JSON.parse(readFileSync(this.file, 'utf8')) : {};
  }
  get size() { return Object.keys(this.#records).length; }
  has(accountId) { return Object.hasOwn(this.#records, accountId); }
  get(accountId) {
    const record = this.#records[accountId];
    if (!record) return undefined;
    const decipher = createDecipheriv('aes-256-gcm', this.#key, Buffer.from(record.iv, 'base64'));
    decipher.setAAD(Buffer.from(accountId));
    decipher.setAuthTag(Buffer.from(record.tag, 'base64'));
    return JSON.parse(Buffer.concat([decipher.update(Buffer.from(record.data, 'base64')), decipher.final()]).toString());
  }
  set(accountId, descriptor) {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.#key, iv);
    cipher.setAAD(Buffer.from(accountId));
    const data = Buffer.concat([cipher.update(JSON.stringify(descriptor)), cipher.final()]);
    this.#records[accountId] = { iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'),
      data: data.toString('base64'), modelVersion: this.modelVersion, createdAt: new Date().toISOString() };
    this.#save();
    return this;
  }
  delete(accountId) {
    const existed = this.has(accountId);
    delete this.#records[accountId];
    this.#save();
    return existed;
  }
  #save() {
    const tmp = this.file + '.tmp';
    writeFileSync(tmp, JSON.stringify(this.#records, null, 2), { mode: 0o600 });
    renameSync(tmp, this.file); // atomic replace, a crash mid-write cannot corrupt the store
  }
}
