const actionLabels = {
  look_straight: 'Look straight ahead', close_eyes: 'Close your eyes',
  open_eyes: 'Open your eyes', turn_left: 'Turn toward image left',
  turn_right: 'Turn toward image right', return_center: 'Return to center'
};
const statusLabels = {
  TEMPLATE_CREATED: ['success', 'Template created'], MATCH: ['success', 'Identity match'],
  PROCESSING: ['progress', 'Processing capture'], CAMERA_STARTING: ['progress', 'Starting camera'],
  MODEL_LOADING: ['progress', 'Loading models'], CHALLENGE_ACTIVE: ['progress', 'Follow the prompt'],
  CONSENT_REQUIRED: ['warning', 'Consent required'], NO_FACE: ['warning', 'No face detected'],
  MULTIPLE_FACES: ['warning', 'One face at a time'], CAMERA_STOPPED: ['warning', 'Camera stopped'],
  CANCELLED: ['warning', 'Attempt cancelled'], SEQUENCE_COMPLETE: ['warning', 'Sequence complete'],
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
      ['metric-ear', 'ear', 3], ['metric-pose', 'noseOffset', 3]]) {
      this.$(id).textContent = Number.isFinite(result[key]) ? result[key].toFixed(digits) : '—';
    }
    const hasMetrics = Number.isFinite(result.distance) || Number.isFinite(result.ear);
    this.$('metrics-panel').hidden = !hasMetrics;
    this.$('result-placeholder').hidden = hasMetrics;
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
    this.$('challenge-progress').max = total;
    this.$('challenge-progress').value = completed;
    this.progress = { step: completed, total };
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
    this.$('challenge-progress').value = 0;
    this.$('challenge-step').textContent = label;
    this.$('challenge-action').textContent = 'Your next instruction will appear here';
    this.$('challenge-prompt').textContent = '';
    this.$('challenge-timer').hidden = true;
    this.$('step-time').textContent = this.$('attempt-time').textContent = '—';
  }
}
