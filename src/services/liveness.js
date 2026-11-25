import { randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { InputError, validateAccountId } from './face-engine.js';

const prompts = {
  look_straight: 'Look straight ahead and keep your eyes open.',
  // tilt_left/tilt_right follow the same raw-image convention as the turns: tilt_left moves the top of
  // the head toward image left, which is the user's own right shoulder.
  tilt_left: 'Face the screen directly (do not turn), then tilt your head toward your right shoulder.',
  tilt_right: 'Face the screen directly (do not turn), then tilt your head toward your left shoulder.',
  // turn_left/turn_right name the nose direction in the raw (unmirrored) camera image, which is
  // opposite to the user's own side: turning to your right moves the nose toward image left.
  turn_left: 'Keep your head upright (no tilt) and turn your face slightly to your right.',
  turn_right: 'Keep your head upright (no tilt) and turn your face slightly to your left.',
  center: 'Face the screen directly with your head upright.'
};
// Target pose per action as [yaw, roll]: -1/1 = required direction, 0 = neutral.
const POSES = { center: [0, 0], turn_left: [-1, 0], turn_right: [1, 0], tilt_left: [0, -1], tilt_right: [0, 1] };
const MIN_STEPS = 3; // random 3..5 actions after look_straight
const STEP_CHOICES = 3;
const MIN_HOLD = 2; // random 2..3 consecutive samples per action, never sent to the client
const HOLD_CHOICES = 2;
const sampleToken = () => randomBytes(32).toString('hex');
const OPS = { '≥': (a, b) => a >= b, '≤': (a, b) => a <= b, '<': (a, b) => a < b };
// One requirement of the evaluated action: shown to the user as "value / op target", pass or fail.
const check = (label, value, op, target) => ({ label, value, op, target, pass: OPS[op](value, target) });
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
    const pick = max => {
      const value = this.random(max);
      if (!Number.isInteger(value) || value < 0 || value >= max) throw new Error('Invalid liveness random source');
      return value;
    };
    // Any pose may follow any other (no fixed "act then return" rhythm), with random length and hold
    // counts, so a video recorded from earlier attempts is unlikely to match a new plan or its timing.
    const plan = ['look_straight'];
    const holds = [2];
    for (let steps = MIN_STEPS + pick(STEP_CHOICES); steps > 0; steps--) {
      const previous = plan.at(-1) === 'look_straight' ? 'center' : plan.at(-1);
      const options = Object.keys(POSES).filter(pose => pose !== previous);
      plan.push(options[pick(options.length)]);
      holds.push(MIN_HOLD + pick(HOLD_CHOICES));
    }
    const challengeId = randomUUID();
    const challenge = { accountId, step: 0, consecutive: 0, lastSampleAt: null, neutralOffset: 0, neutralOffsetSum: 0,
      neutralRoll: 0, neutralRollSum: 0,
      plan, holds, sampleToken: sampleToken(), expiresAt: now + this.timeoutMs,
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
      const identityCheck = check('Identity distance', identity.distance, '≤', identity.threshold);
      if (!identity.matched) {
        this.#challenges.delete(id);
        this.limiter?.fail(challenge.accountId);
        return { ...identity, status: 'NO_MATCH', sequencePassed: false, liveness: 'NOT_EVALUATED', authenticated: false,
          checksFor: challenge.plan[challenge.step], checks: [identityCheck] };
      }
      const offset = metrics.noseOffset - challenge.neutralOffset;
      const action = challenge.plan[challenge.step];
      // Tilt is measured against this person's own neutral head roll from step 0.
      const tilt = metrics.roll - challenge.neutralRoll;
      const [yaw, roll] = POSES[action] ?? POSES.center;
      // A neutral axis must be strictly neutral only in the full center pose; while turning or tilting,
      // the other axis just must not be in a required pose itself. Directed values (yaw * offset,
      // roll * tilt) are positive when moving the requested way.
      const checks = [identityCheck, check('Eyes open (EAR)', metrics.ear, '≥', this.eyeOpen),
        yaw ? check('Turn (nose offset)', yaw * offset, '≥', this.headTurn)
          : roll ? check('Turn, keep below (|nose offset|)', Math.abs(offset), '<', this.headTurn)
            : check('Centered (|nose offset|)', Math.abs(offset), '≤', this.headCenter)];
      // look_straight measures the baseline roll itself, so it has no tilt requirement.
      if (action !== 'look_straight') {
        checks.push(roll ? check('Head tilt (°)', roll * tilt, '≥', this.headTiltDeg)
          : yaw ? check('Tilt, keep below (|°|)', Math.abs(tilt), '<', this.headTiltDeg)
            : check('Head level (|°|)', Math.abs(tilt), '≤', this.headLevelDeg));
      }
      const followsStep = checks.every(item => item.pass);
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
      if (challenge.consecutive === challenge.holds[challenge.step]) {
        challenge.step++;
        challenge.consecutive = 0;
        challenge.stepExpiresAt = Math.min(now + this.stepTimeoutMs, challenge.expiresAt);
      }
      if (challenge.step === challenge.plan.length) { this.#challenges.delete(id); this.limiter?.reset(challenge.accountId); }
      else challenge.sampleToken = sampleToken();
      return { ...this.#response(challenge), checksFor: action, checks, ear: metrics.ear, noseOffset: metrics.noseOffset, tilt,
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
