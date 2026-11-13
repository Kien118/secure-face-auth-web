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
function challenge() { return { challengeId: 'synthetic-id', status: 'CHALLENGE_ACTIVE',
  action: 'look_straight', sampleToken: 'a'.repeat(64),
  stepExpiresAt: Date.now() + 15000, expiresAt: Date.now() + 45000 }; }

test('challenge sends only descriptor/landmarks and cleans up on completion', async t => {
  const calls = []; const updates = [];
  setup(t, async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/samples')) {
      const body = JSON.parse(options.body);
      assert.deepEqual(Object.keys(body).sort(), ['descriptor', 'landmarks', 'sampleToken']);
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

test('no face cancels server state and never submits a sample', async t => {
  const methods = [];
  setup(t, async (_url, options) => { methods.push(options.method); return response(challenge()); }, async () => []);
  await assert.rejects(runChallenge({ video, accountId: 'alice', signal: new AbortController().signal, onUpdate() {} }), e => e.code === 'NO_FACE');
  assert.deepEqual(methods, ['POST', 'DELETE']);
});

test('reopening is announced by action after a randomized turn-first sequence', async t => {
  const original = { speechSynthesis: globalThis.speechSynthesis, SpeechSynthesisUtterance: globalThis.SpeechSynthesisUtterance };
  const spoken = []; let cancelled = 0; let samples = 0;
  Object.assign(globalThis, { speechSynthesis: { speak: cue => spoken.push(cue), cancel: () => cancelled++ },
    SpeechSynthesisUtterance: class { constructor(text) { this.text = text; } } });
  t.after(() => Object.assign(globalThis, original));
  setup(t, async (url, options) => {
    if (!url.endsWith('/samples')) return response({ ...challenge(), step: 3, action: 'close_eyes' });
    assert.equal(JSON.parse(options.body).sampleToken, String.fromCharCode(97 + samples).repeat(64));
    samples++;
    return response(samples < 3 ? { ...challenge(), step: 4, action: 'open_eyes', sampleToken: String.fromCharCode(97 + samples).repeat(64) }
      : { status: 'SEQUENCE_COMPLETE', step: 5 });
  });
  await runChallenge({ video, accountId: 'alice', signal: new AbortController().signal, onUpdate() {} });
  assert.equal(spoken.length, 1);
  assert.equal(spoken[0].lang, 'en-US');
  assert.match(spoken[0].text, /Open your eyes/);
  assert.equal(cancelled, 1);
});

test('an aborted inference cannot cancel the next attempt\'s spoken cue', async t => {
  const original = { speechSynthesis: globalThis.speechSynthesis, SpeechSynthesisUtterance: globalThis.SpeechSynthesisUtterance };
  const spoken = []; const deleted = []; const samples = new Map();
  let cancelled = 0; let captures = 0; let finishOld; let finishNew; let oldStarted; let newStarted;
  const oldPending = new Promise(resolve => { oldStarted = resolve; });
  const newPending = new Promise(resolve => { newStarted = resolve; });
  Object.assign(globalThis, { speechSynthesis: { speak: cue => spoken.push(cue), cancel: () => cancelled++ },
    SpeechSynthesisUtterance: class { constructor(text) { this.text = text; } } });
  t.after(() => Object.assign(globalThis, original));
  setup(t, async (url, options) => {
    if (options.method === 'DELETE') { deleted.push(url); return response({}); }
    if (!url.endsWith('/samples')) return response({ ...challenge(),
      challengeId: JSON.parse(options.body).accountId, action: 'close_eyes' });
    const count = (samples.get(url) ?? 0) + 1;
    samples.set(url, count);
    return response(count === 1 ? { ...challenge(), action: 'open_eyes' } : { status: 'SEQUENCE_COMPLETE' });
  }, async () => {
    captures++;
    if (captures === 2) { oldStarted(); return new Promise(resolve => { finishOld = resolve; }); }
    if (captures === 4) { newStarted(); return new Promise(resolve => { finishNew = resolve; }); }
    return [face];
  });
  const controller = new AbortController();
  const oldRun = runChallenge({ video, accountId: 'old', signal: controller.signal, onUpdate() {} });
  await oldPending;
  assert.equal(spoken.length, 1);
  controller.abort();
  assert.equal(cancelled, 1, 'abort cancels the owned cue before inference finishes');
  const newRun = runChallenge({ video, accountId: 'new', signal: new AbortController().signal, onUpdate() {} });
  await newPending;
  assert.equal(spoken.length, 2);
  finishOld([face]);
  await assert.rejects(oldRun, { name: 'AbortError' });
  assert.equal(cancelled, 1, 'old cleanup must leave the new cue playing');
  finishNew([face]);
  await newRun;
  assert.equal(cancelled, 2, 'the new attempt cleans up its own cue');
  assert.deepEqual(deleted, ['/api/liveness/challenges/old', '/api/liveness/challenges/new']);
});

test('speech failures do not prevent completion or server cleanup', async t => {
  const original = { speechSynthesis: globalThis.speechSynthesis, SpeechSynthesisUtterance: globalThis.SpeechSynthesisUtterance };
  let samples = 0; let deleted = false;
  Object.assign(globalThis, { speechSynthesis: {
    speak() { throw new Error('speech unavailable'); }, cancel() { throw new Error('speech unavailable'); }
  }, SpeechSynthesisUtterance: class {} });
  t.after(() => Object.assign(globalThis, original));
  setup(t, async (url, options) => {
    if (options.method === 'DELETE') { deleted = true; return response({}); }
    if (!url.endsWith('/samples')) return response({ ...challenge(), action: 'close_eyes' });
    return response(++samples === 1 ? { ...challenge(), action: 'open_eyes' } : { status: 'SEQUENCE_COMPLETE' });
  });
  const result = await runChallenge({ video, accountId: 'alice', signal: new AbortController().signal, onUpdate() {} });
  assert.equal(result.status, 'SEQUENCE_COMPLETE');
  assert.equal(deleted, true);
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
