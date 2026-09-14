# Task Hub & Engine Card Flows Status — 13/09/2026

**IMPLEMENTED / VERIFIED (Đợt 1):** Đã hoàn thành toàn bộ 8 tool local của server `task_hub` cùng migration `0004_task_hub_cards.sql` và các luồng card của engine qua controller/CLI thật. Dùng PostgreSQL 16 và MCP stdio thật.

> [!IMPORTANT]
> **Trạng thái G1 tổng thể vẫn là PARTIAL:** Server `task_hub` đã có đủ 8/8 tools, nhưng adapter `filesystem` (2 tools) và rubric môn học vẫn còn thiếu (chưa có 2 MCP servers). Các tầng `apps/api`, `apps/web`, HTTP lifecycle, session management, UI polling 2s, AI planner/retrieval và BullMQ worker tiếp tục giữ trạng thái **NOT_IMPLEMENTED / SPEC_ONLY**.

---

## 1. Kết quả kiểm chứng thực tế (Full Gate)

Các lượt npm ci, full gate và capture runtime chạy tuần tự, có log/exit code/timestamp ghi trực tiếp. Integration và snapshot dùng PostgreSQL 16.15 thật. Thời gian của lần link-check do Antigravity bổ sung sau không được xem là đã xác minh.

| Kiểm chứng | Lệnh | Exit Code | Kết quả thực tế | Log / Artifact |
|---|---|---|---|---|
| Cài đặt sạch | `npm ci --ignore-scripts --no-audit --no-fund` | 0 | 176 packages từ lockfile nguyên vẹn (9s) | [npm-ci.log](task-hub-evidence/batch-01/final/npm-ci.log) |
| Kiểm tra toàn diện | `npm run check:engine` (`ATI_EVIDENCE_DIR=docs/task-hub-evidence/batch-01/final`) | 0 | Typecheck PASS, build 4 packages PASS, emit schema/OpenAPI PASS, **142/142 tests PASS** (39 DSL unit/offline + 103 PostgreSQL/MCP integration; 0 failed, 0 skipped) | [check.log](task-hub-evidence/batch-01/final/check.log) |
| - Thư viện DSL | `npm test -w @wap/dsl` | 0 | **39/39 passed** (unit / offline) | trong `check.log` |
| - MCP Task Hub & DB | `npm run test:integration -w @wap/mcp-task-hub` | 0 | **63/63 passed** (56 MCP tools + 7 database migration/seed; PostgreSQL/MCP thật) | trong `check.log` |
| - Controller Engine | `npm run test:integration -w @wap/engine` | 0 | **40/40 passed** (b02, E01–E13, fault injection, CLI lifecycle; PostgreSQL/MCP thật) | trong `check.log` |
| Runtime snapshot | `node docs/task-hub-evidence/batch-01/final/capture-runtime.mjs` | 0 | Lần 1 FAILED do assertion shape sai trong test script (`output.card.id` thay vì `output.id`); lần 2 PASS: live discovery 8 tools, 4 migrations, assert đúng seed data, drop DB thành công (`database_dropped: true`). Hoàn toàn không có lỗi production code | [task-hub-runtime.json](task-hub-evidence/batch-01/final/task-hub-runtime.json), [capture-runtime-02.log](task-hub-evidence/batch-01/final/capture-runtime-02.log) |
| Kiểm tra liên kết tài liệu | `node docs/task-hub-evidence/batch-01/final/verify-links.mjs` | 0 | 12/12 tài liệu tồn tại, 65/65 internal markdown links PASS (0 broken links), phân biệt bare paths | [link-check.log](task-hub-evidence/batch-01/final/link-check.log) |
| Manifest kiểm chứng | `docs/task-hub-evidence/batch-01/final/manifest.json` | N/A (Artifact) | Bảng kê SHA-256 thực của 40 file source/test/migration/scripts TH01–06 và toàn bộ 162/162 protected files khớp 100% | [manifest.json](task-hub-evidence/batch-01/final/manifest.json) |

---

## 2. Danh mục 8 Tool MCP của `task_hub`

Tất cả 8 tool đều nằm trên **một server stdio `task_hub`** duy nhất với registry policy `b-local-1`:

