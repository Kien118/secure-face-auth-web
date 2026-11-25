import test from 'node:test';
import assert from 'node:assert/strict';
import { randomInt } from 'node:crypto';
import { FaceEngine } from '../src/services/face-engine.js';
import { LivenessChallenges, measureLandmarks } from '../src/services/liveness.js';

const descriptor = () => Array(128).fill(0); // Synthetic fixtures only; no captured biometric data.
function tiltPoints(points, degrees) {
  const a = degrees * Math.PI / 180; // rotate about the image center; negative = image-left eye lower
  return points.map(([x, y]) => [0.5 + (x - 0.5) * Math.cos(a) - (y - 0.5) * Math.sin(a),
    0.5 + (x - 0.5) * Math.sin(a) + (y - 0.5) * Math.cos(a)]);
}
function landmarks({ ear = 0.3, noseOffset = 0, tilt = 0 } = {}) {
  const points = Array.from({ length: 68 }, () => [0.5, 0.5]);
  for (const [index, x] of [[36, 0.3], [42, 0.6]]) {
    const width = 0.1;
    const halfHeight = ear * width / 2;
    points.splice(index, 6, [x, 0.4], [x + width / 3, 0.4 - halfHeight],
      [x + 2 * width / 3, 0.4 - halfHeight], [x + width, 0.4],
      [x + 2 * width / 3, 0.4 + halfHeight], [x + width / 3, 0.4 + halfHeight]);
  }
  points[30] = [0.5 + noseOffset * 0.3, 0.6];
  return tilt ? tiltPoints(points, tilt) : points;
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

test('landmark measurements preserve EAR, nose displacement and mouth opening under in-plane rotation', () => {
  const points = landmarks({ ear: 0.3, noseOffset: -0.3 });
  const original = measureLandmarks(points);
  assert.ok(Math.abs(original.ear - 0.3) < 1e-10);
  assert.ok(Math.abs(original.noseOffset + 0.3) < 1e-10);
  assert.ok(Math.abs(original.roll) < 1e-10);
  const angle = Math.PI / 9;
  const rotated = points.map(([x, y]) => [0.5 + (x - 0.5) * Math.cos(angle) - (y - 0.5) * Math.sin(angle),
    0.5 + (x - 0.5) * Math.sin(angle) + (y - 0.5) * Math.cos(angle)]);
  const result = measureLandmarks(rotated);
  assert.ok(Math.abs(result.ear - original.ear) < 1e-10);
  assert.ok(Math.abs(result.noseOffset - original.noseOffset) < 1e-10);
  assert.ok(Math.abs(result.roll - 20) < 1e-10); // rotation by π/9 = 20° shows up only as roll
});

test('complete ordered sequence checks every sample but never grants authentication', () => {
  const f = fixture();
  const created = f.create();
  const id = created.challengeId;
  assert.equal(created.totalSteps, 4); // random() => 0: look_straight, turn_left, center, turn_left
  assert.equal(created.authenticated, false);
  let result;
  for (const pose of [{}, { noseOffset: -0.3 }, {}, { noseOffset: -0.3 }]) {
    const first = sample(f, id, pose);
    assert.equal(first.sequencePassed, false);
    result = sample(f, id, pose);
  }
  assert.equal(result.status, 'SEQUENCE_COMPLETE');
  assert.equal(result.step, 4);
  assert.equal(result.distance, 0);
  assert.equal(result.sequencePassed, true);
  assert.equal(result.liveness, 'SERVER_MEASURED_CHALLENGE');
  assert.equal(result.authenticated, false);
  assert.throws(() => sample(f, id), /CHALLENGE_NOT_FOUND/);
});

test('static poses, wrong poses and interrupted holds cannot complete the sequence', () => {
  const f = fixture(); const { challengeId: id } = f.create();
  // An unstable baseline (tilted, then level) restarts look_straight.
  assert.equal(sample(f, id, { tilt: -15 }).step, 0);
  sample(f, id); assert.equal(sample(f, id, { tilt: -15 }).step, 0);
  sample(f, id); assert.equal(sample(f, id).step, 1); // now turn_left
  for (let i = 0; i < 8; i++) assert.equal(sample(f, id).step, 1); // staying still never advances
  sample(f, id, { tilt: -15 }); assert.equal(sample(f, id, { tilt: -15 }).step, 1); // wrong pose
  sample(f, id, { noseOffset: -0.3 }); assert.equal(sample(f, id).step, 1); // interrupted hold resets
  sample(f, id, { noseOffset: -0.3 }); assert.equal(sample(f, id, { noseOffset: -0.3 }).step, 2); // now center
  sample(f, id, { tilt: -15 }); assert.equal(sample(f, id, { tilt: -15 }).step, 2); // tilted is not center
});

test('turn and return are measured relative to the initial neutral pose', () => {
  const f = fixture(); const { challengeId: id } = f.create();
  let result;
  // Baseline 0.08; -0.08 is only a turn (-0.16) relative to it, never in absolute terms.
  for (const pose of [{ noseOffset: 0.08 }, { noseOffset: -0.08 }, { noseOffset: 0.08 }, { noseOffset: -0.08 }]) {
    sample(f, id, pose); result = sample(f, id, pose);
  }
  assert.equal(result.status, 'SEQUENCE_COMPLETE');
});

test('wrong identity at a later step terminates the account-bound challenge', () => {
  const f = fixture(); const { challengeId: id } = f.create();
  sample(f, id); sample(f, id);
  const evidence = f.evidence({ tilt: -15 }); evidence.descriptor.fill(1); f.advance();
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
    { headTiltDeg: 5 }, { headLevelDeg: NaN }, { eyeOpen: Infinity }, { headCenter: 0.2 }, { headTurn: -1 }]) {
    assert.throws(() => new LivenessChallenges(new FaceEngine(), options), /Invalid liveness configuration/);
  }
});

