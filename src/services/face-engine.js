export class InputError extends Error {
  constructor(code, status = 400) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

export function validatePayload(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body) ||
      Object.keys(body).sort().join(',') !== 'accountId,descriptor') {
    throw new InputError('INVALID_PAYLOAD');
  }
  if (typeof body.accountId !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(body.accountId)) {
    throw new InputError('INVALID_ACCOUNT');
  }
  const d = body.descriptor;
  if (!Array.isArray(d) || d.length !== 128 ||
      !Array.from(d).every(v => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 10)) {
    throw new InputError('INVALID_DESCRIPTOR');
  }
  return { accountId: body.accountId, descriptor: [...d] };
}

export class FaceEngine {
  #templates = new Map();
  constructor(threshold = 0.6, maxTemplates = 100) {
    if (!Number.isFinite(threshold) || threshold <= 0 || threshold > 2) throw new Error('Invalid threshold');
    this.threshold = threshold;
    this.maxTemplates = maxTemplates;
  }
  enroll(body) {
    const { accountId, descriptor } = validatePayload(body);
    if (this.#templates.has(accountId)) throw new InputError('TEMPLATE_EXISTS', 409);
    if (this.#templates.size >= this.maxTemplates) throw new InputError('TEMPLATE_CAPACITY', 503);
    this.#templates.set(accountId, descriptor);
    return { status: 'TEMPLATE_CREATED', temporary: true };
  }
  verify(body) {
    const { accountId, descriptor } = validatePayload(body);
    const reference = this.#templates.get(accountId);
    if (!reference) throw new InputError('NO_TEMPLATE', 404);
    const distance = Math.hypot(...descriptor.map((v, i) => v - reference[i]));
    const matched = distance <= this.threshold;
    return { status: matched ? 'MATCH' : 'NO_MATCH', matched, distance,
      threshold: this.threshold, liveness: 'NOT_IMPLEMENTED', authenticated: false };
  }
}
