# 30/10/2026 · SLACK-03B2 — Chỉnh Sửa Kế Hoạch Phả Hệ Phái Sinh & Cascade Purge (PLAN_ONLY)

**Tác giả:** Backend Planning Owner.
**Điều phối:** Task `task_e6c726ed89d4`, Dispatch `ctx_f985d0569b37`, terminal `term_7c29c391-286c-4060-ac4d-73fe04010523`.
**Nhánh:** `docs/slack-03b2-derived-plan`, PR #198, nền đối chiếu `e9088d5e76e95fa65e3be019226835371e40908d`.
**Phạm vi:** Chỉ 3 tài liệu SLACK-03B2. Không có mã runtime, migration, gọi Slack/model/provider, `npm install`, sửa `CURRENT-STATE.md`/`ROADMAP.md`, merge `main` hay đổi flag.

## 1. Mục Đích

Đợt này chỉnh sửa các khiếm khuyết còn lại mà review độc lập đã nêu trong kế hoạch SLACK-03B2. Đây là tài liệu kế hoạch, không phải thi công. Mọi kiểm thử runtime trong card/plan là `[Proposed: NOT_RUN]`; không có kết luận F3, native Slack, model-use hay tích hợp hai client nào được tuyên bố đã chạy.

## 2. Các Sửa Đổi Chính

1. **`schedules.request` không còn được bảo toàn mù.** Card/plan xác định `name/request/recurrence` là field do model sinh trong lượt có nguồn Slack; `status/pause_reason/next_run_at` do server quản lý nhưng phải đổi khi purge. Trường có copy phải nhận tombstone không rỗng để thỏa `CHECK (char_length(...))`; `recurrence` thành `{}`; schedule active bị pause với `pause_reason='slack_source_invalidated'` và `next_run_at=NULL`; resume/update có guard typed trước `nextOccurrence`; plan bị purge tách khỏi `schedule_runs` bằng `status='discarded', plan_id=NULL`; title run conversation có copy bị tombstone, rename phải retire copy cũ. Không xóa trường không có copy và không tách văn bản model bị trộn.
2. **Phiên bản đích do server cấp là bắt buộc.** DDL 0018 có `target_version BIGINT NOT NULL DEFAULT nextval(...)`, `target_fingerprint`, unique `(ati_user_id,target_kind,target_id,target_sub_id,target_version)`, partial unique active, trạng thái `active/retired/purged`. Registration không nhận version từ caller; read guard bắt buộc `expectedTargetVersion`; purge chỉ chọn copy active khớp target **và** `created_at <= intent.created_at`, rồi CAS version+fingerprint, mismatch thì retire mà không sửa artifact. Copy mới dưới grant/epoch mới hoặc đăng ký sau intent không bị intent cũ chọn.
3. **Working memory purge theo đúng path.** Bổ sung selector cho `__observed`, `__labels`, `__gatherPending.candidates`, `__gatherBindings`, `members`, entity top-level và `__gatherIntent`/`__gatherMissing` khi chính giá trị đó là Slack. Không xóa cả dictionary; giữ entry Trello/Google/dịch vụ khác. Provenance chỉ lấy từ server planner lookup context; model/client không được cung cấp danh sách segment; thiếu chứng cứ thì fail-closed.
4. **Handoff 03B1 đúng hàng đợi thật.** 03B1 chỉ claim `slack_source_raw` và **được phép** complete raw sau khi xóa raw; 7 intent derived còn `pending`. Không có trạng thái `raw_purged` và không bắt raw chờ đủ 7. Receipt đóng khi mọi intent cùng `source_event_key` completed; thiếu handler làm intent failed/pending và receipt mở. Fanout epoch derived dùng receipt riêng `derived-policy:<eventId>:<epochHash>` vì `stageInTransaction` all-or-nothing theo receipt; không gọi lại `policy:<eventId>` để thêm effect.
5. **Bỏ kết luận deadlock khi chưa có bằng chứng.** Thay bằng ma trận M1-M8 `[Proposed: NOT_RUN]` với hai client PostgreSQL thật: revoke/write, stage/write, purger/writer, grant/provider update, crash/retry, stale version, duplicate claim, missing handler. Ghi rõ 02B commit policy event trước barrier (sweep 03B1 tối đa 5 giây), nên writer/reader phải revalidate authority trong transaction; barrier vắng mặt không phải consent.
6. **Bảng bao phủ và danh sách file dùng đường dẫn thật.** Dùng đúng `services/schedules/schedule-runner.ts`; bỏ `ScheduleRunner.runDue`, `ExecutionService.getExecution`, `StartupReconciliationService`, các đường dẫn sai thư mục `services/conversation-routes.ts`/`services/schedule-routes.ts`/`services/schedule-runner.ts` và admin query không tồn tại. State message do `ScheduleService.recordState` ghi được xếp vào `chat_history_message`; thêm path `metadata.schedule.lastRun.error` để khớp `ScheduleView` thật. Chỉ rõ `ScheduleRepo.stateText` là helper dựng nội dung state message, không phải writer. Tách 5 handler artifact thật khỏi 2 cổng tương lai `proposal_excerpt`/`daily_digest_entry`; nhấn mạnh không có bảng/service cho hai kind này.
7. **Phạm vi runtime trung thực.** 03B2 runtime chỉ có thể đạt 5 handler hiện hữu + từ chối 2 thành phần tương lai. Bảy kind đầy đủ và F3 phụ thuộc SLACK-06 có bảng/service/handler thật cùng test tích hợp thật.
8. **Vệ sinh tài liệu.** Xóa tuyên bố tuyệt đối, dispatch ID cũ, tham chiếu PR sai và mô tả deadlock khi chưa có bằng chứng. Ba tài liệu dùng cùng contract, DDL, AC và tên trường.

