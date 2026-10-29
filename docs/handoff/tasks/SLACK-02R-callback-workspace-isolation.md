# SLACK-02R · Cô lập Callback theo Workspace & Thứ tự State Bền vững

**Ủy quyền:** Điều phối viên trưởng/reviewer chỉ định sau độc lập review PR #184 (nhánh `codex/slack-02-oauth` tại commit `ac448dd39fd8b9188c4ebc967cb735454bbc803d`).
**Thiết kế chuẩn tắc:** [Thiết kế Slack cá nhân](../../superpowers/specs/2026-10-28-slack-personal-oauth-design.md), mục 4.1–4.5, và AGENTS.md.
**Nhánh làm việc:** `VinhDat267/fix-slack-callback-isolation` (tách riêng từ `origin/codex/slack-02-oauth` tại `ac448dd39fd8b9188c4ebc967cb735454bbc803d`).

---

## 1. Bối cảnh & Vấn đề (Root Finding P2)

- Trong PR #184 ban đầu, tại `apps/chat-api/src/db/repositories/slack-connection-repo.ts`:
  Sau khi hoàn tất lưu kết nối ở `save()`, repo thực thi:
  `DELETE FROM slack_oauth_states WHERE user_id=$1;`
- Khi người dùng ATI bắt đầu 2 luồng OAuth song song (ví dụ: mở 2 tab kết nối 2 workspace Slack khác nhau $T_0$ và $T_1$):
  - Luồng 1 callback thành công và gọi `save()`, lệnh DELETE trên xóa sạch toàn bộ state của người dùng trong `slack_oauth_states`.
  - Luồng 2 dù state hợp lệ và đã consume nhưng khi vào `save()` không còn tìm thấy state record, dẫn đến luồng 2 thất bại (`saved: 1 / connections: 1`, mong đợi `connections: 2`).
- 22 bài test backend hiện có đều pass do các test trước đó thực thi tuần tự `start -> consume -> save` cho từng workspace thay vì khởi tạo song song 2 flow trước khi callback.
- Không thể chỉ đơn giản thay bằng `DELETE FROM slack_oauth_states WHERE id=$1` vì nếu không có cơ chế thứ tự bền vững (durable ordering), một luồng cũ hơn (older flow) cho cùng 1 workspace có thể ghi đè token mới hơn được hoàn tất trước đó.

---

## 2. Phạm vi & Quyền sở hữu (Module Ownership)

- **Quyền sở hữu file duy nhất:**
  - `docs/handoff/tasks/SLACK-02R-callback-workspace-isolation.md` (task card này)
  - `apps/chat-api/src/db/repositories/slack-connection-repo.ts` (logic repo)
  - `apps/chat-api/tests/db/slack-connection-repo.test.ts` (test repo mức PG)
  - `apps/chat-api/tests/routes/slack-connections.test.ts` (test route mức HTTP)
  - `db/v3/0015_slack_callback_order.sql` (migration tiến về thứ tự bền vững của state/connection)
  - `docs/handoff/log/2026-10-29-slack-02r-callback-isolation.md` (log bàn giao mới)
- **Tuyệt đối không đụng vào:**
  - Không sửa frontend (`apps/chat-web/`), schemas, adapters, hoặc cấu hình khác.
  - Không gọi native Slack API / model live / app live.
  - Không sửa branch gốc của tác giả (`codex/slack-02-oauth`), `main`, hay worktree của người khác.

---

## 3. Hành vi nghiệp vụ bắt buộc (6 Tiêu chí cốt lõi)

