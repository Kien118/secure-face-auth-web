import { randomUUID } from 'node:crypto';
import { InputError, validateAccountId } from './face-engine.js';

const prompts = [
  'Nhìn thẳng, giữ mắt mở.',
  'Nhìn thẳng, nhắm mắt và giữ đến khi được yêu cầu mở mắt.',
  'Mở mắt lại và nhìn thẳng.',
  'Giữ mắt mở, quay đầu để mũi lệch sang trái khung hình.',
  'Giữ mắt mở, đưa đầu về giữa khung hình.'
];
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
  return { ear: (ratios[0] + ratios[1]) / 2, noseOffset };
}

export class LivenessChallenges {
  #challenges = new Map();
  constructor(engine, { now = Date.now, timeoutMs = 45000, maxChallenges = 100,
    eyeOpen = 0.25, eyeClosed = 0.18, headTurn = 0.20, headCenter = 0.10 } = {}) {
    if (typeof now !== 'function' || !Number.isInteger(timeoutMs) || timeoutMs <= 0 ||
        !Number.isInteger(maxChallenges) || maxChallenges <= 0 ||
        ![eyeOpen, eyeClosed, headTurn, headCenter].every(Number.isFinite) ||
        eyeClosed <= 0 || eyeClosed >= eyeOpen || eyeOpen >= 1 ||
        headCenter < 0 || headCenter >= headTurn || headTurn >= 1) {
      throw new Error('Invalid liveness configuration');
    }
    this.engine = engine;
    this.now = now;
    this.timeoutMs = timeoutMs;
    this.maxChallenges = maxChallenges;
    this.eyeOpen = eyeOpen;
    this.eyeClosed = eyeClosed;
    this.headTurn = headTurn;
    this.headCenter = headCenter;
  }
  create(body) {
    if (!body || typeof body !== 'object' || Array.isArray(body) ||
        Object.keys(body).join(',') !== 'accountId') throw new InputError('INVALID_PAYLOAD');
    const accountId = validateAccountId(body.accountId);
    if (!this.engine.hasTemplate(accountId)) throw new InputError('NO_TEMPLATE', 404);
    const now = this.now();
    for (const [id, challenge] of this.#challenges) {
      if (now >= challenge.expiresAt) this.#challenges.delete(id);
    }
    if (this.#challenges.size >= this.maxChallenges) throw new InputError('CHALLENGE_CAPACITY', 503);
    const challengeId = randomUUID();
    const challenge = { accountId, step: 0, consecutive: 0, lastSampleAt: null, neutralOffset: 0, neutralOffsetSum: 0,
      expiresAt: now + this.timeoutMs };
    this.#challenges.set(challengeId, challenge);
    return { challengeId, ...this.#response(challenge) };
  }
  #response(challenge) {
    const complete = challenge.step === prompts.length;
    return { status: complete ? 'SEQUENCE_COMPLETE' : 'CHALLENGE_ACTIVE',
      step: challenge.step, totalSteps: prompts.length,
      prompt: prompts[challenge.step] ?? 'Đã hoàn thành chuỗi thử thách PoC.',
      expiresAt: challenge.expiresAt, sequencePassed: complete,
      // shortcut: client landmarks remain untrusted until independent PAD/evidence verification is implemented.
      liveness: 'UNVERIFIED_CLIENT_EVIDENCE', authenticated: false };
  }
  submit(id, body) {
    const challenge = this.#challenges.get(id);
    if (!challenge) throw new InputError('CHALLENGE_NOT_FOUND', 404);
    try {
      const now = this.now();
      if (now >= challenge.expiresAt) throw new InputError('CHALLENGE_EXPIRED', 410);
      if (!body || typeof body !== 'object' || Array.isArray(body) ||
          Object.keys(body).sort().join(',') !== 'descriptor,landmarks') throw new InputError('INVALID_PAYLOAD');
      if (challenge.lastSampleAt !== null && now - challenge.lastSampleAt < 150) {
        throw new InputError('SAMPLE_TOO_FAST');
      }
      const identity = this.engine.verify({ accountId: challenge.accountId, descriptor: body.descriptor });
      const metrics = measureLandmarks(body.landmarks);
      if (!identity.matched) {
        this.#challenges.delete(id);
        return { ...identity, status: 'NO_MATCH', sequencePassed: false, liveness: 'NOT_EVALUATED', authenticated: false };
      }
      const offset = metrics.noseOffset - challenge.neutralOffset;
      const centered = Math.abs(offset) <= this.headCenter;
      const eyesOpen = metrics.ear >= this.eyeOpen;
      const followsStep = challenge.step === 1 ? centered && metrics.ear <= this.eyeClosed
        : challenge.step === 3 ? eyesOpen && offset <= -this.headTurn
          : centered && eyesOpen;
      challenge.lastSampleAt = now;
      challenge.consecutive = followsStep ? challenge.consecutive + 1 : 0;
      if (challenge.step === 0) {
        challenge.neutralOffsetSum = followsStep ? challenge.neutralOffsetSum + metrics.noseOffset : 0;
        if (challenge.consecutive === 2) challenge.neutralOffset = challenge.neutralOffsetSum / 2;
      }
      if (challenge.consecutive === 2) { challenge.step++; challenge.consecutive = 0; }
      if (challenge.step === prompts.length) this.#challenges.delete(id);
      return { ...this.#response(challenge), ...metrics, distance: identity.distance, threshold: identity.threshold };
    } catch (error) {
      this.#challenges.delete(id);
      throw error;
    }
  }
  cancel(id) {
    this.#challenges.delete(id);
    return { status: 'CHALLENGE_CANCELLED', authenticated: false };
  }
}
