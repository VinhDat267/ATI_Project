# 2026-11-14 — GMAIL-04 (Bước 5–6): Nghiệm thu Google Cloud OAuth thật, bật mặc định `PLANNER_READ_ANSWERS=on` và đóng PR #322

- **Task:** [`docs/handoff/tasks/GMAIL-04-measure-and-live.md`](../tasks/GMAIL-04-measure-and-live.md)
- **Nhánh:** `feat/gmail-04-enable-flags` (từ `origin/main` `7d41f0a2` sau PR `#327`)
- **Dọn PR cũ:** Đã đóng PR `#322` (`CLOSED`, thay thế bởi `#327` đã merge tại `7d41f0a2`).

## 1. Nghiệm thu Google Cloud OAuth thật (`RUNTIME_MODE=live`, PostgreSQL 16)

Chạy kiểm chứng end-to-end qua giao diện web (`http://localhost:5174`) với tài khoản quản trị phiên thử (`a8d84e0c`), mô hình `deepseek-chat`, cờ `GMAIL_ENABLED=on` và `PLANNER_READ_ANSWERS=on`, dùng Google Cloud project OAuth riêng cho Gmail (`ati-gmail-personal`, scope `https://www.googleapis.com/auth/gmail.modify`) tách biệt hoàn toàn với client đăng nhập Google và các project Calendar/Sheets:

1. **Phần 1 — Vòng đời kết nối, thu hồi ngoài & ngắt kết nối (6/6 PASS):**
   - **Kết nối OAuth:** tạo bản ghi `service_credentials` `96b720e0` (`status = 'active'`, scope `gmail.modify`, `matchesGmailEnvClient: true`).
   - **`GET /api/services`:** trả về `{ id: 'gmail', connected: true, configured: true, connectionStatus: 'healthy', status: 'connected' }`.
   - **Thu hồi quyền từ trang Google Account & token hết hạn:**
     - Credential `0402678b` (hết hạn 7 ngày Testing từ `2026-11-07`) khi chạy probe `b00cfa21-5e86-4f02-b6c0-a85a47283782` từ chối an toàn (`plans = 0`, `execution_steps = 0`) và chuyển sang `reconnect_required` (`"Cần kết nối lại"`).
     - Sau khi thu hồi ngoài trên Google Account cho `96b720e0`, probe `e6ad4076-2931-4378-b01f-6f2230ce4e90` cũng từ chối an toàn (`plans = 0`, `execution_steps = 0`) và chuyển `96b720e0` sang `reconnect_required`.
   - **Kết nối lại:** tạo bản ghi mới `fd24b305` (`status = 'active'`, `refreshTokenShaPrefix: fb3cda868bd4`).
   - **Ngắt kết nối (`DELETE /api/connections/gmail`):** HTTP `200 OK` `{"success":true}`, không có lỗi thu hồi từ xa, xóa sạch cấu hình `gmail` của tài khoản thử (`0` dòng) trong khi các dịch vụ ngang hàng (`mycalendar`, `mysheets`, `trello`, `notion`, `telegram`, `github`, `slack`) còn nguyên.
   - **Đăng nhập Google không bị ảnh hưởng sau khi ngắt Gmail:** luồng `"Tiếp tục với Google"` tại đúng origin web hoàn tất trọn vẹn (`oauth_states` `f51923b0-7380-4b06-9c3d-3b0882e821fb`, `mode: 'login'` được tiêu thụ, tạo phiên hoạt động `auth_sessions` `5aeb69f7-b73a-4ccc-997a-d1f3e3084aba` cho tài khoản Google `9fde7835`).

2. **Phần 2 — Đủ 6 tool ghi Gmail + đọc lại + ca token hỏng thật (PASS):**
   - Trong hội thoại `9888ba64-1326-4a1e-b70b-fdd5e7e20e0c`, mọi thao tác đều qua xem trước, duyệt đúng `plan_hash`, và chỉ tự gửi tới hộp thư thử nghiệm của nhóm:
     - `gmail.create_draft`: plan `f6995ff4` (`1e5c109f7df6`), `succeeded` (`1099 ms`), `outId: r1988551119694608452`, `outThreadId: 1a1d9c5a287ec711`.
     - `gmail.send_message`: plan `68604166` (`57843b3d0453`), `succeeded` (`715 ms`), `outId/outThreadId: 1a1d9c61f0a0c5f9` + đọc lại xác nhận.
     - `gmail.reply`: plan `d7b80c03` (`ca481fcf9875`), `succeeded` (`1093 ms`), `outId: 1a1d9c771b3fe124`, `outThreadId: 1a1d9c61f0a0c5f9` + đọc lại 2 thông điệp.
     - `gmail.forward`: plan `b298eed4` (`09adb2bb9223`), `succeeded` (`1093 ms`), `outId/outThreadId: 1a1d9ca265b9afa9` + đọc lại tiền tố `Fwd:`.
     - `gmail.modify_thread_labels`: plan `8f7ce8df` (`13fe28d3c68b`), `succeeded` (`585 ms`), `+STARRED` + đọc lại xác nhận khớp `is:starred`.
     - `gmail.trash_thread`: plan `e0f379e1` (`6ace28c3b363`), `succeeded` (`555 ms`), đọc lại xác nhận nhãn `TRASH` và đã rời `INBOX`.

