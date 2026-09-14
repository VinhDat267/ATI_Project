# TH-03 date fix — nghiệm thu độc lập

**PASS cho finding P2 về miền ngày.** Antigravity triển khai trong conversation đã audit, dùng Gemini 3.8 Flash High; Codex đọc bản vá và chạy probe độc lập trên PostgreSQL/MCP thật.

`list_cards.since` và `until` chỉ nhận ngày thực YYYY-MM-DD với năm 0001–9999. Năm 0000 bị từ chối tại schema bằng `BAD_ARGS` trước SQL. Ràng buộc calendar date được xuất thành JSON Schema `pattern` và đồng bộ vào catalog. Không thay đổi `create_card.due_date` hoặc bật hai write tools còn lại.

## Bằng chứng

- Regression RED: Antigravity chạy hai test mới trước fix, cả hai fail đúng lỗi gốc (schema nhận 0000, MCP trả INTERNAL_ERROR). [red.log](../TH-03-date-fix/red.log).
- Targeted GREEN: 15 passed, 0 failed; 12 test ngoài bộ lọc bị bỏ qua có chủ đích. [targeted.log](../TH-03-date-fix/targeted.log).
- Full `check:engine` do Antigravity chạy: typecheck/build/schema/API generation thành công; 98 passed, 0 failed, 0 skipped = 39 DSL + 34 MCP/DB + 25 engine. Codex đọc log hoàn chỉnh và kiểm tra trạng thái hoàn tất trên UI. [check.log](../TH-03-date-fix/check.log).
- Probe do Codex trực tiếp chạy sau full suite: **24/24 passed**, exit 0. Mỗi trường hợp được kiểm tại Zod, JSON Schema đã build, catalog qua `validateToolCall` hiện có, và MCP stdio kết nối PostgreSQL thật. [verification.json](verification.json), [command-result.json](command-result.json), [script](verify-date-fix.mjs).
- Probe áp dụng cả `since` và `until`: từ chối 0000-01-01, 0000-12-31, năm âm, năm 10000, tháng 13, 1900/2025-02-29 và 2026-02-30; chấp nhận 0001-01-01, 9999-12-31, 2000/2024-02-29. Các ngày hợp lệ có oracle count độc lập cho hai card seed, không chỉ assert thiếu lỗi. Có positive controls để tránh hiểu nhầm lỗi compile schema là từ chối input đúng.
- Sáu schema đang active khớp live discovery; ba tool schemas cũ giữ nguyên ở built definitions và catalog. Hai write tools chưa được bật.
- 29 hash bảo vệ theo baseline khớp trước/sau probe; toàn bộ file trong review-r2 tái hiện lỗi được giữ nguyên. Tám file bổ sung giữ nguyên từ snapshot trước probe, gồm migration 0004, lockfile và các đường chạy receiver/engine. [before.json](before.json).

Probe chỉ tạo/seed/drop DB riêng `g1_it_a8ca89c0f97146f4bcee365ad2a9c4dc`; không migrate/seed/reset DB demo. Suite của Antigravity và probe của Codex chạy tuần tự.

Không còn finding cần sửa trong phạm vi bản vá ngày đã kiểm. Review-r2 cũ vẫn giữ `NEEDS_FIX` như bằng chứng lịch sử; kết luận ở đây đóng finding đó. Codex chỉ bổ sung artifact nghiệm thu và sửa vài câu báo cáo để phân biệt assertion thực tế với kết quả probe; không triển khai production code.

`git diff --check` còn một dòng trắng cuối file engine test từ trước bản vá ngày (file này khớp snapshot, không thay đổi trong lượt fix). Không có lỗi runtime được tìm thấy từ kiểm tra này. Chưa stage/commit/push và chưa làm TH-04; HTTP/UI/LLM không nằm trong phạm vi nghiệm thu.
