import test from 'node:test';
import assert from 'node:assert/strict';
import { WorkspaceUI } from '../public/js/workspace-ui.js';

function fixture() {
  const ids = ['camera-state', 'model-state', 'camera-placeholder', 'camera-stage', 'status-panel',
    'status-heading', 'metric-distance', 'metric-threshold', 'metric-ear', 'metric-pose', 'metrics-panel',
    'result-placeholder', 'challenge-progress', 'challenge-step', 'challenge-action', 'challenge-prompt',
    'challenge-panel', 'challenge-timer', 'step-time', 'attempt-time'];
  const nodes = Object.fromEntries(ids.map(id => [id, { dataset: {}, textContent: '', hidden: false, max: 5, value: 0 }]));
  let now = 1000; let tick; let starts = 0; let stops = 0;
  const ui = new WorkspaceUI({ getElementById: id => {
    assert.ok(nodes[id], `Unknown UI element: ${id}`); return nodes[id];
  } }, { now: () => now, setInterval: callback => { starts++; tick = callback; return starts; },
    clearInterval: () => { stops++; tick = undefined; } });
  return { ui, nodes, advance(ms) { now += ms; tick?.(); }, starts: () => starts, stops: () => stops };
}
const active = (overrides = {}) => ({ status: 'CHALLENGE_ACTIVE', totalSteps: 5, step: 0,
  action: 'look_straight', prompt: 'Look straight ahead.', stepExpiresAt: 16000, expiresAt: 46000, ...overrides });

test('device indicators reflect actual state, without inferring enrollment or authentication', () => {
  const { ui, nodes } = fixture();
  ui.setDevices({ cameraActive: false, modelsReady: true, busy: false });
  assert.equal(nodes['camera-state'].textContent, 'Camera off');
  assert.equal(nodes['camera-placeholder'].hidden, false);
  assert.equal(nodes['model-state'].dataset.state, 'ready');
  ui.setDevices({ cameraActive: true, modelsReady: true, busy: true });
  assert.equal(nodes['camera-placeholder'].hidden, true);
  assert.equal(nodes['camera-stage'].dataset.active, 'true');
  assert.equal(nodes['camera-stage'].dataset.busy, 'true');
});

test('status distinguishes identity matching from completing an unverified challenge', () => {
  const { ui, nodes } = fixture();
  ui.setStatus('MATCH');
  assert.equal(nodes['status-heading'].textContent, 'Identity match');
  assert.equal(nodes['status-panel'].dataset.tone, 'success');
  ui.setStatus('SEQUENCE_COMPLETE');
  assert.equal(nodes['status-heading'].textContent, 'Sequence complete');
  assert.equal(nodes['status-panel'].dataset.tone, 'warning');
  ui.setStatus('UNKNOWN_SERVER_ERROR');
  assert.equal(nodes['status-panel'].dataset.tone, 'error');
});

test('metrics reject non-finite values and reset without retaining stale results', () => {
  const { ui, nodes } = fixture();
  ui.renderMetrics({ distance: 0.2142, threshold: 0.6, ear: NaN, noseOffset: Infinity });
  assert.equal(nodes['metric-distance'].textContent, '0.2142');
  assert.equal(nodes['metric-threshold'].textContent, '0.6000');
  assert.equal(nodes['metric-ear'].textContent, '—');
  assert.equal(nodes['metric-pose'].textContent, '—');
  assert.equal(nodes['metrics-panel'].hidden, false);
  ui.resetMetrics();
  assert.equal(nodes['metrics-panel'].hidden, true);
  assert.equal(nodes['result-placeholder'].hidden, false);
  assert.equal(nodes['metric-distance'].textContent, '—');
});

test('countdown uses returned deadlines, advances steps without extra intervals, and never decides a result', () => {
  const f = fixture();
  f.ui.updateChallenge(active());
  assert.equal(f.nodes['step-time'].textContent, '15s');
  assert.equal(f.nodes['attempt-time'].textContent, '45s');
  f.advance(1100);
  assert.equal(f.nodes['step-time'].textContent, '14s');
  f.ui.updateChallenge(active({ step: 1, action: 'close_eyes', stepExpiresAt: 17000 }));
  assert.equal(f.starts(), 1);
  assert.equal(f.nodes['challenge-progress'].value, 1);
  assert.equal(f.nodes['challenge-action'].textContent, 'Close your eyes');
  f.advance(15000);
  assert.equal(f.nodes['step-time'].textContent, '0s');
  assert.equal(f.nodes['challenge-panel'].dataset.state, 'active');
  assert.equal(f.nodes['challenge-progress'].value, 1);
});

test('completion and reset clear timers; identity failure retains the known step without NaN', () => {
  const f = fixture();
  f.ui.updateChallenge(active());
  f.ui.updateChallenge({ status: 'SEQUENCE_COMPLETE', totalSteps: 5, step: 5, prompt: 'PoC sequence completed.' });
  assert.equal(f.stops(), 1);
  assert.equal(f.nodes['challenge-progress'].value, 5);
  assert.equal(f.nodes['challenge-timer'].hidden, true);
  f.ui.updateChallenge(active({ step: 2, action: 'open_eyes', prompt: 'Open your eyes.' }));
  f.ui.updateChallenge({ status: 'NO_MATCH' });
  assert.equal(f.stops(), 2);
  assert.equal(f.nodes['challenge-panel'].dataset.state, 'failed');
  assert.equal(f.nodes['challenge-progress'].value, 2);
  assert.equal(f.nodes['challenge-step'].textContent, 'Identity mismatch · Step 3 of 5');
  assert.equal(f.nodes['challenge-action'].textContent, 'Open your eyes');
  assert.equal(f.nodes['challenge-prompt'].textContent, 'Open your eyes.');
  f.ui.updateChallenge(active({ action: 'future_action' }));
  assert.equal(f.nodes['challenge-action'].textContent, 'Follow the current instruction');
  f.ui.resetChallenge({ label: 'Cancelled' });
  assert.equal(f.stops(), 3);
  assert.equal(f.nodes['challenge-step'].textContent, 'Cancelled');
  assert.equal(f.nodes['step-time'].textContent, '—');
});

test('local failure retains the last instruction and progress for recording the failed step', () => {
  const { ui, nodes } = fixture();
  ui.failChallenge('Attempt ended');
  assert.equal(nodes['challenge-step'].textContent, 'Attempt ended');
  ui.updateChallenge(active({ step: 3, action: 'turn_right', prompt: 'Turn right in the preview.' }));
  ui.failChallenge('Capture failed');
  assert.equal(nodes['challenge-panel'].dataset.state, 'failed');
  assert.equal(nodes['challenge-progress'].value, 3);
  assert.equal(nodes['challenge-step'].textContent, 'Capture failed · Step 4 of 5');
  assert.equal(nodes['challenge-prompt'].textContent, 'Turn right in the preview.');
  assert.equal(nodes['challenge-timer'].hidden, true);
});
