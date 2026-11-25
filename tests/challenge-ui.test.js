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
  assert.equal(updates.length, 2);
  assert.equal(calls.length, 3);
  assert.equal(calls.at(-1).options.method, 'DELETE');
});

test('cancel while inference is pending prevents sample POST and stale UI updates', async t => {
  let finishCapture; let captureStarted;
  const started = new Promise(resolve => { captureStarted = resolve; });
  const methods = []; let updates = 0;
  setup(t, async (_url, options) => { methods.push(options.method); return response(challenge()); }, () => {
    captureStarted(); return new Promise(resolve => { finishCapture = resolve; });
  });
  const controller = new AbortController();
  const run = runChallenge({ video, accountId: 'alice', signal: controller.signal, onUpdate: () => updates++ });
  await started;
  controller.abort(); finishCapture([face]);
  await assert.rejects(run, { name: 'AbortError' });
  assert.deepEqual(methods, ['POST', 'DELETE']);
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

test('a lost face skips frames without sending them and keeps the attempt alive', async t => {
  const methods = []; const updates = []; let captures = 0;
  setup(t, async (url, options) => {
    methods.push(options.method);
    return response(url.endsWith('/samples') ? { status: 'SEQUENCE_COMPLETE' } : challenge());
  }, async () => (++captures < 3 ? [] : [face]));
  const result = await runChallenge({ video, accountId: 'alice', signal: new AbortController().signal, onUpdate: r => updates.push(r) });
  assert.equal(result.status, 'SEQUENCE_COMPLETE');
  assert.deepEqual(methods, ['POST', 'POST', 'DELETE']); // create, one real sample, cleanup
  assert.equal(updates.filter(update => update.faceLost).length, 2);
});

test('multiple faces still end the attempt and never submit a sample', async t => {
  const methods = [];
  setup(t, async (_url, options) => { methods.push(options.method); return response(challenge()); }, async () => [face, face]);
  await assert.rejects(runChallenge({ video, accountId: 'alice', signal: new AbortController().signal, onUpdate() {} }), e => e.code === 'MULTIPLE_FACES');
  assert.deepEqual(methods, ['POST', 'DELETE']);
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
    return response(samples < 3 ? { ...challenge(), step: 4, action: 'level_head', sampleToken: String.fromCharCode(97 + samples).repeat(64) }
      : { status: 'SEQUENCE_COMPLETE', step: 5 });
  });
  const result = await runChallenge({ video, accountId: 'alice', signal: new AbortController().signal, onUpdate() {} });
  assert.equal(result.status, 'SEQUENCE_COMPLETE');
  assert.equal(samples, 3);
  assert.equal(spoken, 0, 'eyes stay open, so no spoken cue is needed');
});

test('deadline reached during inference prevents the sample from leaving the browser', async t => {
  let finishCapture; let captureStarted;
  const started = new Promise(resolve => { captureStarted = resolve; });
  const originalNow = Date.now; let now = originalNow();
  Date.now = () => now;
  t.after(() => { Date.now = originalNow; });
  const methods = [];
  setup(t, async (_url, options) => { methods.push(options.method); return response(challenge()); }, () => {
    captureStarted(); return new Promise(resolve => { finishCapture = resolve; });
  });
  const run = runChallenge({ video, accountId: 'alice', signal: new AbortController().signal, onUpdate() {} });
  await started;
  now += 15000; finishCapture([face]);
  await assert.rejects(run, e => e.code === 'STEP_EXPIRED');
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
