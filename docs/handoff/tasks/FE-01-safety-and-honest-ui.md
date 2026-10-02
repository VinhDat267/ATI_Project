# FE-01 · Sửa các lỗi an toàn và nội dung sai sự thật trên giao diện

**Trạng thái:** chờ · **Nhánh gợi ý:** `fix/fe-01-safety-and-honest-ui` · **Phụ thuộc:** không · **Làm song song với:** W3-00, AUTH-01 · **Nên xong trước:** mọi buổi demo, W4-03, W4-04

Nguồn: review frontend của Claude Code ngày 02/10/2026 trên `main` `2ae2a16`. Các lỗi dưới đây đã được xác nhận bằng chạy app sandbox, build thật hoặc đọc test; ghi rõ cách xác nhận ở từng mục.

## Lỗi cần sửa

### 1. Đóng hộp thoại lỗi lại dừng hẳn quy trình (nghiêm trọng)

- **Hiện trạng:** `App.tsx` truyền `onClose={handleStop}` cho `PartialFailureModal`. Trong modal, bấm **Esc**, bấm ra ngoài hoặc bấm **✕** đều gọi `handleClose` → `onClose` → `stopExecution`. Stop là thao tác không quay lại được (plan thành `stopped`).
- Test `tests/components/partial-failure-modal.test.tsx:42` ("closes on Escape key press by calling onClose or onStop") đang **khóa chặt hành vi sai** này.
- **Yêu cầu:**
  - Esc, bấm ra ngoài, ✕ chỉ **ẩn** hộp thoại;
  - quy trình vẫn ở trạng thái tạm dừng, và một thanh thông báo trong khung chat cho phép mở lại hộp thoại;
  - chỉ nút "Dừng quy trình" mới gọi Stop, kèm bước xác nhận ("Dừng hẳn? Không thể chạy tiếp sau khi dừng");
  - sửa test cũ theo hành vi mới, ghi rõ trong PR.

### 2. Mật khẩu admin bị đóng gói vào file JS khi build (nghiêm trọng)

- **Hiện trạng:** `vite.config.ts` gán `import.meta.env.VITE_DEFAULT_ADMIN_PASSWORD` bằng `CHAT_ADMIN_PASSWORD` khi `RUNTIME_MODE !== 'live'`. Nếu không có `.env` thì dùng giá trị cố định `Admin@12345678`. Reviewer đã chạy `vite build` với `.env` hiện tại (`RUNTIME_MODE=sandbox`): **mật khẩu thật có trong file JS**. Tài khoản này cũng là admin khi chạy live, vì hai chế độ dùng chung database.
- **Yêu cầu:**
  - bỏ việc đưa mật khẩu vào bundle;
  - nút "Điền nhanh" và ô hiện tài khoản thử nghiệm chỉ có khi chạy `vite` dev server (`import.meta.env.DEV`) **và** có cờ `VITE_SHOW_DEMO_LOGIN=true`;
  - giá trị lấy từ một tài khoản demo riêng của sandbox (không phải `CHAT_ADMIN_*`);
  - `vite build` không bao giờ chứa các giá trị này: có test build rồi tìm chuỗi trong `dist`.
  - Cập nhật `CURRENT-STATE.md` mục lỗi đã biết khi merge (reviewer làm).

### 3. Trạng thái dịch vụ giả (nghiêm trọng)

- **Hiện trạng:** `MissionControlLaunchpad.tsx` viết cứng `INTEGRATIONS` và dòng "LIVE INTEGRATIONS STATUS ✓ 4/4 Dịch vụ hoạt động tốt". Danh sách có cả Google Sheets ("Đồng bộ"), dù Sheets chưa tích hợp. Cùng lúc đó, màn hình "Cài đặt dịch vụ" hiện Trello và Slack "Chưa cấu hình". Reviewer đã thấy cả hai trên cùng phiên sandbox.
- **Yêu cầu:**
  - trạng thái lấy từ `GET /api/services` (đã cấu hình hay chưa; kết quả "Kiểm tra kết nối" gần nhất nếu có);
  - không có dịch vụ nào chưa đăng ký;
  - không dùng chữ "LIVE" khi đang ở sandbox.

### 4. Quy trình mẫu hứa những việc hệ thống không làm được

- **Hiện trạng:** `BLUEPRINTS` có:
  - "Đồng bộ pull request hoàn thành, cập nhật trạng thái thẻ Trello sang Done…", trong khi không có tool đọc pull request hay chuyển card;
  - "Trello → Google Sheets → Slack", trong khi Sheets chưa có.
- **Yêu cầu:** mỗi mẫu chỉ dùng tool có trong catalog. Mẫu nhắc tới service chưa cấu hình thì hiện mờ, kèm "Cần kết nối X". Thêm test: tên service trong mỗi mẫu đều có trong `GET /api/services`.

### 5. Chế độ sandbox không được báo cho người dùng

