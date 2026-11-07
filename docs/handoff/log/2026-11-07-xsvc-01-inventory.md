# 2026-11-07 · XSVC-01 pha 0 — bản đồ liên dịch vụ

## Đã làm

Đọc registry, `runtimeToolCatalog`, `getToolCatalogFor`, ba plan sandbox, `REPORT_SOURCE_TOOLS`, resolver `$template`, và output của các adapter nằm trên đường handoff. Nạp schema bằng `node --import tsx` từ `@wap/tool-schemas` tại `6e2d3bb9`. 95 tên tool, 12 dịch vụ.

Không sửa `packages/` hay `apps/`. Không gọi provider. Không ghi dịch vụ thật.

## Kết quả

Bản đồ: `docs/audits/2026-11-07-cross-service/INVENTORY.md`.

Placeholder của plan 4/5/9 khớp schema. Lệch nằm trên đường demo cá nhân: Docs/Drive bị khóa bởi bảng tính đã chọn (F1), link Trello rỗng vẫn được gửi tiếp (F2), `meetLink` tùy chọn trong khi bước Gmail có thể bắt buộc (F3). Hai mục P2: biên nhận `newStatus`, và `timeMax` 23:59:59.

## Chưa làm

Test pha 1, đọc live, browser, sửa mã. `CURRENT-STATE.md` và `ROADMAP.md` không đổi.
