import test from 'node:test';
import assert from 'node:assert/strict';
import { FaceEngine } from '../src/services/face-engine.js';
import { LivenessChallenges, measureLandmarks } from '../src/services/liveness.js';

const descriptor = () => Array(128).fill(0); // Synthetic fixtures only; no captured biometric data.
function landmarks({ ear = 0.3, noseOffset = 0 } = {}) {
  const points = Array.from({ length: 68 }, () => [0.5, 0.5]);
  for (const [index, x] of [[36, 0.3], [42, 0.6]]) {
    const width = 0.1;
    const halfHeight = ear * width / 2;
    points.splice(index, 6, [x, 0.4], [x + width / 3, 0.4 - halfHeight],
      [x + 2 * width / 3, 0.4 - halfHeight], [x + width, 0.4],
      [x + 2 * width / 3, 0.4 + halfHeight], [x + width / 3, 0.4 + halfHeight]);
  }
  points[30] = [0.5 + noseOffset * 0.3, 0.6];
  return points;
}
function fixture(options = {}) {
  let time = 1000;
  const engine = new FaceEngine();
  engine.enroll({ accountId: 'alice', descriptor: descriptor() });
  const challenges = new LivenessChallenges(engine, { now: () => time, random: () => 0, ...options });
  const tokens = new Map();
  return { engine, challenges, advance: (ms = 200) => { time += ms; },
    create(body = { accountId: 'alice' }) {
      const result = challenges.create(body);
      tokens.set(result.challengeId, result.sampleToken);
      return result;
    },
    send(id, body) {
      const result = challenges.submit(id, { sampleToken: tokens.get(id), ...body });
      if (result.sampleToken) tokens.set(id, result.sampleToken);
      return result;
    },
    token: id => tokens.get(id),
    evidence: (pose = {}) => ({ descriptor: descriptor(), landmarks: landmarks(pose) }) };
}
function sample(f, id, pose = {}) {
  f.advance();
  return f.send(id, f.evidence(pose));
}

test('landmark measurements preserve EAR and nose displacement under in-plane rotation', () => {
  const points = landmarks({ ear: 0.3, noseOffset: -0.3 });
  const original = measureLandmarks(points);
  assert.ok(Math.abs(original.ear - 0.3) < 1e-10);
  assert.ok(Math.abs(original.noseOffset + 0.3) < 1e-10);
  const angle = Math.PI / 9;
  const rotated = points.map(([x, y]) => [0.5 + (x - 0.5) * Math.cos(angle) - (y - 0.5) * Math.sin(angle),
    0.5 + (x - 0.5) * Math.sin(angle) + (y - 0.5) * Math.cos(angle)]);
  const result = measureLandmarks(rotated);
  assert.ok(Math.abs(result.ear - original.ear) < 1e-10);
  assert.ok(Math.abs(result.noseOffset - original.noseOffset) < 1e-10);
});

test('complete ordered sequence checks every sample but never grants authentication', () => {
  const f = fixture();
  const created = f.create();
  const id = created.challengeId;
  assert.equal(created.totalSteps, 5);
  assert.equal(created.authenticated, false);
  let result;
  for (const pose of [{}, { ear: 0.1 }, {}, { noseOffset: -0.3 }, {}]) {
    const first = sample(f, id, pose);
    assert.equal(first.sequencePassed, false);
    result = sample(f, id, pose);
  }
  assert.equal(result.status, 'SEQUENCE_COMPLETE');
  assert.equal(result.step, 5);
  assert.equal(result.distance, 0);
  assert.equal(result.sequencePassed, true);
  assert.equal(result.liveness, 'UNVERIFIED_CLIENT_EVIDENCE');
  assert.equal(result.authenticated, false);
  assert.throws(() => sample(f, id), /CHALLENGE_NOT_FOUND/);
});

