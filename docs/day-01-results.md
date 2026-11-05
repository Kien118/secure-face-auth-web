# Kết quả Ngày 1 — 05/11/2026

Trạng thái: **baseline mã nguồn đã triển khai và kiểm thử tự động; chưa đạt đủ
điều kiện hoàn thành Ngày 1 vì webcam/khuôn mặt thật chưa được kiểm chứng.**
Final cũng chưa đạt: anti-spoofing là Must have nhưng chưa triển khai trong Ngày 1.

## Hiện trạng ban đầu và căn cứ

- Git `main`, chưa có commit, không có remote; chỉ có `tmp/read_inspection/` chưa track.
- Không có mã ứng dụng, README, AGENTS.md hay rules dự án trong workspace/đường dẫn cha đã kiểm tra.
- Đọc lại Midterm, yêu cầu Topic 2 và kế hoạch 15 ngày đã thống nhất trong chat
  “Đọc và đối chiếu ba tệp”. Giữ nguyên toàn bộ tài liệu ban đầu, không đưa chúng vào Git.
- Giữ HTML/CSS/JavaScript + face-api.js/TensorFlow.js và Node.js/Express hybrid.
  Server sở hữu quyết định matching; challenge, PAD và session chưa triển khai.

## Môi trường thực tế

| Thành phần | Phiên bản / điều kiện |
|---|---|
| OS | Windows, PowerShell |
| Node / npm | 22.13.0 / 10.9.2 |
| Git | 2.48.1.windows.1 |
| Express / Helmet | 5.3.0 / 8.3.0 |
| face-api.js / TF.js core | 0.22.2 / 1.7.0 |
| node-fetch override | 2.7.0 |
| Model | Tiny Face Detector, tiny 68 landmarks, face recognition 128D |
| Model nguồn | commit 8609b25a15f417398a4d2b95dc91985cd1e0c0c3, MIT notice, SHA-256 khóa |
| Threshold | 0.6 ban đầu, chưa hiệu chỉnh trên người thật |
| Web | loopback localhost:3000; HTTP chỉ dùng local |
| Browser quan sát | ChatGPT in-app browser; mở được trang ban đầu |
| Webcam / điện thoại / ánh sáng | Pending — chưa thu thập thông tin thiết bị |

## Đã triển khai

- Express phục vụ frontend và API cùng origin, health endpoint.
- Consent trước camera; bật/dừng, preview, dừng khi ẩn/đổi trang; xử lý lỗi quyền/thiết bị.
- Tải model cùng origin; có nút kiểm tra tải model không cần camera.
- Chụp một frame tạm trong RAM, phát hiện tất cả mặt, chỉ chấp nhận đúng một mặt;
  landmarks và descriptor; không ghi ảnh, không gửi video liên tục.
- POST descriptor vào API; schema đúng hai field; 128 số hữu hạn, chặn giá trị
  bất thường, JSON tối đa 8 KiB. Không nhận cờ matched/authenticated từ client.
- Template riêng theo tài khoản trong RAM; giới hạn 100, từ chối ghi đè; không database.
- Server tính Euclidean distance, trả match/non-match và `authenticated: false`.
- Security headers, CSP, no-store, không log descriptor, ignore .env/weights/tài liệu tmp.
- Downloader kiểm checksum cố định và giữ upstream MIT notice. Không tải ảnh người thật.

## Kiểm thử tự động đã chạy

| Lệnh / phép kiểm | Kết quả quan sát |
|---|---|
| `npm install --ignore-scripts` | Cài được; ban đầu 3 advisory, đã xử lý bằng node-fetch override |
| `npm audit --audit-level=low` | 0 vulnerabilities sau bản vá |
| `npm test` | **13/13 đạt**, 0 fail, dữ liệu synthetic và mocks |
| `npm run lint` | **15 tệp JS đạt** kiểm tra cú pháp Node; chưa dùng ESLint |
| `npm run models:download` | Tải đủ 3 manifest + 4 shards + LICENSE, checksum đạt |
| `npm run check:models` | Nạp được 3 network; tensor zeros → 128 giá trị hữu hạn |
| `npm start` | Entrypoint khởi động tại 127.0.0.1:3000 |
| HTTP/frontend | Health, HTML, modules và browser bundle trả 200; headers đạt |
| Build | Không áp dụng: ES modules tĩnh, không có bundler |

13 test bao gồm backend/health, static assets/headers, schema/dimension/account,
NaN/Infinity/JSON overflow, giới hạn body, content type/query/cross-site, cờ giả,
chưa template, template RAM/1:1, distance/threshold, cách ly/capacity/copy template,
camera lifecycle/hủy quyền đang chờ/play lỗi, gate không/multiple faces và retry tải model.
Mocks camera và tensor tổng hợp **không phải bằng chứng kiểm thử webcam thật**.

Lần chạy HTTP trong sandbox ban đầu thất bại vì không kết nối được loopback;
đã chạy lại ngoài sandbox với quyền được cấp, 13/13 đạt. Không đổi test để che lỗi.
Native TensorFlow/canvas không được cài; chọn inference browser theo Midterm,
không có lỗi native bị che giấu. Thông báo TF.js gợi ý backend native trong smoke test
CPU là thông báo hiệu năng, test vẫn đạt.

## Kiểm tra bản source sạch

Đã xuất source đã commit bằng `git archive` từ `8667063` vào thư mục tạm bị ignore,
không copy node_modules, .env hay weights từ workspace.

