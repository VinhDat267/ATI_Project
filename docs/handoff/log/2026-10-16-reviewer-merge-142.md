# 16/10/2026 · Merge #142 (ANS-01)

**Người viết:** reviewer · **Nhánh:** `docs/record-142` · Chỉ tài liệu.

## Merge

- [#142](https://github.com/VinhDat267/ATI_Project/pull/142), head `1971cd0dad65487e63b9ce436e6c37b021d0f8bc`, merge `96f9f09`, 16/10 lúc 14:10:42 Việt Nam.
- Merge theo lệnh "merge #142" của nhóm trưởng, khoá theo head (`--match-head-commit`).
- [CI #142](https://github.com/VinhDat267/ATI_Project/actions/runs/38862974131) SUCCESS đúng head, gồm check và browser.
- Nhánh đã rebase lên `main` `e03a9c8` và `main` chưa đổi, nên cây `96f9f09` bằng cây `1971cd0` (kiểm bằng `git diff --quiet`).

## Review trước merge

- **Tại `993e485`** (base `61d3be4`): [review độc lập](https://github.com/VinhDat267/ATI_Project/pull/142#issuecomment-6209257629) kết luận **Đạt sau khi sửa nhỏ**.
  - P2: đột biến P1 ("prefetch lỗi vẫn tính là dữ liệu đọc") lọt toàn bộ planner 257/257. Probe: prefetch Slack lỗi `invalid_auth`, model trả lời từ trí nhớ. Mã đúng hỏi lại `read_only`; với P1, câu trả lời được nhận kèm `usedDirectory: ["slack"]`.
  - P3: câu cuối của khối kết quả tra cứu khi bật cờ không có test (đột biến P8 lọt).
  - Reviewer chạy:
    - `npm run check` 1.836 v3 + 173 eval, với `max_connections` mặc định 100, không gặp lỗi "too many clients" như bên thi công;
    - browser lượt 1 fail một ca chập chờn ở nhóm `default`, lượt 2 đạt 105 pass/1 skip;
    - 14/16 đột biến bị bắt.
  - Hai ghi chú: kiểm "có dữ liệu đọc" đạt chỉ nhờ danh mục prefetch (cho GMAIL-04); và #142 xung đột với #143 ở `server.ts` và `sandbox/scenarios.ts`.
- **Phần sửa và rebase** ([log](2026-10-16-codex-ANS-01-review-fixes.md)): `c7b69be` thêm hai test cho P2 và P3; nhánh rebase lên `e03a9c8`.
- **Tại `1971cd0`:** [review lại](https://github.com/VinhDat267/ATI_Project/pull/142#issuecomment-6210118741) kết luận **Đạt**.
  - `git range-diff`: commit mã chỉ khác ở chỗ gộp với #143. `providerMemory(...)` ở cả ba lời gọi model; hai kịch bản sandbox `gmail` và `answer` cùng có.
  - Reviewer chạy `npm run check` exit 0 ngay lượt đầu (1.953 v3 + 173 eval) và browser exit 0 ngay lượt đầu (105 pass/1 skip, 12 nhóm).
  - **22/22 đột biến bị bắt:**
    - 16 của lần trước;
    - 5 vào bảo đảm của #143 trên bản tích hợp: `__labels` ở vòng `llm` và lượt thử lại `regex`, router với dịch vụ riêng, lệnh ghi Gmail đã gửi, fallback khi Gmail lỗi;
    - 1 ở chỗ gộp `server.ts`: bỏ `readAnswers`, nhóm browser `answer` fail 4/4.

## Cập nhật bàn giao

- `CURRENT-STATE.md`:
  - đầu file;
  - mục 2: dòng planner (kiểu trả lời);
  - mục 3: số liệu sau #142, bảng test 1.953 v3 và browser 105 pass/12 nhóm;
  - mục 4: #142, #144;
  - mục 5:
    - dòng mới về kiểm "có dữ liệu đọc" đạt nhờ danh mục prefetch;
    - dòng test GMAIL-01 chập chờn (nay 5 lần);
    - dòng browser chập chờn thêm ca FE-05 ngày 16/10;
  - mục 6: biến `PLANNER_READ_ANSWERS` và cách chạy kịch bản `answer`.
- `ROADMAP.md`:
  - ANS-01 xong; GMAIL-03 bắt đầu được;
  - GMAIL-04: bước 1 (Google Cloud project) xong;
  - đoạn "Cập nhật 16/10 (ANS-01)".
- Task card ANS-01: trạng thái xong.

## Google Cloud project cho Gmail (GMAIL-04 bước 1)

- Nhóm trưởng tạo project riêng cho Gmail theo hướng dẫn của reviewer: client OAuth loại Web, quyền `gmail.modify`, chế độ Testing.
- Reviewer kiểm `.env` ở máy nhóm trưởng mà không in giá trị:
  - 19/19 mục đạt;
  - `validateEnv` của server, giả lập live với `GMAIL_ENABLED=on`, nhận cấu hình.
- Project ID, Client ID và kết quả kiểm nằm ở `docs/ai-evidence/GMAIL-LIVE/` (ignore, không commit). `GMAIL_ENABLED` vẫn `off`; chưa chạy kết nối thật vì trang callback thuộc GMAIL-03.

## Đã dọn

- PostgreSQL tạm của reviewer đã xoá. Nhánh trên GitHub tự xoá khi merge.
- Worktree review `ATI_Project-review-pr142` của reviewer (chỉ có `node_modules`, `dist`, cache kết quả browser bị ignore) được xoá sau khi PR này mở.

## Chưa kiểm

- CI `main` sau #142 (`96f9f09`) đang chạy khi viết log này.
- Không chạy lại `npm run check` hay browser ở máy cho cập nhật bàn giao. Không gọi model.
