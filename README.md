# Face Authentication for Web Applications

Ngày 1 — 05/11/2026: baseline so khớp danh tính 1:1 bằng webcam.
PoC Ngày 2 được triển khai ngày 12/11/2026: chuỗi mở/nhắm/mở mắt và quay đầu.
**Chưa kiểm chứng khả năng chống spoofing, chưa cấp session. Không dùng trong production.**

## Yêu cầu Final

Topic 2, `SECURITY PROJECT TOPICS_CLC_2026.pdf`, trang 1 yêu cầu xây trang đăng nhập
web an toàn bằng thư viện JavaScript, xác thực qua webcam và chặn spoofing như ảnh
khuôn mặt trên màn hình điện thoại. Anti-spoofing là Must have của Final.
Baseline Ngày 1 chưa đáp ứng đầy đủ yêu cầu này. Kế hoạch đã thống nhất đưa
PoC liveness lên Ngày 2–3, kiểm thử ảnh và video điện thoại; ảnh in nếu có điều kiện.

## Kiến trúc và căn cứ Midterm

Đã đối chiếu bản Midterm PDF (24 trang), nội dung PPTX đã trích xuất và kế hoạch
15 ngày trong chat “Đọc và đối chiếu ba tệp”. Tài liệu local ban đầu nằm ở
`tmp/read_inspection/`; giữ nguyên và không commit vì có hình/tài liệu nguồn.
Midterm mục 7.2–7.5 và 8 đề xuất HTML/CSS/JavaScript, face-api.js/TensorFlow.js,
Node.js/Express, kiến trúc hybrid. Workspace ban đầu có Git `main` rỗng,
không có ứng dụng cũ để tái sử dụng, không thấy AGENTS.md hay rules dự án.

Browser: consent → webcam → frame trong RAM → Tiny Face Detector → tiny
68 landmarks → descriptor 128 chiều → POST cùng origin. Baseline xử lý một frame;
thử thách gửi các mẫu descriptor/landmarks trong tối đa 45 giây sau khi bấm bắt đầu.
Server: validation → template theo account trong Map RAM → khoảng cách Euclidean
→ quyết định `distance <= threshold`. Không so 1:N và không tin cờ kết quả client.
Frontend và API cùng Express, không cần bundler/build riêng.

Giữ kiến trúc hybrid; server hiện kiểm tra cả identity và thứ tự các bước PoC. Inference browser là lựa
chọn có chủ ý nhằm tránh native TensorFlow/canvas và không upload video liên tục;
không tuyên bố đã gặp lỗi native Node. Script CPU Node chỉ kiểm tra model bằng tensor
tổng hợp. Challenge hiện là chuỗi cố định, có TTL và bị hủy sau hoàn thành/lỗi;
ngẫu nhiên hóa, PAD độc lập, session và kho template bảo vệ còn trong kế hoạch.

## Công nghệ