- `npm ci --ignore-scripts`: cài mới 78 packages, audit 0 vulnerabilities.
- `npm test`: 13/13 đạt trong bản sạch.
- `npm run lint`: 15 tệp đạt trong bản sạch.
- `npm run models:download`: tải lại assets từ nguồn khóa, checksum đạt.
- `npm run check:models`: nạp 3 network và tensor inference 128D đạt trong bản sạch.
- Smoke test entrypoint thật `src/server.js` với PORT=0: khởi động, health và HTML trả 200.
- Đây là kiểm chứng source sạch cho runtime; không suy ra webcam thật hoạt động.

## Quan sát browser và camera thật

Đã mở trang bằng in-app browser và thấy giao diện, consent, nút camera/template/verify,
cảnh báo chưa liveness, trạng thái chưa cấp quyền và checklist Pending.
Sau đó kết nối điều khiển tab bị mất (“tab not part of session” / “tab not found”),
nên chưa xác minh được tương tác hay tải model trong browser. Không dùng ảnh hoặc
webcam giả để thay kết quả vật lý. **Chưa thực hiện bất kỳ lượt camera thật nào.**

## Checklist người dùng cần thực hiện

Mở http://localhost:3000 (nếu server dừng thì `npm start`). Trước hết bấm kiểm tra
tải model; sau đó tick consent của người tham gia, bật camera và cấp quyền trong browser.
Dùng mã tài khoản giả danh, ví dụ `demo-user`. Không thay template giữa các lượt so sánh.
Restart server để xóa toàn bộ template nếu cần bắt đầu lại.

| ID | Thao tác | Kỳ vọng baseline / thông tin cần ghi | Thực tế |
|---|---|---|---|
| M0 | Bấm kiểm tra tải model không cần camera | 3 model tải được trong browser; ghi browser/lỗi | Pending |
| M1 | Người đã đồng ý tạo template rồi xác minh lại | Ghi distance, threshold, match, camera và ánh sáng | Pending |
| M2 | Cùng người, thay nhẹ tư thế và ánh sáng | Ghi riêng từng lượt, gồm cả lượt không khớp | Pending |
| M3 | Người khác có consent claim cùng account M1 | Mong đợi NO_MATCH; ghi distance và kết quả thật | Pending |
| P1 | Ảnh đúng người trên điện thoại, giữ yên | Có thể match; ghi phone, độ sáng, khoảng cách, kết quả | Pending |
| P2 | Di chuyển ảnh điện thoại | Ghi distance/match hoặc no-face theo thực tế | Pending |
| P3 | Nghiêng màn hình điện thoại | Ghi góc tương đối, distance/kết quả | Pending |
| P4 | Đổi độ sáng màn hình | Ghi mức sáng và kết quả từng lượt | Pending |
| C1 | Dừng camera khi đang xử lý | Tracks dừng, thao tác client bị hủy; ghi lỗi nếu có | Pending |
| C2 | Từ chối quyền camera từ đầu | Thông báo bị từ chối, không gửi descriptor | Pending |
| C3 | Không có khuôn mặt | NO_FACE, không gửi descriptor | Pending |
| C4 | Hai khuôn mặt có consent cùng vào khung | MULTIPLE_FACES, không tạo/verify template | Pending |
| C5 | Thu hồi quyền hoặc đổi tab | Camera dừng, không tiếp tục capture | Pending |

Gửi kết quả theo mẫu: `ID | browser/camera/phone | ánh sáng/tư thế/độ sáng |
distance (nếu có) | match/non-match/no-face/lỗi | ghi chú`. Không gửi descriptor,
ảnh khuôn mặt hay tên thật. Chưa có raw counts người thật, người sai hoặc ảnh điện thoại.
Không suy diễn “đã chấp nhận ảnh điện thoại” từ lý thuyết hay vector tổng hợp.

## Hạn chế và quyết định Ngày 2

- Ảnh điện thoại có thể giữ đủ thông tin danh tính để match; đây là khả năng của baseline,
  chưa phải kết quả camera đã quan sát trong phiên này.
- Client descriptor có thể giả/replay. Chưa có trusted enrollment, liveness, transaction,
  session, rate limiting hoặc DB bền vững. CSP và validation không sửa được giới hạn đó.
- Threshold chưa hiệu chỉnh; detection/descriptor người thật và hành vi trên thiết bị còn Pending.
- Template mất khi restart. Dừng capture không thu hồi request server đã nhận.
- Không triển khai Ngày 2 trong phiên này. Bước đầu Ngày 2 là PoC chuỗi mắt + quay đầu,
  theo dõi chuyển trạng thái qua nhiều frame và kiểm thử thật với người/ảnh điện thoại;
  Ngày 3 thêm random challenge/TTL/single-use và thử video theo kế hoạch.
- Chỉ chọn hướng PAD tiếp theo dựa trên kết quả thật; không dùng blink/pose giả lập để tuyên bố đạt.

## Git / GitHub

- `8667063`: baseline webcam, model, in-memory matching API và 13 kiểm thử.
- README và báo cáo này được commit riêng sau khi kiểm tra.
- Người dùng yêu cầu tự tạo repo `secure-face-auth-web` (Public), sẽ gửi URL sau.
  Chưa có remote, chưa push và không tự tạo repository GitHub.
- Không có .env, ảnh, descriptor thật, model weights, secret hoặc tài liệu tmp trong commit.

**Chưa đánh dấu hoàn thành Ngày 1:** cần người dùng thực hiện M0–M3/P1–P4/C1–C5,
xác nhận webcam → face descriptor → API thực tế, cập nhật quan sát trung thực.
