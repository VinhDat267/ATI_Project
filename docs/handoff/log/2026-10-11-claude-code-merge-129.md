# Merge #129 (FE-11)

- Ngày: 11/10/2026, Asia/Saigon. Agent: Claude Code, reviewer độc lập.
- Người dùng: "kiểm tra #129", rồi "merge #129" (không đăng bình luận review lần 2 lên PR).

## Review lần 2 trên `daa023c`: Đạt

Long sửa hai P2 và ba P3 của [review lần 1](https://github.com/VinhDat267/ATI_Project/pull/129#issuecomment-6099178321), sửa email git, rồi rebase lên `main` `84a3461` kèm `--reset-author`. Cả 13 commit có tác giả `253925836+longnguyen005@users.noreply.github.com`, nên GitHub gắn được tài khoản `longnguyen005`. Xung đột với #128 giải đúng hướng dẫn: runner giữ cả `FE-10:` lẫn `FE-11:`; `auth-google.test.tsx` bỏ `{ timeout: 5_000 }`.

Ở máy (worktree head `daa023c`, PostgreSQL tmpfs riêng 56533, sandbox):

- `npm run check` exit 0: 1.674 v3 (47 + 340 + 212 + 25 + 371 + 679) + 173 eval.
- `npm run test:browser:v3` exit 0 ngay lần đầu: 101 pass, 1 skip có chủ đích, 11 nhóm (default 83).
- `--grep "FE-11:" --repeat-each 20 --workers 1`: 20/20 (lượt review đầu 4/10).
- Probe trình duyệt tạm (đã xoá, không commit), 10 lần mỗi ca, 50/50: ô đầu tiên nhận focus ở `/login` (Email), `/signup` (Họ tên), `/forgot-password` (Email); mở từ nút trang chủ thì focus Email; điền nhanh Email rồi Mật khẩu giữ đúng giá trị.
- Đột biến 8/8 bị bắt:
  - trả `LandingPage` về timer focus 100 ms của `main`;
  - bỏ kiểm "ô đang sửa";
  - bỏ dependency `signupEnabled`;
  - bỏ khoá cuộn;
  - nút Google bỏ qua `googleEnabled` (hai ca "hides Google" bắt được; với cách chờ cũ hai ca này vẫn đạt);
  - Google callback bỏ quay về đích (M5 lượt đầu lọt);
  - `Workspace` không truyền `networkError` (M6 lượt đầu lọt);
  - câu tab khác trở về câu cũ.

Lỗi focus hộp đăng nhập (`ca2cffb`) nằm ngoài phạm vi task card nhưng có sẵn trên `main` từ FE-08 và chặn gate browser của chính PR. Bản sửa có test RED/GREEN, nên reviewer chấp nhận gộp.

P3 còn mở, ghi ở CURRENT-STATE mục 5: effect focus chạy lại khi `signupEnabled` đổi. D1/D2 tuỳ chọn chưa làm.

## Merge

- CI [38082549178](https://github.com/VinhDat267/ATI_Project/actions/runs/38082549178) SUCCESS đúng `daa023c`: 1.674 v3 + 173 eval, browser 101 pass, 1 skip, 11 nhóm.
- Lệnh `gh pr merge 129 --merge --delete-branch --match-head-commit daa023c0e7d60c76b550713e4b99b11566ad537d`, lúc 08:30:55. Merge commit `828c21a`; `git diff --quiet daa023c 828c21a` đạt (cây merge bằng cây head).

## CI `main`

- Sau #130 (`84a3461`, chỉ tài liệu, [run 38066634198](https://github.com/VinhDat267/ATI_Project/actions/runs/38066634198)): đỏ. Nhóm default có 81 pass, 1 skip, 1 fail ở `FE-08: pending and disabled email accounts show safe real account states`: không thấy tiêu đề "Tài khoản đang chờ duyệt" sau bước đăng nhập. Dấu hiệu này khớp lỗi focus mà #129 sửa, nhưng chưa chứng minh cho ca này.
- Sau #129 (`828c21a`, [run 38102094048](https://github.com/VinhDat267/ATI_Project/actions/runs/38102094048)): SUCCESS, browser 101 pass, 1 skip, 11 nhóm.
