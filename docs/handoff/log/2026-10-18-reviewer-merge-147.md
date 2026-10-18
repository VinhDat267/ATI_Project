# 18/10/2026 · Merge #147 (GMAIL-03)

**Người viết:** reviewer · Nhóm trưởng yêu cầu "merge #147".

## Merge

| PR | Task | Head đã review | Merge | Review |
|---|---|---|---|---|
| [#147](https://github.com/VinhDat267/ATI_Project/pull/147) | GMAIL-03 | `5f3bb2f` | `6233637` (07:09:55 Việt Nam) | lần 1 tại `a2d622e` ([16/10](https://github.com/VinhDat267/ATI_Project/pull/147#issuecomment-6219495855), [17/10](https://github.com/VinhDat267/ATI_Project/pull/147#issuecomment-6231045632)): 1 P2, 3 P3 → reviewer sửa `9c46f89` → [review lại](https://github.com/VinhDat267/ATI_Project/pull/147#issuecomment-6237634859): 1 P3 → sửa `5f3bb2f` → [review lại lần 2](https://github.com/VinhDat267/ATI_Project/pull/147#issuecomment-6243532699) **Đạt** |

- `longnguyen005` thi công. Long đang bận, nên nhóm trưởng giao reviewer sửa theo review lần 1 và review lại. Mỗi phần sửa có reviewer độc lập khác xem lại.
- Review lần 1 có hai bản: bản 16/10 ghi "Chưa đạt", bản 17/10 ghi "Đạt sau khi sửa nhỏ". Cả hai cùng một P2 và cùng các P3.
- Merge bằng `gh pr merge 147 --merge --match-head-commit 5f3bb2f5395a99f84948cb4d5c855bc0ba7626ca`. Ngay trước khi merge, PR ở trạng thái `MERGEABLE`/`CLEAN`; `git merge-tree --write-tree` trên `main` `2036396` không báo xung đột.
- [CI #147](https://github.com/VinhDat267/ATI_Project/actions/runs/39055601267) SUCCESS đúng head `5f3bb2f`, gồm `npm run check` và `npm run test:browser:v3`.

## Kiểm cây merge

- Cha của `6233637`: `2036396` (`main` sau #152) và `5f3bb2f` (head đã review).
- `git diff 5f3bb2f 6233637` đổi đúng 6 file tài liệu bàn giao của #152, +90/−13. So từng dòng, diff này bằng diff riêng của #152 (`git diff 2036396^1 2036396`). Mã của #147 vào `main` đúng như head đã review.

## CI `main` sau merge

[Run 39081747075](https://github.com/VinhDat267/ATI_Project/actions/runs/39081747075) **SUCCESS** đúng `6233637`:
- `npm run check`: 63 + 408 + 291 + 42 + 465 + 745 = **2.014 v3**, **275 eval**;
- `npm run test:browser:v3`: **115 pass/1 skip, 13 nhóm** (default 88, gmail 4).

## Số liệu trên head `5f3bb2f`

- **2.014 v3** (63 + 408 + 291 + 42 + 465 + 745) **+ 275 eval**. So với `ce59f4f`, GMAIL-03 thêm 1 test API (kịch bản sandbox) và 60 test web (42 của bên thi công, 18 của phần sửa review).
- Browser **115 pass/1 skip có chủ đích, 13 nhóm**: default 88 (thêm ca `GMAIL-03 off`), gmail 4 (1440/375 sáng/tối).
- Không chạy lại suite ở máy cho lượt bàn giao này. Số ở máy của từng lượt review và sửa ghi trong CURRENT-STATE mục 3.

## Còn mở

- GMAIL-04 (nhóm trưởng): bộ đo Gmail và kiểu "trả lời", nghiệm thu Google thật, PR bật hai cờ. Mọi kiểm thử của GMAIL-03 dùng OAuth và Gmail giả.
- Đột biến G13–G15 của review lần 1 vẫn lọt test; mã hiện tại đúng.
- Test GMAIL-01 chập chờn: nay đã gặp 9 lần (CURRENT-STATE mục 5).
- Ca browser chập chờn: FE-07 ở bước đăng nhập (18/10) và FE-07 thành viên kiểm Notion (16/10) (CURRENT-STATE mục 5).
- Worktree `ATI_Project-wt-gmail-03` vẫn còn ở máy nhóm trưởng; nhánh `codex/feat-gmail-03-ui` trên GitHub đã tự xoá khi merge.
