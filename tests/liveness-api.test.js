import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { AttemptLimiter } from '../src/services/sessions.js';
import { syntheticAnalyzer, syntheticFrame } from './synthetic-analyzer.js';

const descriptor = (value = 0) => Array(128).fill(value);

// Synthetic geometry only; no recorded landmarks or real biometric data.
function tiltPoints(points, degrees) {
  const a = degrees * Math.PI / 180; // rotate about the image center; negative = image-left eye lower
  return points.map(([x, y]) => [0.5 + (x - 0.5) * Math.cos(a) - (y - 0.5) * Math.sin(a),
    0.5 + (x - 0.5) * Math.sin(a) + (y - 0.5) * Math.cos(a)]);
}

function landmarks({ tilted = false, turned = false } = {}) {
  const points = Array.from({ length: 68 }, () => [0.5, 0.6]);
  const halfHeight = 0.015;
  for (const [index, center] of [[36, 0.35], [42, 0.65]]) {
    const eye = [[center - 0.05, 0.4], [center - 0.025, 0.4 - halfHeight],
      [center + 0.025, 0.4 - halfHeight], [center + 0.05, 0.4],
      [center + 0.025, 0.4 + halfHeight], [center - 0.025, 0.4 + halfHeight]];
    eye.forEach((point, offset) => { points[index + offset] = point; });
  }
  points[30] = [turned ? 0.425 : 0.5, 0.5];
  return tilted ? tiltPoints(points, -15) : points; // -15°: top of head toward image left (tilt_left)
}

