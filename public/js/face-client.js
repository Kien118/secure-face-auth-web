// The browser only gates on "exactly one face" for fast feedback. Descriptors, landmarks and every
// decision are computed by the server from the JPEG frame, so editing this file cannot forge evidence.
let modelPromise;
export async function loadModels(api = globalThis.faceapi) {
  if (!api) throw Object.assign(new Error(), { code: 'MODEL_ERROR' });
  modelPromise ??= api.nets.tinyFaceDetector.loadFromUri('/models')
    .catch(() => { modelPromise = undefined; throw Object.assign(new Error(), { code: 'MODEL_ERROR' }); });
  await modelPromise;
}

// detect: false skips the local tiny detector entirely (challenge samples): the server's detector
// decides, including no face and multiple faces. Frames are downscaled to maxWidth: the server's
// detector input is 300-416 px anyway, and a smaller JPEG is faster to encode, upload and decode.
export async function captureFrame(video, api = globalThis.faceapi, { detect = true, maxWidth = 480 } = {}) {
  if (!video.videoWidth || !video.videoHeight || video.readyState < 2) {
    throw Object.assign(new Error(), { code: 'CAMERA_NOT_READY' });
  }
  // Freeze one frame only in memory so the local check and the uploaded frame are the same image.
  const canvas = document.createElement('canvas');
  const scale = Math.min(1, maxWidth / video.videoWidth);
  canvas.width = Math.round(video.videoWidth * scale);
  canvas.height = Math.round(video.videoHeight * scale);
  try {
    canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
    if (detect) {
      const faces = await api.detectAllFaces(canvas, new api.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.5 }));
      if (faces.length !== 1) throw Object.assign(new Error(), { code: faces.length ? 'MULTIPLE_FACES' : 'NO_FACE' });
    }
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
