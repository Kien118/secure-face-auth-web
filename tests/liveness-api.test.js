import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';

const descriptor = (value = 0) => Array(128).fill(value);

// Synthetic geometry only; no recorded landmarks or real biometric data.
function landmarks({ closed = false, turned = false } = {}) {
  const points = Array.from({ length: 68 }, () => [0.5, 0.6]);
  const halfHeight = closed ? 0.005 : 0.015;
  for (const [index, center] of [[36, 0.35], [42, 0.65]]) {
    const eye = [[center - 0.05, 0.4], [center - 0.025, 0.4 - halfHeight],
      [center + 0.025, 0.4 - halfHeight], [center + 0.05, 0.4],
      [center + 0.025, 0.4 + halfHeight], [center - 0.025, 0.4 + halfHeight]];
    eye.forEach((point, offset) => { points[index + offset] = point; });
  }
  points[30] = [turned ? 0.425 : 0.5, 0.5];
  return points;
}

async function fixture(t, options = {}) {
  let time = 1000;
  const server = createApp({ liveness: { ...options, now: () => time } }).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const post = (path, body) => fetch(`${base}/${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  });
  const enroll = (accountId = 'alice', value = 0) => post('templates', { accountId, descriptor: descriptor(value) });
  const create = async (accountId = 'alice') => {
    const response = await post('liveness/challenges', { accountId });
    assert.equal(response.status, 201);
    return response.json();
  };
  const sample = (challengeId, body = { descriptor: descriptor(), landmarks: landmarks() }) => {
    time += 200;
    return post(`liveness/challenges/${challengeId}/samples`, body);
  };
  return { post, enroll, create, sample, advance: ms => { time += ms; },
    cancel: id => fetch(`${base}/liveness/challenges/${id}`, { method: 'DELETE' }) };
}

test('challenge creation requires a template and exact account-only schema; cancellation removes it', async t => {
  const f = await fixture(t);
  const missing = await f.post('liveness/challenges', { accountId: 'alice' });
  assert.equal(missing.status, 404);
  assert.equal((await missing.json()).status, 'NO_TEMPLATE');
  assert.equal((await f.enroll()).status, 201);
  for (const body of [{}, { accountId: '../alice' }, { accountId: 'alice', passed: true }]) {
    assert.equal((await f.post('liveness/challenges', body)).status, 400);
  }
  const created = await f.create();
  assert.equal(typeof created.challengeId, 'string');
  assert.equal(created.sequencePassed, false);
  assert.equal(created.authenticated, false);
  assert.equal((await f.cancel(created.challengeId)).status, 204);
  assert.equal((await f.sample(created.challengeId)).status, 404);
});

test('ordered identity-matched evidence completes a PoC sequence, consumes the challenge and never authenticates', async t => {
  const f = await fixture(t);
  await f.enroll();
  const { challengeId } = await f.create();
  const steps = [{}, { closed: true }, {}, { turned: true }, {}];
  let result;
  for (const [index, pose] of steps.entries()) {
    for (let frame = 0; frame < 2; frame++) {
      const response = await f.sample(challengeId, { descriptor: descriptor(), landmarks: landmarks(pose) });
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('set-cookie'), null);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.match(response.headers.get('content-security-policy'), /frame-ancestors 'none'/);
      result = await response.json();
      assert.equal(result.authenticated, false);
      assert.equal(result.liveness, 'UNVERIFIED_CLIENT_EVIDENCE');
      assert.equal(result.sequencePassed, index === steps.length - 1 && frame === 1);
    }
    assert.equal(result.step, index + 1);
  }
  assert.equal(result.status, 'SEQUENCE_COMPLETE');
  assert.equal(result.distance, 0);
  assert.equal((await f.sample(challengeId)).status, 404);
});

test('a stationary open-eyed face cannot complete the sequence or skip to a head turn', async t => {
  const f = await fixture(t);
  await f.enroll();
  const { challengeId } = await f.create();
  for (const pose of [{ turned: true }, { closed: true }, ...Array(12).fill({})]) {
    const response = await f.sample(challengeId, { descriptor: descriptor(), landmarks: landmarks(pose) });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.sequencePassed, false);
    assert.equal(result.authenticated, false);
    assert.ok(result.step <= 1);
  }
});

test('samples reject forged flags, alternate accounts and malformed evidence', async t => {
  const f = await fixture(t);
  await f.enroll();
  const valid = { descriptor: descriptor(), landmarks: landmarks() };
  const invalidPoints = landmarks(); invalidPoints[0][0] = Infinity;
  const bodies = [
    { ...valid, passed: true }, { ...valid, sequencePassed: true },
    { ...valid, authenticated: true }, { ...valid, accountId: 'bob' },
    { ...valid, step: 5 }, { descriptor: descriptor() },
    { ...valid, descriptor: descriptor().slice(1) },
    { ...valid, landmarks: landmarks().slice(1) },
    { ...valid, landmarks: invalidPoints },
    { ...valid, landmarks: Array.from({ length: 68 }, () => [0.5, 0.5]) }
  ];
  for (const body of bodies) {
    const { challengeId } = await f.create();
    assert.equal((await f.sample(challengeId, body)).status, 400);
    assert.equal((await f.sample(challengeId)).status, 404);
  }
});

test('sample requests retain the 8 KiB JSON limit', async t => {
  const f = await fixture(t);
  await f.enroll();
  const { challengeId } = await f.create();
  const response = await f.sample(challengeId, {
    descriptor: descriptor(), landmarks: landmarks(), padding: 'x'.repeat(9000)
  });
  assert.equal(response.status, 413);
  assert.equal((await response.json()).status, 'PAYLOAD_TOO_LARGE');
});

test('sample identity is checked against the server-bound account on every frame', async t => {
  const f = await fixture(t);
  await f.enroll('alice', 0);
  await f.enroll('bob', 1);
  const { challengeId } = await f.create('alice');
  assert.equal((await f.sample(challengeId)).status, 200);
  const response = await f.sample(challengeId, { descriptor: descriptor(1), landmarks: landmarks() });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.status, 'NO_MATCH');
  assert.equal(result.matched, false);
  assert.equal(result.liveness, 'NOT_EVALUATED');
  assert.equal(result.authenticated, false);
  assert.notEqual(result.sequencePassed, true);
  assert.equal(response.headers.get('set-cookie'), null);
  assert.equal((await f.sample(challengeId)).status, 404);
});

test('expired challenges fail closed using server time', async t => {
  const f = await fixture(t, { timeoutMs: 1000 });
  await f.enroll();
  const { challengeId } = await f.create();
  f.advance(1000);
  const response = await f.sample(challengeId);
  assert.equal(response.status, 410);
  assert.equal((await response.json()).status, 'CHALLENGE_EXPIRED');
  assert.equal((await f.sample(challengeId)).status, 404);
});
