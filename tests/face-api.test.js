import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { FaceEngine, validatePayload } from '../src/services/face-engine.js';
import { readConfig } from '../src/config.js';

const vector = (value = 0) => Array(128).fill(value); // Synthetic numbers, no real biometrics.
const payload = (accountId = 'alice', value = 0) => ({ accountId, descriptor: vector(value) });

async function fixture(t, config = {}) {
  const server = createApp(config).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (path, body, headers = {}) => fetch(`${base}/api/${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body)
  });
  return { base, post };
}

test('backend starts, health and frontend/assets work with security headers', async t => {
  const { base } = await fixture(t);
  const res = await fetch(`${base}/api/health`);
  assert.equal(res.status, 200);
  assert.equal((await res.json()).status, 'ok');
  assert.match(res.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.match(res.headers.get('permissions-policy'), /camera=\(self\)/);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.equal(res.headers.get('x-powered-by'), null);
  for (const path of ['/', '/js/app.js', '/js/camera.js', '/js/face-client.js', '/vendor/face-api.min.js']) {
    assert.equal((await fetch(base + path)).status, 200, path);
  }
  assert.equal((await fetch(base + '/.env')).status, 404);
});

test('reject missing, wrong-type, wrong-dimension and out-of-range descriptors', async t => {
  const { post } = await fixture(t);
  for (const descriptor of [undefined, null, 'face', {}, [], vector().slice(1), [...vector(), 0],
    vector().map(() => '0'), vector().map(() => 11)]) {
    assert.equal((await post('templates', { accountId: 'alice', descriptor })).status, 400);
  }
  for (const accountId of ['', '../alice', 'a b', 'x'.repeat(65), {}, null]) {
    assert.equal((await post('templates', { accountId, descriptor: vector() })).status, 400);
  }
});

test('NaN and Infinity are rejected directly and as invalid or overflowing JSON', async t => {
  for (const value of [NaN, Infinity, -Infinity]) {
    const descriptor = vector(); descriptor[0] = value;
    assert.throws(() => validatePayload({ accountId: 'alice', descriptor }), /INVALID_DESCRIPTOR/);
  }
  const { post } = await fixture(t);
  for (const token of ['NaN', 'Infinity', '-Infinity', '1e400', 'null']) {
    const body = `{"accountId":"alice","descriptor":[${token},${vector().slice(1).join(',')}]}`;
    assert.equal((await post('templates', body)).status, 400);
  }
});

test('payload, content-type, query and cross-site limits fail safely', async t => {
  const { post } = await fixture(t);
  assert.equal((await post('templates', { ...payload(), padding: 'x'.repeat(10000) })).status, 413);
  assert.equal((await post('templates', payload(), { 'Content-Type': 'text/plain' })).status, 415);
  assert.equal((await post('templates?descriptor=forbidden', payload())).status, 400);
  assert.equal((await post('templates', payload(), { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
});

test('cannot force a match using client result flags', async t => {
  const { post } = await fixture(t);
  await post('templates', payload());
  for (const flag of ['matched', 'authenticated', 'distance', 'threshold', 'livenessPassed']) {
    assert.equal((await post('verify', { ...payload('alice', 1), [flag]: true })).status, 400);
  }
  const res = await post('verify', payload('alice', 1));
  const result = await res.json();
  assert.equal(result.matched, false);
  assert.equal(result.authenticated, false);
  assert.equal(res.headers.get('set-cookie'), null);
});

test('no template fails safely; enrollment and 1:1 distance match correctly', async t => {
  const { post } = await fixture(t);
  assert.equal((await post('verify', payload())).status, 404);
  assert.equal((await post('templates', payload())).status, 201);
  const result = await (await post('verify', payload())).json();
  assert.equal(result.distance, 0);
  assert.equal(result.matched, true);
  assert.equal(result.authenticated, false);
  assert.equal(result.liveness, 'NOT_IMPLEMENTED');
  assert.equal((await post('verify', payload('bob'))).status, 404);
  assert.equal((await post('templates', payload())).status, 409);
  const mismatch = await (await post('verify', payload('alice', 0.1))).json();
  assert.ok(mismatch.distance > mismatch.threshold);
  assert.equal(mismatch.matched, false);
});

test('templates are copied, bounded and isolated to server instance RAM', () => {
  const first = new FaceEngine(0.6, 1);
  const data = payload(); first.enroll(data); data.descriptor[0] = 1;
  assert.equal(first.verify(payload()).distance, 0);
  assert.throws(() => first.enroll(payload('bob')), /TEMPLATE_CAPACITY/);
  assert.throws(() => new FaceEngine().verify(payload()), /NO_TEMPLATE/);
});

test('threshold comes from validated config and boundary uses <=', () => {
  assert.equal(readConfig({ FACE_MATCH_THRESHOLD: '0.4' }).threshold, 0.4);
  for (const value of ['NaN', 'Infinity', '0', '-1', '3', '']) {
    assert.throws(() => readConfig({ FACE_MATCH_THRESHOLD: value }));
  }
  const engine = new FaceEngine(0.5); engine.enroll(payload());
  const probe = payload(); probe.descriptor[0] = 0.5;
  assert.equal(engine.verify(probe).matched, true);
  probe.descriptor[0] = 0.50001;
  assert.equal(engine.verify(probe).matched, false);
});
