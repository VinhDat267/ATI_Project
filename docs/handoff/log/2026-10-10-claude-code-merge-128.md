# Merge #128 (FE-10) và review #129 (FE-11)

- Ngày: 10/10/2026, Asia/Saigon. Agent: Claude Code, reviewer độc lập.
- Người dùng: "merge #128".

## #128 FE-10

- `longnguyen005` thi công bằng Codex. Review lần 1 trên `be39fda`: "Đạt sau khi sửa nhỏ", 2 P2 (nút sáng/tối của `/privacy` nằm cuối trang; tiêu chí "Rà soát cuối" chưa làm mà không ghi). Commit `88f12af` sửa P2 thứ nhất có test, và ghi rõ P2 thứ hai là chưa làm.
- Review lần 2 trên `88f12af`: **Đạt**. Ở máy: frontend 649/649, typecheck exit 0; đột biến đưa nút về cuối trang bị test mới bắt; toạ độ nút trùng bản mẫu React ở 1440 và 375, sáng và tối.
- CI [38062515365](https://github.com/VinhDat267/ATI_Project/actions/runs/38062515365) SUCCESS đúng `88f12af`: 1.641 v3 + 173 eval, browser 100 pass, 1 skip, 11 nhóm.
- Merge `gh pr merge 128 --merge --delete-branch --match-head-commit 88f12af…` lúc 22:45:42, merge commit `e08e623`. Nhánh tách từ `c99b7ba`; cây merge chỉ khác head ở 4 file tài liệu FE-11 của #127.
- Ba việc chờ người dùng quyết, ghi ở CURRENT-STATE mục 5: phần chụp lại FE-05b → FE-09; màu logo Jira ở chế độ tối; chữ dưới 3:1.

## #129 FE-11 (chưa merge)

Review trên `7489380`: **Chưa đạt, sửa nhỏ**. Xem [bình luận](https://github.com/VinhDat267/ATI_Project/pull/129#issuecomment-6099178321).

- `npm run check` ở máy exit 0, 1.658 v3 + 173 eval. Browser: nhóm default 79 pass, 1 skip, 1 fail (ca FE-11 mới); 10 nhóm còn lại chạy riêng 18/18. 14/17 đột biến bị bắt.
- P2-1: ca browser FE-11 fail 6/10 lần ở máy do hai lỗi của test:
  - fixture tạo hai tin cùng `created_at`, thứ tự trả về ngẫu nhiên vì `ORDER BY created_at DESC, id DESC` với `id` UUID; đổi sang hai mốc thời gian thì 0/10;
  - trang cũ phát hiện thu hồi phiên trước `page.reload()` nên mất câu thông báo; đây là lần fail trên CI.
- P2-2: bản sửa C7 chờ server nhận request chứ không chờ giao diện nhận phản hồi; với độ trễ 200 ms, test của PR fail 3/41, test cũ trên base đạt 41/41. Ví dụ "hides Google…" trong task card FE-11 do reviewer viết cũng mắc lỗi này.
- Lúc điều tra, reviewer từng nghi có lỗi màn trống sau đăng nhập lại có sẵn trên `main`; kiểm tiếp cho thấy đó chỉ do fixture `created_at` trùng, không phải lỗi sản phẩm.
- #128 và #129 cùng sửa một dòng trong `auth-google.test.tsx` và dòng `grep` của `scripts/test-v3-browser.mjs`; #129 cần gộp `main` và giải xung đột (giữ cả `FE-10:` và `FE-11:`, lấy bản test Google của #129 sau khi sửa P2-2).

## CI main

- Sau #127 (`d319a32`, chỉ tài liệu): đỏ, 2 ca browser chập chờn (`AUTH-01: logout-all …`, `… Continue safe pending after reload`), ghi vào CURRENT-STATE mục 5.
