# SLACK-02 · Kết nối Slack cá nhân đa workspace, token rotation và CAS

**Trạng thái:** chờ điều phối viên review và phê duyệt (awaiting coordinator review)
**Nhánh điều phối:** `docs/slack-02-plan` (tài liệu) · **Nhánh mã triển khai:** chia theo ba card con 02A, 02B, 02C
**Nền:** `fc12e3fbd683f9ffee53322b4f5fc132d50fc2ac` (origin/main sau PR #183 `3d0edfa0`)
**Phụ thuộc:** SLACK-01 (contracts nền, inventory và HTTP fixture đã merge)
**Đặc tả:** [Slack cá nhân và trợ lý công việc trong ATI](../../superpowers/specs/2026-10-28-slack-personal-oauth-design.md) (mục 4, 8, 9, 10).
**Kế hoạch chi tiết:** [Slack-02 Implementation Plan](../../superpowers/plans/2026-10-29-slack-02-personal-connections.md).

---

## 1. Mục tiêu và Phạm vi Điều phối

Thực hiện toàn bộ hạ tầng kết nối OAuth cá nhân cho Slack nhiều workspace (Free/Pro), lưu trữ credential an toàn với stable row per `(ati_user_id, slack_app_id, workspace_id)`, xoay token (token rotation) chống phát lại refresh token đã dùng sau sự cố crash qua session advisory lock (`pg_advisory_lock` trên PoolClient) và durable attempt marker, kiểm soát danh tính độc quyền (exclusive identity binding trên các bản ghi non-revoked), ranh giới chấp thuận xử lý dữ liệu của tổ chức (F1) và giao diện Cài đặt đa workspace.

### Ranh giới Phạm vi:
- **Thuộc phạm vi SLACK-02:**
  - Hợp đồng interface connection/consent tại `packages/tool-schemas/`.
  - Migration DB `0014_slack_personal_connections.sql` (bảng `slack_personal_connections` với ràng buộc stable row `UNIQUE (ati_user_id, slack_app_id, workspace_id)`, bảng `slack_processing_consents`, mở rộng `oauth_states`).
  - Mở rộng fixture HTTP loopback giả lập Slack OAuth v2, rotating token và revoke tại `scripts/fake-slack-personal.mjs`.
  - Confidential OAuth client, `SlackTokenManager` tuần tự hóa refresh đa tiến trình qua session advisory lock và durable attempt marker commit trước khi gọi HTTP.
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
2. **Đa Workspace & Độc quyền Danh tính:** Một tài khoản ATI kết nối được nhiều Workspace Slack khác nhau với stable row per workspace; hai tài khoản ATI khác nhau không thể cùng kết nối một tài khoản Slack trong cùng một workspace trên mọi bản ghi non-revoked (`WHERE status <> 'revoked'`).
3. **An toàn Refresh Token Dùng Một Lần (One-Use Rotation Safety):**
   - Refresh token của Slack xoay nguyên tử qua PostgreSQL session advisory lock (`pg_advisory_lock` trên PoolClient).
   - Cơ chế bất biến crash safety: Có durable refresh-attempt marker lưu DB trước khi gọi HTTP; tiến trình con chết đột ngột giữa chừng không bao giờ khiến tiến trình sau gửi lại refresh token cũ, mà chuyển sang `reconnect_required` có tính tất định.
4. **Phân biệt Rõ Hình dạng Token Exchange vs Refresh:**
   - Code exchange lấy User Token từ `authed_user.access_token` (`xoxp-`), không lấy bot token ngoài cùng.
   - Refresh exchange xử lý đúng hình dạng phẳng (`token_type: 'user'`, `access_token`, `refresh_token`, `expires_in`).
   - Bắt buộc gọi `auth.test` xác minh danh tính chủ sở hữu và team ID.
5. **Ngắt kết nối An toàn (Disconnect Semantics):**
   - Vô hiệu hóa cục bộ trước (`status = 'revoked'`, tăng `identity_version`), sau đó gọi `auth.revoke` thu hồi riêng token đó trong background; không bao giờ gọi `apps.uninstall`.
   - Ngắt kết nối của tài khoản A không phá vỡ kết nối của tài khoản B trong cùng workspace. Xung đột danh tính không thu hồi token của tài khoản đang kết nối.
6. **Ranh giới Chấp thuận Xử lý Dữ liệu (F1 Policy Gate) & `processingReady`:**
   - Chấp thuận tổ chức được cấp qua đường quản trị tin cậy (`slack_processing_consents`), không cho phép người dùng thường tự cấp qua checkbox.
   - `processingReady` chỉ true khi đồng thời thỏa mãn: connection active, consent granted, evidenceRef/authorizedBy đầy đủ, provider id khớp, verified && noTraining true, và retention cap không vượt quá.
   - Mất chấp thuận lập tức chặn đưa dữ liệu vào model thông qua `decideSlackModelUse`, kể cả khi token đang `active`.
7. **Cờ Tính Năng Mặc Định Tắt:** Khi `MYSLACK_ENABLED=off`, toàn bộ hệ thống giữ nguyên 100% baseline, không lộ route hay trạng thái trong health check. Danh sách kết nối trả về định dạng `{ connections: SlackConnectionPublicInfo[] }`.
8. **Kiểm Thử Thực Tế:** Tất cả test concurrency chạy trên PostgreSQL thật và HTTP loopback fixture thật; toàn bộ test suite `npm run check` đạt exit 0.

---

## 4. Bàn Giao & Chiến Lược Nhánh Stacked

- Các nhánh triển khai được tổ chức theo mô hình **stacked branches**:
  - Nhánh 1: `feat/slack-02a-connection-contracts` (từ `main`) -> Review độc lập.
  - Nhánh 2: `feat/slack-02b-oauth-backend` (từ `feat/slack-02a-connection-contracts`) -> Review độc lập.
  - Nhánh 3: `feat/slack-02c-connection-ui` (từ `feat/slack-02b-oauth-backend`) -> Review độc lập.
- **Không tự ý merge vào `main` hay `develop`** khi chưa có quyết định và hướng dẫn rõ ràng từ Điều phối viên Trưởng hoặc chủ dự án.
