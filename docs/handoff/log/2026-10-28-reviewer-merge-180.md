# 28/10/2026 · reviewer · Merge #180 — mã OAUTH-03

## Đã merge

- Người dùng yêu cầu `merge` sau khi được thông báo phần mã đã đủ bằng chứng, còn đo/nghiệm thu thật.
- [PR #180](https://github.com/VinhDat267/ATI_Project/pull/180), merge lúc `2026-10-28T08:44:35Z` (15:44:35 Asia/Saigon).
- Head: `58d4570abb4fdab10700efe7b1a3544f3bd286a5`; base: `155e99de84c9f338dfa17916e2e203c8fb8dead3`.
- Merge commit: `3948007645687d0c209794ce54b82140cbb560d1`, đúng hai parent trên.
- Cây head, cây merge thử và cây merge thật đều là `752025a3d093c622de0c877bc9df600360cc0de4`; `git diff --exit-code 58d4570 3948007` exit **0**. Không có mã chưa kiểm đi vào merge.

## Bằng chứng và review

- [CI #40655033663](https://github.com/VinhDat267/ATI_Project/actions/runs/40655033663): **SUCCESS đúng head**, cả `npm run check` và toàn bộ `npm run test:browser:v3` exit **0**.
- Check đã chạy: **2.509 test v3, 406 eval, 11 launcher/env**, typecheck/build/quét build đạt. **13/13 đột biến gốc + 4/4 hồi quy mới** bị bắt; mã khôi phục đúng SHA-256.
- Chuỗi review đã sửa wiring live, chọn bảng, tham chiếu theo query/limit/index và tên hiện tại; hai P2 cuối sửa ở `58d4570`: lookup runtime lỗi không được quay về tên Picker cũ, lookup phải nhận signal/deadline. Delta cuối được một reviewer độc lập kiểm, không có finding P1/P2/P3 cần sửa.
- [Kết luận tích hợp](https://github.com/VinhDat267/ATI_Project/pull/180#issuecomment-6464579781): **Đạt cho phần mã Bước 1** theo yêu cầu merge. Đây không phải nghiệm thu Google/model thật hay hoàn tất toàn bộ feature.
- Browser local của lượt sửa có **92 pass / 4 fail / 1 skip** ở lượt tổng; đúng bốn ca lỗi pass lại **4/4**, 15 nhóm còn lại **71 pass**. Không gọi lượt local tổng đó là xanh. CI toàn bộ browser xanh là bằng chứng riêng.
- Lượt merge này đối chiếu lại CI và cây Git; không chạy lại bộ runtime test local trên cùng cây không đổi. Log sửa: [review vòng 4](2026-10-28-OAUTH-03-review-r4-fixes.md).

## Bàn giao sau merge

- Cập nhật CURRENT-STATE, ROADMAP và task card OAUTH-03: **mã đã merge; chờ đo và nghiệm thu**. Chỉ đánh dấu hai tiêu chí tự động có bằng chứng; giữ mở tiêu chí đo/model và P-LIVE.
- `MYSHEETS_ENABLED` vẫn mặc định **off**. Không thay đổi cấu hình live, prompt, label hay số liệu model.
- Chưa kiểm chứng cấu hình Google Cloud thật. Bộ 9 câu `cases-mysheets.json`, `EVAL_SET=mysheets` ×3, báo cáo, P-LIVE và PR bật cờ: **NOT_RUN**.
- Sau merge code: commit/push label trước lời gọi model đầu tiên; đo đạt ít nhất **23/27**, chống tiêm lệnh **6/6**, **0/6** lượt bảng chung ghi vào bảng riêng. Nhóm trưởng thực hiện Picker thật, đọc/ghi và đọc lại, bảng riêng → Slack, kiểm chặn bảng ngoài allowlist và thu hồi token không ảnh hưởng Gmail/Calendar riêng.
- Chỉ bật cờ khi đo và P-LIVE cùng đạt, trước **04/11**; quyết định đưa vào phạm vi bảo vệ vẫn là **29/10**. Có thể chuyển task thi công khác khi phần đo/nghiệm thu được bàn giao rõ; không đánh dấu toàn bộ OAUTH-03 hoàn tất.
- Làm trong worktree riêng. Checkout `main` đang có thay đổi của người dùng được giữ nguyên; không stash/reset/pull lên các file đó. Không xóa worktree hay nhánh cục bộ của phiên khác.
