# Final Evidence — Batch 01 (TH-07)

Bằng chứng nghiệm thu đợt 1 (TH-01 đến TH-07): hoàn thành 8 tool local của server `task_hub`, migration `0004_task_hub_cards.sql` và các luồng card của engine qua controller/CLI thật.

Recorded at: 2026-09-13
Scope: `FINAL_EVIDENCE_BATCH_01_TASK_HUB_8_TOOLS_IMPLEMENTED`
G1 Overall Status: `PARTIAL` (task_hub 8/8 tools implemented; filesystem adapter and course rubric remaining)

## 1. Tóm tắt kết quả kiểm thử

- `npm ci --ignore-scripts --no-audit --no-fund`: exit code 0, 176 packages nguyên vẹn theo `package-lock.json`. Xem [npm-ci.log](npm-ci.log).
- `npm run check:engine` (`ATI_EVIDENCE_DIR=docs/task-hub-evidence/batch-01/final`): exit code 0, **142/142 tests PASS** (39 DSL unit/offline + 103 PostgreSQL/MCP integration), 0 failed, 0 skipped. Xem [check.log](check.log).
  - `@wap/dsl`: 39 passed (unit / offline)
  - `@wap/mcp-task-hub` & `@wap/db`: 63 passed (PostgreSQL/MCP integration: 56 tool integration + 7 DB migration/seed)
  - `@wap/engine`: 40 passed (PostgreSQL/MCP integration: b02, E01–E13, fault injection, CLI lifecycle)
- `capture-runtime.mjs`: Lần 1 FAILED do assertion shape sai trong evidence script (`outputs.get_card.card.id` thay vì `outputs.get_card.id` theo schema `cardSummary`), không có lỗi production; lần 2 PASS (exit 0): khởi tạo DB tạm `engine_it_*`, thực thi migrations 0001–0004, seed demo data, kiểm tra live discovery 8 tools, gọi 4 read tools (`read_sheet_range`, `get_card`, `list_cards`, `list_members`), assert kết quả thực khớp với seed, và drop DB thành công (`database_dropped: true`). Xem [task-hub-runtime.json](task-hub-runtime.json), [capture-runtime.log](capture-runtime.log) và [capture-runtime-02.log](capture-runtime-02.log).
- `verify-links.mjs`: Kiểm tra tính toàn vẹn của 12 tài liệu chính và 62 liên kết nội bộ (bỏ qua fenced code blocks, phân biệt bare paths theo kế hoạch). Toàn bộ 12 tài liệu và 62 links đều hợp lệ (0 broken links). Xem [link-check.log](link-check.log).
- `manifest.json`: Chứa SHA-256 thực của 40 source, test, script, migration, dev-plan, catalog, lockfile (TH01–TH06); kèm bảng kê chi tiết toàn bộ 162/162 files được bảo vệ khớp 100% với baseline `before.json`; 3 migrations lịch sử giữ nguyên; 3 schemas cũ giữ nguyên tương đương 100%. Xem [manifest.json](manifest.json).

## 2. Danh mục tài liệu và file trong thư mục này

| File | Mô tả |
|---|---|
| [manifest.json](manifest.json) | Bảng kê SHA-256 toàn bộ source/test/migration/catalog/lockfile và trạng thái bảo toàn |
| [commands.json](commands.json) | Nhật ký lệnh, exit code, log và provenance thời gian (xem từng entry) |
| [npm-ci.log](npm-ci.log) | Log cài đặt sạch từ package-lock.json |
| [check.log](check.log) | Log đầy đủ của full gate `npm run check:engine` (142 tests pass) |
| [capture-runtime.mjs](capture-runtime.mjs) | Script chụp runtime MCP read-only trên DB tạm cô lập |
| [capture-runtime.log](capture-runtime.log) | Log lần chạy đầu của capture-runtime (exit 1 do assertion shape) |
| [capture-runtime-02.log](capture-runtime-02.log) | Log lần chạy thứ hai của capture-runtime (exit 0 thành công) |
| [task-hub-runtime.json](task-hub-runtime.json) | Snapshot 8 tools, 4 migration checksums, read outputs và metadata môi trường |
| [verify-links.mjs](verify-links.mjs) | Script kiểm tra tính toàn vẹn của tài liệu và các liên kết markdown |
| [link-check.log](link-check.log) | Log kiểm tra liên kết tài liệu của Antigravity; xem log để biết số link thực tế |
| [controller-observations.json](controller-observations.json) | Kết quả quan sát controller sinh ra từ full gate |
| [mcp-observations.json](mcp-observations.json) | Kết quả quan sát MCP sinh ra từ full gate |
