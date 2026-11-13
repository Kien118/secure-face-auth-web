import { Camera, cameraError } from './camera.js';
import { loadModels, captureDescriptor } from './face-client.js';
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
  MODEL_LOADING: 'Loading three face-api.js models…',
  MODEL_READY: 'All three models loaded successfully. The camera is off.',
  READY: 'Camera and models are ready. Create a template or start verification.',
  PROCESSING: 'Detecting faces and processing…',
  NO_FACE: 'No face detected.', MULTIPLE_FACES: 'Multiple faces detected. Exactly one face is required.',
  MODEL_ERROR: 'Model loading or inference failed. Run npm run models:download and retry.',
  SERVER_ERROR: 'Server connection or response error.',
  NO_TEMPLATE: 'This account has no template. Create a test template first.',
  TEMPLATE_EXISTS: 'This account already has a template. Restart the server to enroll again.',
  TEMPLATE_CREATED: 'Test template created in server RAM.',
  MATCH: 'Identity match only. Liveness and login were not verified.',
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
  SEQUENCE_COMPLETE: 'PoC sequence completed. Spoofing resistance is unverified; no login session was issued.',
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
function buttons() {
  $('models').disabled = busy || camera.active;
  $('start').disabled = busy || camera.active;
  $('stop').disabled = !busy && !camera.active;
  $('enroll').disabled = $('verify').disabled = $('challenge').disabled = busy || !ready || !camera.active;
  $('account').disabled = busy;
  $('video').hidden = !camera.active;
  workspace.setDevices({ cameraActive: camera.active, modelsReady: ready, busy });
  $('capture-hint').textContent = busy ? 'A check is running. Stop the camera to cancel.'
    : camera.active && ready ? 'Show exactly one face. Create a template before your first check.'
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
      const descriptor = await captureDescriptor($('video'));
      if (current !== operation || !camera.active || !$('consent').checked) return;
      request = new AbortController();
      const result = await postJson(`/api/${endpoint}`, { accountId, descriptor }, request.signal);
      if (current !== operation) return;
      status(result.status ?? 'SERVER_ERROR');
      workspace.renderMetrics(result);
    } catch (error) {
      if (current === operation) status(error.code ?? 'SERVER_ERROR');
    } finally { if (current === operation) { busy = false; request = undefined; buttons(); } }
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
    await runChallenge({ video: $('video'), accountId, signal: request.signal, onUpdate(result) {
      if (current !== operation) return;
      status(result.status);
      workspace.updateChallenge(result);
      workspace.renderMetrics(result);
    } });
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
buttons();
