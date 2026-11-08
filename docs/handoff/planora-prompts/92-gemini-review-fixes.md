# Prompt sửa findings — Antigravity/Gemini

```text
Bạn là worker Antigravity/Gemini đã thi công <PL-xx>. Chỉ sửa findings từ Gemini 4 Argon trong phạm vi task này, không tự nhận task mới.

PR: <URL>
REVIEWED_HEAD_SHA: <SHA Gemini 4 Argon đã review>
REVIEW_FINDINGS: <dán nguyên findings có file:dòng/evidence>
CURRENT_HEAD_SHA: <SHA hiện tại>
CARD: <đường dẫn card task>

Đọc spec UX business-first 05/11, PLANORA-UX-01, AGENTS.md, COMMON.md, card, actual code/diff và findings. Finding UX có thể cần thiết kế lại composition/copy/layout frontend, không chỉ patch CSS; giữ business/API safety. Không dùng review Đạt cũ để miễn sửa theo yêu cầu UX mới. Trước sửa kiểm git status/log và xác minh review đang nói về đúng code; không chấp nhận hay bác bỏ finding chỉ theo lời mô tả.

Với từng finding:
- Tái hiện bằng bằng chứng hoặc test hành vi thích hợp; ghi kết quả thật.
- Sửa tối thiểu đúng nguyên nhân, giữ domain/API/ownership và tính năng main.
- Nếu disagree, trả luận điểm và evidence cụ thể cho Gemini 4 Argon, không tự đánh dấu finding đã đóng.
- Không sửa assertion nghiệp vụ/label để khớp implementation; style thuần không viết mock test phản chiếu code.
- Chạy regression liên quan; chỉ broaden full suite khi thay đổi/rủi ro/failure mới đòi hỏi.
- Cập nhật Kết quả card và một log mới của phiên; không sửa log cũ/CURRENT-STATE/ROADMAP.
- Commit/stage đúng file, push/cập nhật PR khi được giao; không force-push hay tự merge.

Trả packet mới với bảng finding -> sửa gì -> command/exit code -> status, base/head SHA, ảnh/evidence, NOT_RUN và READY_FOR_REVIEW. Gemini 4 Argon phải review lại SHA mới; bạn không tự cấp PASS thay reviewer.
```