- Môi trường triển khai: Windows; Node.js 22.13.0; npm 10.9.2; Git 2.48.1.windows.1.
- Express 5.3.0, Helmet 8.3.0, face-api.js 0.22.2 (TF.js core 1.7.0).
- Override `node-fetch` 2.7.0 sửa advisory trong dependency cũ của TF.js.
- Dependency khóa bằng `package-lock.json`; model khóa commit và SHA-256 trong `models.lock.json`.
- Nguồn và API model: [face-api.js chính thức](https://github.com/justadudewhohacks/face-api.js).
  Dùng model trong chính repository có [MIT LICENSE](https://github.com/justadudewhohacks/face-api.js/blob/master/LICENSE);
  downloader giữ notice đi kèm, không tải dataset khuôn mặt.

## Cài đặt và chạy lại từ checkout sạch

Yêu cầu Node >=22.13.0, npm, webcam và trình duyệt hỗ trợ getUserMedia, WebGL/CPU.

```powershell
npm ci --ignore-scripts
npm run models:download
if (!(Test-Path .env)) { Copy-Item .env.example .env }
npm test
npm run lint
npm run check:models
npm run dev
```

Mở [ứng dụng local](http://localhost:3000). `npm start` dùng cho chạy không watch.
`lint` hiện kiểm tra cú pháp toàn bộ JS bằng `node --check`, không phải bộ quy tắc
ESLint. Không có bước build vì frontend là ES modules tĩnh. `check:models` xác minh
checksum, nạp ba model và tạo descriptor từ tensor tổng hợp; không đánh giá người thật.

Model được tải vào `public/models/`, bị Git ignore. Khi tải lỗi, kiểm tra mạng,
thử lại downloader; checksum sai thì dừng, không bỏ qua kiểm tra. Không commit weights.
Script giữ nguồn cố định ở commit `8609b25a15f417398a4d2b95dc91985cd1e0c0c3` của bản npm 0.22.2.

`.env` tùy chọn, bị ignore; server đọc tự động. `HOST=127.0.0.1`, `PORT=3000`,
`FACE_MATCH_THRESHOLD=0.6` mặc định. Ngưỡng 0.6 chỉ là điểm khởi đầu theo baseline
FaceMatcher của thư viện, **chưa hiệu chỉnh hay đánh giá chính thức**; cần tập capture
genuine/impostor riêng, có consent. Không chỉnh ngưỡng trên cùng tập đánh giá rồi báo lại.
Ngưỡng chỉ thay đổi sau restart. Dev watch cũng làm mất template khi restart.

Các biến `LIVENESS_*` trong `.env.example` dùng cho hiệu chỉnh PoC trên phần cứng thật:

| Biến | Ban đầu | Ý nghĩa |
|---|---:|---|
| `LIVENESS_TIMEOUT_MS` | 45000 | Thời hạn một lượt, tính theo thời gian server |
| `LIVENESS_EYE_OPEN` | 0.25 | EAR tối thiểu khi mở mắt |
| `LIVENESS_EYE_CLOSED` | 0.18 | EAR tối đa khi nhắm mắt |
| `LIVENESS_HEAD_TURN` | 0.20 | Mức lệch mũi so với tư thế ban đầu để quay đầu |
| `LIVENESS_HEAD_CENTER` | 0.10 | Khoảng dung sai khi nhìn thẳng |

EAR là trung bình tỉ lệ khoảng cách mí mắt/chiều rộng của hai mắt. Mức lệch mũi
được chiếu lên trục nối hai mắt, chia theo khoảng cách hai mắt, không phải góc yaw
3D. Hai trục landmarks cùng chia cho cạnh lớn nhất của frame để giữ đúng tỉ lệ.
Server tự tính các chỉ số từ 68 điểm browser gửi. Mỗi bước cần hai mẫu liên tiếp;
server từ chối mẫu cách nhau dưới 150 ms. Browser chờ ít nhất 250 ms giữa lượt
capture, cộng thêm thời gian inference/HTTP; tốc độ thực tế phụ thuộc máy.
Các ngưỡng này chưa hiệu chỉnh, không phải tiêu chuẩn PAD. Quan sát EAR/lệch mũi
trong các capture hiệu chỉnh có consent, ghi cấu hình/điều kiện, restart server khi
đổi ngưỡng và đánh giá trên các lượt mới. Không coi hai kết quả matching là đủ để hiệu chỉnh.

HTTP chỉ dành cho loopback localhost. Ngoài máy local phải triển khai HTTPS với
certificate tin cậy qua reverse proxy cùng origin; bật HSTS tại proxy. Không expose
PoC hiện tại ra Internet. Fetch dùng đường dẫn tương đối nên tương thích HTTPS.
Không bỏ qua cảnh báo certificate của trình duyệt.

## Sử dụng webcam

Có thể bấm “Kiểm tra tải model (không dùng camera)” trước khi bắt đầu.

1. Đọc thông báo dữ liệu và tick consent của chính người thử.
2. Bấm “Bật camera và tải model”, cấp quyền camera trong trình duyệt.
3. Chọn mã account giả danh (chữ, số, `_`, `-`, tối đa 64 ký tự).
4. Đúng một khuôn mặt nhìn vào camera; bấm “Tạo template thử nghiệm”.
5. Bấm “Xác minh 1:1”; xem trạng thái, distance và threshold. Match chưa phải login.
6. Bấm “Dừng camera”; đổi tab/ẩn trang cũng dừng toàn bộ track. Thu hồi consent dừng camera.

Nút template/baseline xử lý một frame tại thời điểm bấm; không gửi video.
Nút “Bắt đầu thử thách PoC” xử lý nhiều frame đến khi hoàn thành, lỗi, hết hạn hoặc
bạn dừng camera. Bắt đầu sau khi đã tạo template. Làm theo prompt từng bước:
nhìn thẳng/mở mắt → nhắm mắt giữ đến khi prompt đổi → mở mắt → quay mũi sang
trái khung hình → về giữa. Preview không lật gương; đây là hướng của ảnh, không
phải chỉ dẫn trái/phải theo cơ thể. Browser sẽ nói “Mở mắt” khi đến bước mở mắt
nếu hỗ trợ giọng nói. Nếu không nghe, nhắm khoảng 2 giây rồi mở để xem bước;
lặp lại nếu bước nhắm mắt chưa đạt. Thời gian cần hiệu chỉnh theo máy.
Server so 1:1 từng mẫu; nếu sai người thì dừng. Hủy/đổi tab/thu hồi consent dừng
capture; không-face hoặc nhiều-face cũng hủy lượt. Bấm bắt đầu để thử lượt mới.
`SEQUENCE_COMPLETE` chỉ có nghĩa đủ chuỗi bằng chứng PoC, luôn `authenticated: false`.
Ảnh tạm không được lưu/download, descriptor không log ra console, localStorage hoặc URL.
Nếu không có mặt/nhiều mặt, không gửi descriptor. Trình duyệt lỗi model có thể thử lại.
Khi camera chưa có quyền, bị từ chối/thu hồi, thiếu thiết bị hoặc đang bận, UI báo riêng.
Template không ghi ra đĩa và **mất khi server khởi động lại**; account có template
không được ghi đè tự do. Muốn reset, dừng server rồi chạy lại.

## API thử nghiệm

| Endpoint | Dữ liệu / kết quả |
|---|---|
| GET `/api/health` | status ok, identity-and-challenge-poc, challengePoc true, liveness false |
| POST `/api/templates` | `{accountId, descriptor}` → 201 TEMPLATE_CREATED |
| POST `/api/verify` | cùng schema → MATCH/NO_MATCH, matched, distance, threshold, authenticated false |
| POST `/api/liveness/challenges` | `{accountId}` đã có template → challengeId, prompt, bước, expiresAt |
| POST `/api/liveness/challenges/:id/samples` | `{descriptor, landmarks}` → tiến trình hoặc SEQUENCE_COMPLETE/NO_MATCH |
| DELETE `/api/liveness/challenges/:id` | Hủy lượt, trả 204; id đã hoàn thành/hủy không dùng lại được |

Baseline chỉ nhận đúng hai field. Mẫu thử thách có descriptor và đúng 68 cặp tọa độ
hữu hạn trong [0,1], không nhận account/step/timestamp hay cờ thành công từ client.
Tài khoản lấy từ trạng thái server. Lỗi schema/descriptor/landmarks hoặc sai danh
tính kết thúc lượt; server giữ tối đa 100 lượt, thu hồi slot hết hạn khi tạo lượt mới.
Chỉ giữ bước/timing/bộ đếm trong RAM; không giữ descriptor/landmarks các mẫu.
Descriptor là array 128 số hữu hạn, mỗi giá trị có trị tuyệt
đối <=10 để chặn biên số học bất thường (không phải quality gate sinh trắc).
JSON tối đa 8 KiB. Không có template → 404; template trùng → 409; tối đa 100
template/instance → 503. JSON sai → 400; sai content type → 415; quá lớn → 413.
API từ chối query string và POST có Sec-Fetch-Site cross-site. Không bật CORS.
Không dùng endpoint này như API đăng nhập thật.

## Kiểm thử thủ công và ghi nhận

Kết quả Ngày 1 nằm ở [docs/day-01-results.md](docs/day-01-results.md): người dùng
đã xác nhận hai lượt MATCH (0.5910, 0.2142) đều là người đã đăng ký. Điều kiện chưa đủ
để đánh giá độ chính xác. Checklist PoC mới nằm ở [docs/day-02-results.md](docs/day-02-results.md).
Người thật thực hiện chuỗi, người khác có consent và ảnh/video điện thoại vẫn **Pending**.
Gửi mã thử, thiết bị, ánh sáng, distance,
match/non-match và lỗi; không gửi ảnh hoặc descriptor. Chỉ cập nhật quan sát thực tế.

## Giới hạn bảo mật

Headers CSP, Permissions Policy, nosniff, no-store; giới hạn body và validation;
server tính matching. Không ảnh/template thật trong Git. Chỉ dùng vector tổng hợp trong tests.

Ảnh điện thoại có thể khớp danh tính: đó là rủi ro baseline, chưa là kết quả vật lý
đã quan sát. Browser có thể gửi descriptor giả, replay hoặc copy descriptor hợp lệ;
server chưa chứng minh nguồn webcam hay sự hiện diện người sống. Landmarks cũng
có thể giả: kiểm tra chuỗi trên server không chứng minh capture đáng tin cậy.
Chuỗi cố định có thể bị video phù hợp phát lại; di chuyển ảnh/điện thoại cũng có thể
làm đổi ước lượng hướng. Chưa có trusted enrollment, tài khoản/mật khẩu, random
challenge, PAD độc lập, session, rate limit, database/mã hóa
template bền vững hoặc chứng nhận PAD. Không coi matching thành công là đăng nhập.
Map có giới hạn số template nhưng không thay thế rate limit hay authorization.
Thư viện TF.js/face-api.js cũ; audit sạch không chứng minh không có rủi ro.

## Tiến độ Ngày 2 và kế hoạch Ngày 3

Ngày 2: đã có PoC chuỗi hành động mắt và quay đầu, server kiểm tra chuyển trạng thái
qua nhiều frame; thử vật lý chưa thực hiện. Ngày 3: random challenge
do server sở hữu và củng cố transaction binding/freshness, thử video điện thoại.
TTL, account binding và tiêu thụ lượt PoC đã có để giới hạn tài nguyên; chưa là giao thức xác thực hoàn chỉnh.
Không coi blink/head pose riêng lẻ là chứng minh liveness; chốt hướng kỹ thuật bằng
kết quả vật lý, cân nhắc PAD bổ sung nếu cần. Anti-spoofing vẫn là điều kiện nghiệm thu Final.

GitHub: người dùng tự tạo `secure-face-auth-web` (Public) rồi gửi URL; hiện chỉ commit local.
