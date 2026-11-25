import { captureFrame } from './face-client.js';

const FACE_LOST = new Set(['NO_FACE', 'FACE_TOO_SMALL']);
// Counted from the previous answer, not from sending: the server spaces samples by when it finished
// analysing them (minimum 150 ms), and a fast frontal frame can finish soon after a slow turned one.
const MIN_GAP_MS = 300;

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

// waitForRetry(signal): resolves when the user presses "Retry this step" after a first identity mismatch.
export async function runChallenge({ video, accountId, signal, onUpdate, waitForRetry }) {
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
    let lastAnswer = 0;
    while (true) {
      const wait = lastAnswer + MIN_GAP_MS - Date.now();
      if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait));
      checkActive();
      let result;
      const started = Date.now();
      try {
        const frame = await captureFrame(video, undefined, { detect: false });
        checkActive();
        result = await postJson(`/api/liveness/challenges/${challengeId}/samples`, {
          frame, sampleToken: state.sampleToken
        }, signal);
        lastAnswer = Date.now();
        result = { ...result, roundTripMs: lastAnswer - started };
      } catch (error) {
        // Face lost (too far a turn, out of frame): skip this frame and keep the attempt and token.
        if (!FACE_LOST.has(error.code)) throw error;
        lastAnswer = Date.now();
        signal.throwIfAborted();
        onUpdate({ ...state, faceLost: true });
        continue;
      }
      signal.throwIfAborted();
      state = result;
      onUpdate(result);
      if (result.status === 'IDENTITY_RETRY' && waitForRetry) {
        await waitForRetry(signal); // sampling stays stopped while the server holds the attempt paused
        state = await postJson(`/api/liveness/challenges/${challengeId}/resume`, { sampleToken: state.sampleToken }, signal);
        signal.throwIfAborted();
        onUpdate(state);
        lastAnswer = Date.now();
        continue;
      }
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
