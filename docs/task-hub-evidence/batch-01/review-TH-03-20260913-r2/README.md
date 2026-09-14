# TH-03 — review bổ sung

**NEEDS_FIX: một lỗi biên P2 đã tái hiện qua PostgreSQL/MCP thật.** Báo cáo này bổ sung phát hiện mới cho lần nghiệm thu trước; không sửa lại evidence lịch sử hoặc implementation.

## P2 — Miền ngày của schema không khớp PostgreSQL

Vị trí: `apps/mcp-task-hub/src/cards.ts:167–168` (ép `since`/`until` sang PostgreSQL `date`).

- `list_cards({board_id:"board_a",since:"0000-01-01"})` qua `inputs.list_cards`, nhưng MCP trả `INTERNAL_ERROR`.
- `until:"0000-12-31"` có cùng lỗi. PostgreSQL báo SQLSTATE `22008`.
- Đối chứng: không filter, `since:"0001-01-01"`, `until:"9999-12-31"` đều trả đúng hai card seed. `since:"2026-02-30"` được từ chối bằng `BAD_ARGS`.

Input được schema quảng bá là hợp lệ có thể làm một lượt đọc thất bại bằng lỗi nội bộ. Kiểm tra thứ tự since/until hiện tại không phát hiện miền năm không được DB hỗ trợ. Spec phân loại lỗi ngày vào `BAD_ARGS`; R05 hiện chưa kiểm tra ranh giới năm.

Khuyến nghị: thống nhất miền năm hỗ trợ giữa schema và DB; nếu dùng 0001–9999 thì từ chối năm 0000 trước khi query, đồng bộ schema catalog của tool mới, thêm regression cho cả `since` và `until`. Giữ ba schema tool cũ và write certainty/approval gate.

Reproduction: [date-domain-probe.mjs](date-domain-probe.mjs), [date-domain-results.json](date-domain-results.json). Probe chỉ tạo/seed/dọn một DB `g1_it_UUID`; không sửa DB demo. Chạy từ root repo bằng `node docs/task-hub-evidence/batch-01/review-TH-03-20260913-r2/date-domain-probe.mjs`.

## Kiểm chứng và phạm vi

- `npm run check:engine`: exit 0, **96 passed, 0 failed, 0 skipped** — 39 DSL + 32 DB/MCP + 25 engine. [Command result](command-result.json), [full log](check.log). Test pass không bao phủ hai input gây lỗi ở trên.
- Review độc lập phần engine không phát hiện lỗi actionable: runtime context lấy từ transaction đang khóa run; wrappers chuyển đủ tham số thứ năm; metadata auth/runtime không ghi đè nhau; preview vẫn kiểm timezone trong snapshot; hai write tool chưa được bật.
- Review handlers xác nhận các predicate owner/board, boundary HCM/DST, projection, workload và limit theo plan. Không thấy lỗi P0/P1 trong phạm vi đã đọc và chạy.
- Không triển khai fix, không stage/commit/push. HTTP/UI/LLM và TH-04 trở đi không thuộc lượt review này.
