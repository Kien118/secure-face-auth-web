// The browser only gates on "exactly one face" for fast feedback. Descriptors, landmarks and every
// decision are computed by the server from the JPEG frame, so editing this file cannot forge evidence.
let modelPromise;
export async function loadModels(api = globalThis.faceapi) {
  if (!api) throw Object.assign(new Error(), { code: 'MODEL_ERROR' });
  modelPromise ??= api.nets.tinyFaceDetector.loadFromUri('/models')
    .catch(() => { modelPromise = undefined; throw Object.assign(new Error(), { code: 'MODEL_ERROR' }); });
  await modelPromise;
}

// allowNoFace: send the frame even if the tiny browser detector misses the face (a turned head);
// the server's stronger detector decides. Multiple faces are still rejected locally.
export async function captureFrame(video, api = globalThis.faceapi, { allowNoFace = false } = {}) {
  if (!video.videoWidth || !video.videoHeight || video.readyState < 2) {
    throw Object.assign(new Error(), { code: 'CAMERA_NOT_READY' });
  }
  // Freeze one frame only in memory so the local check and the uploaded frame are the same image.
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  try {
    canvas.getContext('2d').drawImage(video, 0, 0);
    const faces = await api.detectAllFaces(canvas, new api.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.5 }));
    if (faces.length > 1) throw Object.assign(new Error(), { code: 'MULTIPLE_FACES' });
    if (!faces.length && !allowNoFace) throw Object.assign(new Error(), { code: 'NO_FACE' });
    return canvas.toDataURL('image/jpeg', 0.85);
  } catch (error) {
    if (!error.code) error.code = 'MODEL_ERROR';
    throw error;
  } finally {
    canvas.width = canvas.height = 0;
  }
}

export async function captureFrames(video, count = 3, gapMs = 300, api = globalThis.faceapi) {
  const frames = [];
  for (let i = 0; i < count; i++) {
    if (i) await new Promise(resolve => setTimeout(resolve, gapMs));
    frames.push(await captureFrame(video, api));
  }
  return frames;
}
