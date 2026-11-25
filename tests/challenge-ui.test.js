import test from 'node:test';
import assert from 'node:assert/strict';
import { runChallenge } from '../public/js/challenge-ui.js';

const video = { videoWidth: 640, videoHeight: 480, readyState: 2 };
const face = { descriptor: new Float32Array(128), landmarks: {
  positions: Array.from({ length: 68 }, () => ({ x: 320, y: 240 }))
} }; // Synthetic only; these tests check transport/lifecycle, not physical liveness.
const response = (body, ok = true) => ({ ok, json: async () => body });
function setup(t, fetcher, capture = async () => [face]) {
  const original = { fetch: globalThis.fetch, document: globalThis.document, faceapi: globalThis.faceapi };
  Object.assign(globalThis, {
    fetch: fetcher,
    document: { createElement: () => ({ getContext: () => ({ drawImage() {} }), toDataURL: () => 'data:image/jpeg;base64,AAAA' }) },
    faceapi: { TinyFaceDetectorOptions: class {}, detectAllFaces: () => capture() }
  });
  t.after(() => Object.assign(globalThis, original));
}
function challenge() { return { challengeId: 'synthetic-id', status: 'CHALLENGE_ACTIVE',
  action: 'look_straight', sampleToken: 'a'.repeat(64),
  stepExpiresAt: Date.now() + 15000, expiresAt: Date.now() + 45000 }; }

test('challenge sends only a JPEG frame and token, and cleans up on completion', async t => {
  const calls = []; const updates = [];
  setup(t, async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/samples')) {
      const body = JSON.parse(options.body);
      assert.deepEqual(Object.keys(body).sort(), ['frame', 'sampleToken']);
      assert.match(body.frame, /^data:image\/jpeg;base64,/);
      assert.equal(body.sampleToken, 'a'.repeat(64));
      return response({ status: 'SEQUENCE_COMPLETE', authenticated: false });
    }
    return response(challenge());
  });
  const result = await runChallenge({ video, accountId: 'alice', signal: new AbortController().signal, onUpdate: r => updates.push(r) });
  assert.equal(result.authenticated, false);
  assert.ok(Number.isFinite(result.roundTripMs)); // measured per sample and shown with the requirements
  assert.equal(updates.length, 2);
  assert.equal(calls.length, 3);
  assert.equal(calls.at(-1).options.method, 'DELETE');
});

test('cancel while a sample request is pending prevents stale UI updates', async t => {
  let finishSample; let sampleSent;
  const sent = new Promise(resolve => { sampleSent = resolve; });
  const methods = []; let updates = 0;
  setup(t, async (url, options) => {
    methods.push(options.method);
    if (!url.endsWith('/samples')) return response(challenge());
    sampleSent(); return new Promise(resolve => { finishSample = resolve; });
  });
  const controller = new AbortController();
  const run = runChallenge({ video, accountId: 'alice', signal: controller.signal, onUpdate: () => updates++ });
  await sent;
  controller.abort(); finishSample(response(challenge()));
  await assert.rejects(run, { name: 'AbortError' });
  assert.deepEqual(methods, ['POST', 'POST', 'DELETE']);
  assert.equal(updates, 1);
});
test('late create response after cancellation is deleted without capturing', async t => {
  let finishCreate; let called;
  const created = new Promise(resolve => { called = resolve; });
  const methods = [];
  setup(t, async (_url, options) => {
    methods.push(options.method);
    if (options.method === 'POST') { called(); return new Promise(resolve => { finishCreate = resolve; }); }
    return response({});
  });
  const controller = new AbortController();
  const run = runChallenge({ video, accountId: 'alice', signal: controller.signal, onUpdate: () => assert.fail('stale update') });
  await created;
  controller.abort(); finishCreate(response(challenge()));
  await assert.rejects(run, { name: 'AbortError' });
  assert.deepEqual(methods, ['POST', 'DELETE']);
});

test('challenge frames skip the local detector; a server NO_FACE is skipped and the attempt continues', async t => {
  const methods = []; const updates = []; let samples = 0;
  setup(t, async (url, options) => {
    methods.push(options.method);
    if (!url.endsWith('/samples')) return response(challenge());
    // The server's detector misses the first (turned) frame, then sees the face.
    return ++samples === 1 ? response({ status: 'NO_FACE' }, false) : response({ status: 'SEQUENCE_COMPLETE' });
  }, () => assert.fail('the browser must not run its own detector during a challenge'));
  const result = await runChallenge({ video, accountId: 'alice', signal: new AbortController().signal, onUpdate: r => updates.push(r) });
  assert.equal(result.status, 'SEQUENCE_COMPLETE');
  assert.deepEqual(methods, ['POST', 'POST', 'POST', 'DELETE']); // create, skipped sample, accepted sample, cleanup
  assert.equal(updates.filter(update => update.faceLost).length, 1);
});
test('a server MULTIPLE_FACES ends the attempt', async t => {
  const methods = [];
  setup(t, async (url, options) => {
    methods.push(options.method);
    return url.endsWith('/samples') ? response({ status: 'MULTIPLE_FACES' }, false) : response(challenge());
  });
  await assert.rejects(runChallenge({ video, accountId: 'alice', signal: new AbortController().signal, onUpdate() {} }), e => e.code === 'MULTIPLE_FACES');
  assert.deepEqual(methods, ['POST', 'POST', 'DELETE']);
});
test('each sample uses the latest token across a randomized turn-first sequence, without speech', async t => {
  const original = { speechSynthesis: globalThis.speechSynthesis };
  let spoken = 0; let samples = 0;
  globalThis.speechSynthesis = { speak: () => spoken++, cancel() {} };
  t.after(() => Object.assign(globalThis, original));
  setup(t, async (url, options) => {
    if (!url.endsWith('/samples')) return response({ ...challenge(), step: 3, action: 'tilt_left' });
    assert.equal(JSON.parse(options.body).sampleToken, String.fromCharCode(97 + samples).repeat(64));
    samples++;
    return response(samples < 3 ? { ...challenge(), step: 4, action: 'center', sampleToken: String.fromCharCode(97 + samples).repeat(64) }
      : { status: 'SEQUENCE_COMPLETE', step: 5 });
  });
  const result = await runChallenge({ video, accountId: 'alice', signal: new AbortController().signal, onUpdate() {} });
  assert.equal(result.status, 'SEQUENCE_COMPLETE');
  assert.equal(samples, 3);
  assert.equal(spoken, 0, 'eyes stay open, so no spoken cue is needed');
});

test('an expired step deadline stops the attempt before another sample leaves the browser', async t => {
  const methods = [];
  setup(t, async (_url, options) => { methods.push(options.method); return response({ ...challenge(), stepExpiresAt: Date.now() - 1 }); });
  await assert.rejects(runChallenge({ video, accountId: 'alice', signal: new AbortController().signal, onUpdate() {} }), e => e.code === 'STEP_EXPIRED');
  assert.deepEqual(methods, ['POST', 'DELETE']);
});
test('a lost sample response aborts the attempt without retrying the old token', async t => {
  const methods = []; let samples = 0; let updates = 0;
  setup(t, async (url, options) => {
    methods.push(options.method);
    if (url.endsWith('/samples')) { samples++; throw new TypeError('connection lost'); }
    return response(challenge());
  });
  await assert.rejects(runChallenge({ video, accountId: 'alice', signal: new AbortController().signal,
    onUpdate: () => updates++ }), /connection lost/);
  assert.equal(samples, 1);
  assert.equal(updates, 1);
  assert.deepEqual(methods, ['POST', 'POST', 'DELETE']);
});
