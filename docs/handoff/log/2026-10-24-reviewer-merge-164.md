# 24/10/2026 · Merge #164 (W4-01: đo bộ câu của thành viên)

**Người viết:** reviewer · Nhóm trưởng yêu cầu "merge #164" lúc 23:01, ngày 24/10.

## Merge

| PR | Việc | Head đã review | Merge | Review |
|---|---|---|---|---|
| [#164](https://github.com/VinhDat267/ATI_Project/pull/164) | W4-01: commit đăng ký 32 câu, sửa quy tắc dừng của bộ chạy, báo cáo và sáu thư mục report | `1e3db0b` | `1df2d35` (23:01:28 Việt Nam) | [lần 1](https://github.com/VinhDat267/ATI_Project/pull/164#pullrequestreview-5638836127) tại `15ac249`: 1 P2 (câu không gọi model làm mất chuỗi quá hạn) → sửa `1e3db0b` → [review lại](https://github.com/VinhDat267/ATI_Project/pull/164#pullrequestreview-5638872371) **Đạt** |

- **Merge sớm hơn hẹn.** PR ghi "không merge trước 26/10", và quy tắc chung là không merge trong 23–25/10 (buổi thử W4-03). Nhóm trưởng vẫn yêu cầu merge ngày 24/10. PR chỉ đổi `evaluations/` và tài liệu, không đổi mã sản phẩm. Thư mục chính trên máy nhóm trưởng chưa fast-forward, nên app dùng cho buổi thử không đổi.
- **Lệnh:** `gh pr merge 164 --merge --match-head-commit 1e3db0be1d9e0ed7b10e7a737b97cbf7b22eede3`. Ngay trước khi merge, PR ở trạng thái `MERGEABLE`, check `v3` SUCCESS.
- **[CI đúng head](https://github.com/VinhDat267/ATI_Project/actions/runs/40108857431):** SUCCESS trên `1e3db0b`.
  - `npm run check`: 63 + 408 + 291 + 42 + 465 + 773 = **2.042 v3**, **394 eval**;
  - browser: **120 pass/1 skip**.
- Mô tả PR không có dòng "Generated with…".

## Kiểm cây merge

- `1df2d35` có cha là `a020a55` và `1e3db0b`. Cây merge bằng cây head (`481968ee…`).
- `packages/` và `prompts/` không đổi. Catalog ở mốc chốt 20/10 vẫn là 33 tool/8 dịch vụ.

## CI `main` sau merge

[Run 40109633906](https://github.com/VinhDat267/ATI_Project/actions/runs/40109633906) **SUCCESS** đúng `1df2d35`:
- `npm run check`: 63 + 408 + 291 + 42 + 465 + 773 = **2.042 v3**, **394 eval**;
- browser: **120 pass/1 skip** (default 93).

Không chạy lại suite ở máy cho lượt bàn giao này.

## Dọn

- **Worktree đo `ATI_Project-wt-w401`:**
  - trước khi xoá, `git status --ignored` chỉ có `node_modules/`; mọi commit đều nằm trong `origin/main`;
  - đã xoá bằng `git worktree remove`, cùng nhánh local `test/w4-01-independent-cases`; nhánh trên GitHub tự xoá khi merge;
  - còn sót 6 junction trong `node_modules/@wap`, đều trỏ vào chính worktree đã xoá. Đã gỡ từng junction bằng `rmdir`, rồi xoá thư mục rỗng.
- **Giữ nguyên ở thư mục chính:** bốn file `member-*.json` và `cases.json` đã sửa. `cases.json` có nội dung bằng bản đã commit (SHA-256 `c4425f51…`); khi fast-forward thư mục chính lên `main`, cần xử lý file này trước.
- Worktree `review-pr164` của reviewer độc lập giữ nguyên.

## Còn mở

- **W4-01:** nhóm trưởng xác nhận tiêu chí "GUIDE.md đủ cho người chưa đọc code"; chưa có đối chứng bộ 50 câu cùng ngày.
- **Đề xuất backlog, chờ nhóm trưởng** (CURRENT-STATE mục 5): task độ trễ (model suy nghĩ quá 30 s), định tuyến `m4-07`, bước tra tên của `regex`.
- **W4-03:** buổi thử tới 25/10, rồi chạy `report.ts`.
- **GMAIL-04:** nghiệm thu Google thật (phần 1–3), PR bật cờ trước 28/10.
