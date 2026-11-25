import { randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { InputError, validateAccountId } from './face-engine.js';

const prompts = {
  look_straight: 'Look straight ahead and keep your eyes open.',
  // tilt_left/tilt_right follow the same raw-image convention as the turns: tilt_left moves the top of
  // the head toward image left, which is the user's own right shoulder.
  tilt_left: 'Keep looking at the screen. Tilt your head toward your right shoulder.',
  tilt_right: 'Keep looking at the screen. Tilt your head toward your left shoulder.',
  level_head: 'Straighten your head and look straight ahead.',
  // turn_left/turn_right name the nose direction in the raw (unmirrored) camera image, which is
  // opposite to the user's own side: turning to your right moves the nose toward image left.
  turn_left: 'Keep your eyes open. Turn your head slightly to your right.',
  turn_right: 'Keep your eyes open. Turn your head slightly to your left.',
  return_center: 'Keep your eyes open and return your head to the center.'
};
const sampleToken = () => randomBytes(32).toString('hex');
const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

export function measureLandmarks(points) {
  if (!Array.isArray(points) || points.length !== 68 || !Array.from(points).every(p =>
    Array.isArray(p) && p.length === 2 && Array.from(p).every(v =>
      typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1))) {
    throw new InputError('INVALID_LANDMARKS');
  }
  const eyes = [points.slice(36, 42), points.slice(42, 48)];
  const ratios = eyes.map(eye => {
    const width = distance(eye[0], eye[3]);
    if (width <= 1e-6) throw new InputError('INVALID_LANDMARKS');
    return (distance(eye[1], eye[5]) + distance(eye[2], eye[4])) / (2 * width);
  });
  const centers = eyes.map(eye => eye.reduce((sum, p) =>
    [sum[0] + p[0] / 6, sum[1] + p[1] / 6], [0, 0]));
  const axis = [centers[1][0] - centers[0][0], centers[1][1] - centers[0][1]];
  const axisSquared = axis[0] ** 2 + axis[1] ** 2;
  if (axisSquared <= 1e-12 || ratios.some(ratio => !Number.isFinite(ratio) || ratio > 1)) {
    throw new InputError('INVALID_LANDMARKS');
  }
  const midpoint = [(centers[0][0] + centers[1][0]) / 2, (centers[0][1] + centers[1][1]) / 2];
  const noseOffset = ((points[30][0] - midpoint[0]) * axis[0] +
    (points[30][1] - midpoint[1]) * axis[1]) / axisSquared;
  // Head roll: angle of the eye line in degrees. Negative = image-left eye lower = top of head toward image left.
  const roll = Math.atan2(axis[1], axis[0]) * 180 / Math.PI;
  return { ear: (ratios[0] + ratios[1]) / 2, noseOffset, roll };
}

export class LivenessChallenges {
  #challenges = new Map();
  constructor(engine, { now = Date.now, random = randomInt, timeoutMs = 45000, stepTimeoutMs = 15000, maxChallenges = 100,
    eyeOpen = 0.25, headTurn = 0.15, headCenter = 0.10, headTiltDeg = 12, headLevelDeg = 6, limiter = null } = {}) {
    if (typeof now !== 'function' || typeof random !== 'function' || !Number.isInteger(timeoutMs) || timeoutMs <= 0 ||
        !Number.isInteger(stepTimeoutMs) || stepTimeoutMs <= 0 ||
        !Number.isInteger(maxChallenges) || maxChallenges <= 0 ||
        ![eyeOpen, headTurn, headCenter, headTiltDeg, headLevelDeg].every(Number.isFinite) ||
        eyeOpen <= 0 || eyeOpen >= 1 || headLevelDeg <= 0 || headLevelDeg >= headTiltDeg || headTiltDeg >= 45 ||
        headCenter < 0 || headCenter >= headTurn || headTurn >= 1) {
      throw new Error('Invalid liveness configuration');
    }
    this.engine = engine;
    this.now = now;
    this.random = random;
    this.timeoutMs = timeoutMs;
    this.stepTimeoutMs = stepTimeoutMs;
    this.maxChallenges = maxChallenges;
    this.eyeOpen = eyeOpen;
    this.headTiltDeg = headTiltDeg;
    this.headLevelDeg = headLevelDeg;
    this.headTurn = headTurn;
    this.headCenter = headCenter;
    this.limiter = limiter;
  }
  accountOf(id) { return this.#challenges.get(id)?.accountId; }
  create(body) {
    if (!body || typeof body !== 'object' || Array.isArray(body) ||
        Object.keys(body).join(',') !== 'accountId') throw new InputError('INVALID_PAYLOAD');
    const accountId = validateAccountId(body.accountId);
    if (!this.engine.hasTemplate(accountId)) throw new InputError('NO_TEMPLATE', 404);
    if (this.limiter?.locked(accountId)) throw new InputError('LOCKED', 429);
    const now = this.now();
    for (const [id, challenge] of this.#challenges) {
      if (now >= challenge.stepExpiresAt) this.#challenges.delete(id);
    }
    if (this.#challenges.size >= this.maxChallenges) throw new InputError('CHALLENGE_CAPACITY', 503);
    const order = this.random(2);
    const direction = this.random(2);
    const tiltDirection = this.random(2);
    if (![order, direction, tiltDirection].every(value => value === 0 || value === 1)) throw new Error('Invalid liveness random source');
    // Tilt block: eyes stay open (prompts stay readable), measured from the eye line, presentable in a live demo.
    const tilt = [tiltDirection === 0 ? 'tilt_left' : 'tilt_right', 'level_head'];
    const turn = [direction === 0 ? 'turn_left' : 'turn_right', 'return_center'];
    const plan = ['look_straight', ...(order === 0 ? [...tilt, ...turn] : [...turn, ...tilt])];
    const challengeId = randomUUID();
    const challenge = { accountId, step: 0, consecutive: 0, lastSampleAt: null, neutralOffset: 0, neutralOffsetSum: 0,
      neutralRoll: 0, neutralRollSum: 0,
      plan, sampleToken: sampleToken(), expiresAt: now + this.timeoutMs,
      stepExpiresAt: now + Math.min(this.timeoutMs, this.stepTimeoutMs) };
    this.#challenges.set(challengeId, challenge);
    return { challengeId, ...this.#response(challenge) };
  }
  #response(challenge) {
    const complete = challenge.step === challenge.plan.length;
    const action = challenge.plan[challenge.step] ?? null;
    return { status: complete ? 'SEQUENCE_COMPLETE' : 'CHALLENGE_ACTIVE',
      step: challenge.step, totalSteps: challenge.plan.length, action,
      prompt: prompts[action] ?? 'PoC challenge sequence completed.',
      expiresAt: challenge.expiresAt, stepExpiresAt: challenge.stepExpiresAt, sequencePassed: complete,
      ...(!complete && { sampleToken: challenge.sampleToken }),
      // Evidence is measured by the server from submitted frames. This is challenge-response only, not PAD:
      // a responsive video or deepfake can still perform the actions.
      liveness: 'SERVER_MEASURED_CHALLENGE', authenticated: false };
  }
  submit(id, body) {
    const challenge = this.#challenges.get(id);
    if (!challenge) throw new InputError('CHALLENGE_NOT_FOUND', 404);
    try {
      const now = this.now();
      if (now >= challenge.expiresAt) throw new InputError('CHALLENGE_EXPIRED', 410);
      if (now >= challenge.stepExpiresAt) throw new InputError('STEP_EXPIRED', 410);
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new InputError('INVALID_PAYLOAD');
      if (typeof body.sampleToken !== 'string' || !/^[a-f0-9]{64}$/.test(body.sampleToken) ||
          !timingSafeEqual(Buffer.from(body.sampleToken, 'hex'), Buffer.from(challenge.sampleToken, 'hex'))) {
        throw new InputError('INVALID_SAMPLE_TOKEN');
      }
      if (Object.keys(body).sort().join(',') !== 'descriptor,landmarks,sampleToken') throw new InputError('INVALID_PAYLOAD');
      if (challenge.lastSampleAt !== null && now - challenge.lastSampleAt < 150) {
        throw new InputError('SAMPLE_TOO_FAST');
      }
      const identity = this.engine.verify({ accountId: challenge.accountId, descriptor: body.descriptor });
      const metrics = measureLandmarks(body.landmarks);
      if (!identity.matched) {
        this.#challenges.delete(id);
        this.limiter?.fail(challenge.accountId);
        return { ...identity, status: 'NO_MATCH', sequencePassed: false, liveness: 'NOT_EVALUATED', authenticated: false };
      }
      const offset = metrics.noseOffset - challenge.neutralOffset;
      const centered = Math.abs(offset) <= this.headCenter;
      const eyesOpen = metrics.ear >= this.eyeOpen;
      const action = challenge.plan[challenge.step];
      // Tilt is measured against this person's own neutral head roll from step 0.
      const tilt = metrics.roll - challenge.neutralRoll;
      const followsStep = action === 'tilt_left' ? eyesOpen && tilt <= -this.headTiltDeg
        : action === 'tilt_right' ? eyesOpen && tilt >= this.headTiltDeg
        : action === 'level_head' ? centered && eyesOpen && Math.abs(tilt) <= this.headLevelDeg
        : action === 'turn_left' ? eyesOpen && offset <= -this.headTurn
          : action === 'turn_right' ? eyesOpen && offset >= this.headTurn
            : centered && eyesOpen; // neutral pose: look_straight, return_center
      challenge.lastSampleAt = now;
      // The neutral baseline needs two samples with a stable head roll; an unstable pair restarts from this sample.
      if (challenge.step === 0 && followsStep && challenge.consecutive === 1 &&
          Math.abs(metrics.roll - challenge.neutralRollSum) > this.headLevelDeg) {
        challenge.consecutive = 0;
        challenge.neutralOffsetSum = 0;
        challenge.neutralRollSum = 0;
      }
      challenge.consecutive = followsStep ? challenge.consecutive + 1 : 0;
      if (challenge.step === 0) {
        challenge.neutralOffsetSum = followsStep ? challenge.neutralOffsetSum + metrics.noseOffset : 0;
        challenge.neutralRollSum = followsStep ? challenge.neutralRollSum + metrics.roll : 0;
        if (challenge.consecutive === 2) {
          challenge.neutralOffset = challenge.neutralOffsetSum / 2;
          challenge.neutralRoll = challenge.neutralRollSum / 2;
        }
      }
      if (challenge.consecutive === 2) {
        challenge.step++;
        challenge.consecutive = 0;
        challenge.stepExpiresAt = Math.min(now + this.stepTimeoutMs, challenge.expiresAt);
      }
      if (challenge.step === challenge.plan.length) { this.#challenges.delete(id); this.limiter?.reset(challenge.accountId); }
      else challenge.sampleToken = sampleToken();
      return { ...this.#response(challenge), ear: metrics.ear, noseOffset: metrics.noseOffset, tilt,
        distance: identity.distance, threshold: identity.threshold };
    } catch (error) {
      this.#challenges.delete(id);
      this.limiter?.fail(challenge.accountId);
      throw error;
    }
  }
  cancel(id) {
    this.#challenges.delete(id);
    return { status: 'CHALLENGE_CANCELLED', authenticated: false };
  }
}
