export function readConfig(env = process.env) {
  const threshold = Number(env.FACE_MATCH_THRESHOLD ?? '0.6');
  const port = Number(env.PORT ?? '3000');
  if (!Number.isFinite(threshold) || threshold <= 0 || threshold > 2) {
    throw new Error('FACE_MATCH_THRESHOLD must be finite and in (0, 2].');
  }
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error('PORT must be an integer in [0, 65535].');
  }
  return { threshold, port, host: env.HOST ?? '127.0.0.1' };
}
