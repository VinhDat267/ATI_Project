# 14/10/2026 · Merge #140 (GMAIL-01)

**Người viết:** reviewer · **Nhánh:** `docs/record-140` · Chỉ tài liệu.

## Merge

- [#140](https://github.com/VinhDat267/ATI_Project/pull/140), head `2268d9f339710f616b17ec3fccb9a3466891a3a3`, merge `8973a9e`, 14/10 lúc 19:24:46 Việt Nam.
- Merge theo lệnh "merge #140" của nhóm trưởng, khoá theo head (`--match-head-commit`).
- [CI #140](https://github.com/VinhDat267/ATI_Project/actions/runs/38523128374) SUCCESS đúng head, gồm check và browser.
- Nhánh chứa `main` `b9ceaee`, nên cây `8973a9e` bằng cây `2268d9f` (kiểm bằng `git rev-parse`).

## Review trước merge

- **Review độc lập lần 1** ([bình luận](https://github.com/VinhDat267/ATI_Project/pull/140#issuecomment-6161726666), code `cda8335`) kết luận **chưa đạt**, 3 P2:
  1. callback OAuth cũ ghi đè kết nối mới;
  2. đăng xuất đã commit mà callback vẫn lưu kết nối;
  3. lỗi đọc DB sau khi duyệt làm kế hoạch kẹt ở `approved`, cả khi Gmail tắt.
- **Lỗi 1 và 2** sửa ở `c420cfd`. Reviewer độc lập chạy lại hai file test 38/38 và kết luận **Đạt** trong phạm vi hai lỗi này. Bên sửa ghi:
  - check 1.811 v3 + 173 eval;
  - browser 101 pass/1 skip;
  - 22/22 đột biến bị bắt.

  Xem [log sửa](2026-10-14-codex-GMAIL-01-review-fixes.md).
- **Lỗi 3** sửa ở `7849f43`. Reviewer chạy kiểm bổ sung ngày 14/10 ([bình luận](https://github.com/VinhDat267/ATI_Project/pull/140#issuecomment-6168248566)), trên worktree `2268d9f`, PostgreSQL 16 tmpfs riêng ở 55533, hai cờ tắt:
  - test `never leaves an approved plan stuck…` trên mã trước sửa: **1 fail** (`expected 'approved' to be 'pending'`), exit 1;
  - trên mã hiện tại: **1 pass**, exit 0;
  - 6 file test liên quan tới thực thi: **76/76**, exit 0;
  - file đã khôi phục đúng SHA256.

  Bản sửa được commit trong worktree thi công GMAIL-01, nên kiểm này là của bên thi công, chưa có reviewer độc lập xem lỗi 3. Nhóm trưởng cho merge khi đã biết điều này.

## Cập nhật bàn giao

- `CURRENT-STATE.md`:
  - đầu file;
  - mục 2: thêm `GMAIL_TOOLS` ngoài catalog, migration 0009;
  - mục 3: số liệu sau #140, bảng test 1.811 v3;
  - mục 4: #140, #139;
  - mục 5: dòng giới hạn GMAIL-01;
  - mục 6: biến `GMAIL_*` và cách bật Gmail.
- `ROADMAP.md`: GMAIL-01 xong; GMAIL-02 bắt đầu được; ghi chú GMAIL-03; đoạn "Cập nhật 14/10 (GMAIL-01)".
- Task card GMAIL-01: trạng thái xong.

## Đã dọn

- Worktree `ATI_Project-wt-gmail-01` và nhánh local đã xoá; nhánh trên GitHub tự xoá khi merge. PostgreSQL tạm đã xoá.
- Giữ nguyên: worktree review `ATI_Project-review-pr140` của reviewer độc lập, worktree `ATI_Project-wt-gmail-02` (chưa có code), hai worktree Codex trong `orca`.

## Chưa kiểm

- CI `main` sau #140 (`8973a9e`) đang chạy khi viết log này.
- Không chạy lại `npm run check` hay browser ở máy cho cập nhật bàn giao. Không gọi Google hay model.
