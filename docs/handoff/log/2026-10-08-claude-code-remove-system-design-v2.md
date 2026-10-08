# 2026-10-08 · Claude Code · Xoá thư mục `System Design` thời v2

- **Đã làm:**
  - Người dùng thấy thư mục `System Design/` vẫn còn ở gốc repo sau khi dọn nhánh. Thư mục có 4 file (`DESIGN.md`, `theme.css`, `tokens.json`, `variables.css`): design system "Chat UI" kiểu Apple Gallery, font Space Grotesk, commit `42d991b` ngày 29/09 (thời v2), trước đó `eefe56c` ngày 21/09.
  - Thiết kế hiện hành là Agentic theo 12 bản mẫu: `DESIGN.md` ở gốc repo (#99) và `docs/design/design-system.md` (#97). Thư mục cũ mâu thuẫn với hai file này; agent khác có thể đọc nhầm.
  - `git grep` không thấy file nào trong repo (ngoài chính thư mục) nhắc tới `System Design`. Bản lưu có trong tag `archive/v2-final` (`git ls-tree archive/v2-final "System Design/"` liệt kê đủ 4 file), đọc lại bằng `git show archive/v2-final:"System Design/DESIGN.md"`.
  - PR này xoá 4 file bằng `git rm -r`; không đụng file nào khác.
- **PR / commit:** nhánh `chore/remove-system-design-v2`, worktree riêng từ `main` `c7cf6e3`.
- **Kiểm tra đã chạy (lệnh và kết quả):** `git grep -n -I "System Design" -- . ':!System Design'` rỗng; `git ls-tree --name-only archive/v2-final "System Design/"` ra 4 file. Không chạy suite ứng dụng: không file mã nào dùng thư mục này.
- **Chưa làm / vấn đề phát hiện:** không.
- **Việc tiếp theo đề xuất:** merge khi người dùng đồng ý; CURRENT-STATE sẽ ghi ở lần cập nhật sau merge.
