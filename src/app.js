import express from 'express';
import helmet from 'helmet';
import { fileURLToPath } from 'node:url';
import { FaceEngine, InputError } from './services/face-engine.js';
import { faceRoutes } from './routes/face.js';
import { FrameAnalyzer } from './services/face-analyzer.js';
import { AttemptLimiter, Sessions } from './services/sessions.js';

const publicDir = fileURLToPath(new URL('../public/', import.meta.url));
const browserBundle = fileURLToPath(new URL('../node_modules/face-api.js/dist/face-api.min.js', import.meta.url));

// Routes that carry JPEG frames get a larger body limit; everything else keeps the strict 8 KiB.
const FRAME_ROUTES = /^\/(templates|verify|liveness\/challenges\/[^/]+\/samples)$/;

export function createApp({ threshold = 0.6, liveness, analyzer = new FrameAnalyzer(), templateStore,
  sessions = new Sessions(), limiter = new AttemptLimiter() } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet({
    contentSecurityPolicy: { directives: {
      'default-src': ["'self'"], 'script-src': ["'self'"], 'style-src': ["'self'"],
      'connect-src': ["'self'"], 'img-src': ["'self'", 'data:'],
      'media-src': ["'self'", 'blob:'], 'object-src': ["'none'"],
      'frame-ancestors': ["'none'"], 'upgrade-insecure-requests': null
    } },
    // HTTPS must be terminated by a trusted proxy before any non-loopback use.
    strictTransportSecurity: false
  }));
  app.use((_req, res, next) => {
    res.set('Permissions-Policy', 'camera=(self), microphone=(), geolocation=()');
    res.set('Cache-Control', 'no-store');
    next();
  });
  app.use('/api', (req, _res, next) => {
    if (req.url.includes('?')) return next(new InputError('QUERY_NOT_ALLOWED'));
    if (req.method === 'POST') {
      if (!req.is('application/json')) return next(new InputError('JSON_REQUIRED', 415));
      if (req.get('Sec-Fetch-Site') === 'cross-site') return next(new InputError('CROSS_SITE_REQUEST', 403));
    }
    next();
  });
  const smallJson = express.json({ limit: '8kb', strict: true });
  const frameJson = express.json({ limit: '1mb', strict: true });
  app.use('/api', (req, res, next) => (FRAME_ROUTES.test(req.path) ? frameJson : smallJson)(req, res, next));
  app.get('/api/health', (_req, res) => res.json({ status: 'ok', mode: 'server-evidence-challenge',
    evidence: 'server-measured-frames', liveness: 'challenge-response', pad: false, sessions: true }));
  app.use('/api', faceRoutes(new FaceEngine(threshold, 100, templateStore), { ...liveness, analyzer, sessions, limiter }));
  app.get('/vendor/face-api.min.js', (_req, res) => res.sendFile(browserBundle));
  app.use(express.static(publicDir, { dotfiles: 'deny', index: 'index.html' }));
  app.use((_req, res) => res.status(404).json({ status: 'NOT_FOUND' }));
  app.use((err, _req, res, _next) => {
    if (err.type === 'entity.too.large') return res.status(413).json({ status: 'PAYLOAD_TOO_LARGE' });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ status: 'INVALID_JSON' });
    if (err instanceof InputError) return res.status(err.status).json({ status: err.code });
    // Never log the request body or error objects which may contain biometric input.
    res.status(500).json({ status: 'SERVER_ERROR' });
  });
  return app;
}
