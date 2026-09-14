# Audit độc lập lần 2 — 13/09/2026 (sau FIX-REPORT)

Audit này chạy sau [FIX-REPORT-2026-09-13](FIX-REPORT-2026-09-13.md), mục tiêu là kiểm tra độc lập xem repo hiện tại (mã, DB schema, config, dataset, docs) có còn khớp với bộ tài liệu kế hoạch ([BASELINE](BASELINE.md), [FR](functional-requirements.md), [EXECUTION-CONTRACT](EXECUTION-CONTRACT.md), [KE-HOACH-6-TUAN](KE-HOACH-6-TUAN.md)) hay không, và liệu các claim trong FIX-REPORT có còn đúng. Không chạy lại toàn bộ audit vòng 1; chỉ tái kiểm chứng và tìm phát hiện mới.

## Phương pháp

- Chạy lại `npm ci && npm run check` từ sạch.
- Chạy lại `docs/fix-evidence/2026-09-13/verify-artifacts.mjs` trên trạng thái hiện tại (không dùng log cũ).
- Đọc trực tiếp toàn bộ `packages/dsl/src/*.ts` và test tương ứng, đối chiếu từng file với FR/NFR nó tuyên bố implement.
- Đọc `db/migrations/*.sql`, `config/*.json`, `testdata/*.json`, `apps/*/README.md`, `docker-compose.yml`, `.env.example` và đối chiếu với BASELINE/EXECUTION-CONTRACT.
- Đếm tay bảng FR (78 dòng) và bảng giờ KE-HOACH-6-TUAN để kiểm tổng số học.

## Kết quả tái kiểm chứng — không lệch so với FIX-REPORT

| Việc kiểm | Kết quả |
|---|---|
| `npm ci && npm run check` | Exit 0. 38/38 tests, typecheck, DSL build, JSON Schema, OpenAPI type-gen đều qua. |
| `verify-artifacts.mjs` chạy lại hôm nay | `failures: []`. 11 schemas, 36 refs nội bộ, 9 operations, 14 run status khớp SQL/Zod, 78 FR (59 M / 1 S / 18 OUT), 102 markdown link nội bộ hợp lệ. |
| Bảng FR (đếm tay) | 11+14+9+8+17+9+6+4 = 78 dòng; đúng 18 OUT, đúng 1 S (FR-TRC-09), còn lại 59 M. Khớp tuyên bố "đã bỏ tổng 45/44 sai". |
| Giờ KE-HOACH-6-TUAN (đếm tay) | Tuần 1-5: việc 20+24+24+24+20 = 112h, dự phòng 3+4+4+4+8 = 23h → đúng "112h việc + 23h dự phòng = 135h". Tuần 6: 28h demo/báo cáo + 5h đệm chung = 33h. Tổng 135+33 = 168h = 14h × 2 người × 6 tuần. Số học nhất quán tuyệt đối. |
| `condition.ts` | Đúng grammar hẹp đã tả (or/and/not/compare/operand), không có `eval`/`Function`/`vm`. Tokenizer/parser tự viết, an toàn với input LLM. |
| `reference.ts` | 3 namespace đúng như tả (`inputs`/`steps`/`runtime`); chặn `__proto__`/`prototype`/`constructor`; nội suy chuỗi từ chối object/array (chặn `[object Object]`); giữ nguyên kiểu khi chuỗi chỉ chứa một reference. |
| `tool-policy.ts` | `validatePlanTools` chặn tool thiếu policy, chặn side_effect không khớp registry, chặn `retry.max_attempts > 3` hoặc backoff khác exponential, chặn `on_error: continue`, và chặn tham chiếu tới output của một bước `write` khác trong cùng preview. `validateToolCall` chặn write trong `dry_run`. `normalizeToolResult` coi `isError` luôn là lỗi và bắt buộc `structuredContent`. |
| `schema.ts` / `graph.ts` / `events.ts` | `PlannerResultSchema` discriminated union plan/refusal/clarification, không cho phép plan rỗng đi kèm `kind:"plan"`. `validateGraph` phát hiện chu trình + kiểm tham chiếu bắc cầu (không chỉ thứ tự mảng). 14 run status khớp enum SQL. |
| `db/migrations/0001+0002` | Cấu trúc khớp EXECUTION-CONTRACT: `tool_operations` (reserve/in_flight/succeeded/known_failed/unknown), `run_outbox`, `approvals.snapshot_hash` với CHECK regex 64-hex, composite FK ràng buộc owner/version. Tự ghi rõ NOT_RUN trên PostgreSQL thật (Docker không sẵn). |
| `config/mcp-presets.json`, `config/filesystem-candidate.json`, `testdata/*.json` | Đúng như tài liệu mô tả: deny-all, candidate chưa duyệt, dataset 6 dev/4 holdout, catalog 8+2 tool, `experiment-manifest.json` status `NOT_RUN`. |
| `apps/api`, `apps/web`, `apps/mcp-task-hub` | Vẫn đúng 100% README skeleton, không có code nào khác. Không phát hiện over-claim nào giữa docs và mã. |

**Kết luận tổng quát:** bộ tài liệu B/local hiện tại mô tả đúng thực trạng repo, kể cả các giới hạn tự khai (SPEC_ONLY/NOT_RUN/CODE_TESTED). Không phát hiện tuyên bố sai lệch nào giữa docs và code trong lần audit này.

