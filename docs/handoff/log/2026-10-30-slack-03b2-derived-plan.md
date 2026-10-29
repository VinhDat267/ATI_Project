# 30/10/2026 · SLACK-03B2 — Chỉnh Sửa Kế Hoạch Phả Hệ Phái Sinh & Cascade Purge (PLAN_ONLY)

**Tác giả:** Backend Planning Owner.
**Điều phối:** Task `task_7a44c112b4ff`, Dispatch `ctx_2f93dc52606e`, terminal `term_33a4291d-30eb-447e-a46f-02631df10584`.
**Nhánh:** `docs/slack-03b2-derived-plan`, PR #198, nền tài liệu `e9088d5e76e95fa65e3be019226835371e40908d`.
**Phạm vi:** Chỉ 3 tài liệu SLACK-03B2. Không có mã runtime, migration, gọi Slack/model/provider, `npm install`, sửa `CURRENT-STATE.md`/`ROADMAP.md`, merge `main` hay đổi flag.

## 1. Mục Đích

Phiên này hiệu chỉnh ba khiếm khuyết còn lại mà review độc lập nêu trong kế hoạch SLACK-03B2. Đây là tài liệu kế hoạch, không phải thi công. Mọi kiểm thử runtime trong card/plan là `[Proposed: NOT_RUN]`; không có kết luận F3, native Slack, model-use hay tích hợp hai client nào được tuyên bố đã chạy.

## 2. Các Sửa Đổi Đã Được Chấp Thuận Trước Đó

Các nhóm sau giữ nguyên về ý tưởng: (1) `schedules.request` không được bảo toàn mù, tombstone từng field có copy, `recurrence={}`, pause active-only, guard resume/update, `schedule_runs`/title; (2) `target_version` do server cấp, fingerprint, unique active, CAS và retire khi mismatch; (3) purge working memory theo selector `__observed`/`__labels`/`__gather*`/`members`/entity; (4) handoff 03B1 raw intent được complete sớm, 7 derived intent còn pending, không có `raw_purged`; (5) ma trận khóa/cạnh tranh `[Proposed: NOT_RUN]` thay cho kết luận deadlock; (6) đường dẫn/symbol thật; (7) phạm vi runtime 5 handler thật + 2 cổng tương lai; (8) vệ sinh tài liệu.

## 3. Ba Hiệu Chỉnh Của Phiên Này

1. **BIGINT string xuyên suốt.** `target_version` vẫn là `BIGINT` server sequence, nhưng `targetVersion` trong kết quả register/getActive, `expectedTargetVersion` của read guard và tham số CAS của purge nay là **string thập phân canonical** (`^[1-9][0-9]*$`), không phải `number`. Cấm `Number()`/`parseInt()`/`parseFloat()`/unary `+`/JSON-number round-trip; kiểm tra thêm biên PG BIGINT `9223372036854775807` cho chuỗi 19 ký tự. `identity_version` INT vẫn là number, revision vẫn là string. Ma trận thêm M9: roundtrip `9007199254740993` qua register/getActive/read guard/purge CAS; fingerprint ổn định; so sánh `9007199254740992`/`9007199254740994` không collapse; CAS lệch một đơn vị trả 0 row.
2. **Cutoff chỉ khoanh version, không phải freshness.** `created_at <= intent.created_at` chỉ xác định version artifact mà intent cũ được phép CAS; nó không chứng minh copy đăng ký sau cutoff là mới, hợp lệ hay đã được cấp quyền. Mọi version mới phải tái cấp quyền **toàn bộ segment** theo authority hiện tại và kiểm tra barrier bền vững khớp, dưới cùng bộ advisory lock sorted; không được ghi version mới bằng epoch/nguồn cũ đã revoke/xóa chỉ vì tạo sau intent. Ma trận thêm M10 (event/stage vs register cả hai thứ tự; nỗ lực tái dùng segment cũ sau intent bị từ chối; regrant/revision mới chỉ sống nếu authority/barrier cho phép) và M11 (legacy writer lọt sau cutoff với segment cũ đã vô hiệu hóa bị read guard chặn, không F3-clean, phải purge/repair). Không thêm trạng thái hay source-epoch protocol mới.
3. **Cập nhật snapshot 03B1 và thứ tự khóa.** Tham chiếu 03B1 accepted head `23544be9`, integration `612ac427`; 03C1 read accepted head `390b1c54`. `SlackConnectionRepo.disconnect` lấy advisory sorted trước rồi mới cập nhật connection row, cùng phân cấp với `saveSourceAtomic`; bộ 6 suite PostgreSQL thật (55/55) tại head `23544be9` kiểm chứng save-vs-disconnect, nhưng đây là bằng chứng 03B1, không phải 03B2. Read guard được nêu cùng thứ tự parent-first với writer/purger: advisory sorted → conversation → authority `FOR SHARE` → barrier check → artifact `FOR SHARE` → post-check. Không có tuyên bố deadlock-proof; toàn bộ M1-M11 vẫn `[Proposed: NOT_RUN]`. Seam raw intent riêng và receipt fanout `derived-policy:<eventId>:<epochHash>` chỉ cho derived được giữ nguyên.

## 4. Kiểm Chứng Tài Liệu Đã Chạy

Chỉ các kiểm tra tài liệu dưới đây được chạy trong phiên này. Không có kiểm thử runtime nào được chạy; mọi dòng runtime trong card/plan giữ `[Proposed: NOT_RUN]`.

| Hạng mục | Lệnh / cách kiểm | Kết quả thực tế |
|---|---|---|
| Số dòng plan | `wc -l docs/superpowers/plans/2026-10-30-slack-03b2-derived-lineage-and-purge.md` | `267` (≤350) |
| Số dòng card | `wc -l docs/handoff/tasks/SLACK-03B2-derived-lineage-and-purge.md` | `389` |
| UTF-8, BOM, U+FFFD | Node `Buffer` + regex trên 3 tệp | Cả 3 tệp: `bom=false`, `U+FFFD=0`; task 50857 bytes, plan 37481 bytes; log tự tham chiếu nên không ghi kích thước |
| Liên kết markdown tồn tại | Script kiểm từng link tương đối trong 3 tệp | `checked=4 missing=0`, exit 0 |
| Whitespace/conflict (working tree) | `git diff --check` | exit 0, không output |
| Đúng 3 tệp sở hữu (working tree) | `git diff --name-only` | 3 tệp: log, task card, plan |
| Trạng thái làm việc | `git status --short` trước commit | Chỉ 3 tệp thuộc sở hữu ở trạng thái `M` |

Không có output runtime, exit code test sản phẩm hay log CI nào trong mục này. Bằng chứng runtime cũ (nếu có trong lịch sử) là bằng chứng lưu trữ, không phải kết quả của phiên tài liệu này.

## 5. Bàn Giao

- Chỉ stage đúng 3 tệp sở hữu, commit Conventional Commits, push thường lên nhánh hiện có, không force.
- Cập nhật PR #198 bằng template, mô tả đúng phạm vi PLAN_ONLY, không có chữ ký AI.
- Head hash và kết quả kiểm tra thực tế được báo trong `worker_done`; không ghi hash tự tham chiếu vào chính tệp log này.
- Sau khi gửi `worker_done` đúng một lần, chuyển sang idle.
