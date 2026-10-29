# 30/10/2026 · SLACK-03B2 — Lập Kế Hoạch Phả Hệ Nguồn Bản Sao Phái Sinh & Cascade Purge Bền Vững (PR Draft)

**Tác giả:** Backend Planning Owner (Antigravity gemini-3.8-flash-high).
**Ủy quyền điều phối:** Điều phối viên trưởng (Coordinator `term_c4dfa448-7670-4256-8dac-d0a1c9157a1d`) phân công thực thi Task `task_819dcf415436`, Dispatch `ctx_916711026016`.
**Nhánh công việc:** `docs/slack-03b2-derived-plan` (tách từ integration commit `e9088d5e76e95fa65e3be019226835371e40908d` trên `integration/slack-personal-20261029`).
**Tài liệu sở hữu duy nhất:**
1. Task card: [`docs/handoff/tasks/SLACK-03B2-derived-lineage-and-purge.md`](../tasks/SLACK-03B2-derived-lineage-and-purge.md)
2. Implementation plan: [`docs/superpowers/plans/2026-10-30-slack-03b2-derived-lineage-and-purge.md`](../../superpowers/plans/2026-10-30-slack-03b2-derived-lineage-and-purge.md)
3. Handoff log: [`docs/handoff/log/2026-10-30-slack-03b2-derived-plan.md`](2026-10-30-slack-03b2-derived-plan.md)

**Phụ thuộc & Hợp đồng Cơ sở:**
- **Integration Head (`e9088d5e` / `59f1aafc`):** Đã tích hợp và chấp thuận hợp đồng SLACK-01, 02 và schema 03A `bc8d6b69` (đầy đủ `SlackBinding`, `SlackSourceRef`, `SlackPolicyEpoch`, `SlackSourceLineage`, `SlackDerivedCopyRef`, và `SlackPurgeTarget` với 6 scopes bao gồm `policy_epoch_invalidated`). Bản kế hoạch 04A `1959e867f49` đã được review độc lập và vượt qua exact CI #40917031190 SUCCESS; actual runtime của 03B1 (`ctx_29765fc6b1b7`) và 03C1 (`ctx_89198a2a3d9d`) vẫn chưa được chấp thuận; không có delivery cũ hoàn tất từ `ctx411`.
- **Giao ước 03B1 (Kho nguồn thô & Hàng đợi vô hiệu hóa):** Đồng bộ chặt chẽ với sibling owner `ctx_29765fc6b1b7` trên nhánh `feat/slack-03b1-source-store`. Tận dụng cấu trúc giao dịch `stageInTransaction(client, { sourceEventKey, effects: [{ effectKey, barrier, purgeTarget? }] })` và hàng đợi `slack_invalidation_intents`. Khẳng định rõ: 03B1 hoàn tất raw source purge KHÔNG ĐƯỢC đánh dấu intent là completed; intent chỉ hoàn tất khi toàn bộ 7 nhóm derived copies được purge sạch bởi 03B2.
- **Giao ước 03C1 (Adapter đọc):** Đồng bộ với sibling owner `ctx_89198a2a3d9d` trên `feat/slack-03c1-read-adapters`. Khẳng định rõ: quyền đọc transient (`retentionDays: 0`) không tự động cấp quyền lưu trữ text phái sinh; việc lưu trữ đòi hỏi storage policy riêng biệt dưới cùng epoch thu thập.
- **Ranh giới Thực thi:** Phiên này thuần túy tài liệu kế hoạch (DOCS-ONLY); giữ nguyên toàn bộ mã nguồn sản phẩm và tài liệu của các agent khác; không thi công mã runtime mới, không gọi native Slack API, không gọi model AI trên nội dung Slack, không sửa `CURRENT-STATE.md` hay `ROADMAP.md`.

---

## 1. Khắc Phục Toàn Diện 8 Khiếm Khuyết Root Review (Root Review Findings Remediation)

Kế hoạch SLACK-03B2 và Task Card đã được rà soát và khắc phục triệt để 8 lỗi kỹ thuật cốt lõi:

### 1.1. Khắc Phục Lỗi Mã Hóa Ký Tự (Mojibake Recovery & Native UTF-8 Encoding):
- Toàn bộ 3 tệp tài liệu SLACK-03B2 đã được giải mã và khôi phục tiếng Việt chuẩn xác không mất mát từ lớp mã hóa kép CP1252→UTF8.
- Sử dụng ghi tệp native UTF-8 không BOM, không chứa ký tự thay thế `U+FFFD`, không chứa các marker biến dạng (loại bỏ hoàn toàn các ký tự hỏng do lỗi mã hóa trước đây).
- Đã xác minh thực tế qua việc kiểm tra raw bytes và nội dung hiển thị tiếng Việt tự nhiên kèm gạch ngang em-dash.

