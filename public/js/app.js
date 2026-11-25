import { Camera, cameraError } from './camera.js';
import { loadModels, captureFrame, captureFrames } from './face-client.js';
import { postJson, runChallenge } from './challenge-ui.js';
import { WorkspaceUI } from './workspace-ui.js';

const $ = id => document.getElementById(id);
const messages = {
  CONSENT_REQUIRED: 'Please consent to face processing before starting the camera.',
  CAMERA_NOT_STARTED: 'Camera permission has not been requested; the camera is off.',
  CAMERA_STARTING: 'Waiting for permission and starting the camera…',
  CAMERA_STOPPED: 'Camera stopped. The browser operation was cancelled.',
  CAMERA_DENIED: 'Camera permission was denied or revoked.',
  NO_CAMERA: 'No suitable camera was found.',
  CAMERA_BUSY: 'The camera is busy or cannot be read.',
  CAMERA_UNAVAILABLE: 'Camera access is unavailable. Use localhost or HTTPS and a supported browser.',
  CAMERA_ERROR: 'Camera error.', CAMERA_NOT_READY: 'The camera is not ready or has stopped.',
  MODEL_LOADING: 'Loading the face detector…',
  MODEL_READY: 'Face detector loaded. The camera is off.',
  READY: 'Camera and models are ready. Create a template or start verification.',
  PROCESSING: 'Capturing frames. The server is measuring them…',
  NO_FACE: 'No face detected.', MULTIPLE_FACES: 'Multiple faces detected. Exactly one face is required.',
  MODEL_ERROR: 'Model loading or inference failed. Run npm run models:download and retry.',
  SERVER_ERROR: 'Server connection or response error.',
  NO_TEMPLATE: 'No face is enrolled for this account (never enrolled, or deleted). Click "Enroll face" first.',
  TEMPLATE_EXISTS: 'This account is already enrolled. Continue with "Verify baseline 1:1".',
  TEMPLATE_CREATED: 'Template created and stored encrypted on the server. Now start the login challenge.',
  MATCH: 'Identity match only (baseline). Liveness was not checked and no session was issued.',
  FACE_TOO_SMALL: 'Move closer to the camera.',
  IDENTITY_RETRY: 'Identity uncertain. Face the screen directly, adjust your position, then press "Retry this step". One retry per attempt.',
  CHALLENGE_PAUSED: 'This attempt is paused. Start a new challenge.',
  FACE_LOST: 'Face lost. Turn a little less and keep your face in the frame; the step continues.',
  INCONSISTENT_FRAMES: 'Enrollment frames did not show the same person. Hold still and retry.',
  INVALID_FRAME: 'The server could not read the captured frame.',
  LOCKED: 'Too many failed attempts for this account. Try again in 5 minutes.',
  NO_MATCH: 'The face does not match the claimed account.',
  INVALID_ACCOUNT: 'Account IDs must contain 1–64 letters, digits, underscores, or hyphens.',
  ACCOUNT_CHANGED: 'Test account changed. Previous results were cleared.',
  CHALLENGE_ACTIVE: 'Challenge PoC in progress…',
  CHALLENGE_EXPIRED: 'Challenge time expired. The sequence was not completed; no login session was issued.',
  STEP_EXPIRED: 'The current step timed out. Start a new challenge.',
  INVALID_SAMPLE_TOKEN: 'The attempt is invalid or this sample token was already used. Start a new attempt.',
  CHALLENGE_NOT_FOUND: 'This challenge is no longer active. Start a new attempt.',
  INVALID_LANDMARKS: 'Valid landmarks could not be measured. Face the camera clearly and retry.',
  SAMPLE_TOO_FAST: 'Samples arrived too quickly. Start a new challenge.',
  SEQUENCE_COMPLETE: 'Challenge passed. The server issued a login session; opening your account…',
  CANCELLED: 'Operation cancelled.'
};
let busy = false;
let ready = false;
let operation = 0;
let request;
const workspace = new WorkspaceUI(document);
function status(code) {
  $('status').dataset.code = code;
  const message = messages[code] ?? `Request rejected (${code}).`;
  if ($('status').textContent !== message) $('status').textContent = message;
  workspace.setStatus(code);
}
function clearResults() { workspace.resetMetrics(); workspace.resetChallenge(); }
const camera = new Camera($('video'), () => stop());
// Guided order: every visit (and every account change) starts at "Enroll face", then a matching 1:1
// verify, then the challenge. An already-enrolled account answers TEMPLATE_EXISTS, which also moves
// on to verify. Page guidance only: the server still refuses every check without a template.
const flow = { enrolled: false, verified: false };
function resetFlow() {
  flow.enrolled = flow.verified = false;
  buttons();
}
function buttons() {
  $('models').disabled = busy || camera.active;
  $('start').disabled = busy || camera.active;
  $('stop').disabled = !busy && !camera.active;
  const idle = busy || !ready || !camera.active;
  $('enroll').disabled = idle;
  $('verify').disabled = idle || !flow.enrolled;
  $('challenge').disabled = idle || !flow.verified;
  const next = !flow.enrolled ? 'enroll' : !flow.verified ? 'verify' : 'challenge';
  for (const id of ['enroll', 'verify', 'challenge']) {
    $(id).className = `button ${id === next ? 'button-primary' : 'button-outline'}`;
  }
  $('account').disabled = busy;
  $('video').hidden = !camera.active;
  workspace.setDevices({ cameraActive: camera.active, modelsReady: ready, busy });
  $('capture-hint').textContent = busy ? 'A check is running. Stop the camera to cancel.'
    : camera.active && ready ? (!flow.enrolled ? 'Step 1: enroll your face for this account.'
      : !flow.verified ? 'Step 2: verify your face (1:1) to unlock the challenge.' : 'Step 3: log in with the challenge.')
      : 'Start the camera to enable capture actions.';
}
$('models').addEventListener('click', async () => {
  clearResults();
  const current = ++operation;
  busy = true; buttons(); status('MODEL_LOADING');
  try {
    await loadModels();
    if (current === operation) { ready = true; status('MODEL_READY'); }
  } catch { if (current === operation) status('MODEL_ERROR'); }
  finally { if (current === operation) { busy = false; buttons(); } }
});
function stop() {
  operation++;
  request?.abort();
  camera.stop();
  busy = false;
  clearResults();
  status('CAMERA_STOPPED'); buttons();
}
$('start').addEventListener('click', async () => {
  clearResults();
  if (!$('consent').checked) return status('CONSENT_REQUIRED');
  const current = ++operation;
  busy = true; buttons(); status('CAMERA_STARTING');
  try {
    await camera.start();
    if (current !== operation) return;
    buttons();
    status('MODEL_LOADING');
    await loadModels();
    if (current !== operation) return;
    ready = true; status('READY');
  } catch (error) {
    if (current !== operation) return;
    camera.stop(); status(error.code ?? cameraError(error));
  } finally { if (current === operation) { busy = false; buttons(); } }
});
$('stop').addEventListener('click', stop);
$('consent').addEventListener('change', () => { if (!$('consent').checked) stop(); });
$('account').addEventListener('input', () => {
  if (busy) return;
  clearResults();
  status('ACCOUNT_CHANGED');
  resetFlow();
});
for (const [id, endpoint] of [['enroll', 'templates'], ['verify', 'verify']]) {
  $(id).addEventListener('click', async () => {
    if (busy || !camera.active || !ready) return;
    clearResults();
    const accountId = $('account').value.trim();
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(accountId)) return status('INVALID_ACCOUNT');
    const current = ++operation;
    busy = true; buttons(); status('PROCESSING');
    try {
      const evidence = endpoint === 'templates'
        ? { frames: await captureFrames($('video')) } : { frame: await captureFrame($('video')) };
      if (current !== operation || !camera.active || !$('consent').checked) return;
      request = new AbortController();
      const result = await postJson(`/api/${endpoint}`, { accountId, ...evidence }, request.signal);
      if (current !== operation) return;
      status(result.status ?? 'SERVER_ERROR');
      workspace.renderMetrics(result);
      if (result.status === 'TEMPLATE_CREATED') flow.enrolled = true;
      if (endpoint === 'verify') flow.verified = result.status === 'MATCH';
    } catch (error) {
      if (current === operation) status(error.code ?? 'SERVER_ERROR');
      if (error.code === 'TEMPLATE_EXISTS') flow.enrolled = true;
      if (error.code === 'NO_TEMPLATE') flow.enrolled = flow.verified = false;
    } finally { if (current === operation) { busy = false; request = undefined; buttons(); } }
  });
}
// Shows "Retry this step" until pressed; stopping the camera or cancelling hides it and aborts.
function waitForRetry(signal) {
  return new Promise((resolve, reject) => {
    const button = $('retry');
    const done = () => { button.hidden = true; button.onclick = null; signal.removeEventListener('abort', aborted); };
    const aborted = () => { done(); reject(signal.reason); };
    button.hidden = false;
    button.onclick = () => { done(); resolve(); };
    signal.addEventListener('abort', aborted, { once: true });
  });
}
$('challenge').addEventListener('click', async () => {
  if (busy || !ready || !camera.active || !$('consent').checked) return;
  clearResults();
  const accountId = $('account').value.trim();
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(accountId)) return status('INVALID_ACCOUNT');
  const current = ++operation;
  request = new AbortController();
  busy = true; buttons(); status('PROCESSING');
  try {
    const final = await runChallenge({ video: $('video'), accountId, signal: request.signal, waitForRetry, onUpdate(result) {
      if (current !== operation) return;
      status(result.faceLost ? 'FACE_LOST' : result.status);
      workspace.updateChallenge(result);
      workspace.renderMetrics(result);
    } });
    if (current === operation && final?.authenticated) setTimeout(() => location.assign('/account.html'), 1200);
  } catch (error) {
    if (current === operation) {
      status(error.code ?? 'SERVER_ERROR');
      workspace.resetMetrics();
      workspace.failChallenge();
    }
  } finally { if (current === operation) { busy = false; request = undefined; buttons(); } }
});
window.addEventListener('pagehide', stop);
document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); });
resetFlow();
