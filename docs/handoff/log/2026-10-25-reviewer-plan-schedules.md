# 25/10/2026 · Lập kế hoạch lịch chạy workflow (SCHED-00)

**Người viết:** reviewer (lập kế hoạch). **Nhánh:** `docs/scheduled-workflows-plan`, base `7cf4f3e`. Chỉ tài liệu.

## Bối cảnh

Ngày 24/10, nhóm trưởng gửi tài liệu "Đề xuất tính năng OAuth và tạo lịch workflow bằng AI" của `longnguyen005` (không commit). Tài liệu gồm hai tính năng: kết nối mọi dịch vụ qua OAuth, và tạo lịch chạy workflow bằng hội thoại.

Reviewer đề xuất đưa cả hai vào báo cáo làm hướng phát triển, vì không kịp mốc 29/10 và các số đo tuần 4 sẽ không còn đúng. Nhóm trưởng trả lời "không tôi muốn triển khai".

## Quyết định của nhóm trưởng

- **24/10:**
  - triển khai; dời mốc ngừng thêm tính năng sang **04/11** (chọn giữa giữ 29/10 và dời 04/11);
  - duyệt kịch bản demo reviewer gợi ý (nhóm trưởng chưa hình dung được nên nhờ gợi ý);
  - giao reviewer tự review thiết kế; sau review chọn demo **Calendar → Slack** và **chia đôi** việc: reviewer backend và planner, `longnguyen005` giao diện.
- **25/10:** duyệt đặc tả.

Reviewer tự chọn, không hỏi lại: làm lịch chạy trước OAuth; chỉ chế độ chờ duyệt từng lần; cờ tắt mặc định; các điểm ghi trong bảng "mình tự quyết" khi gửi đặc tả (mỗi hội thoại một lịch, không thêm tab, nhịp 30 giây, trễ 10 phút là lượt lỡ, giới hạn 10 lịch, tự tạm dừng sau 3 lượt quá hạn, mốc cắt).

## Tự review thiết kế (24/10, đối chiếu mã)

12 điểm, đều đã đưa vào đặc tả:
1. `github.search_issues` chỉ tìm theo một cụm từ, không lọc ngày, kết quả không có ngày tạo (`packages/tool-adapters/src/github/github-adapter.ts:178`). Kịch bản "issue mới từ lượt trước" không làm được → đổi demo sang Calendar → Slack.
2. Model có thể quá hạn lúc lập kế hoạch lượt (W4-01: 17/124 lần thử) → `planning_failed`, "Lập lại kế hoạch".
3. Planner có thể hỏi lại, từ chối, trả lời → lượt `needs_attention`; lúc tạo lịch, việc phải có hành động ghi.
4. `createPlan` chuyển kế hoạch đang chờ của cùng hội thoại sang `superseded` (`plan-repo.ts:34`) → mỗi lượt một hội thoại.
5. SSE chỉ theo từng hội thoại (`stream-routes.ts:15`) → số lượt chờ duyệt dùng API đếm.
6. Quản lý bằng tên từ hội thoại khác cần đưa danh sách lịch vào prompt → bản đầu chỉ trong hội thoại đã tạo lịch.
7. Đề xuất cũ đến muộn → kiểm phiên bản, 409.
8. Tab thứ 6 đụng bố cục FE-12 → số trên tab Nhật ký.
9. Bật cờ đổi prompt → đo lại `core`/`services`.
10. Chi phí khi người dùng vắng → giới hạn và tự tạm dừng.
11. Lượt lỡ → gộp một dòng.
12. Thời gian 26/10–04/11 → hai mốc cắt.

Khi đọc đặc tả trong vai người thi công (không dùng agent khác, vì nhóm trưởng chưa yêu cầu), chốt thêm: đề xuất xác nhận muộn có giờ đã qua → 409; hội thoại có lịch đã hủy → gợi ý mở hội thoại mới; quy tắc giờ mùa hè; "Bỏ qua" chỉ ẩn trong phiên.

Khi lập task card (25/10), sửa đặc tả thêm ba chỗ, ghi ở dòng trạng thái của đặc tả:
- hai kiểu metadata `schedule_state`, `schedule_run` ở mục 4, vì giao diện cần;
- thời hạn 180 giây cho một lượt lập kế hoạch ở mục 6.4;
- planner gộp dịch vụ của lịch vào router (mục 5.3). Câu "tạm dừng lịch này" không có từ khoá dịch vụ, nên nếu không gộp thì planner trả từ chối `unroutable` mà không gọi model.

## Thay đổi trong PR

- Đặc tả `docs/superpowers/specs/2026-10-24-scheduled-workflows-design.md`.
- Task card: `SCHED-common`, `SCHED-01` → `SCHED-04`.
- `ROADMAP.md`: 5 dòng mới (4 SCHED, 1 OAuth chưa có task card), dòng tuần 5 ghi mốc 04/11, đoạn "Cập nhật 25/10".
- `CURRENT-STATE.md` mục 7: "Chốt 24–25/10/2026".
- `.gitignore`: `docs/ai-evidence/SCHEDULE-LIVE/`.

Không chạy test: PR chỉ đổi tài liệu. `git diff --check` ở phần kiểm cuối.

## Việc khác trong phiên

- CI `main` sau #165: [run 40111110505](https://github.com/VinhDat267/ATI_Project/actions/runs/40111110505) SUCCESS đúng `7cf4f3e`; 2.042 v3 + 394 eval, browser 120 pass/1 skip.
- Theo yêu cầu nhóm trưởng, xoá hai worktree review đã merge, `ATI_Project-review-pr159` (`ae0b4a4`) và `ATI_Project-review-pr162` (`ffc8952`), cùng thư mục rỗng `ATI_Project-wt-fe12-impl`. Trước khi xoá:
  - chép `.codex/` của hai worktree và 2 log review chưa commit sang `.codex/worktree-archive/2026-10-24-reviews/` (ignore);
  - so SHA-256: 14/14 và 49/49 file khớp;
  - gỡ 12 junction `node_modules/@wap` (mỗi junction chỉ trỏ vào chính worktree của nó).

  Giữ worktree `review-pr164`.

## Còn mở

- Nhóm trưởng báo `longnguyen005` nhận SCHED-03.
- OAuth: bàn sau khi PR này merge; mốc cắt 01/11.
- Task card tuần 5 (ổn định demo, nay 05–06/11) và tuần 6 (báo cáo, slide, video dự phòng, diễn tập bảo vệ) chưa lập.
- Các việc đang chờ nhóm trưởng: báo số lượt W4-03; nghiệm thu Google thật GMAIL-04 và PR bật cờ trước 28/10; quyết task độ trễ.
