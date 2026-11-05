import { readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

let count = 0;
async function check(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) await check(path);
    else if (path.endsWith('.js')) {
      const result = spawnSync(process.execPath, ['--check', path], { stdio: 'inherit' });
      if (result.status !== 0) process.exit(1);
      count++;
    }
  }
}
for (const dir of ['src', 'public/js', 'scripts', 'tests']) await check(dir);
console.log(`Syntax checks passed: ${count} JavaScript files.`);
