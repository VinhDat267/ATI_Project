# 27/10/2026 · Merge #176 (OAUTH-02, phần mã)

**Người viết:** reviewer. **Nhóm trưởng yêu cầu ngày 27/10:**
- "review độc lập #176";
- "xử lý" (xung đột với `main`);
- "xử lý nốt #176" (sửa 3 P3);
- "merge #176".

**Nhánh bàn giao:** `docs/record-176`, tách từ `origin/main` `f616d01`. Chỉ tài liệu.

## Review và sửa

| Bước | Head | Kết quả |
|---|---|---|
| Review trước PR (F1–F6) | `c774af3` | 6 lỗi, sửa ở `2be4696` ([log](2026-10-27-codex-OAUTH-02-review-fixes.md)) |
| Review độc lập | `a379dd5` | [Đạt sau khi sửa nhỏ](https://github.com/VinhDat267/ATI_Project/pull/176#issuecomment-6437340913), 3 P3; 13/14 đột biến bị bắt; check 2.341 + 406, browser 134/1 |
| Gộp `main` (reviewer, theo yêu cầu) | `5363d06` | xung đột với #171 ở 4 file, giải theo kiểu giữ cả hai bên; cây bằng bản gộp thử đã chạy check 2.384 + 406, browser 157/1 |
| Sửa 3 P3 (reviewer, theo yêu cầu) | `4ab61e1`, `e9f1dc3` | check 2.386 + 406, browser 157/1; M6 bị bắt ([log](2026-10-27-reviewer-OAUTH-02-review-p3-fixes.md)) |
| Kiểm lại (reviewer khác) | `e9f1dc3` | [Đạt sau khi sửa nhỏ](https://github.com/VinhDat267/ATI_Project/pull/176#issuecomment-6447099752); 3 P3 gốc đóng, 1 P3 mới ở chú thích |
| Sửa chú thích | `7f37f21` | chỉ đổi chú thích và log |

Người sửa 3 P3 cũng là người viết review độc lập; phần sửa đó đã có reviewer khác kiểm lại.

## Merge

- [#176](https://github.com/VinhDat267/ATI_Project/pull/176): merge commit `f616d01`, lúc 16:32:11Z (23:32:11 Việt Nam). Lệnh merge khoá theo SHA head `7f37f21930a0c0ec7a48a9b15bf93ceb60251669`.
- **Trước merge:** [CI #176](https://github.com/VinhDat267/ATI_Project/actions/runs/40538791965) SUCCESS đúng head `7f37f21`; PR `CLEAN`.
- **Cây:** `main` đã có thêm #177 (`ae07723`) sau khi nhánh gộp `main`. `git diff 7f37f21 f616d01` bằng đúng `git diff f4ff636 ae07723`, tức 4 file tài liệu của #177.
- **Sau merge:** [CI `main`](https://github.com/VinhDat267/ATI_Project/actions/runs/40541874778) SUCCESS đúng `f616d01`.

## Quyết định ghi lại

- Đặc tả OAUTH-02 được viết lại ngày 27/10 sau phiên brainstorm với nhóm trưởng: chọn nhiều lịch trên màn callback; Google Cloud project riêng (CURRENT-STATE mục 7).
- Thiết kế bản 26/10 do reviewer viết (client OAuth thứ hai trong project Gmail) là sai: Google thu hồi token cho mọi client trong cùng project.
- Phần mã merge trước buổi quyết 29/10 theo quyết định của nhóm trưởng; điều kiện "cờ Gmail đã bật" chưa đạt. Cờ vẫn tắt.

## Dọn sau merge

- Bằng chứng ở `ATI_Project-review-pr176/.codex/review-176` (27 file) được chép vào `ATI_Project/.codex/worktree-archive/2026-10-27-review-pr176`. SHA-256 khớp từng file.
- Gỡ junction trong `node_modules`, gỡ worktree `ATI_Project-review-pr176`, xoá nhánh local `fix/oauth-02-review-p3`. DB tạm `ati-review176-pg` đã xoá; DB dev không bị đụng tới.
- Hai worktree khác không do reviewer tạo nên để nguyên:
  - `ATI_Project-oauth02` (nhánh `feat/oauth-02-personal-calendar`, nhánh trên GitHub đã tự xoá khi merge);
  - `ATI_Project-review-176-p3-e9f1dc3` (của reviewer kiểm lại).

## Còn mở

- Google Cloud project riêng cho Calendar; `EVAL_SET=mycalendar` ×3; P-LIVE; PR bật cờ. Chỉ làm nếu ngày 29/10 nhóm trưởng đưa OAUTH-02 vào phạm vi bảo vệ.
- Ngoài live, `env.ts` không kiểm URL override là máy chủ giả (CURRENT-STATE mục 5).
