# 18/10/2026 · W4-02 · Sửa P2 lần 2 và test browser làm CI #157 đỏ

Nhóm trưởng yêu cầu "hãy fix nốt cho tôi nhé" sau [review tại `4fe8fb4`](https://github.com/VinhDat267/ATI_Project/pull/157#issuecomment-6245785227). Làm trên nhánh `fix/pr157-failure-label`, cập nhật cùng PR #157; không sửa CURRENT-STATE hay ROADMAP.

## Label và scorer

- Label `c864f55` đăng ký trước mọi lời gọi model. Chưa đo.
- `mt_reply02` tiếp tục loại `succeed`, `success`, `thành công`, nhưng dùng `excludeExceptions` cho các cụm thất bại đã ghi trong label, như `unsuccessful`, `did not succeed`, `failed to complete successfully`.
- Scorer chỉ bỏ qua những cụm này khi kiểm `excludes`; các matcher khác vẫn đọc nguyên nội dung. Một mệnh đề thành công khác trong cùng tin nhắn vẫn bị loại. Label cũ không có trường mới giữ nguyên cách chấm.
- Thêm 19 câu qua `runCase`, AIPlanner và history thật, chỉ mock model, gồm các câu đúng của review và các câu đảo nghĩa do reviewer độc lập phát hiện: `completed successfully with no failures`, `did not fail; it succeeded`, `thành công, không có lỗi`. Thêm 4 test scorer cho chữ hoa/thường, lặp cụm và mệnh đề thành công ngoài ngoại lệ.

## Browser CI

`gmail-03.spec.ts` sửa riêng `plans.resource_labels` trong PostgreSQL rồi reload. SSE buffer vẫn giữ `plan_preview` với label cũ. Thứ tự REST/SSE quyết định test thấy tiêu đề nào, dù app xử lý đúng dữ liệu nó nhận.

Đã ép thứ tự trên test cũ: chặn stream tới khi REST hiện tiêu đề dài, rồi cho stream chạy. Tiêu đề đổi lại thành `Họp nhóm ATI`, đúng lỗi CI; assertion tiêu đề dài fail. Probe tạm đã khôi phục nguyên byte và kiểm SHA-256.

Test nay mở Cuộc hội thoại mới qua drawer, đợi URL mới rồi Back về hội thoại đang kiểm. Cách này nạp lại kế hoạch từ PostgreSQL và giữ cursor SSE trong cùng app, không phát lại fixture cũ. Vẫn giữ kiểm tra tiêu đề 120 ký tự ở màn duyệt và biên nhận, không tràn ngang, cùng các screenshot 1440/375 sáng/tối. Không đổi runtime hoặc stub dữ liệu SSE.

## Kiểm chứng

- RED trên label cũ: 7 fail / 36 pass trong file label.
- Sau thêm các phản ví dụ của reviewer độc lập và test scorer mới: RED 7 fail / 55 pass.
- GREEN: 67/67 ở ba file label, runner multi-turn và scorer; typecheck chặt golden-v2 exit 0.
- Đột biến 3/3 bị bắt: bỏ ngoại lệ; bỏ hết `excludes` khi có ngoại lệ; chỉ che lần xuất hiện đầu. Mỗi lần khôi phục và kiểm SHA-256.
- Browser Gmail: 4/4, gồm desktop/mobile sáng/tối, 44,4 giây.
- Reviewer độc lập chạy lại 67/67, không còn finding quan trọng; đã đọc bằng chứng browser RED/GREEN, không tự chạy lại browser.
- Lượt `npm run check` cuối đầu tiên sau sửa scorer dừng ở timeout 5 giây của `fe-04-shell.test.tsx`, ca `/settings`, ngoài diff. Chạy riêng file này: 10/10; giữ log lỗi, không tính lượt đó là đạt.
- Chạy lại `npm run check` tuần tự, PostgreSQL 16 riêng tại 56657, sandbox, hai cờ tắt, không dùng `.env`: **exit 0**, **2.014 v3 + 389 eval** (63 + 408 + 291 + 42 + 465 + 745; thêm 23 eval so với `4fe8fb4`). Build, kiểm 7 mẫu cấm, launcher và 10 test Node cuối đều đạt.

Không gọi model hay Google thật; không merge.
