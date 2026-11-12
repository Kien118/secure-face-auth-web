let modelPromise;
export async function loadModels(api = globalThis.faceapi) {
  if (!api) throw Object.assign(new Error(), { code: 'MODEL_ERROR' });
  modelPromise ??= Promise.all([
    api.nets.tinyFaceDetector.loadFromUri('/models'),
    api.nets.faceLandmark68TinyNet.loadFromUri('/models'),
    api.nets.faceRecognitionNet.loadFromUri('/models')
  ]).catch(() => { modelPromise = undefined; throw Object.assign(new Error(), { code: 'MODEL_ERROR' }); });
  await modelPromise;
}

export async function captureDescriptor(video, api = globalThis.faceapi) {
  return (await captureFace(video, api)).descriptor;
}

export async function captureFace(video, api = globalThis.faceapi) {
  if (!video.videoWidth || !video.videoHeight || video.readyState < 2) {
    throw Object.assign(new Error(), { code: 'CAMERA_NOT_READY' });
  }
  // Freeze one frame only in memory so detection and recognition use the same input.
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  try {
    canvas.getContext('2d').drawImage(video, 0, 0);
    const faces = await api.detectAllFaces(canvas, new api.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.5 }))
      .withFaceLandmarks(true).withFaceDescriptors();
    if (faces.length !== 1) throw Object.assign(new Error(), { code: faces.length ? 'MULTIPLE_FACES' : 'NO_FACE' });
    const descriptor = Array.from(faces[0].descriptor);
    if (descriptor.length !== 128 || !descriptor.every(Number.isFinite)) throw new Error('Invalid inference output');
    // One scale for both axes preserves eye ratios on non-square video frames.
    const scale = Math.max(canvas.width, canvas.height);
    const landmarks = faces[0].landmarks.positions.map(p => [p.x / scale, p.y / scale]);
    return { descriptor, landmarks };
  } catch (error) {
    if (!error.code) error.code = 'MODEL_ERROR';
    throw error;
  } finally {
    canvas.width = canvas.height = 0;
  }
}
