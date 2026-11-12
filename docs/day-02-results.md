# PoC Ngày 2 — thực hiện ngày 12/11/2026

Đây là mốc công việc Ngày 2, không backdate thành 06/11. Mã PoC đã triển khai;
kiểm thử vật lý và hiệu chỉnh còn **Pending**. Chưa nghiệm thu anti-spoofing hay Final.

## Thay đổi và kiến trúc

Giữ Node/Express, face-api.js 0.22.2 và ba model Ngày 1, không thêm dependency.
Browser nhận consent, chỉ gửi nhiều mẫu sau hành động “Bắt đầu thử thách PoC”.
Mỗi mẫu có descriptor 128D và 68 cặp landmarks, không có ảnh/video. Server tự tính
EAR và mức lệch mũi, đối chiếu template của tài khoản đã gắn vào lượt ở server,
kiểm tra thứ tự và thời gian nhận mẫu. Không nhận cờ thành công, step, thời gian
hay tài khoản thay thế từ mẫu client.

Chuỗi cố định đầu tiên:

1. Nhìn thẳng, giữ mắt mở để lấy mốc hướng ban đầu.
2. Nhắm mắt và giữ đến khi được yêu cầu mở; chưa dùng chớp mắt tự nhiên trên máy chậm.
3. Mở mắt, nhìn thẳng.
4. Quay đầu để mũi lệch sang trái khung hình, giữ mắt mở.
5. Đưa đầu về giữa, giữ mắt mở.

Mỗi bước cần hai mẫu liên tiếp phù hợp. Mẫu không đúng động tác đặt lại bộ đếm
của bước hiện tại, không bỏ qua bước. Mắt/hướng đầu dùng ngưỡng thử nghiệm từ
`.env.example` (EAR mở 0.25, nhắm 0.18, quay 0.20, giữa 0.10). Các ngưỡng **chưa
được hiệu chỉnh trên người thật**. Hướng đầu là chỉ số 2D theo trục hai mắt, không
phải đo góc yaw 3D; có mốc trung tính và kiểm thử phép quay ảnh để tránh nhầm roll.

Mẫu cách nhau dưới 150 ms theo clock server bị từ chối; browser chờ 250 ms cộng
thời gian inference/HTTP giữa lượt capture. Lượt hết hạn sau 45 giây, tối đa 100
lượt trong RAM; slot hết hạn được dọn khi tạo lượt mới. Hoàn thành/lỗi mẫu/sai
danh tính/hủy sẽ tiêu thụ lượt. Không giữ landmarks/descriptor các mẫu; template
đăng ký vẫn trong RAM theo baseline. Khởi động lại server xóa tất cả.

Khi đủ chuỗi, server trả `SEQUENCE_COMPLETE`, `sequencePassed: true`,
`liveness: UNVERIFIED_CLIENT_EVIDENCE`, `authenticated: false`. Không tạo session.
Baseline `/api/verify` vẫn hoạt động và được ghi rõ là chỉ so danh tính.

## Kiểm tra đã chạy

| Phép kiểm | Quan sát |
|---|---|
| `npm test` | 35/35 đạt sau bổ sung lời nhắc mở mắt, không chạy trùng test trong tmp |
| `npm run lint` | 20 tệp JavaScript đạt kiểm tra cú pháp |
| Model trong browser | Đạt: in-app browser hiển thị “Đã tải ba model thành công” sau khi bấm nút model; camera chưa bật |
| Trang PoC | Quan sát được consent, nút baseline/challenge, hướng dẫn chuỗi và trạng thái chưa camera |
| Template/descriptor thật trong phiên | Không thu thập; các test dùng vector/landmarks tổng hợp hoặc mocks |
| Build | Không có bước build riêng; frontend là ES modules tĩnh |

Unit/integration tests bao gồm: chuỗi đúng; ảnh/mẫu tổng hợp đứng yên không đủ
chuỗi; đảo thứ tự; danh tính sai ở bước sau; schema/landmarks suy biến/cờ giả;
binding tài khoản; expiry/capacity/hủy/dùng lại; hướng so với mốc trung tính;
body 8 KiB; phản hồi không cookie/session; hủy trong inference và response tạo
lượt đến muộn không gửi tiếp dữ liệu, lời nhắc mở mắt chỉ phát một lần và dừng
khi kết thúc/hủy. Có regression cho lỗi `video.play()` cũ
không được dừng stream vừa khởi động lại.

`npm test` trước đây tự tìm cả test trong bản export bị ignore ở `tmp/`; đã giới
hạn thành `tests/*.test.js`, kiểm chứng trên Windows/Node 22.13.0. Giữ nguyên
thư mục tạm/tài liệu nguồn của người dùng.

## Chạy và thử trên thiết bị thật

```powershell
cd "C:\Users\Trung Kiên\Documents\ChatGPT\Final_BMTT"
npm start
```

