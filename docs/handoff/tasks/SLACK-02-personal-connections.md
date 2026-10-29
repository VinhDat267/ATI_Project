# SLACK-02 · Kết nối Slack cá nhân đa workspace, token rotation và CAS

**Trạng thái:** sẵn sàng triển khai (kế hoạch và task cards đã được duyệt)  
**Nhánh điều phối:** `docs/slack-02-plan` (tài liệu) · **Nhánh mã triển khai:** chia theo ba card con 02A, 02B, 02C  
**Nền:** `fc12e3fbd683f9ffee53322b4f5fc132d50fc2ac` (origin/main sau PR #183 `3d0edfa0`)  
**Phụ thuộc:** SLACK-01 (contracts nền, inventory và HTTP fixture đã merge)  
**Đặc tả:** [Slack cá nhân và trợ lý công việc trong ATI](../../superpowers/specs/2026-10-28-slack-personal-oauth-design.md) (mục 4, 8, 9, 10).  
**Kế hoạch chi tiết:** [Slack-02 Implementation Plan](../../superpowers/plans/2026-10-29-slack-02-personal-connections.md).

---

## 1. Mục tiêu và Phạm vi Điều phối

Thực hiện toàn bộ hạ tầng kết nối OAuth cá nhân cho Slack nhiều workspace (Free/Pro), lưu trữ credential an toàn, xoay token (token rotation) chống mất mát dữ liệu do refresh token dùng một lần, kiểm soát danh tính độc quyền (exclusive identity binding), ranh giới chấp thuận xử lý dữ liệu của tổ chức (F1) và giao diện Cài đặt đa workspace.

### Ranh giới Phạm vi:
- **Thuộc phạm vi SLACK-02:**
  - Hợp đồng interface connection/consent tại `packages/tool-schemas/`.
  - Migration DB `0014_slack_personal_connections.sql` (bảng `slack_personal_connections`, `slack_processing_consents`, mở rộng `oauth_states`).
  - Mở rộng fixture HTTP loopback giả lập Slack OAuth v2, rotating token và revoke tại `scripts/fake-slack-personal.mjs`.
  - Confidential OAuth client, `SlackTokenManager` tuần tự hóa refresh đa tiến trình có durable attempt marker chống crash.
  - API routes kết nối cá nhân `/api/connections/myslack/...` sau cờ `MYSLACK_ENABLED` (mặc định `off`).
  - UI Cài đặt hiển thị danh sách workspace, kết nối mới, ngắt kết nối từng workspace và callback view.
- **Ngoài phạm vi SLACK-02 (Dành cho SLACK-03–07):**
  - **Không** đăng ký công cụ `myslack.*` vào `ALL_TOOLS` hay `SERVICE_REGISTRY` (thuộc SLACK-03).
  - **Không** nhận sự kiện chủ động Events API, chữ ký ingress, queue (thuộc SLACK-04).
  - **Không** cấu hình ba mode, phân loại intent hay ngân sách (thuộc SLACK-05).
  - **Không** hộp đề xuất, workflow liên dịch vụ hay bản tổng hợp (thuộc SLACK-06).
  - **Không** gọi model LLM, prompt evaluation hay bật cờ live (thuộc SLACK-07).
  - **Không** hỗ trợ Enterprise-only capabilities (phạm vi pilot chốt Free/Pro).

---

## 2. Phân Rã Thành Các Task Cards Con (Narrowly Owned Child Cards)

Để tuân thủ nghiêm ngặt **Module Ownership** (`docs/team-workflow.md`), SLACK-02 được bóc tách thành ba task card con với ranh giới mã nguồn độc lập:

| Task Card | Module & Quyền sở hữu | Files được phép sửa | Nhánh triển khai gợi ý | Phụ thuộc |
|---|---|---|---|---|
| **[SLACK-02A](SLACK-02A-connection-contracts.md)** | **Integration / AI Engineer** | `packages/tool-schemas/` | `feat/slack-02a-connection-contracts` | SLACK-01 |
| **[SLACK-02B](SLACK-02B-oauth-backend.md)** | **Backend Engineer** | `apps/chat-api/`, `db/v3/`, `scripts/fake-slack-personal.*` | `feat/slack-02b-oauth-backend` | SLACK-02A |
| **[SLACK-02C](SLACK-02C-connection-ui.md)** | **Frontend Engineer** | `apps/chat-web/` | `feat/slack-02c-connection-ui` | SLACK-02A, SLACK-02B API |

---

## 3. Tiêu chí Nghiệm thu Tổng thể SLACK-02

1. **Schema Interface:** `packages/tool-schemas` export đầy đủ các interface DTO cho connection, consent và public metadata mà không làm ô nhiễm catalog `ALL_TOOLS`.
2. **Đa Workspace & Độc quyền Danh tính:** Một tài khoản ATI kết nối được nhiều Workspace Slack khác nhau; hai tài khoản ATI khác nhau không thể cùng kết nối một tài khoản Slack trong cùng một workspace (kể cả khi connection cũ ở `reconnect_required`).
3. **An toàn Refresh Token Dùng Một Lần (One-Use Rotation):**
   - Refresh token của Slack xoay nguyên tử vào database qua transaction advisory lock.
   - Crash safety: Có durable refresh-attempt marker lưu DB trước khi gọi HTTP; tiến trình con chết đột ngột giữa chừng không bao giờ khiến tiến trình sau gửi lại refresh token cũ, mà chuyển sang `reconnect_required` có tính tất định.
4. **Phân biệt Rõ Hình dạng Token Exchange vs Refresh:**
   - Code exchange lấy User Token từ `authed_user.access_token` (`xoxp-`), không lấy bot token ngoài cùng.
   - Refresh exchange xử lý đúng hình dạng phẳng (`token_type: 'user'`, `access_token`, `refresh_token`, `expires_in`).
   - Bắt buộc gọi `auth.test` xác minh danh tính chủ sở hữu và team ID.
5. **Ngắt kết nối An toàn (Disconnect Semantics):**
   - Vô hiệu hóa cục bộ trước (`status = 'revoked'`, tăng `identity_version`), sau đó gọi `auth.revoke` thu hồi riêng token đó trong background; không bao giờ gọi `apps.uninstall`.
   - Ngắt kết nối của tài khoản A không phá vỡ kết nối của tài khoản B trong cùng workspace.
6. **Ranh giới Chấp thuận Xử lý Dữ liệu (F1 Policy Gate):**
   - Chấp thuận tổ chức được cấp qua đường quản trị tin cậy (`slack_processing_consents`), không cho phép người dùng thường tự cấp qua checkbox.
   - Mất chấp thuận lập tức chặn đưa dữ liệu vào model thông qua `decideSlackModelUse`, kể cả khi token đang `active`.
7. **Cờ Tính Năng Mặc Định Tắt:** Khi `MYSLACK_ENABLED=off`, toàn bộ hệ thống giữ nguyên 100% baseline, không lộ route hay trạng thái trong health check.
8. **Kiểm Thử Thực Tế:** Tất cả test concurrency chạy trên PostgreSQL thật và HTTP loopback fixture thật; toàn bộ test suite `npm run check` đạt exit 0.

---

## 4. Bàn Giao & Thứ Tự Tích Hợp

- **Bước 1:** Hoàn thành và merge SLACK-02A (contracts) vào develop/main.
- **Bước 2:** Triển khai SLACK-02B (backend, DB migration 0014, fixture). Chạy test PostgreSQL concurrency và crash simulation. Merge SLACK-02B.
- **Bước 3:** Triển khai SLACK-02C (frontend UI). Chạy test vitest và browser spec. Merge SLACK-02C.
- **Bước 4:** Điều phối viên kiểm tra tích hợp toàn diện và đóng card SLACK-02.
