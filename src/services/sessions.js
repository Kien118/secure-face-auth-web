import { randomBytes } from 'node:crypto';

const COOKIE = 'sid';

// Server-side sessions: the cookie carries only a random ID; all state stays on the server.
// shortcut: in-memory, lost on restart and single-process only; move to Redis/DB for more than one process.
export class Sessions {
  #sessions = new Map();
  constructor({ ttlMs = 30 * 60_000, now = Date.now } = {}) {
    this.ttlMs = ttlMs;
    this.now = now;
  }
  create(res, accountId, secure) {
    const id = randomBytes(32).toString('base64url'); // new ID every login, so no session fixation
    this.#sessions.set(id, { accountId, expiresAt: this.now() + this.ttlMs });
    res.append('Set-Cookie', `${COOKIE}=${id}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${this.ttlMs / 1000}${secure ? '; Secure' : ''}`);
  }
  get(req) {
    const id = readCookie(req);
    const session = id && this.#sessions.get(id);
    if (!session) return null;
    if (session.expiresAt <= this.now()) { this.#sessions.delete(id); return null; }
    return session;
  }
  destroy(req, res) {
    const id = readCookie(req);
    if (id) this.#sessions.delete(id);
    res.append('Set-Cookie', `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);
  }
  destroyAccount(accountId) {
    for (const [id, session] of this.#sessions) if (session.accountId === accountId) this.#sessions.delete(id);
  }
}

function readCookie(req) {
  for (const part of (req.get('Cookie') ?? '').split(';')) {
    const [name, ...value] = part.trim().split('=');
    if (name === COOKIE) return value.join('=');
  }
  return null;
}

// Per-account lockout after repeated failed attempts.
export class AttemptLimiter {
  #failures = new Map();
  constructor({ maxFailures = 5, lockMs = 5 * 60_000, now = Date.now } = {}) {
    this.maxFailures = maxFailures;
    this.lockMs = lockMs;
    this.now = now;
  }
  locked(accountId) { return (this.#failures.get(accountId)?.lockedUntil ?? 0) > this.now(); }
  fail(accountId) {
    const entry = this.#failures.get(accountId) ?? { count: 0, lockedUntil: 0 };
    entry.count++;
    if (entry.count >= this.maxFailures) { entry.count = 0; entry.lockedUntil = this.now() + this.lockMs; }
    this.#failures.set(accountId, entry);
  }
  reset(accountId) { this.#failures.delete(accountId); }
}