## 3. Kiểm Chứng Tài Liệu Đã Chạy

Chỉ các kiểm tra tài liệu dưới đây được chạy trong phiên này. Không có kiểm thử runtime nào được chạy; mọi dòng runtime trong card/plan giữ `[Proposed: NOT_RUN]`.

| Hạng mục | Lệnh / cách kiểm | Kết quả thực tế |
|---|---|---|
| Số dòng plan | `wc -l docs/superpowers/plans/2026-10-30-slack-03b2-derived-lineage-and-purge.md` | `260` (≤350) |
| UTF-8, BOM, U+FFFD | Node `Buffer` + regex trên 3 tệp | Cả 3 tệp: `bom=false`, `U+FFFD=0`; task 44314 bytes, plan 31359 bytes; log tự tham chiếu nên không ghi kích thước |
| Liên kết markdown tồn tại | Script kiểm từng link tương đối trong 3 tệp | `checked=4 missing=none`, exit 0 |
| Whitespace/conflict (working tree) | `git diff --check e9088d5e` | exit 0, không output |
| Đúng 3 tệp sở hữu (working tree) | `git diff --name-only e9088d5e` | 3 tệp: log, task card, plan |
| Trạng thái làm việc | `git status --short` trước commit | Chỉ 3 tệp thuộc sở hữu ở trạng thái `M` |

Không có output runtime, exit code test sản phẩm hay log CI nào trong mục này. Bằng chứng runtime cũ (nếu có trong lịch sử) là bằng chứng lưu trữ, không phải kết quả của phiên tài liệu này.

## 4. Bàn Giao

- Chỉ stage đúng 3 tệp sở hữu, commit Conventional Commits, push thường lên nhánh hiện có, không force.
- Cập nhật PR #198 bằng template, mô tả đúng phạm vi PLAN_ONLY, không có chữ ký AI.
- Head hash và kết quả kiểm tra thực tế được báo trong `worker_done`; không ghi hash tự tham chiếu vào chính tệp log này.
- Sau khi gửi `worker_done` đúng một lần, chuyển sang idle.