Nếu đang chạy bản server cũ, dừng bằng Ctrl+C rồi chạy lại. Mở
[localhost:3000](http://localhost:3000), tải model, tick consent của người tham gia,
bật camera, tạo template mới sau restart. Bấm “Xác minh baseline 1:1” để lấy mốc
danh tính rồi “Bắt đầu thử thách PoC”, làm theo prompt. Không nhắm mắt chỉ trong
0,5 giây: browser sẽ nói “Mở mắt” khi đạt bước, nếu giọng nói được hỗ trợ.
Nếu không nghe, nhắm khoảng 2 giây rồi mở để xem tiến trình, lặp lại nếu chưa đạt.
Thời gian cần hiệu chỉnh theo máy; chưa kiểm thử loa/giọng nói thật. Preview không lật gương;
quay mũi về bên trái hình bạn nhìn thấy. Bấm “Dừng camera” để hủy.

Thử cùng template trong mỗi nhóm so sánh, không đăng ký lại bằng ảnh điện thoại.
Chỉ dùng người/ảnh/video có consent. Ghi cả lần thành công và thất bại.

| ID | Thử nghiệm | Cần ghi nhận | Kết quả thực tế |
|---|---|---|---|
| D2-01 | Người đã đăng ký làm đúng chuỗi | Từng bước, EAR/lệch mũi, distance, tổng thời gian | Pending |
| D2-02 | Người đã đăng ký cố ý làm sai/không nhắm mắt | Bước bị giữ lại hoặc hết hạn; không session | Pending |
| D2-03 | Người khác có consent claim cùng account | Có dừng vì NO_MATCH không, distance | Pending |
| D2-04 | Ảnh đúng người trên điện thoại, giữ yên | Baseline có match không; chuỗi dừng bước nào | Pending |
| D2-05 | Di chuyển ảnh điện thoại | Mọi lần bước tiến hoặc chuỗi vượt qua | Pending |
| D2-06 | Nghiêng màn hình điện thoại | Mọi lần bước tiến hoặc chuỗi vượt qua | Pending |
| D2-07 | Thay độ sáng màn hình | EAR, lỗi detection, kết quả từng mức sáng | Pending |
| D2-08 | Video điện thoại có mắt/quay đầu | Có hoàn thành chuỗi cố định không; ghi cả bypass | Pending |
| D2-09 | Dừng camera/thu hồi consent/đổi tab giữa chuỗi | Camera dừng, không còn capture, không kết quả muộn | Pending |
| D2-10 | Không mặt/hai mặt trong chuỗi | Thông báo và lượt bị hủy | Pending |
| D2-11 | Ảnh in nếu có điều kiện | Điều kiện, bước đạt/dừng và mọi bypass | Pending |

Mẫu báo cáo: `ID | thiết bị/browser | ánh sáng/khoảng cách/độ sáng điện thoại |
bước cuối | EAR/lệch mũi/distance | kết quả/thời gian | ghi chú`.
Không gửi hoặc commit ảnh/video, descriptor hay landmarks thật.

## Giới hạn và bước tiếp theo

- Server tính lại chỉ số từ **landmarks client cung cấp**, không xác minh độc lập
  điểm đó đến từ camera. Client giả có thể hoàn thành chuỗi bằng dữ liệu tự tạo.
- Chuỗi cố định có thể khớp video ghi sẵn. Các test tổng hợp chỉ kiểm tra thuật toán,
  không chứng minh ảnh điện thoại bị chặn. Di chuyển/nghiêng điện thoại cần thử thật.
- Ngưỡng mắt/hướng đầu, chất lượng camera, latency và khả năng thao tác của từng
  người cần hiệu chỉnh; chưa tuyên bố độ chính xác hay chứng nhận PAD.
- Enrollment vẫn là baseline không được bảo vệ bởi challenge; chưa có tài khoản
  đăng nhập, session, database mã hóa, rate limit hay giao thức xác thực hoàn chỉnh.
- Dừng camera hủy xử lý phía client và yêu cầu DELETE; nếu mất mạng, metadata lượt
  vẫn có thể còn đến TTL và lần dọn tiếp theo. Request đã đến server không thu hồi được.

Ngày 3: random hướng/thứ tự hành động do server sở hữu, củng cố freshness và binding,
kiểm thử video/ảnh thật; nếu vẫn bypass thì xem xét evidence/PAD độc lập theo giấy phép
và khả năng chạy. Chưa tự triển khai Ngày 3 trong phiên này.

Ngày 1: người dùng đã xác nhận hai lượt 0.5910/0.2142 đều là người đăng ký;
người khác và ảnh điện thoại vẫn Pending. GitHub chờ URL repository người dùng tạo.

Commit mã PoC: `e3f321f`; lời nhắc mở mắt: `a5e02ea`. Tài liệu và kết quả
kiểm thử được commit sau khi kiểm tra. Không có ảnh, video, descriptor hay landmarks thật trong Git.
