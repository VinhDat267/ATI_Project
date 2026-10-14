# GMAIL-03 · Giao diện Gmail: "Của riêng bạn", callback, cockpit, trang công khai

**Trạng thái:** chờ, giao `longnguyen005` ngày 13/10/2026 (làm sau ANS-01) · **Nhánh gợi ý:** `feat/gmail-03-gmail-ui` · **Phụ thuộc:** GMAIL-01 đã merge (API). Browser test và nhãn người nhận cần GMAIL-02 · **Mốc:** trước **23/10/2026**
**Đặc tả:** mục 3.9, dòng "Màn chưa rõ kết quả" ở 4.4, và 6.1. **Quy tắc chung và hợp đồng:** [GMAIL-common](GMAIL-common.md), đọc trước, nhất là mục 4.2 và 4.3.

## Mục tiêu

Khi `GMAIL_ENABLED=on`, mỗi người:
- tự kết nối, kết nối lại, ngắt kết nối Gmail của mình ở `/settings`;
- thấy rõ thư sẽ gửi từ địa chỉ nào, tới ai, và mỗi người nhận lấy từ đâu, trước khi duyệt.

Khi cờ tắt, giao diện không có chữ nào về Gmail, trừ câu mới ở `/privacy` (đúng cả khi bật lẫn tắt).

## Việc cần làm

1. **`/settings`** (`pages/Settings/`):
   - nhóm "Của riêng bạn" ở đầu trang, trên "Đã thiết lập" và "Chưa thiết lập". Lấy các dịch vụ có `connection === 'personal'` từ `GET /api/services`; hai nhóm cũ chỉ còn dịch vụ `shared`;
   - hàng Gmail có bốn trạng thái (đặc tả mục 3.9):
     - **chưa kết nối:** câu nói rõ ATI được làm gì (đọc, soạn, gửi, gắn nhãn, chuyển vào thùng rác, không xoá vĩnh viễn), hiện trước khi bấm. Nút "Kết nối Gmail" gọi `POST /api/connections/gmail/start` rồi chuyển trang tới `url`;
     - **đã kết nối:** địa chỉ Gmail, thời điểm kết nối kiểu Việt, nút "Ngắt kết nối" có hộp xác nhận;
     - **cần kết nối lại:** câu thường giải thích (quyền bị thu hồi, hoặc hết hạn 7 ngày ở chế độ thử nghiệm của Google), nút "Kết nối lại";
     - **đang chuyển hướng hoặc lỗi:** cách hiện lỗi hiện có của trang;
   - mọi thành viên thao tác được hàng này, không dựa vào `canConfigure`. Không có ô khoá, không có chip phạm vi;
   - `/settings#gmail` mở và focus đúng hàng, như `/settings#<id>` hiện có;
   - bản mẫu không có Gmail: dùng giá trị chuẩn của `docs/design/design-system.md`, chép kiểu hàng và ngăn chi tiết đang có.
2. **`/connections/gmail/callback`** (`routes.ts`, view mới theo `views/GoogleCallbackView.tsx`):
   - xoá query khỏi URL trước khi gửi;
   - gửi `code`, `state` lên `POST /api/connections/gmail/callback` đúng một lần, không thử lại;
   - phản hồi muộn (người dùng đã rời trang, đăng xuất, đổi phiên) không giành điều hướng;
   - thành công: về `/settings#gmail` với thông báo "Đã kết nối <email>";
   - lỗi: câu riêng cho từng `code` ở GMAIL-common mục 4.2 và nút về `/settings`.
3. **Cockpit:**
   - màn từ chối có `unavailableServices` chứa Gmail: nút "Kết nối Gmail" tới `/settings#gmail` cho **mọi người** (dịch vụ `personal`), cùng kiểu nút của FE-06b;
   - xem trước kế hoạch có bước Gmail hiện "Gửi từ: <email>" lấy từ `plan.connections.gmail.email`;
   - bước `send_message`, `reply`, `forward`, `create_draft` hiện đủ người nhận gồm `bcc`, tiêu đề và nội dung (xuống dòng, không tràn ngang ở 375). Mỗi người nhận có nhãn nguồn và cảnh báo theo GMAIL-common mục 4.3. Luồng hiện tiêu đề qua `resourceLabels`;
   - khoảnh khắc 8 (chưa rõ kết quả) của bước `send_message`, `reply`, `forward`: thêm link "Mở thư mục Đã gửi" (GMAIL-common mục 4.3) và câu hướng dẫn tự kiểm rồi chọn Bỏ qua hoặc Dừng. Không có nút Thử lại, như hiện nay.
