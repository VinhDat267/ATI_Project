# 28/10/2026 · GMAIL-04 · Chuẩn bị PR bật cờ, chờ nghiệm thu thật

**Task:** [GMAIL-04](../tasks/GMAIL-04-measure-and-live.md), Bước 6. Người dùng yêu cầu thực hiện sau khi đọc các phần còn lại, cung cấp địa chỉ tài khoản thử và hỏi tài khoản nào dùng được. Tài khoản kết nối cần được thêm Test users của project Google; không ghi địa chỉ thật vào log công khai.

**Nhánh:** `codex/gmail-04-enable-flags`. Worktree do app tạo tại `C:/Users/Admin/.codex/worktrees/gmail-04-enable-flags/ATI_Project`, từ `origin/main` `b437f98`. Checkout cũ trên nhánh SCHED-03 được giữ nguyên. **Commit mã:** `26db0b2`.

## Phạm vi và trạng thái

- Chuẩn bị mã, test và hướng dẫn cho PR **nháp**. Không merge, không đổi `.env` của người dùng và không đánh dấu GMAIL-04 hoàn tất.
- Gmail không đặt cờ (hoặc để trống) chỉ tự bật khi đủ ba biến OAuth client. Sandbox còn cần đủ bốn endpoint giả. Ép `off` luôn tắt; ép `on` thiếu cấu hình live vẫn lỗi khởi động như trước.
- `PLANNER_READ_ANSWERS` mặc định `on`, độc lập với Gmail. Tắt tường minh vẫn giữ chính sách cũ.
- Thêm bảng test 27 ca: live/sandbox × không đặt/on/off × đủ/thiếu một phần/không có client; thiếu endpoint giả; cấu hình đầy đủ nhưng sai URL; tính độc lập của hai cờ; cờ trống.
- Hai test cũ kiểm mặc định off được chuyển sang đầu vào **off tường minh**, giữ nguyên assertion. Hành vi mặc định mới được kiểm riêng trong bảng rollout; không nới assertion để bỏ lỗi runtime.
- Cập nhật `.env.example`, README và mục cài đặt/nghiệm thu Gmail trong `evaluations/README.md`. Catalog, prompt, label và model measurement runner không đổi.

## Bằng chứng

Các lệnh test chạy với cấu hình giả do test tạo, không tải `.env` của checkout cũ. PostgreSQL 16 Alpine tmpfs `ati-gmail04-check-pg`, cổng riêng **56534**. Migration 0001–0013 chạy trước kiểm tra; không dùng database cá nhân.

| Kiểm tra | Kết quả |
|---|---|
| `npm run test -w @wap/chat-api -- tests/config/gmail-rollout.test.ts` trước sửa | exit 1, **7 failed / 20 passed** |
| Test bảng rollout và bốn file hồi quy cấu hình Gmail/runtime/Calendar/Sheets sau sửa | exit 0, **61/61** |
| Năm đột biến, khôi phục SHA-256 từng lượt | **5/5 bị bắt**, từng mutant exit 1; runner exit 0 |
| `npm run typecheck:v3` | exit 0 |
| `VITEST_MAX_WORKERS=2 npm run check` | exit 0, **2.536 v3** = 67 schemas + 443 adapters + 381 planner + 42 executor + 720 API + 883 web, **406 eval**, **11 launcher/env**; build và quét build đạt |
| `SCENARIO=gmail npm run test:browser:v3` | exit 0, **10/10**, gồm OAUTH-01, 1440/375 sáng/tối |
| `SCENARIO=answer npm run test:browser:v3` | exit 0, **4/4**, 1440/375 sáng/tối |
| Probe startup server thật với `RUNTIME_MODE=live`, không client Gmail | exit 0, `/api/health` **ok**, `runtimeMode=live`, không có Gmail bật |

Browser dùng OAuth/Gmail giả, API/web **3998/5198**. Probe live dùng database riêng `gmail04_startup` trong container test, API **3997**, model key fixture không thực hiện lời gọi; chỉ mở health rồi dừng server. Đây là bằng chứng khởi động, **không phải nghiệm thu Gmail thật**.

Năm đột biến bị bắt: trả mặc định answer về off; bỏ auto Gmail; bỏ tôn trọng off; bật auto khi chỉ có một phần client; bật auto sandbox khi thiếu endpoint giả. Script ghi từng output và khôi phục mã nguyên byte, so SHA-256.

Bằng chứng cục bộ và script tại `.codex/gmail04-rollout/2026-10-28/` ở checkout gốc; bản chạy tại `node_modules/.cache/gmail04/` của worktree. Manifest SHA-256 đi cùng bằng chứng, không commit log thô. Full browser chưa chạy lại cục bộ; CI của PR sẽ chạy toàn bộ theo workflow hiện có. Không dùng CI cũ để chứng nhận head này.

## Điều kiện còn thiếu

- Chưa có cấu hình `GMAIL_OAUTH_CLIENT_ID`, `GMAIL_OAUTH_CLIENT_SECRET`, `GMAIL_OAUTH_REDIRECT_URI`, `GMAIL_OAUTH_PROJECT_ID` trên máy thi công đã kiểm. Chỉ kiểm sự hiện diện, không in giá trị bí mật.
- Bước 5, Google thật/P-LIVE **NOT_RUN**. Chưa gửi thư thật, chưa thu hồi quyền hoặc sửa tài khoản Google. Cần người dùng cấu hình OAuth trong file bị ignore, đăng nhập Google, và duyệt từng kế hoạch ghi trong app theo P-LIVE.
- Chưa có manifest bằng chứng live phần 1–3, chưa có quyết định bật từng cờ. Phần số đo 18/10 được giữ nguyên, không chạy lại campaign và không sửa label.
- Sau khi nghiệm thu đủ: cập nhật kết quả/log, review độc lập, CI xanh, nhóm trưởng quyết định từng cờ rồi mới chuyển PR khỏi nháp/merge. Không đánh dấu hai điều kiện live là đã đạt từ test fake.
