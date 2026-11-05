import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { modelLock, modelsDir, sha256, checkAssets } from './model-assets.js';

const lock = JSON.parse(await readFile(modelLock, 'utf8'));
await mkdir(modelsDir, { recursive: true });
for (const asset of lock.assets) {
  const url = `https://raw.githubusercontent.com/justadudewhohacks/face-api.js/${lock.commit}/${asset.path}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(60000), redirect: 'error' });
  if (!res.ok) throw new Error(`Download failed (${res.status}): ${asset.name}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  if (sha256(bytes) !== asset.sha256) throw new Error(`Checksum mismatch: ${asset.name}`);
  await writeFile(new URL(asset.name, modelsDir), bytes);
  console.log(`Verified ${asset.name} (${bytes.length} bytes)`);
}
await checkAssets();
console.log('Model assets ready. No face images were downloaded.');