### 1.2. Phân Cấp TTL & 8 Thuộc Tính Canonical Của storagePolicyRef:
- Khắc phục việc mất trường `storage_requested_retention_days` trong DDL phân đoạn. Bảng `slack_derived_provenance_segments` hiện lưu đầy đủ 8 trường canonical của `storagePolicyRef`: `binding` (5 trường), `policy_purpose = 'storage'`, `storage_requested_retention_days` (1-30), `provider_profile_id`, `config_fingerprint`, `policy_version`, `consent_revision`, `provider_revision`, cùng bằng chứng thu thập `acquisition_purpose` và `acquisition_requested_retention_days`.
- Thiết lập ràng buộc kiểm tra phân cấp TTL chặt chẽ: `expiry <= effectiveTTL <= issuedTTL <= currentauthority` và trần tối đa `<= 30 ngày`:
  `storage_requested_retention_days INT NOT NULL CHECK (storage_requested_retention_days > 0 AND storage_requested_retention_days <= 30)`
  `effective_retention_days INT NOT NULL CHECK (effective_retention_days > 0 AND effective_retention_days <= storage_requested_retention_days)`
  `CONSTRAINT chk_slack_derived_provenance_ttl CHECK (expires_at > captured_at AND expires_at <= captured_at + make_interval(days => effective_retention_days) AND expires_at <= captured_at + INTERVAL '30 days')`
- Loại bỏ hoàn toàn lỗ hổng khai báo 1 ngày nhưng lưu thực tế 30 ngày, và ngăn chặn việc dùng metadata `isExcerpt` để lách luật trần 7 ngày của nguồn thô.

### 1.3. Ngữ Cảnh Chủ Sở Hữu Artifact & Thẩm Định Người Gọi (assertDerivedCopyAllowed):
- Bổ sung trường `ati_user_id UUID NOT NULL REFERENCES users(id)` vào bảng `slack_derived_copies`.
- Hàm `assertDerivedCopyAllowed` bắt buộc nhận đầy đủ thông tin định danh: `callerAtiUserId`, `consumerPurpose` (mục đích của người đọc hiện tại), `targetKind`, `targetId`, `targetSubId`, và `expectedTargetVersion`.
- Cơ chế bảo vệ: Xác thực `callerAtiUserId === derivedCopy.atiUserId`; kiểm tra khớp chủ sở hữu target và TẤT CẢ phân đoạn; cấm truy cập chéo giữa các người dùng ATI (`cross-ATI user`); từ chối cấp quyền nếu danh sách phân đoạn rỗng/thiếu; chống tái gắn revision cũ/mới trên cùng một target ID.

### 1.4. Bổ Sung Các Điểm Nhân Bản Bị Sót & Lan Truyền Nguồn Gốc Phía Máy Chủ:
- Bổ sung vào bảng ánh xạ độ bao phủ các điểm lưu trữ/nhân bản dữ liệu Slack thực tế:
  1. `ChatService` (lines 500-511): Khi nạp lịch sử hội thoại cho model, `messages.metadata.plan` và `messages.metadata.proposal` được serialize trực tiếp thành chuỗi JSON đưa vào context của model.
  2. `PlanRepo`: Cột `plans.resource_labels` lưu trữ các nhãn hiển thị có nguồn gốc từ Slack (tên kênh, tiêu đề thread, tên người nhận).
  3. `WorkingMemory`: `toJSON` serialize toàn bộ `entities` và `members`. Trong `planner.ts`, bộ nhớ lưu các khóa nội bộ: `__labels`, `__gatherPending.candidates`, `__gatherIntent`, `__gatherBindings`, `__gatherMissing`, và các entities đã chọn.
- Xóa bỏ quan niệm sai lầm rằng chỉ cần `delete state.__observed[k]`: Quá trình purge working memory bắt buộc tẩy sạch toàn bộ các khóa nội bộ `__labels`, `__gather*`, `members` và entities phái sinh từ Slack.
- Giữ nguyên ranh giới module: Backend công bố giao diện `IPlannerSlackLineageGuard` để AI Engineer tích hợp trong `packages/planner/`; Backend tuyệt đối không sửa trực tiếp mã planner.

