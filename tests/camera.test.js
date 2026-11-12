import test from 'node:test';
import assert from 'node:assert/strict';
import { Camera, cameraError } from '../public/js/camera.js';

function fixture() {
  let stopped = 0;
  const track = { readyState: 'live', stop() { stopped++; this.readyState = 'ended'; }, addEventListener() {} };
  const stream = { getTracks: () => [track], getVideoTracks: () => [track] };
  const video = { srcObject: null, play: async () => {} };
  return { video, stream, track, stopped: () => stopped };
}
test('camera requests video only on start and stops all tracks', async () => {
  const f = fixture(); let calls = 0;
  const camera = new Camera(f.video, undefined, { async getUserMedia(options) {
    calls++; assert.equal(options.audio, false); return f.stream;
  } });
  assert.equal(calls, 0);
  await camera.start(); assert.equal(camera.active, true);
  camera.stop(); assert.equal(f.stopped(), 1); assert.equal(f.video.srcObject, null);
});
test('stop while permission pending releases late stream', async () => {
  const f = fixture(); let finish;
  const camera = new Camera(f.video, undefined, { getUserMedia: () => new Promise(resolve => { finish = resolve; }) });
  const pending = camera.start(); camera.stop(); finish(f.stream);
  await assert.rejects(pending, error => error.code === 'CANCELLED');
  assert.equal(f.stopped(), 1); assert.equal(f.video.srcObject, null);
});
test('play failure releases stream; permission and no-device errors are distinct', async () => {
  const f = fixture(); f.video.play = async () => { throw new Error('play failed'); };
  const camera = new Camera(f.video, undefined, { getUserMedia: async () => f.stream });
  await assert.rejects(camera.start()); assert.equal(f.stopped(), 1);
  assert.equal(cameraError({ name: 'NotAllowedError' }), 'CAMERA_DENIED');
  assert.equal(cameraError({ name: 'NotFoundError' }), 'NO_CAMERA');
});

test('late play rejection does not stop a newly started stream', async () => {
  const first = fixture(); const second = fixture(); let rejectFirst; let calls = 0;
  first.video.play = () => ++calls === 1 ? new Promise((_resolve, reject) => { rejectFirst = reject; }) : Promise.resolve();
  let streams = 0;
  const camera = new Camera(first.video, undefined, { getUserMedia: async () => ++streams === 1 ? first.stream : second.stream });
  const oldStart = camera.start();
  await Promise.resolve();
  camera.stop();
  await camera.start();
  rejectFirst(new Error('old play failed'));
  await assert.rejects(oldStart);
  assert.equal(camera.active, true);
  assert.equal(second.stopped(), 0);
  camera.stop();
});
