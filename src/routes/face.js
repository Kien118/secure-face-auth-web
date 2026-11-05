import { Router } from 'express';

export function faceRoutes(engine) {
  const router = Router();
  router.post('/templates', (req, res) => res.status(201).json(engine.enroll(req.body)));
  router.post('/verify', (req, res) => res.json(engine.verify(req.body)));
  return router;
}
