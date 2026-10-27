# 27/10/2026 · Merge #171 (SCHED-03)

**Người viết:** reviewer. **Nhóm trưởng yêu cầu ngày 27/10:**
- "hãy review #171";
- "xử lý conflict giúp tôi";
- "merge #171".

**Nhánh bàn giao:** `docs/record-171`, tách từ `origin/main` `f4ff636`. Chỉ tài liệu.

## Review lại phần sửa

Head `91642f4`; review lần 1 ở `490c6ae` có 3 P3. Long sửa ở `a661344`, ghi log ở `91642f4`.
- Diff `490c6ae..91642f4` khớp đúng 3 P3:
  - `schedule_updated` qua SSE nay có nội dung `scheduleLabel(...)`;
  - lần tải lại sau 409 dùng `normalizeConversationMessages`, giống lần tải đầu;
  - `ConversationDrawer` có test trực tiếp, ở cả cờ bật lẫn cờ tắt.
- Đột biến: 13 đột biến gốc của review lần 1 chạy lại trên head mới, **12/13 bị bắt**.
  - R4 trước lọt, nay bị bắt.
  - R11 vẫn lọt. Đây là đột biến tương đương: nút đã `disabled` khi đang gửi. R11b bỏ cả khoá lẫn `disabled` thì bị bắt.
  - Sau đó `git status` sạch.
- Một lượt kiểm lại khác, [bình luận 6429778251](https://github.com/VinhDat267/ATI_Project/pull/171#issuecomment-6429778251), cũng kết luận Đạt: 6/6 đột biến của phần sửa, web 816/816, browser `schedule` 24/24. Lượt đó chưa kiểm bản gộp với `main`.

## Gộp `main`

Nhánh tách từ `c760aa3`, nên xung đột với #172 ở hai file.

**Gộp thử ở máy reviewer** (nhánh tạm, không push):
- `Cockpit.tsx`:
  - giữ cả `schedulesEnabled` và `gmailEnabled`, trong một lần gọi `getRuntime()`;
  - giữ nhánh `ScheduleMoment` của #171;
  - `RefusalMoment` giữ đủ props OAUTH-01.
- `scripts/test-v3-browser.mjs`: giữ grep `GMAIL-03:|OAUTH-01 from chat:` của nhóm `gmail`, thêm nhóm `schedule`.
- Màn lịch chạy dùng trang `app-stage` và ô soạn tin `bottom`, nên quy tắc `scroll-padding-bottom` của #172 cũng áp cho màn này.

**Kiểm bản gộp thử** (PostgreSQL 16 tmpfs riêng ở 56533, dựng lại sạch trước mỗi lượt; sandbox; không dùng `.env` hay DB dev):
- `npm run check` exit 0: 63 + 408 + 359 + 42 + 554 + 835 = **2.261 v3** + **394 eval**.
- `npm run test:browser:v3` lượt 1 exit 1 ở nhóm `auth04`: ca `AUTH-04: Google signup waits for approval…` không thấy `status` "chờ quản trị viên duyệt" sau 10 s. Ca này ngoài diff, đã có trong danh sách ca chập chờn ở CURRENT-STATE mục 5. Các nhóm trước đó: default 94 pass/1 skip, auth02 2.
- Chạy lại từ nhóm `auth04` trên DB mới, runner giữ nguyên: exit 0; auth04 6, clarification 3, partial_failure 2, sáu nhóm service × 1, answer 4, gmail 10, schedule 22.
- Gộp hai lượt: **149 pass/1 skip, 14 nhóm**.

Kết luận đăng ở [bình luận 6430075593](https://github.com/VinhDat267/ATI_Project/pull/171#issuecomment-6430075593).

**Gộp thật**, theo yêu cầu nhóm trưởng:
- reviewer gộp `origin/main` (`2888a9f`) vào `codex/feat-sched-03-ui` ở `ec2df5a`. Đây là merge, cha là `91642f4` và `2888a9f`; không rebase, không force push;
- `git diff --quiet` cho thấy cây `ec2df5a` bằng cây bản gộp thử;
- [bình luận 6435578754](https://github.com/VinhDat267/ATI_Project/pull/171#issuecomment-6435578754) báo cho Long.

## Merge

- [#171](https://github.com/VinhDat267/ATI_Project/pull/171): merge commit `f4ff636`, lúc 06:51:36Z (13:51:36 Việt Nam). Lệnh merge khoá theo SHA head `ec2df5ac0145b27d1a0f1dede320d1ba5f4160fc`.
- **Trước merge:** [CI #171](https://github.com/VinhDat267/ATI_Project/actions/runs/40462770139) SUCCESS đúng head `ec2df5a`; PR `CLEAN`.
- **Cây merge** `f4ff636` bằng cây head `ec2df5a`.
- **Sau merge:** [CI `main`](https://github.com/VinhDat267/ATI_Project/actions/runs/40463609040) SUCCESS đúng `f4ff636`.

## Dọn sau merge

- Bằng chứng review ở `ATI_Project-review-pr171/.codex/review-171` (33 file) và 2 ảnh của lượt review lần 1 được chép vào `ATI_Project/.codex/worktree-archive/2026-10-27-review-pr171`. SHA-256 khớp từng file.
- Gỡ junction trong `node_modules`, gỡ worktree, xoá nhánh local `codex/feat-sched-03-ui` và `review-pr171`. DB tạm `ati-review171-pg` đã xoá; DB dev không bị đụng tới.
- Có worktree `ATI_Project-oauth02`, nhánh `feat/oauth-02-personal-calendar`, không do reviewer tạo; để nguyên.

## Còn mở

- SCHED-04: bộ đo, đo, nghiệm thu thật, PR bật cờ.
- Màn phục hồi chỉ tra trong 50 lượt mà API trả về (giới hạn ghi ở task card).