4. **Trang công khai:**
   - `/privacy`: thay câu "ATI không đọc Gmail, Drive hay lịch cá nhân của bạn" (`PrivacyPage.tsx`) bằng câu đúng cả khi bật lẫn tắt: ATI chỉ đọc hộp thư bạn tự kết nối, và chỉ hộp thư đó. Khi `GET /api/health` trả `gmailEnabled: true`, thêm các điểm của đặc tả mục 3.8: nội dung thư đi qua 9router tới tài khoản model bên thứ ba; thứ được giữ trong DB; ngắt kết nối chỉ xoá token, hội thoại cũ vẫn còn;
   - `/guide` (`Guide/data.tsx`) và Landing chỉ thêm Gmail và mẫu câu Gmail khi `gmailEnabled`; khi tắt vẫn ghi 8 dịch vụ. Test đối chiếu tool của mẫu câu dùng `ALL_TOOLS` khi tắt, `ALL_TOOLS` cộng `GMAIL_TOOLS` khi bật;
   - `scripts/test-v3-web-build-security.mjs` thêm mẫu chặn câu "không đọc Gmail".
5. **Browser:** nhóm `gmail` trong `scripts/test-v3-browser.mjs`, với `GMAIL_ENABLED=on`, `SANDBOX_SCENARIO=gmail` và máy chủ Google giả của GMAIL-01/02. Luồng:
   - `/settings` → kết nối (OAuth giả) → câu Gmail → xem trước có "Gửi từ" và nhãn người nhận → duyệt → biên nhận;
   - ngắt kết nối → câu Gmail bị từ chối, có nút "Kết nối Gmail".
   Nhóm `default` (cờ tắt) thêm một ca: `/settings`, `/guide`, Landing, cockpit không có chữ "Gmail".

## Test tối thiểu

- **Unit/DOM:**
  - bốn trạng thái của hàng Gmail;
  - thành viên thường (không `canConfigure`) vẫn bấm được "Kết nối Gmail";
  - hộp xác nhận ngắt kết nối có Esc và trả focus;
  - callback gửi một lần (StrictMode không gửi hai lần), phản hồi muộn sau đăng xuất không điều hướng;
  - nhãn nguồn và cảnh báo người nhận đúng theo tool; `bcc` được hiện;
  - link thư mục Đã gửi chỉ có khi trạng thái `unknown` và chỉ ở ba tool gửi;
  - `/privacy` khi `gmailEnabled` true và false;
  - mẫu câu của `/guide` khớp catalog đang bật.
- **Browser:** nhóm `gmail` đạt ở sáng/tối, 1440 và 375. Nhóm `default` đạt, gồm ca "không có Gmail khi cờ tắt".
- **Trợ năng không đổi hình thức:** mỗi route một `h1`, một `main`; nút có nhãn; focus nhìn thấy.
- **Ảnh** đặt cạnh giá trị design system ở 1440/375 sáng/tối: hàng Gmail bốn trạng thái, callback, xem trước có "Gửi từ". Không commit ảnh; ghi đường dẫn trong log.

## Đột biến

- Hiện hàng Gmail khi cờ tắt.
- Dựa vào `canConfigure` cho nút "Kết nối Gmail".
- Gửi callback hai lần.
- Bỏ `bcc` khỏi xem trước.
- Bỏ cảnh báo người nhận lấy từ luồng ở `send_message`.

Mỗi đột biến phải bị ít nhất một test bắt; ghi kết quả vào log.

## Tiêu chí nghiệm thu

- [ ] RED trước GREEN; đột biến trên đều bị bắt.
- [ ] `npm run check` exit 0; `npm run test:browser:v3` exit 0, gồm nhóm `gmail`.
- [ ] Quét bản build đạt, gồm mẫu mới.
- [ ] Không gọi Google thật.

## Ngoài phạm vi

- Backend kết nối và tool (GMAIL-01, GMAIL-02); màn trả lời (ANS-01).
- Bản mẫu HTML mới cho Gmail.
- Kiểm với Google thật (GMAIL-04, nhóm trưởng chạy).

## Kết quả (agent thi công điền)

- PR:
- RED/GREEN và đột biến:
- Điều chưa làm hoặc khác với task card:
