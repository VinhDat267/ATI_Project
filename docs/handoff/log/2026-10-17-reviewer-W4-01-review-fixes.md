# 17/10/2026 · W4-01 · Sửa theo review độc lập #150

**Người viết:** reviewer (bên thi công) · **Nhánh:** `test/w4-01-independent-eval` · [Review](https://github.com/VinhDat267/ATI_Project/pull/150): chưa đạt, 2 P2, 1 P3.

## Đã sửa

- **P2 – câu từ chối chỉ nhắc email không có giá trị `services` hợp lệ.**
  - Câu `refusal` hoặc `clarification` được ghi `services: []` khi không nhắc dịch vụ nào trong catalog.
  - Câu có kế hoạch vẫn phải có ít nhất một dịch vụ; thiếu hẳn trường `services` vẫn là lỗi.
  - `GUIDE.md` mục 6 ghi quy tắc này.
- **P2 – điều kiện sai kiểu với tham số vẫn được nhận.** `typeProblems` đối chiếu điều kiện với kiểu trong `inputSchema`, theo cách `scorer.ts` so sánh. Báo lỗi khi:
  - `equals` khác kiểu;
  - `startsWith`/`endsWith`/`instantEquals` đặt cho tham số không phải chữ;
  - `includesAny`/`includesAll` đặt cho tham số không phải chữ hay danh sách;
  - `contains`/`minItems` đặt cho tham số không phải danh sách, hoặc `contains` khác kiểu phần tử.

  `anyOf` lồng được kiểm đệ quy; `includesAll` trên `rows` vẫn hợp lệ. `GUIDE.md` mục 6 thêm phần "Điều kiện phải hợp với kiểu của tham số".
- **P3 – test chỉ gọi thẳng `assertSetReady`.** Thêm test chạy `run.ts` qua dòng lệnh với `EVAL_DRY_RUN=1 EVAL_SET=independent`:
  - bộ rỗng: exit 1 và có thông báo readiness;
  - bộ đủ: dừng ở `EVAL_ONLY` không tồn tại, không chấm câu nào.

## Kiểm thử

- RED: 7 ca kiểu và 1 ca `services: []` fail trên mã cũ (8 fail / 53 pass). Test CLI đạt ngay trên mã cũ vì cổng chặn đúng; nó là test hồi quy, được chứng minh bằng đột biến M30.
- GREEN: 61/61 (`golden-independent` + `run.test.ts`).
- Không có cảnh báo kiểu nhầm nào trên 112 label của ba bộ cũ (probe tạm, không commit).
- Đột biến: 21 cũ và 9 mới, **30/30 bị bắt**. M30 xoá lời gọi `assertSetReady` trong `main()`; lần review trước đột biến này lọt, nay bị test CLI bắt.
- Typecheck chặt `golden-independent` và `golden-v2`: exit 0.
- `npm run check` (worktree, database tạm 55533 đã migrate, sandbox, không có `.env`): exit 0, **1.953 v3 + 221 eval** (210 + 11 test mới).