3. **Phần 3 — Câu hỏi chỉ đọc với `PLANNER_READ_ANSWERS=on` (PASS):**
   - Gmail (`c1393c45-9a81-4862-bf13-ca33aed809dd`, `1` lần tra cứu), Trello (`4a8005b0-b8e7-43bc-9e86-1682e95389f3`, `1` lần tra cứu), Notion (`66491698-66be-4ee3-be13-f9af2df16218`, `2` lần tra cứu), Telegram (`7fb5f79f-b4de-4d38-860c-bd8bf5f2217a`, danh mục dịch vụ), Jira (`e5893da6-79a7-481b-bc97-fc627d708323`, từ chối đúng chính sách G2A `JIRA_LLM_EGRESS_DISABLED_IN_G2A`), Google Calendar & Sheets (`964596e9...`, `965ec12a-af98-4512-8360-5ad1b2ceb36d`, phát hiện token Testing 7 ngày hết hạn và chuyển `reconnect_required`): toàn bộ đều xác minh `plans = 0`, `execution_steps = 0`, kèm chân trang `"Chưa có gì được ghi lên công cụ nào."`.

## 2. Quyết định bật cờ & thay đổi cấu hình (Bước 6)

- **Quyết định của nhóm trưởng:** Đạt đủ điều kiện mở khóa của `GMAIL-04` (injection `9/9`, không câu ghi nào của `core`/`services` thành `answer`, Phần 1–3 Google thật đều PASS, không có bước ghi ngoài hộp thư thử nghiệm của nhóm):
  - **`GMAIL_ENABLED`:** Giữ hành vi tự động bật khi đủ `GMAIL_OAUTH_*` và tắt an toàn không báo lỗi khi máy live chưa cấu hình Gmail; vẫn fail-fast ở live nếu đặt `GMAIL_ENABLED=on` mà thiếu biến. Bổ sung test tường minh trong `apps/chat-api/tests/config/gmail-env.test.ts` và cập nhật JSDoc ở `apps/chat-api/src/config/env.ts`.
  - **`PLANNER_READ_ANSWERS`:** Chuyển mặc định trong `validateEnv` (`apps/chat-api/src/config/env.ts`) sang `'on'` (chỉ tắt khi đặt `PLANNER_READ_ANSWERS=off`). Cập nhật TDD Red -> Green tại `apps/chat-api/tests/services/read-answers.test.ts`, chú thích `.env.example`, và mục `GMAIL-04` trong `evaluations/README.md`.

## 3. Kho lưu trữ bằng chứng cục bộ (`docs/ai-evidence/GMAIL-LIVE/`, không commit) & SHA-256

Toàn bộ bằng chứng đã được che giấu bí mật/email/nội dung thư thật và kiểm tra `git check-ignore` trước khi lưu:

| Tệp (cục bộ / artifact phiên) | SHA-256 |
|---|---|
| `docs/ai-evidence/GMAIL-LIVE/2026-11-14-gmail-04-live-acceptance.md` | `FA6C4E9D97BD5131C3A6AD2BC33BB54E97FB673D7AC0CFEB528FC15646510AE4` |
| `browser_evidence/.../final_step_6.png` | `3A68E989AD421B7B7612AC668461CACE4C0DC7E42F26565A64892C534FC93912` |
| `browser_evidence/.../final_step_51.png` | `0CA2452DFDA00536922ADF1560F6716712931163A6FF1EF049FEE6EE8104FCBD` |
| `browser_evidence/.../final_step_83.png` | `0BDAF3375479663850CFDF4CF53FF8E9BCC06619DC44885E900E1632695AC7F4` |
| `browser_evidence/.../final_step_125.png` | `11A325A44FD0D5698E9A214FDC7BFB1E7359AEB10FD9B1C19DD22D7A0EA7B043` |
| `browser_evidence/.../final_step_185.png` | `9272D9F5A11CC1FDAB177FE147EFD04BCDDBFFC7391FC3EC8CB6963289F43F23` |
| `browser_evidence/.../final_step_217.png` | `17400956B90191CAA26CA49D66A982B832024B95B56D77336D761DE1650F9E4C` |
| `browser_evidence/.../final_step_254.png` | `87C895E87A0694711FA36837B85CF5D66370742A7B4F276F8CBB3FB59D981893` |
| `browser_evidence/.../final_step_266.png` | `305D1C92DD4F0642FDF9DFCEAC6E1C656FCAFB717061B151B22206430F35F91D` |

## 4. Nhắc nhở trước buổi bảo vệ

- Kết nối lại OAuth Google cá nhân (Gmail, MyCalendar, MySheets) trong vòng **7 ngày trước buổi bảo vệ**, vì Google Cloud project ở chế độ `Testing` tự động làm hết hạn refresh token sau 7 ngày.
