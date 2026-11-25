const actionLabels = {
  look_straight: 'Look straight ahead', tilt_left: 'Face screen, tilt to right shoulder',
  tilt_right: 'Face screen, tilt to left shoulder', center: 'Look straight, head upright', turn_left: 'Turn to your right',
  turn_right: 'Turn to your left'
};
// Which side of the meter fills, in the user's own (mirrored) terms: turn_left / tilt_left move the
// nose / head toward raw image left, which is the user's right. 0 = neutral pose, fills both ways.
const meterSide = { turn_left: 1, tilt_left: 1, turn_right: -1, tilt_right: -1 };
const statusLabels = {
  TEMPLATE_CREATED: ['success', 'Template created'], MATCH: ['success', 'Identity match'],
  PROCESSING: ['progress', 'Processing capture'], CAMERA_STARTING: ['progress', 'Starting camera'],
  MODEL_LOADING: ['progress', 'Loading models'], CHALLENGE_ACTIVE: ['progress', 'Follow the prompt'],
  CONSENT_REQUIRED: ['warning', 'Consent required'], NO_FACE: ['warning', 'No face detected'],
  MULTIPLE_FACES: ['warning', 'One face at a time'], CAMERA_STOPPED: ['warning', 'Camera stopped'],
  CANCELLED: ['warning', 'Attempt cancelled'], SEQUENCE_COMPLETE: ['success', 'Logged in'], LOCKED: ['error', 'Account locked'], FACE_LOST: ['warning', 'Face lost, keep going'],
  READY: ['neutral', 'Ready for a check'], MODEL_READY: ['neutral', 'Models ready'],
  CAMERA_NOT_STARTED: ['neutral', 'Start with consent'], NO_MATCH: ['error', 'No identity match'],
  ACCOUNT_CHANGED: ['neutral', 'Account updated'],
  CAMERA_DENIED: ['error', 'Camera access denied'], STEP_EXPIRED: ['error', 'Step timed out'],
  CHALLENGE_EXPIRED: ['error', 'Attempt timed out']
};