- **Hiện trạng:** ở sandbox, planner luôn dùng mock trả **cùng một plan soạn sẵn** cho mọi câu chat. Reviewer hỏi "Tạo issue … trên GitHub…" và nhận plan "Tạo thẻ Trello sửa CSS, gán Minh…". Adapter cũng là giả. Giao diện không báo gì.
- **Yêu cầu:**
  - backend trả `runtimeMode` (ví dụ trong `GET /api/auth/config` của AUTH-01, hoặc `GET /api/health` nếu AUTH-01 chưa merge);
  - frontend hiện dải cố định "Chế độ thử nghiệm: kế hoạch mẫu, không gọi dịch vụ thật" khi `sandbox`.

### 6. Trang giới thiệu có số liệu chưa đo và dịch vụ chưa có

- **Hiện trạng:** `LandingPageView.tsx` ghi:
  - "< 10s xử lý toàn bộ quy trình", "Hoàn thành tức thì dưới 10 giây" (số đo thật: lập plan p95 14,8 s trên golden set, xem `CURRENT-STATE.md`);
  - "80% / 95% tiết kiệm thời gian", "15–20 phút", "2–3 giờ/ngày", "loại bỏ 100% sai sót cơ học", "mã hóa đa lớp… ngăn chặn triệt để";
  - mục hệ sinh thái liệt kê Gmail, Jira, Notion, Google Sheets như đã có.
- **Yêu cầu:**
  - chỉ giữ số liệu đã đo, kèm nguồn (ví dụ "lập kế hoạch trung vị 5,5 s, đo 01/10/2026 trên 50 câu"), hoặc bỏ;
  - danh sách dịch vụ chia "Đã hỗ trợ" và "Đang phát triển" theo `ROADMAP.md`;
  - mô tả bảo mật đúng với code (AES-256-GCM, allowlist, duyệt trước khi ghi);
  - không có Gmail (không nằm trong kế hoạch).

### 7. Trạng thái giả khi API lỗi

- `handleNewConversation`: API lỗi thì tạo ID giả `conv-<timestamp>` mà server không biết. Phải báo lỗi, không tạo ID giả.
- `handleApprovePlan`: thiếu ID thì dùng `'plan_default'`. Phải bỏ; plan không có ID thì không cho duyệt.
- `handleRejectPlan`: API hủy lỗi nhưng giao diện vẫn ẩn plan, trong khi plan trên server vẫn duyệt được. Phải giữ plan và báo lỗi.
- Lỗi mạng hiện nguyên chuỗi tiếng Anh "Failed to fetch" (thấy ở màn hình đăng nhập khi API không chạy). Đổi thành thông báo tiếng Việt ("Không kết nối được máy chủ…").
- `App.tsx` khôi phục phiên: `getMe` lỗi vì bất kỳ lý do gì (kể cả mất mạng tạm thời) thì xóa token. Chỉ xóa khi server trả 401 sau khi đã thử refresh.

## Tiêu chí nghiệm thu

- [ ] Test mới fail trước khi sửa cho từng mục 1–7.
- [ ] Mục 1: test Esc / bấm ngoài / ✕ **không** gọi `stopExecution`; nút Dừng có bước xác nhận. Browser E2E kịch bản lỗi: bấm Esc → quy trình vẫn tạm dừng, chạy lại được.
- [ ] Mục 2: script kiểm tra `vite build` (chạy với `.env` có `CHAT_ADMIN_PASSWORD`) không chứa giá trị đó trong `dist`; chạy trong `npm run check`. Không in giá trị bí mật ra log.
- [ ] Mục 3–4: test với `GET /api/services` giả trả 2 dịch vụ đã cấu hình và 1 chưa: dòng trạng thái đúng 2/3, mẫu dùng dịch vụ chưa cấu hình bị mờ.
- [ ] Mục 5: browser E2E sandbox thấy dải "Chế độ thử nghiệm"; test frontend chế độ live không có dải này.
- [ ] Mục 6: không còn các con số chưa có nguồn. PR liệt kê từng câu đã sửa, câu cũ và câu mới.
- [ ] `npm run check` exit 0; `npm run test:browser:v3` đạt hết.

## Kết quả (agent thi công điền)

- PR: [#27](https://github.com/VinhDat267/ATI_Project/pull/27).
- Commit triển khai: `1698506c90807fe1e5ec6ec3a68070b047b7a292` ; fix pass `77743f6fce7d97e9d206258fdd2e1e8770477cc0` (base `c6d6e89`).
- Test đã chạy và kết quả: `npm run check` exit 0, 526 test v3 + 66 evaluation offline; build/secret scan/launcher/env guard đạt. `npm run test:browser:v3` exit 0, 9/9 với PostgreSQL thật và adapter sandbox.
- Bằng chứng RED → GREEN và phạm vi: xem [nhật ký FE-01](../log/2026-10-02-codex-fe-01-safety-honest-ui.md).
- Review độc lập: đạt sau một lượt sửa tại `77743f6`; CI: xem checks trên PR #27 trước merge.
- Điều chưa làm hoặc khác với task card: không có thay đổi ngoài phạm vi. Không chạy model/provider hay dịch vụ thật; trạng thái lần kiểm tra kết nối là dữ liệu trong tiến trình, reset khi restart. Giữ CURRENT-STATE/ROADMAP cho reviewer cập nhật sau merge.
