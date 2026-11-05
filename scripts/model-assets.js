import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

export const modelsDir = new URL('../public/models/', import.meta.url);
export const modelLock = new URL('../models.lock.json', import.meta.url);
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export async function checkAssets() {
  const lock = JSON.parse(await readFile(modelLock, 'utf8'));
  for (const asset of lock.assets) {
    const bytes = await readFile(new URL(asset.name, modelsDir));
    if (sha256(bytes) !== asset.sha256) throw new Error(`Checksum mismatch: ${asset.name}`);
  }
  return lock;
}
