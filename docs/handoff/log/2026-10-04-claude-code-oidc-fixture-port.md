# 2026-10-04 · Claude Code · Cổng của OIDC giả trong browser E2E

- **Bối cảnh:** CI của #69 (chỉ sửa tài liệu) đỏ ở scenario `auth04` với lỗi `listen EADDRINUSE 127.0.0.1:55534`. Chạy lại job thì xanh.
  - Cổng 55534 do AUTH-04 cố định cho server OIDC giả.
  - Cổng này nằm trong dải cổng tạm của Linux (32768–60999), nên một kết nối ra ngoài bất kỳ trên runner có thể đang giữ nó.
  - Không có task card riêng: đây là sửa hạ tầng test, người dùng báo CI lỗi.
- **Đã làm:**
  - Tách phần khởi động server OIDC giả ra `scripts/google-oidc-fixture.mjs`.
  - Server mở cổng 0; script dùng cổng thật nó báo để dựng `GOOGLE_OAUTH_*_URL` cho API.
  - Thêm `scripts/google-oidc-fixture.test.mjs` vào `npm run check`.
- **PR / commit:** nhánh `fix/browser-oidc-port`; `e17763a` (tách module, giữ hành vi), `b58199f` (test RED), `8397e5a` (sửa).
- **Kiểm tra đã chạy (lệnh và kết quả):**
  - **RED:** chiếm 55534 rồi khởi động fixture, ra `EADDRINUSE 127.0.0.1:55534`, giống CI.
  - **GREEN:** `node --test` 8/8.
  - `npm run check`: exit 0; v3 1.219, eval 165.
  - `npm run test:browser:v3` chạy **trong lúc một tiến trình giữ 55534**: exit 0, 28/28 ca qua 11 scenario (`auth04` 1/1).
- **Chưa làm / vấn đề phát hiện:** PostgreSQL test ở máy vẫn dùng cổng cố định 55533 (do `v3-local-env.mjs` bắt buộc); trên CI dùng 5432 của service nên không bị ảnh hưởng.
- **Việc tiếp theo đề xuất:** không có.