1. **Consume CAS per state:** Mỗi OAuth state chỉ được consume chính xác một lần bằng CAS query nguyên tử (`UPDATE slack_oauth_states ... WHERE used_at IS NULL RETURNING o.id`).
2. **Two valid states / two different workspaces:** Hai state hợp lệ cho 2 workspace khác nhau đều phải kết nối thành công bất kể thứ tự callback về trước/sau.
3. **Stale same-workspace protection:** Với cùng một workspace, luồng cũ hơn (bắt đầu trước) không được phép ghi đè danh tính/token đã được áp dụng bởi luồng mới hơn (bắt đầu sau).
4. **No resurrections:** Không làm sống lại (resurrect) kết nối sau disconnect hoặc logout (`auth_sessions` bị revoke).
5. **Reconnect generation increment:** Kết nối lại cùng workspace giữ nguyên `id` của connection và tăng `identity_version` (tách biệt với refresh token rotation).
6. **No identity conflict / auto-revoke:** Người dùng ATI khác không thể chiếm đoạt danh tính Slack đã liên kết (`active` hoặc `reconnect_required`); vi phạm unique constraint trả về `SLACK_IDENTITY_CONFLICT` mà không tự ý revoke kết nối của người cũ.

---

## 4. Thiết kế Kỹ thuật (Durable Ordering / CAS Protocol)

- Bổ sung sequence/thứ tự tăng dần cho OAuth state (`order_seq` trong `slack_oauth_states`) và cột lưu thứ tự state đã áp dụng gần nhất (`last_state_order` trong `slack_connections`).
- Khi `repo.save(userId, stateId, input)`:
  - Đọc `order_seq` của state đang xử lý (dưới transaction và session lock).
  - Khi INSERT / ON CONFLICT `(user_id, app_id, workspace_id)` DO UPDATE:
    Chỉ cho phép UPDATE nếu `excluded.last_state_order > slack_connections.last_state_order`.
    Nếu luồng cũ đến sau, điều kiện WHERE không thỏa mãn, không có row nào được cập nhật (`RETURNING *` rỗng) -> transaction rollback và trả về `null`.
  - Chỉ xóa chính state đã hoàn tất: `DELETE FROM slack_oauth_states WHERE id=$1 AND user_id=$2;`. Các state khác của người dùng cho các workspace khác vẫn được bảo toàn nguyên vẹn.
- Hợp đồng `disconnect`: Giữ nguyên hợp đồng hiện tại (xóa state của user khi disconnect) để đảm bảo an toàn, đồng thời ghi nhận việc giới hạn hủy theo từng workspace cho thiết kế tương lai.

---

## 5. Kế hoạch TDD & Kiểm chứng (Red-Green-Refactor)

1. **RED:**
   - Viết regression test trên PostgreSQL thật (`createMigratedSchema`): 2 state song song cho 2 workspace khác nhau -> xác nhận failure (chỉ lưu 1/2) trên code hiện tại.
   - Viết test cho trường hợp 2 state song song cùng 1 workspace: luồng mới hơn hoàn tất trước, luồng cũ hơn đến sau bị từ chối và không ghi đè token của luồng mới.
   - Viết test HTTP route mô phỏng 2 callback song song với HTTP provider mock thật.
2. **GREEN:**
   - Tạo migration `0015_slack_callback_order.sql` (hỗ trợ non-empty / idempotent).
   - Cập nhật `SlackConnectionRepo` với giao thức thứ tự bền vững và xóa state cục bộ.
   - Chạy test targeted vitest -> Tất cả 6 ca kiểm thử + 22 test nền tảng đều GREEN.
3. **VERIFY:**
   - Chạy `npm run typecheck`.
   - Chạy `npm run check` (toàn bộ suite).
   - Kiểm tra `git diff` so với `ac448dd39fd8b9188c4ebc967cb735454bbc803d`.

---

## 6. Kết quả

