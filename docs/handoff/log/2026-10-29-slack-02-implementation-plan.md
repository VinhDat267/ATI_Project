# 29/10/2026 · Kế hoạch Triển khai & Task Cards cho SLACK-02

**Ngày lập:** 29/10/2026 (Asia/Bangkok)
**Tác giả:** Antigravity Worker (gemini-3.8-flash-high)
**Nhánh làm việc:** `docs/slack-02-plan` (đổi tên sạch từ `VinhDat267/slack-02-implementation-plan`, không xung đột)
**Git Head nền:** `fc12e3fbd683f9ffee53322b4f5fc132d50fc2ac` (`origin/main`, sau khi merge PR #183 `3d0edfa0` cho SLACK-01)
**Mục đích:** Hoàn thiện kế hoạch chi tiết và các task card chuyên trách cho đợt triển khai **SLACK-02: Kết nối Slack cá nhân đa workspace, token rotation và CAS**, tuân thủ đầy đủ các điểm hiệu chỉnh và preflight review từ Điều phối viên (Coordinator).

---

## 1. Tóm tắt Nội dung Tiếp thu & Giải Pháp Kỹ Thuật

1. **Phạm vi Pilot & Độc quyền Danh tính Toàn cục (Correction 1 & Preflight):**
   - Giữ nguyên phạm vi Free/Pro; các tính năng Enterprise Grid được chuyển sang backlog tương lai.
   - Bảng `slack_personal_connections` giữ duy nhất một dòng ổn định per `(ati_user_id, slack_app_id, workspace_id)` qua ràng buộc `UNIQUE (ati_user_id, slack_app_id, workspace_id)`. Reconnect upsert trên dòng này và tăng `identity_version`.
   - Ràng buộc độc quyền danh tính `(slack_app_id, workspace_id, slack_user_id)` được áp dụng cho mọi bản ghi non-revoked (`WHERE status <> 'revoked'`), bảo vệ chống cướp quyền ngay cả khi kết nối cũ đang ở `reconnect_required`.
2. **An toàn Sự cố Crash cho Refresh Token Dùng Một Lần (Correction 2 & Preflight):**
   - Sử dụng **Session Advisory Lock (`pg_advisory_lock`) trên một `PoolClient` riêng biệt**.
   - Lưu một **durable refresh-attempt marker** (`refresh_attempt_id UUID`, `refresh_attempt_at TIMESTAMPTZ`) vào database và COMMIT marker transaction TRƯỚC KHI phát request HTTP ra ngoài, trong khi session advisory lock vẫn được duy trì trên client đó để ngăn mọi tiến trình khác.
   - Nếu tiến trình bị sập (crash) sau khi HTTP provider đã commit tiêu thụ refresh token nhưng trước khi DB publish: tiến trình khởi động lại phát hiện attempt marker treo, deterministically chuyển sang `reconnect_required` và **tuyệt đối không gửi lại refresh token cũ** (tránh lỗi `invalid_grant` do Slack thu hồi token dùng một lần).
   - Thiết kế bài test kiểm thử crash thực tế: Spawn tiến trình con, gửi tín hiệu `SIGKILL` ngay sau khi fixture nhận request, chứng minh tiến trình sau không tạo request HTTP thứ hai.
3. **Callback CAS Theo Từng State (Correction 3):**
   - Một consumer cho một state. Hai state hợp lệ cho hai workspace khác nhau trong cùng một session ATI có thể hoàn tất song song mà không bị triệt tiêu lẫn nhau.
   - So khớp generation và kiểm tra CAS ngăn chặn stale callback đè lên phiên bản mới hơn của cùng một workspace.
4. **Phân Biệt Hình Dạng Token Exchange vs Refresh (Correction 4):**
   - Code exchange lấy User Token từ `authed_user.access_token` (`xoxp-`), bỏ qua bot token cấp cao nhất.
   - User token refresh xử lý đúng hình dạng phẳng (`token_type: 'user'`, `access_token`, `refresh_token`, `expires_in`) theo chuẩn Slack Node SDK `install-provider.ts`.
   - Bắt buộc gọi `auth.test` xác minh danh tính owner và team ID sau khi nhận token.
5. **Ngắt Kết Nối & Thu Hồi Quyền An Toàn (Correction 5):**
   - Vô hiệu hóa cục bộ trước (`status = 'revoked'`, tăng `identity_version`), sau đó gọi `auth.revoke` thu hồi riêng token đó trong background; **không bao giờ gọi `apps.uninstall`** (để không làm gỡ app khỏi workspace dùng chung của người khác).
   - Ngắt kết nối của User A không làm hỏng kết nối của User B trong cùng workspace. Xung đột danh tính từ chối kết nối mới nhưng không thu hồi token của tài khoản đang kết nối hợp lệ.
6. **Ranh Giới Chấp Thuận Xử Lý Dữ Liệu (F1 Policy Boundary) & `processingReady` (Correction 6 & Preflight):**
   - Bảng `slack_processing_consents` lưu vết bằng chứng cấp phép của tổ chức, provider được phép và thời hạn retention.
   - Cấp phép qua đường quản trị tin cậy (`POST /api/admin/connections/myslack/:workspaceId/consent` yêu cầu admin session), không để người dùng thường tự cấp qua checkbox.
   - `processingReady` chỉ true khi toàn bộ các điều kiện sau được thỏa mãn đồng thời:
     1. `connection.status === 'active'`
     2. `consent.status === 'granted'`
     3. `consent.evidenceRef` và `authorizedBy` có giá trị xác thực
     4. `provider.id === consent.providerId`
     5. Cấu hình provider có `verified === true` và `noTraining === true`
     6. `consent.retentionDays <= provider.maxRetentionDays`
   - Bất kỳ điều kiện nào không thỏa -> fail-closed (`false`). Mất chấp thuận lập tức chặn đưa dữ liệu vào model thông qua `decideSlackModelUse`.
7. **Cờ Tính Năng & Bảo Tồn Hệ Thống (Correction 7 & Preflight):**
   - Chỉ thêm cờ `MYSLACK_ENABLED` (mặc định `off`).
   - `ALL_TOOLS` và `SERVICE_REGISTRY` tuyệt đối không đăng ký `myslack` trong SLACK-02 (dành cho SLACK-03).
   - API list envelope chuẩn: `{ connections: SlackConnectionPublicInfo[] }`.
   - Lệnh kiểm tra type chuẩn: `npm run typecheck` (hoặc `typecheck:v3`).
   - Phiên bản Express chuẩn: `express@5.2.1`.
8. **An Toàn Bảo Mật & CSRF (Correction 8):**
   - Bắt buộc cookie trình duyệt `ati_slack_browser`, xác thực phiên `auth_sessions`, finite timeout `AbortSignal`, và che giấu toàn bộ secret trong log/lỗi.
9. **Phân Rã Task Cards theo Quyền Sở Hữu Module & Quy Trình Bàn Giao (Correction 9 & Preflight):**
   - Bóc tách thành 3 cards con độc lập:
     - `SLACK-02A` (Integration: `packages/tool-schemas`)
     - `SLACK-02B` (Backend: `apps/chat-api`, `db/v3`, `scripts/fake-slack-personal.*`)
     - `SLACK-02C` (Frontend: `apps/chat-web`, browser runner)
   - Trạng thái card cha là **chờ điều phối viên review và phê duyệt**. Quy trình bàn giao là các nhánh stacked branches, không tự ý merge vào `main` hay `develop` khi chưa có hướng dẫn rõ ràng.
10. **Đánh Giá Phụ Thuộc & Kế Thừa PR #184 (Dependency Resolution):**
   - Nhánh draft PR #184 (`codex/slack-02-oauth`, commit `ac448dd`) được đánh giá là ứng viên tái sử dụng cho backend, nhưng chưa có shared tool-schemas DTO và có bug xóa nhầm OAuth state khi kết nối 2 workspace đồng thời.
   - SLACK-02A giữ nguyên phạm vi thêm contracts chuẩn độc lập tại `packages/tool-schemas`.
   - SLACK-02B sẽ đối soát và hợp nhất an toàn với PR #184 trên nhánh backend độc lập; không tạo bảng trùng lặp hay migration chồng lấn.

---

## 2. Danh Mục Tài Liệu Được Tạo & Commit

1. [`docs/handoff/tasks/SLACK-02-personal-connections.md`](../tasks/SLACK-02-personal-connections.md): Task card cha điều phối toàn bộ feature SLACK-02.
2. [`docs/handoff/tasks/SLACK-02A-connection-contracts.md`](../tasks/SLACK-02A-connection-contracts.md): Task card con cho Integration Engineer (`packages/tool-schemas`).
3. [`docs/handoff/tasks/SLACK-02B-oauth-backend.md`](../tasks/SLACK-02B-oauth-backend.md): Task card con cho Backend Engineer (`apps/chat-api`, `db/v3`, scripts fixture).
4. [`docs/handoff/tasks/SLACK-02C-connection-ui.md`](../tasks/SLACK-02C-connection-ui.md): Task card con cho Frontend Engineer (`apps/chat-web`).
5. [`docs/superpowers/plans/2026-10-29-slack-02-personal-connections.md`](../../superpowers/plans/2026-10-29-slack-02-personal-connections.md): Bản kế hoạch chi tiết 6 tasks chuẩn TDD Red-Green-Refactor.
6. `docs/handoff/log/2026-10-29-slack-02-implementation-plan.md`: File log bàn giao này.

---

## 3. Trạng Thái Mã Nguồn, Kiểm Thử & Hành Động Kế Tiếp

- **Mã nguồn:** Không có product code nào bị sửa đổi.
- **Kiểm thử sản phẩm:** `NOT_RUN` (giai đoạn lập kế hoạch và task cards thuần túy tài liệu, không chạy kiểm thử sản phẩm trước khi code).
- **Kiểm tra định dạng:** `git diff --check` đạt 0 lỗi trailing whitespace.
- **Git:** Nhánh `docs/slack-02-plan` sạch, chỉ chứa các file tài liệu và task cards mới. Sẵn sàng push và mở Draft PR cho tài liệu kế hoạch.
- **Sẵn sàng:** Bàn giao cho Điều phối viên Trưởng (Coordinator) để thẩm định và phê duyệt trước khi bắt đầu triển khai các nhánh stacked.