| # | Tên Tool | Loại | Tóm tắt hành vi & Ràng buộc schema |
|---|---|---|---|
| 1 | `read_sheet_range` | Read | Đọc dải ô trong workbook/sheet (vd: `Progress!A1:B2`), tối đa 1000 dòng × 100 cột. |
| 2 | `append_sheet_rows` | Write | Thêm các dòng dữ liệu vào sheet có sẵn; kiểm tra approval, ghi mutation + receipt trong một transaction. |
| 3 | `send_slack_message` | Write | Ghi message vào channel nội bộ; kiểm tra approval, ghi mutation + receipt trong một transaction. |
| 4 | `list_cards` | Read | Lấy danh sách card thuộc board; hỗ trợ lọc `list_name`, `assignee_id`, `since`, `until`. Giới hạn 1000 kết quả (1001 báo `LIMIT_EXCEEDED`). Ngày được lọc theo trường `updated_at` dưới dạng khoảng nửa mở `[since, until + 1 ngày)` theo timezone được giải quyết từ metadata `_meta["ati/runtime"].time_zone` (mặc định `Asia/Ho_Chi_Minh`). |
| 5 | `get_card` | Read | Đọc chi tiết một card theo `card_id` thuộc quyền owner của principal. Trả về đúng schema `cardSummary` (`{ id, board_id, title, list_name }`). Không tìm thấy trả về `NOT_FOUND`. |
| 6 | `list_members` | Read | Danh sách thành viên trong board kèm `task_count` — tính theo **active workload semantics**: đếm số lượng card được gán cho member trên các list chưa hoàn thành (`is_done = false`). Giới hạn tối đa 1000 thành viên (1001 báo `LIMIT_EXCEEDED`). |
| 7 | `create_card` | Write | Tạo card mới với `card_id` sinh tự động bởi DB (`gen_random_uuid()::text`, raw UUID không prefix `c_`). Ràng buộc composite FK `(user_id, board_id, list_name)` và `(user_id, board_id, assignee_id)`. Yêu cầu approval trước; mutation và receipt commit cùng transaction; rollback nếu receipt lỗi; khóa danh sách chờ quá hạn trả `NOT_AUTHORIZED`. |
| 8 | `move_card` | Write | Chuyển card sang cột khác trong cùng board: `SELECT FOR UPDATE` trên card, `FOR KEY SHARE` trên target list. Khác target thì đổi `list_name` và `updated_at = clock_timestamp()`; cùng target thì giữ nguyên timestamp nhưng vẫn cần approval và receipt cho intent mới. Trả về `{ id, list_name }`. |

### Ràng buộc Schema chi tiết (Zod Contracts)
- **Strict extra fields:** Toàn bộ Zod schemas input và output đều khai báo `.strict()`; mọi thuộc tính thừa (additional properties) đều bị từ chối.
- **Tiêu đề (`title`):** `min(1).max(500).regex(/\S/)` — độ dài từ 1 đến 500 ký tự và không được toàn khoảng trắng.
- **Mô tả (`description`):** Chuỗi tối đa 16000 ký tự nếu cung cấp.
- **Miền ngày lịch (`calendarDate`):** Định dạng `YYYY-MM-DD`, chuẩn Gregorian từ `0001-01-01` đến `9999-12-31`, kiểm tra chính xác năm nhuận và ngày hợp lệ.
- **Trường optional không nhận `null`:** Các trường tùy chọn (`description`, `due_date`, `assignee_id`, `list_name`, `since`, `until`, `thread_ts`) dùng `.optional()`, chỉ nhận `undefined` (vắng mặt), không nhận `null`.
- **Giới hạn danh sách:** `list_cards` và `list_members` giới hạn tối đa 1000 kết quả; truy vấn cơ sở dữ liệu `LIMIT 1001`, nếu có 1001 kết quả sẽ ném lỗi `LIMIT_EXCEEDED`.

---

## 3. Các quy tắc cốt lõi đã kiểm chứng

1. **Một Shared Receiver Gate duy nhất (`TaskHub.call`):**
   Cổng kiểm tra quyền ghi duy nhất cho toàn bộ 4 write tools (`append_sheet_rows`, `send_slack_message`, `create_card`, `move_card`) là phương thức `TaskHub.call` trong `apps/mcp-task-hub/src/service.ts`. Phương thức này trực tiếp quản lý transaction receiver, kiểm tra `approvals` (`approved`, `running`, `snapshot_hash`, `approval_version === current_version`), đối chiếu `tool_operations` (hash payload và fingerprint), kiểm tra `gate.preview.actions`, và kiểm tra `assertLive()` sau khi chờ khóa. Hàm `writeCardTool` trong `apps/mcp-task-hub/src/cards.ts` chỉ là nhánh mutation chuyên biệt cho card được gọi *bên trong* transaction của gate này; không có gate riêng và không thể bypass approval.
2. **Khóa tài nguyên và thời hạn Approval (Lock & Expiry):**
   Thời hạn của approval được kiểm tra lại sau khi đã giành được khóa tài nguyên (row lock card hoặc list lock) và ngay trước khi commit. Nếu thời gian chờ khóa làm approval hết hạn, transaction tự động rollback toàn bộ và trả về `NOT_AUTHORIZED`.
3. **Idempotency & Replay:**
   Replay cùng `operation_id` và cùng payload trả về receipt đã commit mà không thực hiện lặp mutation (số card/message không tăng). Replay khác payload hoặc sau khi approval hết hạn bị từ chối và bảo toàn nguyên trạng DB.
4. **Bảo toàn dữ liệu di chuyển & Xử lý Unknown:**
   Mất response sau commit hoặc engine process crash (exit code 86) đưa run về trạng thái `reconciliation_required`. Tiến trình `reconcile` chỉ đọc DB, đối chiếu receipt và giữ nguyên toàn bộ trace lịch sử; không tự động resume hay lặp lại write.

