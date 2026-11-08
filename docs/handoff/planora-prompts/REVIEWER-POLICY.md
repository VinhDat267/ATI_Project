# Reviewer Planora — Gemini 4 Argon trong Antigravity

**Quyết định của chủ dự án, 05/11/2026:** dùng Gemini 4 Argon thay Codex để review vì Codex đến limit. Chính sách này thay yêu cầu reviewer Codex trong các prompt/kế hoạch local cũ; không cần chờ quota Codex để review task hoặc review tích hợp cuối.

## Vai trò và cấu hình

- Implementer: Gemini 3.8 Flash (High) trong Antigravity, theo cấu hình thi công hiện tại.
- Reviewer: **Gemini 4 Argon (High)** trong **phiên Antigravity mới**, worktree review riêng, không phải phiên đã viết/sửa task. Tài khoản khác là tùy chọn; worktree/phiên độc lập là bắt buộc.
- Provider model ID đã xác minh qua `agy models` trên máy: **`gemini-4-argon-high`**. Danh sách thực tế cũng có Argon Medium/Low; chọn High cho lượt review này. Không suy ID model từ tên hiển thị.
- Orca worker mới: `--agent antigravity --model gemini-4-argon-high`. Model ID đã chứa mức High; không cần tự suy thêm effort khác. Sau launch kiểm receipt và model hiển thị thực tế; prompt tự nhận tên model không phải bằng chứng chọn model.
- Nếu model unavailable/quota/auth lỗi: báo coordinator đúng lỗi và dừng review phụ thuộc; không tự dùng Flash hoặc sửa nhãn reviewer để giả Argon.

**UX authority 05/11/2026:** [Business-first UX](../../superpowers/specs/2026-11-05-planora-business-first-ux.md) và [PLANORA-UX-01](../tasks/PLANORA-UX-01-business-first-redesign.md). Reviewer phải đánh giá lại các phần đã làm, yêu cầu thiết kế/refactor lại nếu không đạt; PASS kỹ thuật/ảnh giống mẫu cũ không miễn gate UX. Không dùng cấu trúc UI hiện tại làm chuẩn bắt buộc.

## Quy trình review

1. Coordinator điền task/card/base/head và kiểm head còn đúng. Dùng [review từng task](90-argon-task-review.md) hoặc [review cuối](91-argon-final-review.md), đọc COMMON, main-sync revision và yêu cầu task.
2. Giao reviewer riêng bằng Orca supervised worker khi được giao điều phối; dùng `--spec-file` để tránh lỗi quoting. Nếu đã có run thì gắn đúng run/task, không tạo run cạnh tranh hoặc chiếm inbox của coordinator. Không dùng terminal send để điều khiển worker đã dispatch.
3. Reviewer đọc actual diff/source, chạy lại checks cần thiết và kiểm trình duyệt bằng Playwriter theo skill. Dùng DB/port/tab/session riêng; không ghi provider thật. Test selection/listing không thay thế thực thi.
4. Findings phải có severity, file:dòng, trigger, tác động và evidence. Reviewer không sửa production code/worker branch. Worker sửa theo [prompt fixes](92-gemini-review-fixes.md), rồi Argon kiểm lại SHA mới.
5. Mỗi report ghi rõ **Reviewer: Antigravity / Gemini 4 Argon (High)**, base/head, lệnh/exit code, PASS/FAIL/NOT_RUN và giới hạn. Gửi `worker_done` theo Task/Dispatch thực, outcome không đồng nghĩa verdict Đạt. Findings chưa sửa hoặc thiếu gate bắt buộc vẫn giữ Chưa đạt.
6. Review code từng task và toàn nhánh cuối đều dùng Argon. Hình thức UI vẫn do chủ dự án duyệt; merge/deploy vẫn cần quyền và CI đúng head như trước.

## Chuyển từ review Codex hiện có

- Giữ nguyên báo cáo/commit/nhãn reviewer lịch sử, không đổi Codex thành Gemini trong log đã tạo. Bằng chứng cũ chỉ áp dụng head/phạm vi đã kiểm.
- Không miễn findings Codex chỉ vì đổi reviewer. Với PL-07, báo cáo local tại `review-planora-pl-07/docs/handoff/log/2026-11-04-codex-review-pl-07.md` còn F1/F2 P2 (prefill clarification, contrast) tại head `4405fd36`; kiểm head mới nhất và xử lý/review lại đúng các findings đó trước acceptance.
- Packet mới dùng `READY_FOR_REVIEW`, `WAITING_REVIEW`, `REVIEW_FINDINGS`. Packet cũ `READY_FOR_CODEX_REVIEW` vẫn được coordinator nhận như trạng thái chờ review; không tự nâng thành PASS.
- Prompt 90/91 có tên cũ chỉ là alias chuyển tiếp sang prompt Argon. Không gọi reviewer Argon là Codex hoặc buộc khởi chạy Codex khi hết limit.
- Tài liệu/prompt giữ local, không commit vào nhánh sản phẩm công khai. Việc sửa file không tự cập nhật context/DAG hoặc chạy reviewer; coordinator đang hoạt động phải đọc chính sách này trước dispatch tiếp.
