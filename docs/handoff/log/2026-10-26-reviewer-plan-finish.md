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

## Thêm cùng ngày: đặc tả và task card OAUTH-02

Theo yêu cầu của nhóm trưởng ("2": viết sẵn OAUTH-02 để dùng nếu ngày 29/10 chọn làm):
- [đặc tả](../../superpowers/specs/2026-10-26-oauth-02-personal-calendar-design.md);
- [task card](../tasks/OAUTH-02-personal-calendar.md).

Các quyết định thiết kế, lý do ở đặc tả mục 1:
- **Dịch vụ riêng `mycalendar`**, tool riêng, sau cờ `MYCALENDAR_ENABLED`, không thay `calendar.*`. Lịch chung, các phép đo và kịch bản demo Calendar → Slack giữ nguyên; không rơi về service account.
- **Client OAuth thứ hai** trong cùng Google Cloud project của Gmail. Google gom quyền theo cặp (người dùng, client OAuth), nên dùng chung client thì ngắt kết nối Gmail (`revoke`) sẽ thu hồi luôn quyền Calendar.
- **Chỉ lịch chính**, hai tool (`list_events`, `create_event`), không có `calendarId`, không mời ai.
- **Tổng quát hoá phần kết nối riêng của Gmail theo mã dịch vụ.** Bộ test Gmail phải đạt không sửa assertion; nếu không được thì chép route và ghi lý do.

Ước lượng 3 ngày công cộng review; mốc cắt 01/11; mặc định vẫn là bỏ. ROADMAP và FINISH-PLAN (mục 4, mục 8) trỏ tới hai file mới.

## Chưa biết, đã để chỗ cho nhóm trưởng điền

- Thời lượng và hình thức buổi bảo vệ, hạn nộp báo cáo và slide (SLIDES-01, REHEARSAL-01). Kế hoạch giả định 15 phút trình bày và 5 phút demo.
- Phân vai trình bày và hỏi đáp (REHEARSAL-01).

## Ghi chú

- Mặc định đề xuất: bỏ OAUTH-02; không làm mã cho task độ trễ; không làm các việc backlog trước 04/11. Lý do ở FINISH-PLAN mục 4. Nhóm trưởng quyết ngày 29/10; không quyết thì áp dụng mặc định.
- Không đổi mã sản phẩm, không chạy test.