export class WorkspaceUI {
  constructor(document, { now = Date.now, setInterval = globalThis.setInterval,
    clearInterval = globalThis.clearInterval } = {}) {
    this.$ = id => document.getElementById(id);
    this.document = document;
    this.now = now;
    this.setInterval = setInterval.bind(globalThis);
    this.clearInterval = clearInterval.bind(globalThis);
    this.interval = null;
    this.deadlines = null;
    this.progress = null;
  }
  setDevices({ cameraActive, modelsReady, busy }) {
    this.$('camera-state').textContent = cameraActive ? 'Camera on' : 'Camera off';
    this.$('camera-state').dataset.state = cameraActive ? 'active' : 'idle';
    this.$('model-state').textContent = modelsReady ? 'Models ready' : 'Not loaded';
    this.$('model-state').dataset.state = modelsReady ? 'ready' : 'idle';
    this.$('camera-placeholder').hidden = cameraActive;
    this.$('camera-stage').dataset.active = String(Boolean(cameraActive));
    this.$('camera-stage').dataset.busy = String(Boolean(busy));
  }
  setStatus(code) {
    const [tone, heading] = statusLabels[code] ?? ['error', 'Check could not continue'];
    this.$('status-panel').dataset.tone = tone;
    this.$('status-heading').textContent = heading;
  }
  renderMetrics(result) {
    for (const [id, key, digits] of [['metric-distance', 'distance', 4], ['metric-threshold', 'threshold', 4],
      ['metric-ear', 'ear', 3], ['metric-pose', 'noseOffset', 3], ['metric-mouth', 'tilt', 1]]) {
      this.$(id).textContent = Number.isFinite(result[key]) ? result[key].toFixed(digits) : '—';
    }
    const hasMetrics = Number.isFinite(result.distance) || Number.isFinite(result.ear);
    this.$('metrics-panel').hidden = !hasMetrics;
    this.$('result-placeholder').hidden = hasMetrics || Array.isArray(result.checks);
    this.#renderChecks(result);
  }
  // "value / op target": only the measured value is colored, green when met and red when not.
  #renderChecks(result) {
    const list = this.$('checks-list');
    list.textContent = '';
    const checks = Array.isArray(result.checks) ? result.checks : [];
    this.$('checks-panel').hidden = !checks.length;
    if (!checks.length) return;
    const timing = Number.isFinite(result.roundTripMs)
      ? ` · ${result.roundTripMs} ms${Number.isFinite(result.serverMs) ? ` (server ${result.serverMs} ms)` : ''}` : '';
    this.$('checks-title').textContent = `Server requirements · ${actionLabels[result.checksFor] ?? 'last sample'}${timing}`;
    for (const item of checks) {
      if (!Number.isFinite(item?.value) || !Number.isFinite(item?.target)) continue;
      const digits = Number.isInteger(item.target) ? 1 : 3;
      const value = this.document.createElement('span');
      value.className = item.pass ? 'pass' : 'fail';
      value.textContent = item.value.toFixed(digits);
      const amount = this.document.createElement('span');
      amount.className = 'check-value';
      amount.append(value, ` / ${item.op} ${item.target.toFixed(digits)}`);
      const label = this.document.createElement('span');
      label.className = 'check-label';
      label.textContent = item.label;
      const row = this.document.createElement('li');
      row.append(label, amount);
      list.append(row);
    }
  }
  resetMetrics() { this.renderMetrics({}); }
  updateChallenge(result) {
    const active = result.status === 'CHALLENGE_ACTIVE';
    const complete = result.status === 'SEQUENCE_COMPLETE';
    if (!active && !complete) {
      this.failChallenge(result.status === 'NO_MATCH' ? 'Identity mismatch' : 'Attempt ended');
      return;
    }
    const total = Number.isInteger(result.totalSteps) && result.totalSteps > 0 ? result.totalSteps : 1;
    const completed = complete ? total : Math.max(0, Math.min(Number.isInteger(result.step) ? result.step : 0, total - 1));
    this.progress = { step: completed, total };
    this.#renderMeter(result);
    this.$('challenge-panel').dataset.state = complete ? 'complete' : 'active';
    this.$('challenge-step').textContent = complete ? 'Sequence complete' : `Step ${completed + 1} of ${total}`;
    this.$('challenge-action').textContent = complete ? 'Sequence completed'
      : actionLabels[result.action] ?? 'Follow the current instruction';
    const prompt = typeof result.prompt === 'string' ? result.prompt : '';
    if (this.$('challenge-prompt').textContent !== prompt) this.$('challenge-prompt').textContent = prompt;
    this.$('challenge-timer').hidden = complete;
    if (complete) { this.#stopTimer(); return; }
    this.deadlines = { step: result.stepExpiresAt, attempt: result.expiresAt };
    this.#tick();
    if (this.interval === null) this.interval = this.setInterval(() => this.#tick(), 200);
  }
  // Progress of the current action toward the server's threshold, from the server's own checks.
  // After the step advances the checks belong to the previous action, so the meter restarts empty.
  #renderMeter(result) {
    const fill = this.$('pose-fill');
    const readout = this.$('pose-readout');
    const checks = result.checksFor === result.action && Array.isArray(result.checks) ? result.checks : [];
    const pose = checks.filter(item => item.label !== 'Identity distance' && item.label !== 'Eyes open (EAR)');
    const side = meterSide[result.action] ?? 0;
    const main = side ? pose.find(item => item.op === '≥') : null;
    const share = item => (item.pass ? 1 : item.op === '≥' ? item.value / item.target : item.target / item.value);
    const fraction = pose.length ? Math.max(0, Math.min(1, main ? share(main) : Math.min(...pose.map(share)))) : 0;
    const half = fraction * 50;
    fill.style.width = `${side ? half : half * 2}%`;
    fill.style.left = `${side > 0 ? 50 : 50 - half}%`; // grows rightward from the middle, or leftward/both ways
    fill.dataset.pass = String(checks.length > 0 && checks.every(item => item.pass));
    readout.textContent = '';
    const shown = main ?? pose[0];
    if (!shown || !Number.isFinite(shown.value) || !Number.isFinite(shown.target)) { readout.textContent = '—'; return; }
    const digits = Number.isInteger(shown.target) ? 1 : 2;
    const value = this.document.createElement('span');
    value.className = shown.pass ? 'pass' : 'fail';
    value.textContent = shown.value.toFixed(digits);
    readout.append(value, ` / ${shown.op} ${shown.target.toFixed(digits)}`);
  }
  #tick() {
    if (!this.deadlines) return;
    for (const [id, deadline] of [['step-time', this.deadlines.step], ['attempt-time', this.deadlines.attempt]]) {
      this.$(id).textContent = Number.isFinite(deadline)
        ? `${Math.max(0, Math.ceil((deadline - this.now()) / 1000))}s` : '—';
    }
  }
  #stopTimer() {
    if (this.interval !== null) this.clearInterval(this.interval);
    this.interval = null;
    this.deadlines = null;
  }
  failChallenge(label = 'Attempt ended') {
    this.#stopTimer();
    this.$('challenge-panel').dataset.state = 'failed';
    this.$('challenge-timer').hidden = true;
    this.$('challenge-step').textContent = this.progress
      ? `${label} · Step ${Math.min(this.progress.step + 1, this.progress.total)} of ${this.progress.total}` : label;
  }
  resetChallenge({ label = 'Not started' } = {}) {
    this.#stopTimer();
    this.progress = null;
    this.$('challenge-panel').dataset.state = 'idle';
    this.#renderMeter({});
    this.$('challenge-step').textContent = label;
    this.$('challenge-action').textContent = 'Your next instruction will appear here';
    this.$('challenge-prompt').textContent = '';
    this.$('challenge-timer').hidden = true;
    this.$('step-time').textContent = this.$('attempt-time').textContent = '—';
  }
}