### 1.5. Minh Định Bảng SQL Thực Tế & Bảo Toàn Ràng Buộc Cơ Sở Dữ Liệu:
- Tránh mô tả mơ hồ "audit tables / system logs / AdminUserRepo": Minh định rõ trong migrations `db/v3/` không có bảng SQL `audit_logs` riêng biệt. Bản ghi audit thực thi nằm tại `execution_steps.output_json`, `execution_steps.error_json` và các receipt tombstone bất biến.
- Nhận diện chính xác tác giả đọc/ghi và đường dẫn tệp thực tế trong codebase (`ChatService`, `PlanRepo`, `StepRepo`, `ScheduleService`, `ScheduleRunner`, `StartupReconciliationService`).
- Bảo toàn tuyệt đối các ràng buộc DB khi thực hiện cascade purge:
  - `schedules.request`: BẢO TOÀN nguyên văn yêu cầu của người dùng, không xóa rỗng (thỏa mãn `CHECK (char_length(request) BETWEEN 1 AND 1000)`). Đặt `status = 'paused'`, `pause_reason = 'slack_source_invalidated'`, `next_run_at = NULL` (thỏa mãn `schedules_next_run_check`).
  - `schedule_runs`: Chuyển trạng thái sang `'discarded'` khi hủy plan liên kết (thỏa mãn `schedule_runs_plan_check CHECK ((status = 'planned') = (plan_id IS NOT NULL))`).
  - `plans`: Chuyển pending plan sang `'superseded'` (thỏa mãn `ux_plans_one_pending_per_conversation`).

### 1.6. Công Bố Danh Sách Tệp Triển Khai Thực Tế & Cổng Fail-Closed:
- Công bố danh sách đầy đủ các tệp cần tạo và tích hợp:
  - DDL: `db/v3/0018_slack_derived_lineage_and_purge.sql` (dự kiến số 0018 sau 0017 của 03B1).
  - Repositories: `apps/chat-api/src/db/repositories/slack-derived-lineage-repo.ts`.
  - Services: `apps/chat-api/src/services/slack/slack-derived-lineage-store.ts`, `slack-cascade-purge-runner.ts`, `slack-lineage-guards.ts`.
  - 5 Handlers hiện hữu: `chat-history-message-purge-handler.ts`, `working-memory-entity-purge-handler.ts`, `plan-step-arg-purge-handler.ts`, `scheduled-workflow-arg-purge-handler.ts`, `execution-audit-purge-handler.ts`.
  - 2 Handlers fail-closed tương lai: `proposal-excerpt-purge-handler.ts`, `daily-digest-entry-purge-handler.ts` (ném lỗi từ chối lưu trữ trích đoạn nếu chưa đăng ký lineage hợp lệ).
  - Tích hợp writers & readers thực tế: `chat-service.ts`, `plan-repo.ts`, `conversation-routes.ts`, `schedule-routes.ts`, `schedule-runner.ts`.
  - Kiểm thử tích hợp toàn bộ writers thực tế trên PostgreSQL 16 thật (`slack-derived-writers-integration.test.ts`), không dùng mock 7 hàng hình thức.

### 1.7. Định Danh Quan Sát Capture & Fanout Sự Kiện Cho Derived-Only Epochs:
- Tách biệt định danh quan sát capture (`ObservationCaptureIdentity`) khỏi UUID nguồn thô: Định danh gồm `captureHash`, `capturedAt`, `sourceRef` (bất biến), và `targetOwnership`. Không đòi hỏi bản ghi raw text phải tồn tại vĩnh viễn trong `slack_sources`.
- Quét fanout sự kiện chính sách thu thập epoch trực tiếp từ `slack_derived_provenance_segments`, bảo đảm các bản sao phái sinh vẫn được purge sạch sẽ ngay cả khi dữ liệu nguồn thô đã hết hạn (trần 7 ngày) hoặc chỉ đọc transient.
- Danh sách phân đoạn phải được lấy từ server acquisition context tin cậy, không tin cậy danh sách do model hay client cung cấp.
- Ghi dữ liệu đích và phả hệ trong cùng 1 transaction PostgreSQL; rào chắn chặn đọc có hiệu lực ngay lập tức.

### 1.8. Trật Tự Khóa Toàn Cục, Chống Deadlock & Xử Lý Tín Hiệu Hủy AbortSignal:
- Thiết lập trật tự khóa đơn điệu sắp xếp theo ID tăng dần:
  `conversations` (FOR UPDATE) -> `schedules` (FOR UPDATE) -> `plans` (FOR UPDATE) -> `connections` (FOR SHARE) -> `providers` (FOR SHARE) -> `consents` (FOR SHARE) -> kiểm tra barrier -> ghi lineage -> ghi target writes.
