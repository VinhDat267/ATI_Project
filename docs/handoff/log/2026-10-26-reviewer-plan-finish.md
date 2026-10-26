# 26/10/2026 · Kế hoạch hoàn thành dự án (26/10 → 11/11)

**Người viết:** reviewer (lập kế hoạch). **Yêu cầu của nhóm trưởng ngày 26/10:** "lên plan chi tiết cho các phần còn lại", để vẫn làm theo được khi không còn reviewer cũ (phiên lập kế hoạch và review lâu nay). **Nhánh:** `docs/finish-plan`, tách từ `c760aa3`. Chỉ tài liệu.

## Đã làm

- **[FINISH-PLAN.md](../FINISH-PLAN.md):**
  - trạng thái ngày 26/10;
  - mốc cứng (28/10 Gmail, 29/10 OAUTH-01 và hai quyết định, 31/10–04/11 lịch chạy, 04/11 ngừng thêm tính năng, 05–11/11 demo, báo cáo, video, diễn tập);
  - lịch từng ngày, có người làm và điều kiện xong;
  - quyết định chờ nhóm trưởng, mỗi quyết định có mặc định;
  - thứ tự bỏ khi thiếu thời gian;
  - quy trình khi không còn reviewer cũ: hai phiên agent, A-thi công và A-review. A-review thay vai reviewer, gồm cả ghi bàn giao sau merge;
  - môi trường kiểm cục bộ, cách xử lý khi 9router hỏng;
  - bảng task card.
- **Task card mới:**
  - [DEMO-01](../tasks/DEMO-01-demo-stability.md): 3 kịch bản theo cờ đã bật, runbook, 3 lần liên tiếp, diễn tập LLM dự phòng;
  - [REPORT-01](../tasks/REPORT-01-final-report.md): 13 mục, bảng nguồn, kiểm số liệu và kiểm trung thực;
  - [SLIDES-01](../tasks/SLIDES-01-defense-slides.md): 16 slide, giả định 15 + 5 phút;
  - [VIDEO-01](../tasks/VIDEO-01-backup-demo-video.md);
  - [REHEARSAL-01](../tasks/REHEARSAL-01-defense-rehearsal.md): phân vai, diễn tập sự cố, 12 câu hỏi, checklist ngày bảo vệ;
  - [LAT-01](../tasks/LAT-01-planning-deadline.md): tuỳ chọn, chỉ làm nếu nhóm trưởng chọn.
- **`PROMPTS.md`**, mục "Khi không còn reviewer cũ": P-START, P-TASK, P-REVIEW, P-FIX, P-RECHECK, P-RECORD, P-W4-03, P-LIVE, P-PLAN.
- **ROADMAP:** tuần 5–6 trỏ tới task card mới; thêm dòng LAT-01; OAUTH-02 ghi "mặc định bỏ"; thêm "Cập nhật 26/10".
- **`README.md` của handoff:** thêm FINISH-PLAN vào bảng file.
- **`.gitignore`:** thêm `docs/ai-evidence/DEMO-LIVE/`.

## Chưa biết, đã để chỗ cho nhóm trưởng điền

- Thời lượng và hình thức buổi bảo vệ, hạn nộp báo cáo và slide (SLIDES-01, REHEARSAL-01). Kế hoạch giả định 15 phút trình bày và 5 phút demo.
- Phân vai trình bày và hỏi đáp (REHEARSAL-01).

## Ghi chú

- Mặc định đề xuất: bỏ OAUTH-02; không làm mã cho task độ trễ; không làm các việc backlog trước 04/11. Lý do ở FINISH-PLAN mục 4. Nhóm trưởng quyết ngày 29/10; không quyết thì áp dụng mặc định.
- Không đổi mã sản phẩm, không chạy test.
