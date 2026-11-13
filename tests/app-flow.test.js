import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};
class Element {
  constructor() { this.listeners = {}; this.dataset = {}; this.textContent = ''; this.hidden = false; this.disabled = false; }
  addEventListener(type, listener) { (this.listeners[type] ??= []).push(listener); }
  async emit(type) {
    if (type === 'click' && this.disabled) return;
    await Promise.all((this.listeners[type] ?? []).map(listener => listener({ target: this })));
  }
}

test('real app orchestration enforces consent, readiness, cancellation and fresh result state', async t => {
  const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  const nodes = Object.fromEntries([...html.matchAll(/\bid="([^"]+)"/g)].map(([, id]) => [id, new Element()]));
  nodes.account.value = 'demo-user'; nodes.consent.checked = false;
  Object.assign(nodes.video, { videoWidth: 640, videoHeight: 480, readyState: 2, play: async () => {} });
  const documentEvents = new Element(); const windowEvents = new Element();
  const modelsReady = deferred(); const modelStarted = deferred();
  const face = { descriptor: new Float32Array(128), landmarks: {
    positions: Array.from({ length: 68 }, () => ({ x: 320, y: 240 }))
  } }; // Synthetic only; no physical camera or face data is used.
  let modelLoads = 0; let cameraCalls = 0; let networkError = false;
  let capture = async () => [face];
  const tracks = []; const requests = [];
  const net = { loadFromUri: async () => {
    if (++modelLoads === 3) modelStarted.resolve();
    await modelsReady.promise;
  } };
  const replacements = {
    document: Object.assign(documentEvents, { hidden: false,
      getElementById: id => { assert.ok(nodes[id], `Missing actual page element: ${id}`); return nodes[id]; },
      createElement: () => ({ getContext: () => ({ drawImage() {} }) }) }),
    window: windowEvents,
    navigator: { mediaDevices: { getUserMedia: async options => {
      cameraCalls++; assert.equal(options.audio, false);
      const track = Object.assign(new Element(), { readyState: 'live', stopped: 0,
        stop() { this.stopped++; this.readyState = 'ended'; } });
      tracks.push(track);
      return { getTracks: () => [track], getVideoTracks: () => [track] };
    } } },
    faceapi: { nets: { tinyFaceDetector: net, faceLandmark68TinyNet: net, faceRecognitionNet: net },
      TinyFaceDetectorOptions: class {}, detectAllFaces: () => ({
        withFaceLandmarks: () => ({ withFaceDescriptors: () => capture() })
      }) },
    fetch: async (url, options) => {
      requests.push({ url, options });
      if (networkError) throw new TypeError('network unavailable');
      return { ok: true, json: async () => url.endsWith('/templates')
        ? { status: 'TEMPLATE_CREATED' }
        : { status: 'MATCH', distance: 0.2142, threshold: 0.6, authenticated: false } };
    }
  };
  const originals = Object.fromEntries(Object.keys(replacements).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(replacements)) {
    Object.defineProperty(globalThis, key, { value, writable: true, configurable: true });
  }
  t.after(() => {
    tracks.forEach(track => { if (track.readyState === 'live') track.stop(); });
    for (const [key, descriptor] of Object.entries(originals)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  await import(`../public/js/app.js?app-flow=${Date.now()}`);

  await t.test('camera requires consent and capture waits for both camera and models', async () => {
    await nodes.start.emit('click');
    assert.equal(cameraCalls, 0);
    assert.equal(nodes.status.dataset.code, 'CONSENT_REQUIRED');
    nodes.consent.checked = true;
    const starting = nodes.start.emit('click');
    await modelStarted.promise;
    assert.equal(cameraCalls, 1);
    for (const action of ['enroll', 'verify', 'challenge']) assert.equal(nodes[action].disabled, true);
    assert.equal(nodes.account.disabled, true);
    modelsReady.resolve(); await starting;
    for (const action of ['enroll', 'verify', 'challenge']) assert.equal(nodes[action].disabled, false);
    assert.equal(nodes.video.hidden, false);
    assert.equal(nodes['model-state'].textContent, 'Models ready');
  });

  await t.test('changing the idle account clears the previous identity result and progress', async () => {
    nodes.account.value = 'alice';
    await nodes.verify.emit('click');
    assert.equal(JSON.parse(requests.at(-1).options.body).accountId, 'alice');
    assert.equal(nodes.status.dataset.code, 'MATCH');
    assert.equal(nodes['metrics-panel'].hidden, false);
    nodes.account.value = 'bob'; await nodes.account.emit('input');
    assert.equal(nodes.status.dataset.code, 'ACCOUNT_CHANGED');
    assert.equal(nodes['metric-distance'].textContent, '—');
    assert.equal(nodes['metrics-panel'].hidden, true);
    assert.equal(nodes['result-placeholder'].hidden, false);
    assert.equal(nodes['challenge-panel'].dataset.state, 'idle');
    assert.equal(nodes['challenge-progress'].value, 0);
    assert.equal(nodes['challenge-step'].textContent, 'Not started');
  });

  await t.test('a network failure clears the previous successful match and its measurements', async () => {
    await nodes.verify.emit('click');
    assert.equal(nodes.status.dataset.code, 'MATCH');
    assert.equal(nodes['metric-distance'].textContent, '0.2142');
    assert.equal(nodes['metrics-panel'].hidden, false);
    assert.deepEqual(Object.keys(JSON.parse(requests.at(-1).options.body)).sort(), ['accountId', 'descriptor']);
    networkError = true; await nodes.verify.emit('click'); networkError = false;
    assert.equal(nodes.status.dataset.code, 'SERVER_ERROR');
    assert.equal(nodes['metric-distance'].textContent, '—');
    assert.equal(nodes['metrics-panel'].hidden, true);
    assert.equal(nodes['result-placeholder'].hidden, false);
  });

  await t.test('stop during enrollment or verification inference prevents POST and stale UI', async () => {
    for (const action of ['enroll', 'verify']) {
      const started = deferred(); const finish = deferred();
      capture = () => { started.resolve(); return finish.promise; };
      const pending = nodes[action].emit('click');
      await started.promise;
      const sent = requests.length;
      await nodes.stop.emit('click');
      finish.resolve([face]); await pending;
      assert.equal(requests.length, sent, action);
      assert.equal(nodes.status.dataset.code, 'CAMERA_STOPPED');
      assert.equal(nodes['metrics-panel'].hidden, true);
      assert.equal(nodes.video.srcObject, null);
      assert.equal(nodes.video.hidden, true);
      assert.equal(tracks.at(-1).stopped, 1);
      await nodes.start.emit('click');
    }
    capture = async () => [face];
  });

  await t.test('withdrawing consent stops media and disables capture without discarding loaded models', async () => {
    nodes.consent.checked = false; await nodes.consent.emit('change');
    assert.equal(tracks.at(-1).stopped, 1);
    assert.equal(nodes.video.srcObject, null);
    assert.equal(nodes['camera-state'].textContent, 'Camera off');
    assert.equal(nodes['model-state'].textContent, 'Models ready');
    for (const action of ['enroll', 'verify', 'challenge']) assert.equal(nodes[action].disabled, true);
    assert.ok(windowEvents.listeners.pagehide?.length);
    assert.ok(documentEvents.listeners.visibilitychange?.length);
  });
});
