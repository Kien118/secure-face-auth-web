import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../src/app.js';
import { EncryptedTemplateStore } from '../src/services/template-store.js';
import { AttemptLimiter } from '../src/services/sessions.js';
import { syntheticAnalyzer, syntheticFrame } from './synthetic-analyzer.js';

const vector = (value = 0) => Array(128).fill(value); // Synthetic numbers only.

function tiltPoints(points, degrees) {
  const a = degrees * Math.PI / 180; // rotate about the image center; negative = image-left eye lower
  return points.map(([x, y]) => [0.5 + (x - 0.5) * Math.cos(a) - (y - 0.5) * Math.sin(a),
    0.5 + (x - 0.5) * Math.sin(a) + (y - 0.5) * Math.cos(a)]);
}

function landmarks({ tilted = false, turned = false } = {}) {
  const points = Array.from({ length: 68 }, () => [0.5, 0.6]);
  const half = 0.015;
  for (const [index, c] of [[36, 0.35], [42, 0.65]]) {
    [[c - 0.05, 0.4], [c - 0.025, 0.4 - half], [c + 0.025, 0.4 - half], [c + 0.05, 0.4],
      [c + 0.025, 0.4 + half], [c - 0.025, 0.4 + half]].forEach((p, o) => { points[index + o] = p; });
  }
  points[30] = [turned ? 0.425 : 0.5, 0.5];
  return tilted ? tiltPoints(points, -15) : points; // -15°: top of head toward image left (tilt_left)
}
const frame = (value = 0, pose) => syntheticFrame({ descriptor: vector(value), landmarks: landmarks(pose) });

async function fixture(t, options = {}) {
  let time = 1000;
  const server = createApp({ analyzer: syntheticAnalyzer, liveness: { random: () => 0, now: () => time }, ...options })
    .listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const call = (path, body, { method = 'POST', cookie } = {}) => fetch(`${base}/${path}`, {
    method, headers: { 'Content-Type': 'application/json', ...(cookie && { Cookie: cookie }) },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const enroll = (accountId = 'alice', value = 0) => call('templates', { accountId, frames: [frame(value), frame(value), frame(value)] });
  async function login(accountId = 'alice', value = 0) {
    const created = await (await call('liveness/challenges', { accountId })).json();
    let token = created.sampleToken; let response;
    for (const pose of [{}, { turned: true }, {}, { turned: true }, {}, { turned: true }]) { // plan for random() => 0
      for (let i = 0; i < 2; i++) {
        time += 200;
        response = await call(`liveness/challenges/${created.challengeId}/samples`, { frame: frame(value, pose), sampleToken: token });
        token = (await response.clone().json()).sampleToken;
      }
    }
    return response;
  }
  return { call, enroll, login, advance: ms => { time += ms; } };
}

test('repeated identity mismatches lock the account and block new challenges', async t => {
  const f = await fixture(t, { limiter: new AttemptLimiter({ maxFailures: 3, lockMs: 60_000 }) });
  await f.enroll('alice', 0);
  for (let i = 0; i < 3; i++) {
    const { challengeId, sampleToken } = await (await f.call('liveness/challenges', { accountId: 'alice' })).json();
    const paused = await (await f.call(`liveness/challenges/${challengeId}/samples`, { frame: frame(1), sampleToken })).json();
    assert.equal(paused.status, 'IDENTITY_RETRY'); // the one retry does not count as a failure
    const resumed = await (await f.call(`liveness/challenges/${challengeId}/resume`, { sampleToken: paused.sampleToken })).json();
    f.advance(200);
    const result = await (await f.call(`liveness/challenges/${challengeId}/samples`, { frame: frame(1), sampleToken: resumed.sampleToken })).json();
    assert.equal(result.status, 'NO_MATCH');
  }
  const locked = await f.call('liveness/challenges', { accountId: 'alice' });
  assert.equal(locked.status, 429);
  assert.equal((await locked.json()).status, 'LOCKED');
});

test('a lost face is skipped without advancing, while multiple faces end the attempt', async t => {
  const f = await fixture(t);
  await f.enroll();
  const { challengeId, sampleToken } = await (await f.call('liveness/challenges', { accountId: 'alice' })).json();
  const lost = await f.call(`liveness/challenges/${challengeId}/samples`, { frame: syntheticFrame({ face: 'none' }), sampleToken });
  assert.equal(lost.status, 422);
  assert.equal(lost.headers.get('set-cookie'), null);
  f.advance(200);
  const next = await f.call(`liveness/challenges/${challengeId}/samples`, { frame: frame(), sampleToken }); // same token still valid
  assert.equal(next.status, 200);
  const state = await next.json();
  assert.equal(state.step, 0);
  f.advance(200);
  const many = await f.call(`liveness/challenges/${challengeId}/samples`, { frame: syntheticFrame({ face: 'many' }), sampleToken: state.sampleToken });
  assert.equal(many.status, 422);
  f.advance(200);
  assert.equal((await f.call(`liveness/challenges/${challengeId}/samples`, { frame: frame(), sampleToken: state.sampleToken })).status, 404);
});

test('the identity-only baseline never issues a session, even on a perfect match', async t => {
  const f = await fixture(t);
  await f.enroll();
  const response = await f.call('verify', { accountId: 'alice', frame: frame() });
  assert.equal((await response.json()).matched, true);
  assert.equal(response.headers.get('set-cookie'), null);
});

test('only the logged-in owner can delete their template; deletion ends the session', async t => {
  const f = await fixture(t);
  await f.enroll();
  assert.equal((await f.call('templates/me', undefined, { method: 'DELETE' })).status, 401);
  const login = await f.login();
  assert.equal((await login.json()).authenticated, true);
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const deleted = await f.call('templates/me', undefined, { method: 'DELETE', cookie });
  assert.equal(deleted.status, 200);
  assert.equal((await f.call('session', undefined, { method: 'GET', cookie })).status, 401);
  assert.equal((await f.call('liveness/challenges', { accountId: 'alice' })).status, 404);
  assert.equal((await f.enroll()).status, 201); // can re-enroll after deletion
});

test('encrypted store persists templates and rejects tampering or swapping between accounts', t => {
  const dir = mkdtempSync(join(tmpdir(), 'templates-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const store = new EncryptedTemplateStore(dir);
  store.set('alice', vector(0.1));
  store.set('bob', vector(0.2));
  const raw = readFileSync(join(dir, 'templates.json'), 'utf8');
  assert.doesNotMatch(raw, /0\.1/); // no plaintext descriptor values on disk
  assert.deepEqual(new EncryptedTemplateStore(dir).get('alice'), vector(0.1)); // survives restart

  const records = JSON.parse(raw);
  records.alice = { ...records.bob }; // attacker copies Bob's template onto Alice's account
  writeFileSync(join(dir, 'templates.json'), JSON.stringify(records));
  assert.throws(() => new EncryptedTemplateStore(dir).get('alice'), /authenticate/);

  const other = mkdtempSync(join(tmpdir(), 'templates-'));
  t.after(() => rmSync(other, { recursive: true, force: true }));
  writeFileSync(join(other, 'templates.json'), raw); // stolen file without the key
  assert.throws(() => new EncryptedTemplateStore(other).get('alice'), /authenticate/);
});
