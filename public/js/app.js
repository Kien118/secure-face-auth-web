import { Camera, cameraError } from './camera.js';
import { loadModels, captureDescriptor } from './face-client.js';
import { postJson, runChallenge } from './challenge-ui.js';

const $ = id => document.getElementById(id);
const messages = {
  CONSENT_REQUIRED: 'Hãy đồng ý xử lý dữ liệu trước khi bật camera.',
  CAMERA_NOT_STARTED: 'Chưa cấp quyền / camera chưa bật.',
  CAMERA_STARTING: 'Đang chờ quyền và khởi động camera…',
  CAMERA_STOPPED: 'Camera đã dừng; đã hủy thao tác phía trình duyệt.',
  CAMERA_DENIED: 'Bạn đã từ chối hoặc thu hồi quyền camera.',
  NO_CAMERA: 'Không tìm thấy camera phù hợp.',
  CAMERA_BUSY: 'Camera đang bận hoặc không thể đọc.',
  CAMERA_UNAVAILABLE: 'Camera không khả dụng. Dùng localhost hoặc HTTPS và trình duyệt hỗ trợ webcam.',
  CAMERA_ERROR: 'Lỗi camera.', CAMERA_NOT_READY: 'Camera chưa sẵn sàng hoặc đã dừng.',
  MODEL_LOADING: 'Đang tải ba model face-api.js…',
  MODEL_READY: 'Đã tải ba model thành công. Camera chưa bật; chưa kiểm thử khuôn mặt thật.',
  READY: 'Camera và model sẵn sàng. Chọn tạo template hoặc xác minh.',
  PROCESSING: 'Đang phát hiện khuôn mặt và xử lý…',
  NO_FACE: 'Không tìm thấy khuôn mặt.', MULTIPLE_FACES: 'Có nhiều hơn một khuôn mặt; chỉ cho phép đúng một.',
  MODEL_ERROR: 'Lỗi tải model. Chạy npm run models:download rồi thử lại.',
  SERVER_ERROR: 'Lỗi kết nối hoặc phản hồi server.',
  NO_TEMPLATE: 'Tài khoản chưa có template. Hãy tạo template thử nghiệm trước.',
  TEMPLATE_EXISTS: 'Tài khoản đã có template; khởi động lại server nếu cần đăng ký lại.',
  TEMPLATE_CREATED: 'Đã tạo template thử nghiệm trong RAM server.',
  MATCH: 'So khớp thành công — chỉ khớp danh tính, chưa xác thực liveness hay đăng nhập.',
  NO_MATCH: 'Không khớp khuôn mặt với tài khoản được claim.',
  INVALID_ACCOUNT: 'Tài khoản chỉ gồm 1–64 chữ cái, chữ số, dấu _ hoặc -.',
  CHALLENGE_ACTIVE: 'Đang thực hiện thử thách PoC…',
  CHALLENGE_EXPIRED: 'Đã hết thời gian. Chưa hoàn thành thử thách; không cấp phiên đăng nhập.',
  CHALLENGE_NOT_FOUND: 'Thử thách không còn hiệu lực. Hãy bắt đầu lượt mới.',
  INVALID_LANDMARKS: 'Không đọc được landmarks phù hợp. Hãy nhìn rõ vào camera và thử lại.',
  SAMPLE_TOO_FAST: 'Mẫu gửi quá nhanh. Hãy bắt đầu thử thách mới.',
  SEQUENCE_COMPLETE: 'Đã hoàn thành chuỗi PoC. Chưa chứng minh chống giả mạo và chưa cấp phiên đăng nhập.',
  CANCELLED: 'Thao tác đã hủy.'
};
let busy = false;
let ready = false;
let operation = 0;
let request;
function status(code) { $('status').dataset.code = code; $('status').textContent = messages[code] ?? `Thao tác bị từ chối (${code}).`; }
const camera = new Camera($('video'), () => stop());
function buttons() {
  $('models').disabled = busy || camera.active;
  $('start').disabled = busy || camera.active;
  $('stop').disabled = !busy && !camera.active;
  $('enroll').disabled = $('verify').disabled = $('challenge').disabled = busy || !ready || !camera.active;
  $('account').disabled = busy;
}
$('models').addEventListener('click', async () => {
  const current = ++operation;
  busy = true; buttons(); status('MODEL_LOADING');
  try {
    await loadModels();
    if (current === operation) { ready = true; status('MODEL_READY'); }
  } catch { if (current === operation) status('MODEL_ERROR'); }
  finally { if (current === operation) { busy = false; buttons(); } }
});
function stop() {
  operation++;
  request?.abort();
  camera.stop();
  busy = false;
  $('score').textContent = '';
  $('challenge-prompt').textContent = '';
  status('CAMERA_STOPPED'); buttons();
}
$('start').addEventListener('click', async () => {
  if (!$('consent').checked) return status('CONSENT_REQUIRED');
  const current = ++operation;
  busy = true; buttons(); status('CAMERA_STARTING');
  try {
    await camera.start();
    if (current !== operation) return;
    status('MODEL_LOADING');
    await loadModels();
    if (current !== operation) return;
    ready = true; status('READY');
  } catch (error) {
    if (current !== operation) return;
    camera.stop(); status(error.code ?? cameraError(error));
  } finally { if (current === operation) { busy = false; buttons(); } }
});
$('stop').addEventListener('click', stop);
$('consent').addEventListener('change', () => { if (!$('consent').checked) stop(); });
for (const [id, endpoint] of [['enroll', 'templates'], ['verify', 'verify']]) {
  $(id).addEventListener('click', async () => {
    if (busy || !camera.active || !ready) return;
    const accountId = $('account').value.trim();
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(accountId)) return status('INVALID_ACCOUNT');
    const current = ++operation;
    busy = true; buttons(); status('PROCESSING'); $('score').textContent = ''; $('challenge-prompt').textContent = '';
    try {
      const descriptor = await captureDescriptor($('video'));
      if (current !== operation || !camera.active || !$('consent').checked) return;
      request = new AbortController();
      const result = await postJson(`/api/${endpoint}`, { accountId, descriptor }, request.signal);
      if (current !== operation) return;
      status(result.status ?? 'SERVER_ERROR');
      if (Number.isFinite(result.distance)) {
        $('score').textContent = `Distance: ${result.distance.toFixed(4)} | Threshold ban đầu: ${result.threshold} | Liveness: chưa triển khai`;
      }
    } catch (error) {
      if (current === operation) status(error.code ?? 'SERVER_ERROR');
    } finally { if (current === operation) { busy = false; request = undefined; buttons(); } }
  });
}
$('challenge').addEventListener('click', async () => {
  if (busy || !ready || !camera.active || !$('consent').checked) return;
  const accountId = $('account').value.trim();
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(accountId)) return status('INVALID_ACCOUNT');
  const current = ++operation;
  request = new AbortController();
  busy = true; buttons(); status('PROCESSING'); $('score').textContent = '';
  try {
    await runChallenge({ video: $('video'), accountId, signal: request.signal, onUpdate(result) {
      if (current !== operation) return;
      status(result.status);
      $('challenge-prompt').textContent = Number.isInteger(result.step)
        ? `Bước ${Math.min(result.step + 1, result.totalSteps)}/${result.totalSteps}: ${result.prompt}` : '';
      if (Number.isFinite(result.distance)) {
        const metrics = Number.isFinite(result.ear) && Number.isFinite(result.noseOffset)
          ? `EAR: ${result.ear.toFixed(3)} | Lệch mũi: ${result.noseOffset.toFixed(3)} | ` : '';
        $('score').textContent = `${metrics}Distance: ${result.distance.toFixed(4)} | Ngưỡng: ${result.threshold}`;
      }
    } });
  } catch (error) {
    if (current === operation) { status(error.code ?? 'SERVER_ERROR'); $('challenge-prompt').textContent = ''; }
  } finally { if (current === operation) { busy = false; request = undefined; buttons(); } }
});
window.addEventListener('pagehide', stop);
document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); });
buttons();
