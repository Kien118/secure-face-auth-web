import test from 'node:test';
import assert from 'node:assert/strict';
import { captureFrame, captureFrames, loadModels } from '../public/js/face-client.js';

test('one-face gate rejects no/multiple faces, returns a JPEG frame and clears the transient canvas', async t => {
  const original = globalThis.document;
  const canvas = { width: 0, height: 0, getContext: () => ({ drawImage() {} }),
    toDataURL: (type, quality) => { assert.equal(type, 'image/jpeg'); assert.ok(quality > 0.5); return 'data:image/jpeg;base64,AAAA'; } };
  globalThis.document = { createElement: () => canvas };
  t.after(() => { globalThis.document = original; });
  const video = { videoWidth: 640, videoHeight: 480, readyState: 2 };
  const api = faces => ({ TinyFaceDetectorOptions: class {}, detectAllFaces: async () => faces });
  for (const [faces, code] of [[[], 'NO_FACE'], [[{}, {}], 'MULTIPLE_FACES']]) {
    await assert.rejects(captureFrame(video, api(faces)), e => e.code === code);
    assert.equal(canvas.width, 0);
  }
  // The browser sends only the image: no descriptor or landmarks leave the client.
  assert.equal(await captureFrame(video, api([{}])), 'data:image/jpeg;base64,AAAA');
  assert.equal(canvas.height, 0);
  assert.deepEqual(await captureFrames(video, 3, 0, api([{}])), Array(3).fill('data:image/jpeg;base64,AAAA'));
  await assert.rejects(captureFrame({}), e => e.code === 'CAMERA_NOT_READY');
});

test('model loader loads only the detector and permits retry after failure', async () => {
  const failing = { loadFromUri: async () => { throw new Error('network'); } };
  await assert.rejects(loadModels({ nets: { tinyFaceDetector: failing } }), e => e.code === 'MODEL_ERROR');
  let loads = 0;
  const net = { loadFromUri: async path => { assert.equal(path, '/models'); loads++; } };
  const api = { nets: { tinyFaceDetector: net } };
  await loadModels(api); await loadModels(api);
  assert.equal(loads, 1);
});