- Chứng minh xen kẽ 2 tiến trình đồng thời (Writer vs Revoker 02B/03B1): Writer khóa target FOR UPDATE rồi lấy consent FOR SHARE; Revoker khóa consent FOR UPDATE rồi stage barrier. Hai tiến trình tuần tự hóa an toàn dưới PostgreSQL MVCC, không có chu trình chờ đợi -> Không deadlock.
- Purger khóa hàng target trước rồi mới khóa `slack_derived_copies`, loại trừ triệt để nguy cơ deadlock "ledger-first vs conversation-first".
- Xử lý tín hiệu hủy: SSE stream và model execution lắng nghe `AbortSignal` thực tế, ngắt truyền tải ngay lập tức trước khi xuất chunk nếu có tín hiệu hủy hoặc rào chắn kích hoạt. Nếu purge handler bị lỗi hoặc thiếu, ném lỗi và giữ nguyên intent ở trạng thái pending; không bao giờ âm thầm nuốt lỗi.
- Handoff seam: 03B1 raw source purge hoàn tất không được đánh dấu intent complete; intent chỉ complete khi 03B2 hoàn thành cả 7 target kinds.

---

## 2. Giới Hạn Dòng Bản Kế Hoạch & Ranh Giới Tệp Hoàn Hảo

- Kế hoạch triển khai [`docs/superpowers/plans/2026-10-30-slack-03b2-derived-lineage-and-purge.md`](../../superpowers/plans/2026-10-30-slack-03b2-derived-lineage-and-purge.md) đạt độ dài **229 dòng**, nằm sâu trong ngân sách `<= 350 dòng`.
- Loại bỏ toàn bộ code giả định dài dòng, tập trung súc tích vào hợp đồng kỹ thuật, DDL 0018, trật tự khóa và ma trận kiểm thử.
- Chỉ tạo và sửa đúng 3 tệp tài liệu thuộc phạm vi sở hữu của SLACK-03B2. Không sửa bất kỳ tệp mã nguồn nào, không sửa `CURRENT-STATE.md` hay `ROADMAP.md`.

---

## 3. Bảng Bằng Chứng Xác Minh Cơ Học

| Hạng mục kiểm tra | Lệnh thực hiện | Kết quả thực tế |
|---|---|---|
| **Ranh giới Module & Tệp Sở hữu** | `git status --porcelain` | Chỉ sửa đúng 3 tệp tài liệu SLACK-03B2; không có tệp thừa, không sửa mã nguồn, không sửa `CURRENT-STATE.md` hay `ROADMAP.md` |
| **Kiểm tra Cú pháp & Whitespace** | `git diff --check e9088d5e..HEAD` | **EXIT 0**; hoàn toàn sạch sẽ, không có trailing whitespace hay conflict marker |
| **Tính Hợp Lệ Của Đường Dẫn & Liên Kết** | Kiểm tra chéo giữa Task card, Plan và Log | Tất cả liên kết markdown tương đối đều trỏ chính xác đến các file hiện hữu trong workspace |
| **Độ Dài Bản Kế Hoạch (Line Budget)** | `(Get-Content docs/superpowers/plans/2026-10-30-slack-03b2-derived-lineage-and-purge.md).Count` | **229 dòng** (Thỏa mãn yêu cầu `<= 350 dòng`) |
| **Chất Lượng Mã Hóa UTF-8 (No Mojibake)** | Node.js buffer & character scan | **0 ký tự U+FFFD**, không BOM, không chứa marker biến dạng, 100% tiếng Việt chuẩn tự nhiên |
| **Kiểm Thử Mã Nguồn (Test Run Status)** | Docs-only scope | **Proposed NOT_RUN** (Tuân thủ nghiêm ngặt chỉ đạo DOCS-ONLY; không chạy `npm install` hay tải npx bên ngoài) |

---

## 4. Trạng Thái Hoàn Thành & Bàn Giao

1. Cả 3 tài liệu SLACK-03B2 đã được hiệu chỉnh hoàn hảo, giải quyết triệt để 8 khiếm khuyết của root review.
2. Kiểm tra hòm thư điều phối viên (`orca orchestration check`) để bảo đảm không có thông điệp chỉ đạo bổ sung.
3. Commit đúng 3 file tài liệu, push lên nhánh `docs/slack-03b2-derived-plan` (không dùng force push) và cập nhật PR template.
4. Gửi báo cáo `worker_done` kèm tóm tắt 3 câu theo đúng quy chuẩn điều phối Orca, sau đó chuyển sang trạng thái nghỉ (idle).
