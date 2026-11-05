import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { checkAssets, modelsDir } from './model-assets.js';

// CPU tensor smoke test, not evidence of camera detection or real-user accuracy.
await checkAssets();
const require = createRequire(import.meta.url);
const faceapi = require('face-api.js');
await faceapi.nets.tinyFaceDetector.loadFromDisk(fileURLToPath(modelsDir));
await faceapi.nets.faceLandmark68TinyNet.loadFromDisk(fileURLToPath(modelsDir));
await faceapi.nets.faceRecognitionNet.loadFromDisk(fileURLToPath(modelsDir));
const input = faceapi.tf.zeros([150, 150, 3]);
try {
  const result = await faceapi.nets.faceRecognitionNet.computeFaceDescriptor(input);
  if (result.length !== 128 || !Array.from(result).every(Number.isFinite)) throw new Error('Invalid tensor inference');
  console.log('PASS: checksums, three model loads, synthetic tensor -> finite 128-dimensional descriptor.');
  console.log('Physical webcam/real-face detection: Pending. Synthetic tensor is not a real face test.');
} finally {
  input.dispose();
  faceapi.nets.tinyFaceDetector.dispose();
  faceapi.nets.faceLandmark68TinyNet.dispose();
  faceapi.nets.faceRecognitionNet.dispose();
}