## Phát hiện mới (nhỏ, không chặn kế hoạch)

| ID | Phát hiện | Mức | Đề xuất |
|---|---|---|---|
| N01 | File `00-BAT-DAU (BẢN CŨ - xoá được).md` ở root trùng nội dung với `00-BAT-DAU.md` (cả hai chỉ trỏ tới `docs/00-BAT-DAU.md`). Tự tên file đã ghi "xoá được". | Cosmetic | Xoá file này; không có nơi nào tham chiếu tới nó. |
| N02 | Thư mục `scripts/` ở root rỗng, không dùng. Script thật nằm ở `packages/dsl/scripts/`. | Cosmetic | Xoá thư mục rỗng hoặc ghi rõ mục đích dự kiến nếu giữ lại cho tuần sau. |
| N03 | ~~`.env.example` đặt `LLM_MODEL=claude-sonnet-4-6` — không khớp định danh model Anthropic hiện hành nào.~~ **ĐÍNH CHÍNH 14/09/2026: phát hiện này SAI.** `claude-sonnet-4-6` là model id có thật (Claude Sonnet 4.6, $3/$15 mỗi triệu token input/output). Nó chỉ là thế hệ trước, không phải id bịa. Thế hệ hiện hành: `claude-opus-5` ($5/$25), `claude-sonnet-5` ($2/$10 — mới hơn và rẻ hơn 4.6), `claude-haiku-4-5` ($1/$5). | Đã đính chính | Yêu cầu thực tế còn lại chỉ là của EVALUATION/FR-CON-08: pin model id kèm pricing snapshot vào `experiment-manifest.json` trước khi chạy thí nghiệm. Chọn id nào là quyết định của nhóm; `claude-sonnet-5` đáng cân nhắc vì vừa mới hơn vừa rẻ hơn giá trị đang ghi. |
| N04a | Ba file gần như trùng nội dung cùng đóng vai trò "pointer tới audit chuẩn": root `AUDIT.md`, `docs/AUDIT.md`, `docs/AUDIT-vong-1.md`. Cả ba chỉ khác đường dẫn tương đối, cùng trỏ tới `AUDIT-DOCS-2026-09-12.md`/`FIX-REPORT-2026-09-13.md` (đã cập nhật thêm audit này). Không có nội dung nào phân biệt `docs/AUDIT-vong-1.md` khỏi `docs/AUDIT.md`. | Cosmetic | Giữ đúng một pointer (`AUDIT.md` ở root là đủ vì đó là nơi người đọc mới vào repo sẽ thấy); xoá `docs/AUDIT.md` và `docs/AUDIT-vong-1.md` hoặc gộp còn một file. |
| N04 | Repo hiện KHÔNG phải git repository (`git status` không áp dụng). Kế hoạch 2 người yêu cầu "cross-review" liên tục (KE-HOACH-6-TUAN) — không có Git thì không có commit history/diff để review hay để chứng minh "không có gì chèn thêm" như archive SHA-256 đã làm thủ công. | Vận hành | Khởi tạo Git trước hoặc trong G1 nếu nhóm muốn review bằng PR/diff thay vì so sánh archive thủ công. Đây là lựa chọn quy trình, không phải lỗi kỹ thuật. |

Không phát hiện N nào yêu cầu sửa code hay đổi baseline.

## Đã dọn trong cùng phiên audit này

Theo yêu cầu người dùng, đã xoá N01 (`00-BAT-DAU (BẢN CŨ - xoá được).md`), N02 (thư mục `scripts/` rỗng), và N04a (`docs/AUDIT.md`, `docs/AUDIT-vong-1.md` — chỉ giữ pointer duy nhất ở root `AUDIT.md`, đã cập nhật để trỏ thêm tới audit này). Hai citation kiểu `[audit cũ](docs/AUDIT.md:36|112)` trong `AUDIT-DOCS-2026-09-12.md` trỏ tới file vừa xoá đã được sửa thành chú thích văn bản kèm link tới [archive](archive/pre-fix-2026-09-13.zip) chứa bản gốc. Đã chạy lại `verify-artifacts.mjs`: `failures: []`, 101 markdown link nội bộ hợp lệ (giảm từ 102 do bớt một pointer trùng).

N04 (chưa init Git) để mở — cần quyết định của nhóm, không tự sửa. *(Cập nhật 14/09: Git đã được khởi tạo, N04 đã xử lý. N03 đã được đính chính ở bảng trên vì phát hiện gốc là sai.)*

## Khoảng cách còn lại so với lộ trình 6 tuần (nhắc lại, không phải phát hiện mới)

Repo hiện ở đúng mốc mà FIX-REPORT đã ghi: thư viện DSL/validation/policy đã CODE_TESTED, nhưng **G1 (tuần 1) chưa đạt** — chưa có discovery/call MCP thật, chưa có một plan tay chạy hết luồng đọc → preview → duyệt → write có receipt trên service đang chạy. `apps/api`, `apps/web`, `apps/mcp-task-hub` vẫn là 0% code ngoài README. Đây là điểm bắt đầu triển khai tiếp theo, đúng như FIX-REPORT đã nêu — audit này không đổi kết luận đó, chỉ xác nhận nó vẫn đúng ở thời điểm hiện tại.