const poseFor = action => ({ tilt_left: { tilt: -15 }, tilt_right: { tilt: 15 },
  turn_left: { noseOffset: -0.3 }, turn_right: { noseOffset: 0.3 } })[action] ?? {};

test('any pose can follow any other, with hidden random hold counts and no future actions exposed', () => {
  // Script: 5 actions; poses picked from "all poses except the previous one"; holds of 2 or 3 samples.
  const choices = [2, 3, 1, 2, 0, 2, 1, 1, 0, 0, 1];
  const maxima = [];
  const f = fixture({ random: max => { maxima.push(max); return choices.shift(); } });
  let result = f.create();
  const id = result.challengeId;
  assert.deepEqual(maxima, [3, 4, 2, 4, 2, 4, 2, 4, 2, 4, 2]);
  const expected = [['look_straight', 2], ['tilt_right', 3], ['turn_right', 2], ['tilt_left', 3], ['turn_left', 2], ['center', 3]];
  assert.equal(result.totalSteps, expected.length);
  for (const [step, [action, hold]] of expected.entries()) {
    assert.equal(result.action, action);
    for (const hidden of ['plan', 'steps', 'holds', 'hold']) assert.equal(result[hidden], undefined);
    for (let i = 1; i < hold; i++) assert.equal(sample(f, id, poseFor(action)).step, step, `${action} needs ${hold} samples`);
    result = sample(f, id, poseFor(action));
  }
  assert.equal(result.status, 'SEQUENCE_COMPLETE');
  assert.equal(result.action, null);
  assert.equal(result.sampleToken, undefined);
  assert.equal(result.authenticated, false);
  assert.throws(() => fixture({ random: () => 3 }).create(), /Invalid liveness random source/);
});

test('real randomness yields varied plans of 4-6 steps without repeated consecutive poses', () => {
  const f = fixture({ maxChallenges: 1000, random: randomInt });
  const plans = new Set();
  for (let n = 0; n < 300; n++) {
    let result = f.create();
    const id = result.challengeId;
    const actions = [];
    assert.ok(result.totalSteps >= 4 && result.totalSteps <= 6);
    while (result.status === 'CHALLENGE_ACTIVE') {
      if (actions.at(-1) !== result.action) actions.push(result.action);
      result = sample(f, id, poseFor(result.action));
    }
    assert.equal(actions.length, result.step); // each step differs from the previous one
    plans.add(actions.join('>'));
  }
  assert.ok(plans.size > 150, `only ${plans.size} distinct plans in 300 attempts`);
});

test('each accepted sample rotates its token, including a pose which does not advance', () => {
  const f = fixture(); const created = f.create(); const id = created.challengeId;
  assert.match(created.sampleToken, /^[a-f0-9]{64}$/);
  const wrongPose = sample(f, id, { tilt: -15 });
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
  result = sample(f, id, { tilt: -15 });
  assert.equal(result.stepExpiresAt, 2400);
  f.advance(300);
  assert.throws(() => sample(f, id, { tilt: -15 }), /STEP_EXPIRED/);
  const second = f.create();
  f.advance(1000);
  assert.notEqual(f.create().challengeId, second.challengeId);
  assert.throws(() => sample(f, second.challengeId), /CHALLENGE_NOT_FOUND/);
  const short = fixture({ timeoutMs: 500, stepTimeoutMs: 15000 }).create();
  assert.equal(short.stepExpiresAt, short.expiresAt);
});

test('each sample reports the requirements of the evaluated action, and they match the decision', () => {
  const f = fixture(); const { challengeId: id } = f.create(); // look_straight, turn_left, center, turn_left
  let result = sample(f, id);
  assert.equal(result.checksFor, 'look_straight');
  assert.deepEqual(result.checks.map(c => c.label), ['Identity distance', 'Eyes open (EAR)', 'Centered (|nose offset|)']);
  sample(f, id);
  result = sample(f, id, { noseOffset: -0.1 }); // not far enough for turn_left
  assert.equal(result.checksFor, 'turn_left');
  const turn = result.checks.find(c => c.label === 'Turn (nose offset)');
  assert.ok(Math.abs(turn.value - 0.1) < 1e-9);
  assert.deepEqual([turn.op, turn.target, turn.pass], ['≥', 0.15, false]);
  assert.equal(result.checks.find(c => c.label === 'Tilt, keep below (|°|)').pass, true);
  result = sample(f, id, { noseOffset: -0.3 });
  assert.ok(result.checks.every(c => c.pass));
  const mismatch = f.evidence(); mismatch.descriptor.fill(1); f.advance();
  result = f.send(id, mismatch);
  assert.equal(result.status, 'NO_MATCH');
  assert.deepEqual(result.checks.map(c => [c.label, c.pass]), [['Identity distance', false]]);
});
