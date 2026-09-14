# Báo cáo xử lý finding P2 TH-03 — Date Domain Fix (0001–9999)

## Nhận diện

- Task ID và tên: TH-03-date-fix — Date Domain Fix for `since` and `until` (0001–9999)
- Thời gian UTC: 2026-09-13T10:32:00Z
- Trạng thái: VERIFIED
- Vấn đề xử lý: Finding P2 trong `docs/task-hub-evidence/batch-01/review-TH-03-20260913-r2/README.md`. Live MCP `list_cards` nhận `since="0000-01-01"` hoặc `until="0000-12-31"` lọt qua Zod `z.iso.date()` (cho phép năm 0000) rồi bị PostgreSQL báo lỗi `22008` (date/time field value out of range) dẫn tới `INTERNAL_ERROR`.
- Giải pháp: Chốt miền năm của `since` và `until` trong `inputs.list_cards` là `0001–9999` bằng calendar date regex xuất được trực tiếp ra JSON Schema (`pattern`). Năm `0000` bị từ chối bằng `BAD_ARGS` tại tầng schema validation trước khi chạm SQL.
- Giữ nguyên: 3 tool schemas cũ, 2 write tools disabled (`SPEC_ONLY`), `due_date` planned chưa động, migrations `0001`–`0003`, demo DB `wap_g1`, không thay đổi write certainty / approval.

## Đã thay đổi

| File | Thay đổi |
|---|---|
| `apps/mcp-task-hub/src/contracts.ts` | Định nghĩa `calendarDate` với regex chuẩn calendar date YYYY-MM-DD giới hạn năm 0001–9999 (`/^(?!0000)(?:...)$/`), áp dụng cho `since` và `until` trong `inputs.list_cards`. Regex xuất trực tiếp thành thuộc tính `pattern` trong JSON Schema qua `z.toJSONSchema` |
| `testdata/tools.json` | Cập nhật `list_cards` inputSchema cho `since` và `until` chứa `pattern` YYYY-MM-DD năm 0001–9999, đồng bộ với `toolDefinitions()` |
| `apps/mcp-task-hub/tests/tools.integration.test.ts` | Thêm 2 regression tests mang tag `[TH-03-date-domain]` kiểm tra: (1) Zod schema + exported JSON schema qua Ajv2020 validator cùng từ chối năm 0000 và ngày không hợp lệ, chấp nhận 0001/9999/năm nhuận; (2) Live MCP `list_cards` từ chối năm 0000 với `BAD_ARGS` và chấp nhận 0001/9999 |
| `docs/superpowers/specs/2026-09-13-task-hub-completion-design.md` | Bổ sung làm rõ miền năm của `since`/`until` là 0001–9999 trong phần mô tả hợp đồng tools |
| `docs/superpowers/plans/2026-09-13-task-hub-completion.md` | Bổ sung làm rõ miền năm của `since`/`until` được chốt ở 0001–9999 qua calendar date regex |

## Kiểm chứng

| Lệnh | Exit code | Passed/failed/skipped | Đường dẫn log |
|---|---|---|---|
| `cmd /c "set ATI_EVIDENCE_DIR=docs/task-hub-evidence/batch-01/TH-03-date-fix&& npm run test:integration -w @wap/mcp-task-hub -- tests/tools.integration.test.ts -t TH-03-date-domain"` (RED test trước khi sửa) | 1 | 0 passed, 2 failed, 25 skipped | `docs/task-hub-evidence/batch-01/TH-03-date-fix/red.log` |
| `cmd /c "set ATI_EVIDENCE_DIR=docs/task-hub-evidence/batch-01/TH-03-date-fix&& npm run test:integration -w @wap/mcp-task-hub -- tests/tools.integration.test.ts -t TH-03"` (GREEN targeted test sau sửa) | 0 | 15 passed, 0 failed, 12 skipped | `docs/task-hub-evidence/batch-01/TH-03-date-fix/targeted.log` |
| `cmd /c "set ATI_EVIDENCE_DIR=docs/task-hub-evidence/batch-01/TH-03-date-fix&& npm run check:engine"` (Full test suite) | 0 | 98 passed, 0 failed, 0 skipped (39 DSL, 34 MCP/DB, 25 Engine) | `docs/task-hub-evidence/batch-01/TH-03-date-fix/check.log` |

### Quan sát Red Test (trước fix)

