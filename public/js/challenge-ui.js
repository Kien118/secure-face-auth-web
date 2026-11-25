import { captureFrame } from './face-client.js';

const FACE_LOST = new Set(['NO_FACE', 'FACE_TOO_SMALL']);

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
    let state = challenge;
    const checkActive = () => {
      signal.throwIfAborted();
      if (Date.now() >= challenge.expiresAt) throw Object.assign(new Error(), { code: 'CHALLENGE_EXPIRED' });
      if (Date.now() >= state.stepExpiresAt) throw Object.assign(new Error(), { code: 'STEP_EXPIRED' });
    };
    while (true) {
      await new Promise(resolve => setTimeout(resolve, 250));
      checkActive();
      let result;
      try {
        const frame = await captureFrame(video);
        checkActive();
        result = await postJson(`/api/liveness/challenges/${challengeId}/samples`, {
          frame, sampleToken: state.sampleToken
        }, signal);
      } catch (error) {
        // Face lost (too far a turn, out of frame): skip this frame and keep the attempt and token.
        if (!FACE_LOST.has(error.code)) throw error;
        signal.throwIfAborted();
        onUpdate({ ...state, faceLost: true });
        continue;
      }
      signal.throwIfAborted();
      state = result;
      onUpdate(result);
      if (result.status !== 'CHALLENGE_ACTIVE') return result;
    }
  } finally {
    if (challengeId) {
      // Cancel also clears server state after local detection or transport errors.
      await fetch(`/api/liveness/challenges/${challengeId}`, {
        method: 'DELETE', signal: AbortSignal.timeout(2000)
      }).catch(() => {});
    }
  }
}
