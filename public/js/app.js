import { Camera, cameraError } from './camera.js';
import { loadModels, captureDescriptor } from './face-client.js';

const $ = id => document.getElementById(id);
const messages = {
  CONSENT_REQUIRED: 'Hãy đồng ý xử lý dữ liệu trước khi bật camera.',
  CAMERA_NOT_STARTED: 'Chưa cấp quyền / camera chưa bật.',
  CAMERA_STARTING: 'Đang chờ quyền và khởi động camera…',
  CAMERA_STOPPED: 'Camera đã dừng. Không gửi dữ liệu đang xử lý.',
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
  $('enroll').disabled = $('verify').disabled = busy || !ready || !camera.active;
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
    busy = true; buttons(); status('PROCESSING'); $('score').textContent = '';
    try {
      const descriptor = await captureDescriptor($('video'));
      if (current !== operation || !camera.active || !$('consent').checked) return;
      request = new AbortController();
      const response = await fetch(`/api/${endpoint}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId, descriptor }), signal: request.signal
      });
      const result = await response.json();
      if (current !== operation) return;
      status(result.status ?? 'SERVER_ERROR');
      if (response.ok && Number.isFinite(result.distance)) {
        $('score').textContent = `Distance: ${result.distance.toFixed(4)} | Threshold ban đầu: ${result.threshold} | Liveness: chưa triển khai`;
      }
    } catch (error) {
      if (current === operation) status(error.code ?? 'SERVER_ERROR');
    } finally { if (current === operation) { busy = false; request = undefined; buttons(); } }
  });
}
window.addEventListener('pagehide', stop);
document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); });
buttons();
