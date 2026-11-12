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
    document: { createElement: () => ({ getContext: () => ({ drawImage() {} }) }) },
    faceapi: { TinyFaceDetectorOptions: class {}, detectAllFaces: () => ({
      withFaceLandmarks: () => ({ withFaceDescriptors: capture })
    }) }
  });
  t.after(() => Object.assign(globalThis, original));
}
function challenge() { return { challengeId: 'synthetic-id', status: 'CHALLENGE_ACTIVE', expiresAt: Date.now() + 45000 }; }

test('challenge sends only descriptor/landmarks and cleans up on completion', async t => {
  const calls = []; const updates = [];
  setup(t, async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/samples')) {
      assert.deepEqual(Object.keys(JSON.parse(options.body)).sort(), ['descriptor', 'landmarks']);
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

test('no face cancels server state and never submits a sample', async t => {
  const methods = [];
  setup(t, async (_url, options) => { methods.push(options.method); return response(challenge()); }, async () => []);
  await assert.rejects(runChallenge({ video, accountId: 'alice', signal: new AbortController().signal, onUpdate() {} }), e => e.code === 'NO_FACE');
  assert.deepEqual(methods, ['POST', 'DELETE']);
});

test('reopening step announces once and cancellation stops the speech cue', async t => {
  const original = { speechSynthesis: globalThis.speechSynthesis, SpeechSynthesisUtterance: globalThis.SpeechSynthesisUtterance };
  const spoken = []; let cancelled = 0; let samples = 0;
  Object.assign(globalThis, { speechSynthesis: { speak: cue => spoken.push(cue), cancel: () => cancelled++ },
    SpeechSynthesisUtterance: class { constructor(text) { this.text = text; } } });
  t.after(() => Object.assign(globalThis, original));
  setup(t, async (url) => url.endsWith('/samples') ? response(++samples < 3
    ? { status: 'CHALLENGE_ACTIVE', step: 2 } : { status: 'SEQUENCE_COMPLETE', step: 5 }) : response({ ...challenge(), step: 1 }));
  await runChallenge({ video, accountId: 'alice', signal: new AbortController().signal, onUpdate() {} });
  assert.equal(spoken.length, 1);
  assert.equal(spoken[0].lang, 'vi-VN');
  assert.match(spoken[0].text, /Mở mắt/);
  assert.equal(cancelled, 1);
});