---

## 4. Hướng dẫn chạy Demo thủ công (Manual Sequence)

> [!NOTE]
> Các bộ test tự động sử dụng database tạm cô lập (`engine_it_*`). Cơ sở dữ liệu demo `wap_g1` **chưa áp dụng migration 0004** trong lần chạy này. Người dùng có thể thực hiện theo quy trình chuẩn dưới đây:

```powershell
# 1. Build mã nguồn TypeScript trước khi chuẩn bị hoặc chạy
npm run build

# 2. Khởi động Docker containers (PostgreSQL 55432, Redis 56379)
npm run db:up:g1

# 3. Áp dụng toàn bộ 4 migration lên database demo wap_g1 (bảo toàn dữ liệu cũ)
npm run db:migrate:g1

# 4. Seed dữ liệu mẫu (sử dụng ON CONFLICT DO NOTHING - bảo toàn các sửa đổi trước đó)
npm run db:seed:g1

# 5. Chuẩn bị plan tay chuyển card th-move (đọc dữ liệu -> tạo preview và approval)
# Gán trực tiếp các trường định danh từ JSON trả về của prepare để copy/paste thực thi:
$prepareJson = node packages/engine/dist/cli.js prepare testdata/dev-hand-plans/th-move.json
if ($LASTEXITCODE -ne 0) { throw 'Prepare failed; inspect the error before continuing.' }
$prep = ($prepareJson -join "`n") | ConvertFrom-Json
$runId = $prep.run_id
$approvalId = $prep.approval.id
$versionId = $prep.workflow_version_id
$snapshotHash = $prep.approval.snapshot_hash

# 6. Xem trước (Preview) chi tiết các hành động bằng $runId
npm run engine -- preview $runId

# 7. Phê duyệt (Approve) với đúng 4 positional arguments lấy từ $prep:
npm run engine -- approve $runId $approvalId $versionId $snapshotHash

# 8. Thực thi (Execute) run đã duyệt
npm run engine -- execute $runId

# 9. Xem nhật ký attempt (trace có outcome_certainty = "confirmed")
npm run engine -- trace $runId

# 10. Đối chiếu và kiểm tra các bản ghi receipt trong DB (chỉ đọc)
npm run engine -- reconcile $runId
```

Lệnh `preview` trả về snapshot đã lưu (plan, inputs, runtime, reads, tools, actions), không trả approval ID hoặc snapshot hash. Lấy `$approvalId` từ `prepare.approval.id`, `$snapshotHash` từ `prepare.approval.snapshot_hash`, và `$versionId` từ `prepare.workflow_version_id`. Dùng Node trực tiếp khi đọc JSON để tránh banner npm lẫn vào stdout. Lệnh `trace` xuất các attempt cùng `outcome_certainty` thực tế; với demo thành công, mong đợi ba attempt `confirmed`. Các trường hợp mất phản hồi/crash vẫn giữ `unknown` trong trace. Để kiểm tra và đối chiếu các bản ghi receipt đã commit trong cơ sở dữ liệu, sử dụng lệnh `reconcile $runId`; không coi `trace` là bảng kết xuất trực tiếp các hàng receipt.

**Lưu ý quan trọng về tính bảo toàn của Seed:**
- `seedDemo` không ghi đè dữ liệu; nếu card `c1` đã được di chuyển sang `Done` trong một lần chạy trước đó, việc chạy lại `db:seed:g1` sẽ **không đặt lại** `c1` về `Doing`.
- Một lần chạy lại là một ý định (intent) mới với `run_id` và `operation_id` mới cần được xem và duyệt lại; không phải là replay của run cũ.

---

## 5. Scope còn lại của các đợt tiếp theo

| Thành phần | Trạng thái hiện tại | Kế hoạch đợt tới |
|---|---|---|
| `task_hub` (8 tools) | **HOÀN THÀNH (8/8)** | Đã nghiệm thu xong đợt 1 |
| `filesystem` adapter (2 tools) | **CHƯA LÀM (SPEC_ONLY)** | Đợt 2: Adapter `read_file`, `write_file`, root confinement, live discovery 2 server MCP |
| Rubric môn học & Mẫu việc thật | **CHƯA CÓ** | Đợt 2 / Đợt 6: Tiếp nhận rubric chính thức từ nhóm/giảng viên |
| `apps/api` (HTTP Lifecycle) | **CHƯA LÀM (SPEC_ONLY)** | Đợt 3: HTTP API, session management, worker dispatch |
| `apps/web` (UI Polling) | **CHƯA LÀM (SPEC_ONLY)** | Đợt 4: Giao diện 2 màn hình, polling 2 giây, trace hiển thị |
| AI Planner & Semantic Retrieval | **CHƯA LÀM (SPEC_ONLY)** | Đợt 5: LLM provider probe, prompt, bounded local replan, đo cost/latency |