test('static poses and out-of-order actions cannot complete the sequence', () => {
  const f = fixture(); const { challengeId: id } = f.create();
  assert.equal(sample(f, id, { ear: 0.1 }).step, 0);
  sample(f, id); assert.equal(sample(f, id, { ear: 0.1 }).step, 0);
  sample(f, id); assert.equal(sample(f, id).step, 1);
  for (let i = 0; i < 8; i++) assert.equal(sample(f, id).step, 1);
  assert.equal(sample(f, id, { noseOffset: -0.3 }).step, 1);
  sample(f, id, { ear: 0.1 }); sample(f, id);
  assert.equal(sample(f, id, { ear: 0.1 }).step, 1);
  assert.equal(sample(f, id, { ear: 0.1 }).step, 2);
});

test('turn and return are measured relative to the initial neutral pose', () => {
  const f = fixture(); const { challengeId: id } = f.create();
  let result;
  for (const pose of [{ noseOffset: 0.08 }, { ear: 0.1, noseOffset: 0.08 },
    { noseOffset: 0.08 }, { noseOffset: -0.17 }, { noseOffset: 0.08 }]) {
    sample(f, id, pose); result = sample(f, id, pose);
  }
  assert.equal(result.status, 'SEQUENCE_COMPLETE');
});

test('wrong identity at a later step terminates the account-bound challenge', () => {
  const f = fixture(); const { challengeId: id } = f.create();
  sample(f, id); sample(f, id);
  const evidence = f.evidence({ ear: 0.1 }); evidence.descriptor.fill(1); f.advance();
  const result = f.send(id, evidence);
  assert.equal(result.status, 'NO_MATCH');
  assert.equal(result.authenticated, false);
  assert.equal(result.liveness, 'NOT_EVALUATED');
  assert.throws(() => sample(f, id), /CHALLENGE_NOT_FOUND/);
});

test('invalid evidence, fake flags, account replacement and geometry consume the challenge', () => {
  const invalid = [
    f => ({ ...f.evidence(), matched: true }),
    f => ({ ...f.evidence(), sequencePassed: true }),
    f => ({ ...f.evidence(), accountId: 'bob' }),
    f => ({ ...f.evidence(), descriptor: Array(127).fill(0) }),
    f => { const body = f.evidence(); body.landmarks[0] = [Infinity, 0]; return body; },
    f => ({ ...f.evidence(), landmarks: Array.from({ length: 68 }, () => [0.5, 0.5]) }),
    f => ({ ...f.evidence(), landmarks: landmarks().slice(1) })
  ];
  for (const make of invalid) {
    const f = fixture(); const { challengeId: id } = f.create();
    assert.throws(() => f.send(id, make(f)));
    assert.throws(() => sample(f, id), /CHALLENGE_NOT_FOUND/);
  }
  assert.throws(() => measureLandmarks(landmarks().map(p => p.map(() => '0'))), /INVALID_LANDMARKS/);
});

test('server time enforces sample spacing, expiry and cancellation', () => {
  const f = fixture({ timeoutMs: 1000 });
  const first = f.create().challengeId;
  f.send(first, f.evidence());
  f.advance(149);
  assert.throws(() => f.send(first, f.evidence()), /SAMPLE_TOO_FAST/);
  assert.throws(() => sample(f, first), /CHALLENGE_NOT_FOUND/);
  const expired = f.create().challengeId;
  f.advance(1000);
  assert.throws(() => f.send(expired, f.evidence()), /CHALLENGE_EXPIRED/);
  const cancelled = f.create().challengeId;
  assert.equal(f.challenges.cancel(cancelled).authenticated, false);
  assert.throws(() => sample(f, cancelled), /CHALLENGE_NOT_FOUND/);
});

test('creation validates account/template, caps RAM and reclaims expired challenges', () => {
  const f = fixture({ maxChallenges: 1, timeoutMs: 1000 });
  for (const body of [null, [], {}, { accountId: '../alice' }, { accountId: 'alice', matched: true }]) {
    assert.throws(() => f.create(body));
  }
  assert.throws(() => f.create({ accountId: 'bob' }), /NO_TEMPLATE/);
  const id = f.create().challengeId;
  assert.throws(() => f.create(), /CHALLENGE_CAPACITY/);
  f.advance(1000);
  const next = f.create().challengeId;
  assert.notEqual(next, id);
  assert.throws(() => sample(f, id), /CHALLENGE_NOT_FOUND/);
});

