// Test double for FrameAnalyzer. A "frame" here is synthetic evidence wrapped in a string, so the API
// tests exercise the real routes, token and liveness logic without real faces or model inference.
import { InputError } from '../src/services/face-engine.js';

const PREFIX = 'synthetic:';

export const syntheticFrame = evidence => PREFIX + Buffer.from(JSON.stringify(evidence)).toString('base64');

export const syntheticAnalyzer = {
  async analyze(frame) {
    if (typeof frame !== 'string' || !frame.startsWith(PREFIX)) throw new InputError('INVALID_FRAME');
    const evidence = JSON.parse(Buffer.from(frame.slice(PREFIX.length), 'base64').toString());
    if (evidence.face === 'none') throw new InputError('NO_FACE', 422);
    if (evidence.face === 'many') throw new InputError('MULTIPLE_FACES', 422);
    return evidence;
  }
};