async function fixture(t, options = {}, { limiter = new AttemptLimiter({ maxFailures: 1000 }) } = {}) {
  let time = 1000;
  const server = createApp({ liveness: { random: () => 0, ...options, now: () => time },
    analyzer: syntheticAnalyzer, limiter }).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const post = (path, body, headers = {}) => fetch(`${base}/${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body)
  });
  const enroll = (accountId = 'alice', value = 0) => post('templates', {
    accountId, frames: Array(3).fill(syntheticFrame({ descriptor: descriptor(value), landmarks: landmarks() }))
  });
  const tokens = new Map();
  const create = async (accountId = 'alice') => {
    const response = await post('liveness/challenges', { accountId });
    assert.equal(response.status, 201);
    const result = await response.json();
    tokens.set(result.challengeId, result.sampleToken);
    return result;
  };
  // Synthetic evidence (descriptor/landmarks) is wrapped into a frame, as the browser would send a JPEG.
  const sample = async (challengeId, { descriptor: d = descriptor(), landmarks: l = landmarks(), ...rest } = {}) => {
    time += 200;
    const evidence = {};
    if (d !== null) evidence.descriptor = d;
    if (l !== null) evidence.landmarks = l;
    const response = await post(`liveness/challenges/${challengeId}/samples`,
      { sampleToken: tokens.get(challengeId), frame: syntheticFrame(evidence), ...rest });
    if (response.ok) {
      const result = await response.clone().json();
      if (result.sampleToken) tokens.set(challengeId, result.sampleToken);
    }
    return response;
  };
  return { base, post, enroll, create, sample, advance: ms => { time += ms; },
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
  assert.equal(created.action, 'look_straight');
  assert.match(created.sampleToken, /^[a-f0-9]{64}$/);
  assert.ok(created.stepExpiresAt <= created.expiresAt);
  assert.equal((await f.cancel(created.challengeId)).status, 204);
  assert.equal((await f.sample(created.challengeId)).status, 404);
});

test('ordered server-measured evidence completes the sequence, consumes the challenge and only then issues a session', async t => {
  const f = await fixture(t);
  await f.enroll();
  const { challengeId } = await f.create();
  // random() => 0 yields look_straight, turn_left, center, turn_left, each held for 2 samples.
  const steps = [{}, { turned: true }, {}, { turned: true }];
  let result;
  let cookie;
  for (const [index, pose] of steps.entries()) {
    for (let frame = 0; frame < 2; frame++) {
      const response = await f.sample(challengeId, { descriptor: descriptor(), landmarks: landmarks(pose) });
      const last = index === steps.length - 1 && frame === 1;
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.match(response.headers.get('content-security-policy'), /frame-ancestors 'none'/);
      result = await response.json();
      assert.equal(result.liveness, 'SERVER_MEASURED_CHALLENGE');
      assert.equal(result.sequencePassed, last);
      assert.equal(result.authenticated, last);
      if (last) cookie = response.headers.get('set-cookie');
      else assert.equal(response.headers.get('set-cookie'), null);
    }
    assert.equal(result.step, index + 1);
  }
  assert.equal(result.status, 'SEQUENCE_COMPLETE');
  assert.equal(result.accountId, 'alice');
  assert.equal(result.distance, 0);
  assert.equal(result.sampleToken, undefined);
  assert.match(cookie, /^sid=[\w-]{43}; HttpOnly; SameSite=Strict; Path=\//);
  assert.equal((await f.sample(challengeId)).status, 404);

  const sid = cookie.split(';')[0];
  const session = await fetch(`${f.base}/session`, { headers: { Cookie: sid } });
  assert.equal(session.status, 200);
  assert.equal((await session.json()).accountId, 'alice');
  assert.equal((await fetch(`${f.base}/session`)).status, 401);
  assert.equal((await f.post('logout', {}, { Cookie: sid })).status, 200);
  assert.equal((await fetch(`${f.base}/session`, { headers: { Cookie: sid } })).status, 401);
});

test('a stationary open-eyed face cannot complete the sequence or skip to a head turn', async t => {
  const f = await fixture(t);
  await f.enroll();
  const { challengeId } = await f.create();
  for (const pose of [{ turned: true }, { tilted: true }, ...Array(12).fill({})]) {
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
    { ...valid, step: 5 }, { descriptor: descriptor(), landmarks: null }, { frame: 'data:image/png;base64,AAAA' },
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

test('sample requests are limited to 1 MB of JSON', async t => {
  const f = await fixture(t);
  await f.enroll();
  const { challengeId } = await f.create();
  const response = await f.sample(challengeId, {
    padding: 'x'.repeat(1_100_000)
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

test('stale tokens cannot replay or advance concurrent sample requests twice', async t => {
  const f = await fixture(t);
  await f.enroll();
  const created = await f.create();
  const body = { descriptor: descriptor(), landmarks: landmarks(), sampleToken: created.sampleToken };
  const responses = await Promise.all([f.sample(created.challengeId, body), f.sample(created.challengeId, body)]);
  assert.deepEqual(responses.map(response => response.status).sort(), [200, 400]);
  const accepted = await responses.find(response => response.status === 200).json();
  const rejected = await responses.find(response => response.status === 400).json();
  assert.equal(accepted.step, 0);
  assert.equal(accepted.sequencePassed, false);
  assert.notEqual(accepted.sampleToken, created.sampleToken);
  assert.equal(accepted.authenticated, false);
  assert.equal(rejected.status, 'INVALID_SAMPLE_TOKEN');
  assert.equal((await f.sample(created.challengeId)).status, 404);
});

test('missing and cross-challenge tokens cannot substitute for the target request token', async t => {
  const f = await fixture(t);
  await f.enroll();
  const first = await f.create();
  for (const sampleToken of [undefined, 'invalid', first.sampleToken]) {
    const target = await f.create();
    const response = await f.sample(target.challengeId, { descriptor: descriptor(), landmarks: landmarks(), sampleToken });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).status, 'INVALID_SAMPLE_TOKEN');
    assert.equal((await f.sample(target.challengeId)).status, 404);
  }
  assert.equal((await f.sample(first.challengeId)).status, 200);
});

test('step deadline expires before total deadline even with a valid current token', async t => {
  const f = await fixture(t, { stepTimeoutMs: 1000, timeoutMs: 5000 });
  await f.enroll();
  const created = await f.create();
  f.advance(1000);
  const response = await f.sample(created.challengeId);
  assert.equal(response.status, 410);
  assert.equal((await response.json()).status, 'STEP_EXPIRED');
  assert.equal((await f.sample(created.challengeId)).status, 404);
});
