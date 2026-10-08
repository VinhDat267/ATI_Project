# FE-06A — sửa sau review độc lập

08/10/2026 · Claude Code · PR [#107](https://github.com/VinhDat267/ATI_Project/pull/107) · **chưa merge**.

Người dùng giao cho Claude Code tự sửa các lỗi đã nêu trong [bình luận review](https://github.com/VinhDat267/ATI_Project/pull/107#issuecomment-6058605141) trên head `c8c5fc0`. Reviewer tự sửa nên phần sửa này **chưa có review độc lập**. Thi công trong worktree riêng của reviewer; worktree của Codex (`fe-06-cockpit-recovery-a`) không bị sửa, nên sẽ chậm hơn nhánh trên GitHub một commit.

## Đã sửa

**P2 thứ nhất: "Sửa rồi thử lại" gửi tin kỹ thuật dưới tên người dùng.**
- Thêm `pages/Cockpit/recovery-request.ts`. Hàm này dựng câu tiếng Việt theo số thứ tự việc và nhãn trường trong schema, ví dụ:
  - dòng đầu: "Làm lại việc 2 (Gán Minh vào thẻ) của kế hoạch đã dừng, với nội dung đã sửa:";
  - mỗi trường: "- ID của thành viên Trello cần gán: corrected-member";
  - các việc chưa làm, kèm tham số đã lưu;
  - dòng cuối: "Không làm lại các việc đã xong."
- Tham chiếu chưa có kết quả hiện là "(kết quả của việc N)". Câu không còn mã bước, `$ref`, `$template` hay JSON.
- `Workspace.tsx` gọi hàm này. Cách làm giữ nguyên: chỉ gửi sau khi kế hoạch cũ đã `stopped`, và kế hoạch mới phải được duyệt lại.
- Ô "Yêu cầu / Prompt" đổi thành "Ghi chú thêm (không bắt buộc)", để trống mặc định, nên không còn mâu thuẫn với tham số đã sửa.
- `ConversationDrawer.tsx`: nội dung tin xuống dòng (`[overflow-wrap:anywhere]`), không tràn ngang.

**P2 thứ hai: test link của bước bị bỏ qua không kiểm gì.** Test giờ tìm theo nhãn thật "Xem tin" và kiểm thẻ của bước bị bỏ qua không có link nào.

**P3:**
- Ca browser đổi tên thành `FE-06A: …`; thêm `FE-06A:` vào bộ lọc `default` của `scripts/test-v3-browser.mjs`.
- Thêm test cho chốt "chỉ thử lại/bỏ qua đúng bước đang dừng" của hook.
- Thêm test cho `recoveryDestination`: chỉ nhận `https`, không có thông tin đăng nhập.
- Màn kết thúc: dòng "Quy trình đã dừng." chuyển sang `sr-only`; vẫn đọc cho trình đọc màn hình, không lặp với tiêu đề.

## TDD và lệnh thật

PostgreSQL 16 tmpfs riêng ở cổng 55538, API 3018, web 5198, sandbox, tài khoản theo `v3-check.yml`.

| Lần | Lệnh / kiểm tra | Kết quả | Exit |
|---|---|---|---|
| RED unit | 5 file test FE-06A | 5 fail / 64: chưa có `recovery-request`; tin còn `Sửa việc step_2…`; ô ghi chú chưa có hoặc chưa trống; dòng trạng thái chưa `sr-only` | 1 |
| GREEN unit | cùng lệnh | 67/67 | 0 |
| RED browser | ca `FE-06A:` khi tạm bỏ `[overflow-wrap:anywhere]` | log hội thoại rộng 1634 px > 419 px | 1 |
| GREEN browser | ca `FE-06A:` | 4/4 | 0 |
| Đột biến | 5 phép trên 5 file test | 5/5 bị bắt: bỏ chốt bước đang dừng; cho qua `http` và link có thông tin đăng nhập; output của bước bị bỏ qua thành link; ô ghi chú lấy mô tả bước làm mặc định; tham chiếu giữ mã bước | – |
| `npm run check` | toàn repo | 47 + 340 + 196 + 25 + 349 + 517 = **1.474 v3**, cộng **165 eval** | 0 |
| `npm run test:browser:v3` lần 1 | toàn bộ | 51/52 ở nhóm default: ca `FE-06A … 375 light` không thấy `#moment-8` sau 10 giây; không có ảnh lúc lỗi | 1 |
| Ca `FE-06A:` lặp 3 lần | `--repeat-each 3` | 12/12 | 0 |
| `npm run test:browser:v3` lần 2 | toàn bộ | **69/69 qua 11 nhóm** | 0 |

Lỗi ở lần chạy browser đầu chưa rõ nguyên nhân. Lỗi xảy ra ở bước `page.goto` sang hội thoại thứ hai, trước phần kiểm ngăn hội thoại mới thêm; chạy riêng và chạy lại bộ đầy đủ đều đạt. Nên ghi vào danh sách test chập chờn và theo dõi.

## Chưa làm

- Không chạy model thật. Ở sandbox, planner mẫu trả câu hỏi lại, không lập kế hoạch theo tin sửa. Chưa đo planner thật có hiểu câu sửa mới hay không.
- Không chụp lại 32 ảnh đối chiếu. Phần sửa không đổi bố cục khoảnh khắc 7–9, trừ dòng trạng thái của màn kết thúc đã ẩn khỏi giao diện.
