import { Router } from 'express';
import { LivenessChallenges } from '../services/liveness.js';

export function faceRoutes(engine, options) {
  const router = Router();
  const challenges = new LivenessChallenges(engine, options);
  router.post('/templates', (req, res) => res.status(201).json(engine.enroll(req.body)));
  router.post('/verify', (req, res) => res.json(engine.verify(req.body)));
  router.post('/liveness/challenges', (req, res) => res.status(201).json(challenges.create(req.body)));
  router.post('/liveness/challenges/:id/samples', (req, res) => res.json(challenges.submit(req.params.id, req.body)));
  router.delete('/liveness/challenges/:id', (req, res) => {
    challenges.cancel(req.params.id);
    res.status(204).end();
  });
  return router;
}
