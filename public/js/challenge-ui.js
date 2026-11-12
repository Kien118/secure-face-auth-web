import { captureFace } from './face-client.js';

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
  try {
    const challenge = await postJson('/api/liveness/challenges', { accountId }, signal);
    challengeId = challenge.challengeId;
    signal.throwIfAborted();
    onUpdate(challenge);
    let previousStep = challenge.step;
    while (true) {
      await new Promise(resolve => setTimeout(resolve, 250));
      signal.throwIfAborted();
      if (Date.now() >= challenge.expiresAt) throw Object.assign(new Error(), { code: 'CHALLENGE_EXPIRED' });
      const sample = await captureFace(video);
      signal.throwIfAborted();
      const result = await postJson(`/api/liveness/challenges/${challengeId}/samples`, sample, signal);
      signal.throwIfAborted();
      if (result.step === 2 && previousStep !== 2 && globalThis.speechSynthesis && globalThis.SpeechSynthesisUtterance) {
        try {
          const cue = new SpeechSynthesisUtterance('Mở mắt và nhìn thẳng.');
          cue.lang = 'vi-VN';
          speechSynthesis.speak(cue);
        } catch { /* The visible prompt remains available when speech is unsupported. */ }
      }
      previousStep = result.step;
      onUpdate(result);
      if (result.status !== 'CHALLENGE_ACTIVE') return result;
    }
  } finally {
    try { globalThis.speechSynthesis?.cancel(); } catch { /* Keep cancellation working if speech fails. */ }
    if (challengeId) {
      // Cancel also clears server state after local detection or transport errors.
      await fetch(`/api/liveness/challenges/${challengeId}`, {
        method: 'DELETE', signal: AbortSignal.timeout(2000)
      }).catch(() => {});
    }
  }
}
