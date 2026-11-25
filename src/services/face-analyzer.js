import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { InputError } from './face-engine.js';

// Server-side evidence: the browser sends raw JPEG frames and the server measures them itself,
// so a modified client can no longer submit made-up descriptors or landmarks.
const require = createRequire(import.meta.url);
const modelDir = fileURLToPath(new URL('../../public/models/', import.meta.url));
const wasmDir = fileURLToPath(new URL('../../node_modules/@tensorflow/tfjs-backend-wasm/dist/', import.meta.url));
const FRAME_RE = /^data:image\/jpeg;base64,([A-Za-z0-9+/]+={0,2})$/;
const MAX_FRAME_CHARS = 400_000;

export class FrameAnalyzer {
  #ready;
  constructor({ minFaceRatio = 0.15 } = {}) {
    this.minFaceRatio = minFaceRatio; // face box width / frame width; smaller = too far for stable landmarks
  }
  init() {
    this.#ready ??= (async () => {
      this.faceapi = require('@vladmandic/face-api/dist/face-api.node-wasm.js');
      this.jpeg = require('jpeg-js');
      require('@tensorflow/tfjs-backend-wasm').setWasmPaths(wasmDir);
      await this.faceapi.tf.setBackend('wasm');
      await this.faceapi.tf.ready();
      // Same pinned, checksum-verified weights the browser uses, so thresholds stay comparable.
      for (const net of ['tinyFaceDetector', 'faceLandmark68TinyNet', 'faceRecognitionNet']) {
        await this.faceapi.nets[net].loadFromDisk(modelDir);
      }
    })().catch(error => { this.#ready = undefined; throw error; });
    return this.#ready;
  }
  #decode(frame) {
    const match = typeof frame === 'string' && frame.length <= MAX_FRAME_CHARS && FRAME_RE.exec(frame);
    if (!match) throw new InputError('INVALID_FRAME');
    let image;
    try {
      image = this.jpeg.decode(Buffer.from(match[1], 'base64'), { useTArray: true, maxResolutionInMP: 1.3, maxMemoryUsageInMB: 64 });
    } catch {
      throw new InputError('INVALID_FRAME');
    }
    const rgb = new Uint8Array(image.width * image.height * 3);
    for (let i = 0, j = 0; i < image.data.length; i += 4, j += 3) {
      rgb[j] = image.data[i]; rgb[j + 1] = image.data[i + 1]; rgb[j + 2] = image.data[i + 2];
    }
    return { tensor: this.faceapi.tf.tensor3d(rgb, [image.height, image.width, 3]), width: image.width, height: image.height };
  }
  // Returns { descriptor, landmarks } in the same format the liveness rules already expect.
  async analyze(frame) {
    await this.init();
    const { tensor, width, height } = this.#decode(frame);
    try {
      const api = this.faceapi;
      const faces = await api.detectAllFaces(tensor, new api.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.5 }))
        .withFaceLandmarks(true).withFaceDescriptors();
      if (faces.length !== 1) throw new InputError(faces.length ? 'MULTIPLE_FACES' : 'NO_FACE', 422);
      if (faces[0].detection.box.width < width * this.minFaceRatio) throw new InputError('FACE_TOO_SMALL', 422);
      // One scale for both axes preserves eye ratios on non-square frames (matches the old client code).
      const scale = Math.max(width, height);
      return {
        descriptor: Array.from(faces[0].descriptor),
        landmarks: faces[0].landmarks.positions.map(p => [p.x / scale, p.y / scale])
      };
    } finally {
      tensor.dispose();
    }
  }
}
