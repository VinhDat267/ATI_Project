# 17/10/2026 · W4-03 · Sửa theo review độc lập #149

**Người viết:** reviewer (bên thi công) · **Nhánh:** `test/w4-03-usable-plan-study` · [Review](https://github.com/VinhDat267/ATI_Project/pull/149#issuecomment-6232725979): chưa đạt, 2 P2, 1 P3.

## Đã sửa

- **P2 – mẫu lệch 16–1–1–1–1 vẫn báo đạt.**
  - `meetsMinimum` giờ cần thêm điều kiện mỗi người ≥ 4 lượt (`MIN_TURNS_PER_PARTICIPANT`).
  - Báo cáo trả `shortParticipants`; tóm tắt ghi số lượt của từng người và các mã chưa đủ lượt.
  - CLI trên database thật với phân bố 16–1–1–1–1: exit 2, ghi "Chưa đủ 4 lượt: P02, P03, P04, P05".
- **P2 – đếm cả bước `pending`/`skipped` là đã thực thi.**
  - Tách `executionRows` (mọi dòng) và `startedSteps` (`started_at IS NOT NULL`; `step-repo` chỉ ghi `started_at` khi bước chuyển `running`).
  - Tóm tắt dùng câu trung tính và đề nghị đối chiếu với phiếu, không còn câu "chủ dự án cho chạy thật".
  - `PROTOCOL.md`: lượt được phép chạy thật ghi `chay-that` ở đầu cột `note`.
- **P3 – CSV thiếu `superseded`.** Thêm cột `superseded`, `execution_rows` và `started_steps`.

## Kiểm thử

- PostgreSQL 16 tmpfs riêng ở 55533, không dùng DB của `.env`.
- RED: 4 test mới và 2 test sửa đều fail trên mã cũ: 6 fail / 22 pass.
- GREEN: 28/28; toàn bộ eval 201/201.
- Đột biến: 17/17 bị bắt. Gồm 12 đột biến cũ và 5 đột biến mới vào ba chỗ sửa.
- Typecheck chặt 3 file exit 0.
- **Chưa chạy lại `npm run check` đầy đủ** sau bản sửa; chỉ có `evaluations/` thay đổi.
