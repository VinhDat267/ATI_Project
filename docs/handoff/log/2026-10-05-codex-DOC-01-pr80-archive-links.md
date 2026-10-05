# 05/10/2026 · Codex · DOC-01: sửa link lưu trữ sau review #80

- **Yêu cầu:** người dùng yêu cầu sửa finding P3 của review độc lập #80: năm link hỏng trong `docs/screens.html` và `docs/wireframes.html`.
- **Phạm vi:** task card `DOC-01-pr80-archive-links.md`; worktree riêng từ `main` `0ecaa18`, nhánh `vinhdat/fix-pr80-archive-links`. Không sửa file riêng chưa commit của người dùng, `CURRENT-STATE.md` hoặc `ROADMAP.md`.
- **Commit sửa:** `1d7473ad6e2509c936746a819bc7a9306a6f10d8`.
- **Thay đổi:** hai dòng HTML; năm href trỏ sang GitHub blob tại tag `archive/v2-final`, nhãn bổ sung "lưu trữ". Link local tới tài liệu còn tồn tại giữ nguyên.
- **Bằng chứng:**
  - kiểm trước sửa: `files=2`, `localLinks=9`, `archiveLinks=0`, năm đích local thiếu; exit 1;
  - kiểm sau sửa: `files=2`, `localLinks=4`, `archiveLinks=5`, `missing=[]`, `wrongArchiveCounts=[]`; exit 0;
  - GitHub Contents API trả cả ba file BASELINE/API/EXECUTION-CONTRACT tại `ref=archive/v2-final`, exit 0; href đã sửa bằng `html_url` trả về;
  - tag trên origin peel về `badccb3a47f2240c8b1356885c03c6abe25ad43d`;
  - `git diff --check` exit 0.
- **Giới hạn:** chỉ sửa liên kết tài liệu; không thêm test tự động, không chạy lại test ứng dụng local và không gọi model/service workflow. CI và reviewer độc lập xác nhận trên PR trước merge. Chưa merge.