test('liveness configuration rejects non-finite and inverted thresholds', () => {
  for (const options of [{ timeoutMs: 0 }, { stepTimeoutMs: 0 }, { stepTimeoutMs: Infinity }, { random: null }, { maxChallenges: 0 }, { eyeOpen: NaN },
    { eyeClosed: 0.3 }, { eyeOpen: Infinity }, { headCenter: 0.2 }, { headTurn: -1 }]) {
    assert.throws(() => new LivenessChallenges(new FaceEngine(), options), /Invalid liveness configuration/);
  }
});

test('server randomizes both action order and turn direction without exposing future actions', () => {
  for (const order of [0, 1]) for (const direction of [0, 1]) {
    const choices = [order, direction];
    const f = fixture({ random: max => { assert.equal(max, 2); return choices.shift(); } });
    let result = f.create();
    const id = result.challengeId;
    const blink = ['close_eyes', 'open_eyes'];
    const turn = [direction === 0 ? 'turn_left' : 'turn_right', 'return_center'];
    const expected = ['look_straight', ...(order === 0 ? [...blink, ...turn] : [...turn, ...blink])];
    for (const action of expected) {
      assert.equal(result.action, action);
      assert.equal(result.plan, undefined);
      assert.equal(result.steps, undefined);
      const pose = action === 'close_eyes' ? { ear: 0.1 }
        : action === 'turn_left' ? { noseOffset: -0.3 }
          : action === 'turn_right' ? { noseOffset: 0.3 } : {};
      sample(f, id, pose); result = sample(f, id, pose);
    }
    assert.equal(result.status, 'SEQUENCE_COMPLETE');
    assert.equal(result.action, null);
    assert.equal(result.sampleToken, undefined);
    assert.equal(result.authenticated, false);
  }
  const f = fixture({ random: () => 2 });
  assert.throws(() => f.create(), /Invalid liveness random source/);
});

test('each accepted sample rotates its token, including a pose which does not advance', () => {
  const f = fixture(); const created = f.create(); const id = created.challengeId;
  assert.match(created.sampleToken, /^[a-f0-9]{64}$/);
  const wrongPose = sample(f, id, { ear: 0.1 });
  assert.equal(wrongPose.step, 0);
  assert.notEqual(wrongPose.sampleToken, created.sampleToken);
  f.advance();
  assert.throws(() => f.send(id, { ...f.evidence(), sampleToken: created.sampleToken }), /INVALID_SAMPLE_TOKEN/);
  assert.throws(() => sample(f, id), /CHALLENGE_NOT_FOUND/);
});

test('missing, malformed and cross-challenge tokens are rejected and consume the target challenge', () => {
  const f = fixture(); const first = f.create();
  const invalid = [undefined, null, 0, '', 'A'.repeat(64), 'g'.repeat(64), 'a'.repeat(63), first.sampleToken];
  for (const token of invalid) {
    const target = f.create();
    assert.throws(() => f.send(target.challengeId, { ...f.evidence(), sampleToken: token }), /INVALID_SAMPLE_TOKEN/);
    assert.throws(() => sample(f, target.challengeId), /CHALLENGE_NOT_FOUND/);
  }
  assert.equal(sample(f, first.challengeId).status, 'CHALLENGE_ACTIVE');
});

test('step deadlines use server time, reset only after advancement, and are bounded by total expiry', () => {
  const f = fixture({ stepTimeoutMs: 1000, timeoutMs: 3000, maxChallenges: 1 });
  let result = f.create(); const id = result.challengeId;
  assert.equal(result.stepExpiresAt, 2000);
  sample(f, id); result = sample(f, id);
  assert.equal(result.stepExpiresAt, 2400);
  f.advance(500);
  result = sample(f, id, { ear: 0.1 });
  assert.equal(result.stepExpiresAt, 2400);
  f.advance(300);
  assert.throws(() => sample(f, id, { ear: 0.1 }), /STEP_EXPIRED/);
  const second = f.create();
  f.advance(1000);
  assert.notEqual(f.create().challengeId, second.challengeId);
  assert.throws(() => sample(f, second.challengeId), /CHALLENGE_NOT_FOUND/);
  const short = fixture({ timeoutMs: 500, stepTimeoutMs: 15000 }).create();
  assert.equal(short.stepExpiresAt, short.expiresAt);
});
