import test from 'node:test';
import assert from 'node:assert/strict';
import { captureDescriptor, captureFace, loadModels } from '../public/js/face-client.js';

test('one-face gate rejects no/multiple faces and clears transient canvas', async t => {
  const original = globalThis.document;
  const canvas = { width: 0, height: 0, getContext: () => ({ drawImage() {} }) };
  globalThis.document = { createElement: () => canvas };
  t.after(() => { globalThis.document = original; });
  const video = { videoWidth: 640, videoHeight: 480, readyState: 2 };
  function api(faces) { return {
    TinyFaceDetectorOptions: class {},
    detectAllFaces: () => ({ withFaceLandmarks: tiny => {
      assert.equal(tiny, true); return { withFaceDescriptors: async () => faces };
    } })
  }; }
  for (const [faces, code] of [[[], 'NO_FACE'], [[{}, {}], 'MULTIPLE_FACES']]) {
    await assert.rejects(captureDescriptor(video, api(faces)), e => e.code === code);
    assert.equal(canvas.width, 0);
  }
  const descriptor = new Float32Array(128); // Synthetic only.
  const face = { descriptor, landmarks: { positions: Array.from({ length: 68 }, () => ({ x: 320, y: 240 })) } };
  assert.equal((await captureDescriptor(video, api([face]))).length, 128);
  const sample = await captureFace(video, api([face]));
  assert.deepEqual(sample.landmarks[0], [0.5, 0.375]);
  assert.equal(canvas.height, 0);
  await assert.rejects(captureDescriptor({}), e => e.code === 'CAMERA_NOT_READY');
});

test('model loader loads three networks and permits retry after failure', async () => {
  const failing = { loadFromUri: async () => { throw new Error('network'); } };
  await assert.rejects(loadModels({ nets: { tinyFaceDetector: failing,
    faceLandmark68TinyNet: failing, faceRecognitionNet: failing } }), e => e.code === 'MODEL_ERROR');
  let loads = 0;
  const net = { loadFromUri: async path => { assert.equal(path, '/models'); loads++; } };
  const api = { nets: { tinyFaceDetector: net, faceLandmark68TinyNet: net, faceRecognitionNet: net } };
  await loadModels(api); await loadModels(api);
  assert.equal(loads, 3);
});
