# 17/10/2026 · W4-01 · Khung bộ đánh giá độc lập

**Người viết:** reviewer (nhóm trưởng giao thi công) · **Nhánh:** `test/w4-01-independent-eval`, base `ab54c77` · Task: [W4-01](../tasks/W4-01-independent-eval-set.md).

## Đã làm

- `evaluations/golden-independent/GUIDE.md`: hướng dẫn tiếng Việt cho người viết câu. Gồm quy tắc, năm nhóm câu, workspace giả lập (tên → ID), 14 tool ghi, cách viết label, 5 ví dụ, cách tự kiểm và cách nộp.
- `evaluations/golden-independent/cases.json`: rỗng, cùng định dạng với `golden-v2`, đồng hồ `2026-09-29T10:00:00+07:00` như bộ services.
- `evaluations/golden-independent/validate.ts`: `caseProblems`, `validateIndependentSet` và CLI (`--partial` cho file của từng người).
- `evaluations/golden-independent/cases.test.ts`, `tsconfig.json`.
- `evaluations/golden-v2/run.ts`: `EVAL_SET=independent`, `assertSetReady`, kiểm commit đăng ký cả `evaluations/golden-independent`, ghi `author` vào từng dòng kết quả. Thông báo "Independent set is not ready: N problems" được in nguyên văn; các lỗi khác vẫn bị che như trước.
- `evaluations/golden-v2/scorer.ts`: `GoldenCase.author`. `run.test.ts`: một test mới.
- Mục "W4-01: independent set" trong `evaluations/README.md`, ghi rõ chưa đo.

Không sửa mã sản phẩm, prompt hay label cũ.

## Bộ kiểm định dạng

Mỗi câu:
- chỉ có các trường `id`, `category`, `language`, `author`, `services`, `prompt`, `expect`;
- `id` chữ thường, không bắt đầu bằng `vd-`; `author` dạng `member-N`, không phải `author-v2`;
- `prompt` không trùng bộ cũ (core, freeform, services) hay ví dụ của GUIDE, bỏ qua hoa thường và khoảng trắng;
- `services` là dịch vụ có thật và chứa dịch vụ của mọi bước;
- `kind` đúng theo nhóm; câu hỏi lại và từ chối không có bước;
- kế hoạch có đúng một trong `steps`/`anyOf`; mỗi bước là tool ghi có thật, có ít nhất một điều kiện, tham số có trong schema;
- điều kiện thuộc 11 loại của `scorer.ts`, đúng kiểu giá trị; `instantEquals` có múi giờ; `refTo` trỏ tới tool có trong cùng phương án; `anyOf` lồng được kiểm đệ quy;
- ID tài nguyên (`equals`, `contains`) có trong fixtures hoặc có trong câu chat;
- `single_step` đúng một bước; `multi_step` một dịch vụ và có phương án từ hai bước; `cross_service` mọi phương án từ hai dịch vụ.

Cả bộ (không có `--partial`): ≥ 30 câu, mỗi nhóm ≥ 4, mỗi ngôn ngữ ≥ 5; `id` và `prompt` không trùng trong bộ.

Bộ kiểm không chạy planner, nên không báo câu nào AI sẽ trả sai. Theo task card, agent chỉ báo lỗi định dạng.

## Kiểm thử

- PostgreSQL 16 tmpfs riêng ở 55533 (container `ati-w401-pg`), không dùng DB của `.env`.
- **RED:**
  - `cases.test.ts` khi chưa có `validate.ts`: fail vì không tìm thấy module. Bộ kiểm được viết trước test; RED này chỉ cho thấy test không đạt khi thiếu mã, nên bằng chứng chính là đột biến dưới đây;
  - test mới của `run.test.ts` chạy trên `run.ts` của `main`: fail với "EVAL_SET must be core, freeform or services".
- **GREEN:** 36/36 (`golden-independent`) và 14/14 (`run.test.ts`).
- **Đột biến:** 21 đột biến, mỗi lần khôi phục và kiểm SHA-256, **21/21 bị bắt**. 19 vào `validate.ts`: ngưỡng 30/4/5, mẫu `author`, tool đọc, ID fixtures, ID gõ trong câu, `anyOf` lồng, `refTo`, `services`, câu trùng bộ cũ, so khớp không phân biệt hoa thường, số bước, số dịch vụ, trường lạ, ví dụ GUIDE, `kind`, mã `vd-`, câu trùng trong bộ. 2 vào `run.ts`: tắt cổng chặn, trỏ `independent` sang file core.
- **Typecheck chặt:** `npx tsc -p evaluations/golden-independent/tsconfig.json` exit 0 (lần đầu báo 1 lỗi kiểu trong test, đã sửa); `npx tsc -p evaluations/golden-v2/tsconfig.json` exit 0.
- **CLI:**
  - trên `cases.json` rỗng: exit 1, 8 lỗi thiếu thành phần;
  - `EVAL_DRY_RUN=1 EVAL_SET=independent`: runner in "Independent set is not ready: 8 problems; run evaluations/golden-independent/validate.ts", exit 1.
- `npm run check` (worktree, `DATABASE_URL` trỏ database tạm 55533 đã migrate, `RUNTIME_MODE=sandbox`, không có `.env`): exit 0, **1.953 v3** (63 schema + 408 adapter + 291 planner + 42 executor + 464 API + 685 web) **+ 210 eval** (173 + 36 test của `golden-independent` + 1 test runner). Browser không chạy: PR không đổi mã sản phẩm hay giao diện.

## Giới hạn

- Chưa có câu nào; ba tiêu chí sau khi nộp (commit đăng ký, 3 lần chạy, báo cáo) còn mở.
- Nhóm trưởng cần đọc `GUIDE.md` và xác nhận một người chưa đọc code dùng được (tiêu chí đầu của task card).
- Viết JSON tay khó với người không viết code. Bộ kiểm báo lỗi từng chỗ, nhưng có thể cần nhóm trưởng ngồi cùng ở lượt đầu.
- Cần review độc lập: reviewer là bên thi công.
