# 05/10/2026 · Claude Code · Merge kế hoạch #77 và đồng bộ CURRENT-STATE

- **Phạm vi:** người dùng yêu cầu merge #77 (task card W3-10, W3-11, W4-00 và cập nhật ROADMAP). Trước đó đọc quy tắc phiên mới trong `docs/handoff/PROMPTS.md` (#78, `2fb15df`); thêm dòng "tự review, nên có review độc lập" vào mô tả #77 theo quy tắc này.
- **Gate:**
  - PR OPEN, non-draft, MERGEABLE/CLEAN; head `fdf073edba02e61774f2427130124bc44ccf60fd`;
  - CI [37248029172](https://github.com/VinhDat267/ATI_Project/actions/runs/37248029172) `v3` SUCCESS, `headSha` của run đúng head;
  - worktree `.claude/worktrees/w4-risk-task-cards` sạch, HEAD bằng remote; đã xoá trước khi merge.
- **Merge:** `gh pr merge 77 --merge --delete-branch --match-head-commit fdf073edba02e61774f2427130124bc44ccf60fd` thành công.
  - Readback MERGED, merge `badccb3a47f2240c8b1356885c03c6abe25ad43d`, 05/10 lúc 07:38:41 Việt Nam.
  - `git fetch --prune` và `git merge --ff-only origin/main` trên thư mục chính.
  - Năm file tài liệu của #77 trên `origin/main` bằng head (`git diff --exit-code` đạt).
  - Nhánh local và remote `vinhdat/docs-week4-risk-tasks` đã xoá.
  - Năm file riêng chưa commit của người dùng giữ nguyên.
- **Giới hạn:** #77 tự review, chưa có review độc lập. Hai commit của #77 viết tiếng Anh vì được tạo trước khi quy tắc #78 (commit viết tiếng Việt) merge; không viết lại lịch sử.
- **Đồng bộ (PR này):** CURRENT-STATE gồm:
  - dòng cập nhật;
  - tiến độ mảng service;
  - mục 4 thêm #77/#78;
  - mục 5 trỏ hai lỗi đã biết sang W3-10;
  - mục 6 đổi đường dự phòng từ Gemini API chính thức sang `cx/` trong 9router;
  - mục 7 thêm quyết định ngày 05/10.

  ROADMAP không cần sửa thêm (#77 đã thêm ba dòng `chờ`). Không đổi mã nguồn, không gọi model hay service thật.
- **Tiếp theo:**
  - giao W4-01 (khung), W4-03 (script/protocol), W4-04 (công cụ) song song;
  - các task gọi model qua 9router chạy lần lượt: W4-00 → W3-10 → phần chạy model của W4-02;
  - W3-11 cần người dùng ngồi cùng.