- **Đã khắc phục hoàn toàn P2 (Callback Independence & Workspace Isolation):**
  - Thêm forward migration `db/v3/0015_slack_callback_order.sql`:
    - Tạo `slack_oauth_state_seq` sequence đảm bảo thứ tự đơn điệu bền vững cho mọi state được tạo (`order_seq bigint NOT NULL DEFAULT nextval('slack_oauth_state_seq')`).
    - Bổ sung `last_state_order bigint NOT NULL DEFAULT 0` trong `slack_connections` để lưu thứ tự state đã áp dụng gần nhất.
    - Migration hoàn toàn idempotent và an toàn khi chạy lại nhiều lần trên cơ sở dữ liệu có sẵn dữ liệu state/connection thực tế.
  - Sửa `SlackConnectionRepo.save()`:
    - Đọc `order_seq` của state dưới khóa advisory lock và transaction của user.
    - Dùng mệnh đề `ON CONFLICT (user_id, app_id, workspace_id) DO UPDATE SET ... WHERE excluded.last_state_order > slack_connections.last_state_order RETURNING *`. Nếu luồng cũ đến sau luồng mới cho cùng một workspace, WHERE không thỏa mãn, không có bản ghi nào bị cập nhật và transaction rollback, trả về `null`.
    - Xóa cục bộ chính xác state vừa lưu: `DELETE FROM slack_oauth_states WHERE id=$1 AND user_id=$2;`. Không còn lệnh xóa toàn bộ state của user (`DELETE ... WHERE user_id=$1`).
    - Giữ nguyên hợp đồng `disconnect` để ngăn chặn resurrection/cứu hồi token cũ, đồng thời đánh dấu việc tối ưu hủy theo từng workspace cho thiết kế tương lai.
- **Bằng chứng kiểm thử TDD thực tế (RED → GREEN):**
  - **RED:**
    - Test PG mức DB: 2 luồng song song cho 2 workspace khác nhau ban đầu FAIL với `AssertionError: expected null to be truthy` tại `repo.save()` cho workspace thứ 2 (chỉ lưu 1/2 kết nối).
    - Test HTTP Route: 2 luồng callback song song ban đầu FAIL với status 400 (do state thứ 2 bị xóa).
  - **GREEN:**
    - 5 suite test backend Slack trong `apps/chat-api`: **27/27 tests PASS** (22 tests nền tảng ban đầu + 5 tests hồi quy/hành vi mới).
    - Bao phủ đầy đủ 6 ca hành vi bắt buộc:
      1. Consume CAS per state (chính xác 1 lần).
      2. Hai workspace độc lập thành công ở cả 2 thứ tự callback (sequential lẫn reverse order và song song).
      3. Bảo vệ cùng workspace: luồng cũ đến sau không ghi đè token/identity của luồng mới đến trước; luồng mới sau đó vẫn cập nhật thành công và tăng `identity_version`.
      4. Không resurrection sau disconnect hoặc logout.
      5. Reconnect giữ nguyên connection `id` và tăng `identity_version`.
      6. Chống chiếm đoạt (hijack) danh tính của user khác ngay cả khi connection ở trạng thái `reconnect_required`, và không tự ý revoke connection của nạn nhân.
    - Test migration 0015 lặp lại 2 lần trên DB có sẵn cả pending state lẫn saved connection thực tế, đọc trực tiếp file SQL gốc; pending state vẫn sống và hoàn tất kết nối bình thường sau migration.
    - Test HTTP route: 2 lượt start dùng chung cookie browser phiên (mô phỏng 2 tab) và callback đồng thời qua `Promise.all`, map provider mock theo code/token -> cả 2 workspace đều 200 và lưu 2 kết nối.
- **Full Verification Suite:**
  - `npm run typecheck`: EXIT 0 (sạch typecheck trên cả `chat-api` và `chat-web`).
  - `npm run check`: EXIT 0 (2.583 test v3 + 406 eval + 1 launcher + 66 Node fixtures).
  - Môi trường PostgreSQL 16 cô lập đạt chuẩn, không đụng chạm hay dừng container review chung trên cổng 55533.
- **Phạm vi bảo toàn:**
  - Không sửa frontend, schemas, adapters, hoặc config ngoài phạm vi.
  - Không bật cờ `MYSLACK_ENABLED` hoặc gọi API live / model live.
