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
  const challenges = new LivenessChallenges(engine, { now: () => time, ...options });
  return { engine, challenges, advance: (ms = 200) => { time += ms; },
    evidence: (pose = {}) => ({ descriptor: descriptor(), landmarks: landmarks(pose) }) };
}
function sample(f, id, pose = {}) {
  f.advance();
  return f.challenges.submit(id, f.evidence(pose));
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
  const created = f.challenges.create({ accountId: 'alice' });
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
  const f = fixture(); const { challengeId: id } = f.challenges.create({ accountId: 'alice' });
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
  const f = fixture(); const { challengeId: id } = f.challenges.create({ accountId: 'alice' });
  let result;
  for (const pose of [{ noseOffset: 0.08 }, { ear: 0.1, noseOffset: 0.08 },
    { noseOffset: 0.08 }, { noseOffset: -0.17 }, { noseOffset: 0.08 }]) {
    sample(f, id, pose); result = sample(f, id, pose);
  }
  assert.equal(result.status, 'SEQUENCE_COMPLETE');
});

test('wrong identity at a later step terminates the account-bound challenge', () => {
  const f = fixture(); const { challengeId: id } = f.challenges.create({ accountId: 'alice' });
  sample(f, id); sample(f, id);
  const evidence = f.evidence({ ear: 0.1 }); evidence.descriptor.fill(1); f.advance();
  const result = f.challenges.submit(id, evidence);
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
    const f = fixture(); const { challengeId: id } = f.challenges.create({ accountId: 'alice' });
    assert.throws(() => f.challenges.submit(id, make(f)));
    assert.throws(() => sample(f, id), /CHALLENGE_NOT_FOUND/);
  }
  assert.throws(() => measureLandmarks(landmarks().map(p => p.map(() => '0'))), /INVALID_LANDMARKS/);
});

test('server time enforces sample spacing, expiry and cancellation', () => {
  const f = fixture({ timeoutMs: 1000 });
  const first = f.challenges.create({ accountId: 'alice' }).challengeId;
  f.challenges.submit(first, f.evidence());
  f.advance(149);
  assert.throws(() => f.challenges.submit(first, f.evidence()), /SAMPLE_TOO_FAST/);
  assert.throws(() => sample(f, first), /CHALLENGE_NOT_FOUND/);
  const expired = f.challenges.create({ accountId: 'alice' }).challengeId;
  f.advance(1000);
  assert.throws(() => f.challenges.submit(expired, f.evidence()), /CHALLENGE_EXPIRED/);
  const cancelled = f.challenges.create({ accountId: 'alice' }).challengeId;
  assert.equal(f.challenges.cancel(cancelled).authenticated, false);
  assert.throws(() => sample(f, cancelled), /CHALLENGE_NOT_FOUND/);
});

test('creation validates account/template, caps RAM and reclaims expired challenges', () => {
  const f = fixture({ maxChallenges: 1, timeoutMs: 1000 });
  for (const body of [null, [], {}, { accountId: '../alice' }, { accountId: 'alice', matched: true }]) {
    assert.throws(() => f.challenges.create(body));
  }
  assert.throws(() => f.challenges.create({ accountId: 'bob' }), /NO_TEMPLATE/);
  const id = f.challenges.create({ accountId: 'alice' }).challengeId;
  assert.throws(() => f.challenges.create({ accountId: 'alice' }), /CHALLENGE_CAPACITY/);
  f.advance(1000);
  const next = f.challenges.create({ accountId: 'alice' }).challengeId;
  assert.notEqual(next, id);
  assert.throws(() => sample(f, id), /CHALLENGE_NOT_FOUND/);
});

test('liveness configuration rejects non-finite and inverted thresholds', () => {
  for (const options of [{ timeoutMs: 0 }, { maxChallenges: 0 }, { eyeOpen: NaN },
    { eyeClosed: 0.3 }, { eyeOpen: Infinity }, { headCenter: 0.2 }, { headTurn: -1 }]) {
    assert.throws(() => new LivenessChallenges(new FaceEngine(), options), /Invalid liveness configuration/);
  }
});
