import { captureFace } from './face-client.js';

let activeCue;

export async function postJson(path, body, signal) {
  const timeout = AbortSignal.timeout(10000);
  const response = await fetch(path, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body), signal: signal ? AbortSignal.any([signal, timeout]) : timeout
  });
  const result = await response.json();
  if (!response.ok) throw Object.assign(new Error(), { code: result.status ?? 'SERVER_ERROR' });
  return result;
}

export async function runChallenge({ video, accountId, signal, onUpdate }) {
  let challengeId;
  let cue;
  const cancelCue = () => {
    if (!cue || activeCue !== cue) return;
    activeCue = undefined;
    try { globalThis.speechSynthesis?.cancel(); } catch { /* Keep cancellation working if speech fails. */ }
  };
  signal.addEventListener('abort', cancelCue, { once: true });
  try {
    const challenge = await postJson('/api/liveness/challenges', { accountId }, signal);
    challengeId = challenge.challengeId;
    signal.throwIfAborted();
    onUpdate(challenge);
    let state = challenge;
    let previousAction = challenge.action;
    const checkActive = () => {
      signal.throwIfAborted();
      if (Date.now() >= challenge.expiresAt) throw Object.assign(new Error(), { code: 'CHALLENGE_EXPIRED' });
      if (Date.now() >= state.stepExpiresAt) throw Object.assign(new Error(), { code: 'STEP_EXPIRED' });
    };
    while (true) {
      await new Promise(resolve => setTimeout(resolve, 250));
      checkActive();
      const sample = await captureFace(video);
      checkActive();
      const result = await postJson(`/api/liveness/challenges/${challengeId}/samples`, {
        ...sample, sampleToken: state.sampleToken
      }, signal);
      signal.throwIfAborted();
      if (result.action === 'open_eyes' && previousAction !== 'open_eyes' && globalThis.speechSynthesis && globalThis.SpeechSynthesisUtterance) {
        try {
          cue = new SpeechSynthesisUtterance('Open your eyes and look straight ahead.');
          cue.lang = 'en-US';
          activeCue = cue;
          speechSynthesis.speak(cue);
        } catch { /* The visible prompt remains available when speech is unsupported. */ }
      }
      previousAction = result.action;
      state = result;
      onUpdate(result);
      if (result.status !== 'CHALLENGE_ACTIVE') return result;
    }
  } finally {
    signal.removeEventListener('abort', cancelCue);
    cancelCue();
    if (challengeId) {
      // Cancel also clears server state after local detection or transport errors.
      await fetch(`/api/liveness/challenges/${challengeId}`, {
        method: 'DELETE', signal: AbortSignal.timeout(2000)
      }).catch(() => {});
    }
  }
}
