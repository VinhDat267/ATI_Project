# 17/10/2026 · W4-03 · Khung buổi thử "kế hoạch dùng được"

**Người viết:** reviewer (nhóm trưởng giao thi công) · **Nhánh:** `test/w4-03-usable-plan-study`, base `ab54c77` · Task: [W4-03](../tasks/W4-03-usable-plan-study.md).

## Quyết định của nhóm trưởng (17/10)

Nhóm trưởng đồng ý các mặc định reviewer đề xuất:
- **chỉ xem, không chạy thật:** người tham gia nói "duyệt", người điều phối ghi nhận, hỏi "Nếu ATI chạy đúng kế hoạch này, kết quả có đúng ý bạn không?", rồi bấm Hủy;
- mỗi lượt là một hội thoại mới;
- 10 tình huống phủ 8 dịch vụ;
- chế độ live với `ag/gemini-3.8-flash`, cờ Gmail và kiểu trả lời tắt.

## Đã làm

- `evaluations/usable-plan/PROTOCOL.md`: định nghĩa chép nguyên văn từ task card và cách áp dụng "chỉ xem" kèm giới hạn; người tham gia; chuẩn bị; bối cảnh nhóm; 10 tình huống; bảng chia lượt; các bước một lượt; phiếu ghi; chạy báo cáo; quyền riêng tư.
- `evaluations/usable-plan/report-lib.ts`, `report.ts`: đọc phiếu, đọc PostgreSQL trong `BEGIN TRANSACTION READ ONLY` (luôn `ROLLBACK`), phân loại từng lượt, Wilson 95%, xuất `turns.csv` và `summary.md`. Exit 2 khi chưa đủ 20 lượt hoặc 5 người, exit 1 khi phiếu sai hoặc lỗi database.
- `evaluations/usable-plan/report.test.ts`: 25 test.
- `evaluations/usable-plan/sheet-template.csv`, `.gitignore` (`docs/ai-evidence/USABLE-PLAN/`), mục README.

Không sửa mã sản phẩm.

## Cách tính

| Dữ liệu | Lấy từ |
|---|---|
| Quyết định (`duyet`/`huy`/`bo-cuoc`), câu trả lời đúng ý | phiếu của người điều phối |
| Số kế hoạch, số `superseded`, trạng thái kế hoạch cuối, số bước đã thực thi | `plans`, `execution_steps` |
| Số câu hỏi lại, số lần từ chối | `messages.metadata->>'type'` = `clarification`/`refusal` |
| Thời gian tới kế hoạch đầu | `min(plans.created_at)` − `min(messages.created_at)` của tin `user` |

Số lần sửa = số kế hoạch − 1. Phân loại theo thứ tự: không tìm thấy hội thoại → không có kế hoạch → hủy → bỏ cuộc → sửa từ hai lần → người tham gia nói không đúng ý. Còn lại là dùng được.

## Kiểm thử

- PostgreSQL 16 tmpfs riêng ở 55533 (container `ati-w403-pg`), không dùng DB của `.env`.
- RED: chạy test khi chưa có `report-lib.ts`, fail vì không tìm thấy module. GREEN: 25/25.
- Nhóm PostgreSQL tạo schema riêng `usable_plan_<uuid>` từ migration 0001–0009, gieo 5 hội thoại (duyệt ngay, sửa một lần, sửa hai lần, hủy, có câu hỏi lại) với tin `user` chứa chuỗi riêng tư; kiểm số liệu, phân loại 3/5 dùng được, và CSV không chứa chuỗi đó. Một test chạy `INSERT` trong `withReadOnly`: bị từ chối với "read-only transaction", số dòng không đổi.
- 12 đột biến vào `report-lib.ts`, mỗi lần khôi phục và kiểm SHA-256: **12/12 bị bắt**. Gồm: sửa hai lần vẫn dùng được; bỏ câu trả lời đúng ý; transaction không chỉ đọc; thời gian lấy kế hoạch cuối; câu hỏi lại tính là sửa; khoảng 90% thay 95%; nhận tên thay mã; mẫu tối thiểu bỏ điều kiện số người; lượt hủy dùng được; không có kế hoạch dùng được; duyệt mà không có câu trả lời đúng ý; ghi chú có dấu phẩy không được bọc.
- Typecheck chặt ba file exit 0: `tsconfig.json` gốc (`strict`, `noUncheckedIndexedAccess`) với `module: ESNext`, `moduleResolution: Bundler`, vì repo không đặt `"type": "module"` mà test dùng `import.meta` như các file eval khác. Lần đầu báo 6 lỗi giá trị có thể `undefined` (3 trong `quantile`, 3 trong test), đã sửa; 12/12 đột biến chạy lại sau sửa vẫn bị bắt. `typecheck:v3` không gồm `evaluations/`.
- Chạy CLI với một phiếu một dòng trên database tạm: in tóm tắt, ghi hai file, exit 2 (chưa đủ mẫu).
- `npm run check` (worktree, `DATABASE_URL` trỏ database tạm 55533 đã migrate, `RUNTIME_MODE=sandbox`, không có `.env`): exit 0, **1.953 v3** (63 schema + 408 adapter + 291 planner + 42 executor + 464 API + 685 web) **+ 198 eval** (173 + 25 test mới). Browser không chạy: PR không đổi mã sản phẩm hay giao diện.

## Giới hạn

- Buổi thử chưa chạy; ba tiêu chí sau buổi thử còn mở.
- Cách "chỉ xem" đo việc người tham gia *sẽ* duyệt kế hoạch họ thấy, không đo kết quả thực thi thật. Báo cáo môn học phải ghi điều này.
- Thời gian tới kế hoạch đầu gồm cả lúc người tham gia trả lời câu hỏi lại; không phải phép đo W4-04.
- Câu từ chối của AI không tạo kế hoạch nên không tính là sửa; nếu người tham gia viết lại câu sau khi bị từ chối, kế hoạch đầu tiên vẫn là kế hoạch đầu. CSV có cột `refusals` để xem những lượt này.
- Cần review độc lập: reviewer là bên thi công.
