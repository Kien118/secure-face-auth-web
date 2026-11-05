import express from 'express';
import helmet from 'helmet';
import { fileURLToPath } from 'node:url';
import { FaceEngine, InputError } from './services/face-engine.js';
import { faceRoutes } from './routes/face.js';

const publicDir = fileURLToPath(new URL('../public/', import.meta.url));
const browserBundle = fileURLToPath(new URL('../node_modules/face-api.js/dist/face-api.min.js', import.meta.url));

export function createApp({ threshold = 0.6 } = {}) {
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
  app.use('/api', express.json({ limit: '8kb', strict: true }));
  app.get('/api/health', (_req, res) => res.json({ status: 'ok', mode: 'identity-baseline', liveness: false }));
  app.use('/api', faceRoutes(new FaceEngine(threshold)));
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
