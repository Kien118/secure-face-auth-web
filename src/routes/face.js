import { Router } from 'express';
import { InputError, validateAccountId } from '../services/face-engine.js';
import { LivenessChallenges } from '../services/liveness.js';

const ENROLL_FRAMES = { min: 3, max: 5 };
const SAME_PERSON_MAX = 0.45; // all enrollment frames must show the same person
const FACE_LOST = new Set(['NO_FACE', 'FACE_TOO_SMALL']);

function exactKeys(body, keys) {
  if (!body || typeof body !== 'object' || Array.isArray(body) ||
      Object.keys(body).sort().join(',') !== [...keys].sort().join(',')) throw new InputError('INVALID_PAYLOAD');
  return body;
}

const euclidean = (a, b) => Math.hypot(...a.map((v, i) => v - b[i]));

export function faceRoutes(engine, { analyzer, sessions, limiter, ...options } = {}) {
  const router = Router();
  const challenges = new LivenessChallenges(engine, { ...options, limiter });

  // Enrollment: the server measures several frames itself and stores their mean descriptor.
  router.post('/templates', async (req, res) => {
    const { accountId, frames } = exactKeys(req.body, ['accountId', 'frames']);
    validateAccountId(accountId);
    if (!Array.isArray(frames) || frames.length < ENROLL_FRAMES.min || frames.length > ENROLL_FRAMES.max) {
      throw new InputError('INVALID_FRAME');
    }
    if (engine.hasTemplate(accountId)) throw new InputError('TEMPLATE_EXISTS', 409);
    const descriptors = [];
    for (const frame of frames) descriptors.push((await analyzer.analyze(frame)).descriptor);
    for (let i = 0; i < descriptors.length; i++) {
      for (let j = i + 1; j < descriptors.length; j++) {
        if (euclidean(descriptors[i], descriptors[j]) > SAME_PERSON_MAX) throw new InputError('INCONSISTENT_FRAMES', 422);
      }
    }
    const descriptor = descriptors[0].map((_, k) => descriptors.reduce((sum, d) => sum + d[k], 0) / descriptors.length);
    res.status(201).json(engine.enroll({ accountId, descriptor }));
  });

  // Identity-only baseline (no liveness, never a session): kept for the demo comparison.
  router.post('/verify', async (req, res) => {
    const { accountId, frame } = exactKeys(req.body, ['accountId', 'frame']);
    validateAccountId(accountId);
    const { descriptor } = await analyzer.analyze(frame);
    res.json(engine.verify({ accountId, descriptor }));
  });

  router.post('/liveness/challenges', (req, res) => res.status(201).json(challenges.create(req.body)));

  router.post('/liveness/challenges/:id/samples', async (req, res) => {
    const accountId = challenges.accountOf(req.params.id);
    if (!accountId) throw new InputError('CHALLENGE_NOT_FOUND', 404);
    let evidence;
    const started = performance.now();
    try {
      const body = req.body;
      // sampleToken may be missing here; submit() rejects that as INVALID_SAMPLE_TOKEN.
      if (!body || typeof body !== 'object' || Array.isArray(body) || !('frame' in body) ||
          Object.keys(body).some(key => key !== 'frame' && key !== 'sampleToken')) throw new InputError('INVALID_PAYLOAD');
      evidence = { ...await analyzer.analyze(body.frame), sampleToken: body.sampleToken };
    } catch (error) {
      // A face briefly lost while turning is skipped: nothing is evaluated, the token is not rotated
      // and the step deadline keeps running, so retrying gives no advantage. Anything else ends the attempt.
      if (!FACE_LOST.has(error.code)) challenges.cancel(req.params.id);
      throw error;
    }
    const serverMs = Math.round(performance.now() - started);
    const result = { ...challenges.submit(req.params.id, evidence), serverMs };
    if (result.status === 'SEQUENCE_COMPLETE') {
      sessions.create(res, accountId, req.secure);
      return res.json({ ...result, accountId, authenticated: true });
    }
    res.json(result);
  });

  router.delete('/liveness/challenges/:id', (req, res) => {
    challenges.cancel(req.params.id);
    res.status(204).end();
  });

  router.get('/session', (req, res) => {
    const session = sessions.get(req);
    if (!session) return res.status(401).json({ status: 'NOT_AUTHENTICATED', authenticated: false });
    res.json({ status: 'AUTHENTICATED', authenticated: true, accountId: session.accountId, expiresAt: session.expiresAt });
  });

  router.post('/logout', (req, res) => {
    sessions.destroy(req, res);
    res.json({ status: 'LOGGED_OUT', authenticated: false });
  });

  // Right to erasure: only the logged-in owner can delete their own template.
  router.delete('/templates/me', (req, res) => {
    const session = sessions.get(req);
    if (!session) throw new InputError('NOT_AUTHENTICATED', 401);
    engine.removeTemplate(session.accountId);
    sessions.destroyAccount(session.accountId);
    sessions.destroy(req, res);
    res.json({ status: 'TEMPLATE_DELETED', authenticated: false });
  });

  return router;
}
