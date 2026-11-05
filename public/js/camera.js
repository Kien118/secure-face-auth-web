export function cameraError(error) {
  return ({ NotAllowedError: 'CAMERA_DENIED', SecurityError: 'CAMERA_DENIED',
    NotFoundError: 'NO_CAMERA', NotReadableError: 'CAMERA_BUSY',
    OverconstrainedError: 'NO_CAMERA' })[error?.name] ?? 'CAMERA_ERROR';
}

export class Camera {
  constructor(video, onEnded = () => {}, mediaDevices = globalThis.navigator?.mediaDevices) {
    this.video = video;
    this.onEnded = onEnded;
    this.mediaDevices = mediaDevices;
    this.generation = 0;
    this.stream = null;
  }
  get active() { return Boolean(this.stream?.getVideoTracks().some(t => t.readyState === 'live')); }
  async start() {
    this.stop();
    const generation = this.generation;
    if (!this.mediaDevices?.getUserMedia) throw Object.assign(new Error(), { code: 'CAMERA_UNAVAILABLE' });
    const stream = await this.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }, audio: false
    });
    if (generation !== this.generation) {
      stream.getTracks().forEach(t => t.stop());
      throw Object.assign(new Error(), { code: 'CANCELLED' });
    }
    this.stream = stream;
    for (const track of stream.getVideoTracks()) track.addEventListener('ended', () => {
      if (this.stream === stream) { this.stop(); this.onEnded(); }
    }, { once: true });
    this.video.srcObject = stream;
    try { await this.video.play(); }
    catch (error) { this.stop(); throw error; }
    if (generation !== this.generation) throw Object.assign(new Error(), { code: 'CANCELLED' });
  }
  stop() {
    this.generation++;
    this.stream?.getTracks().forEach(t => t.stop());
    this.stream = null;
    this.video.srcObject = null;
  }
}