- Lệnh: `vitest run tests/tools.integration.test.ts -t TH-03-date-domain`
- Log: `docs/task-hub-evidence/batch-01/TH-03-date-fix/red.log` (Exit code: 1)
- Lỗi 1: `[TH-03-date-domain] schema rejects year 0000 and invalid dates across Zod and JSON Schema validator`
  - `AssertionError: expected true to be false` tại `inputs.list_cards.safeParse({ board_id: "board_a", since: "0000-01-01" })` (do `z.iso.date()` cho phép năm 0000).
- Lỗi 2: `[TH-03-date-domain] live MCP list_cards rejects year 0000 with BAD_ARGS and accepts 0001 and 9999`
  - `AssertionError: expected 'INTERNAL_ERROR' to be 'BAD_ARGS'` (do chuỗi "0000-01-01" lọt qua schema validation và bị Postgres báo lỗi 22008 khi cast sang `date`).

### Tên Test Verbatim trong Code

1. `[TH-03-date-domain] schema rejects year 0000 and invalid dates across Zod and JSON Schema validator`
   - Kiểm tra Zod `safeParse`:
     - `since: "0000-01-01"` -> `false`
     - `until: "0000-12-31"` -> `false`
     - `since: "0001-01-01"` -> `true`
     - `until: "9999-12-31"` -> `true`
     - `since: "2024-02-29"` -> `true` (năm nhuận)
     - `since: "2025-02-29"` -> `false` (năm không nhuận)
     - `since: "2026-02-30"` -> `false` (ngày không tồn tại)
   - Kiểm tra Ajv2020 validator trên `inputSchema` của `list_cards` từ `toolDefinitions()`:
     - `since: "0000-01-01"` -> `false`
     - `until: "0000-12-31"` -> `false`
     - `since: "2025-02-29"` -> `false`
     - `since: "2026-02-30"` -> `false`
     - `since: "0001-01-01"` -> `true`
     - `until: "9999-12-31"` -> `true`
     - `since: "2024-02-29"` -> `true`
2. `[TH-03-date-domain] live MCP list_cards rejects year 0000 with BAD_ARGS and accepts 0001 and 9999`
   - Gọi live MCP server qua stdio transport:
     - `list_cards({ board_id: "board_a", since: "0000-01-01" })` -> `isError: true`, error code `BAD_ARGS`
     - `list_cards({ board_id: "board_a", until: "0000-12-31" })` -> `isError: true`, error code `BAD_ARGS`
     - `list_cards({ board_id: "board_a", since: "0001-01-01" })` -> test assert không có lỗi MCP
     - `list_cards({ board_id: "board_a", until: "9999-12-31" })` -> test assert không có lỗi MCP
   - Probe độc lập của Codex sau đó assert đúng 2 cards seed cho hai đối chứng trên: [verification.json](review-TH-03-date-fix-20260913/verification.json).

### Bảo toàn Hashes và Schemas (29 Protected Hashes + Old 3 Tool Schemas)

Đã chạy kiểm tra tự động đối chiếu với `docs/antigravity/task-hub-handoff-baseline.json`:
- **26/26 historical evidence files**: 100% khớp SHA-256 baseline (0 mismatch).
- **3/3 migration files** (`0001_init.sql`, `0002_audit_contracts.sql`, `0003_task_hub_local.sql`): 100% khớp SHA-256 baseline.
- **Old 3 tool schemas** (`send_slack_message`, `read_sheet_range`, `append_sheet_rows`): khớp cấu trúc và giá trị với `old_three_tool_contracts` trong baseline (deep equality).
- **Thư mục review lịch sử**: `docs/task-hub-evidence/batch-01/review-TH-02-20260913-154039`, `review-TH-03-20260913`, `review-TH-03-20260913-r2` hoàn toàn nguyên vẹn, không bị sửa hay ghi đè.

## Tóm tắt gửi Codex

- Đã sửa finding P2 TH-03: `since` và `until` trong `list_cards` dùng `calendarDate` regex ràng buộc năm 0001–9999, xuất thành `pattern` trong JSON Schema. Năm 0000 bị từ chối bằng `BAD_ARGS` trước khi chạm SQL.
- Red test ghi nhận tại `docs/task-hub-evidence/batch-01/TH-03-date-fix/red.log` (exit code 1: 2 failed).
- Targeted test đạt 15/15 passed ([targeted.log](TH-03-date-fix/targeted.log)).
- Full suite `check:engine` đạt 98/98 passed (39 DSL, 34 MCP/DB, 25 Engine), exit code 0 ([check.log](TH-03-date-fix/check.log)).
- 26 historical evidence + 3 migrations sha256 + 3 old tool schemas nguyên vẹn 100%.
- Không commit/push, không làm TH-04, dừng chờ Codex nghiệm thu.
