# 2026-10-06 · Claude Code · PROTO-01 bước 1: khung React cho 12 bản mẫu, trang 404 và privacy

- **Yêu cầu:** người dùng muốn chuyển 12 bản mẫu HTML sang React, dùng đúng công nghệ của frontend hiện tại.
  - chỉ làm trong `docs/design/prototypes/`, chưa đưa vào app;
  - giữ nguyên design system của bản mẫu.

  Claude Code audit trước, người dùng chọn để Claude Code tự làm, bắt đầu bằng bước 1.
- **Audit:**
  - frontend: React 19.3, Vite 8.3, Tailwind 4.3.3, TypeScript strict, Zustand 5, router tự viết, Vitest, Playwright;
  - bản mẫu: Tailwind v3 CDN, khoảng 7.000 dòng JS inline, 238 thuộc tính `on*`, 871 dòng CSS riêng;
  - cấu hình Tailwind có 6 nhóm nhưng chỉ 6/32 token khác giá trị.
- **Worktree** `.claude/worktrees/proto-react`, nhánh `feat/proto-react-01` từ `origin/main` `18980ec`. Thư mục chính có file riêng của người dùng, giữ nguyên.
- **Cách làm:**
  - bộ chuyển HTML → JSX bằng `parse5`;
  - Tailwind v4 nạp không qua cascade layer để thứ tự CSS giống bản CDN;
  - token theo trang;
  - lớp tương thích cho từng khác biệt v3 → v4 mà script so tìm ra;
  - JS của bản mẫu viết lại bằng React.

  Chi tiết và bảng tương thích ở [README](../../design/prototypes/react/README.md); số liệu RED → GREEN ở [task card](../tasks/PROTO-01-prototypes-to-react.md).
- **Kết quả:**
  - `npm run verify -- 404 privacy` 8/8 đạt: 0 phần tử lệch, 0 pixel lệch;
  - kiểm hành vi 8/8 đạt;
  - typecheck và build exit 0.
- **Ngoại lệ hook thiết kế:**
  - hook `impeccable` báo Playfair Display và JetBrains Mono "ngoài DESIGN.md" (bản `DESIGN.md` trong repo không mô tả design system của bản mẫu);
  - Claude Code ghi ngoại lệ hẹp cho đúng hai font này, lý do: design system của 12 bản mẫu mà người dùng yêu cầu giữ;
  - file `.impeccable/config.json` nằm trong worktree, không commit.
- **Sự cố nhỏ:** một lệnh sửa file bằng heredoc làm mất dấu `\` trong regex, thay thế không ăn. Đã phát hiện qua `grep`, sửa lại bằng công cụ sửa file.
- **Dọn dẹp:**
  - server Vite và server tĩnh do script so tự mở, tự đóng;
  - `dist/` của lần build đã xoá;
  - `.parity/` (ảnh so) nằm trong `.gitignore`.
- **Việc tiếp theo:** bước 2 (`errors`, `responses`, `auth-action`). Khi đưa vào app cần chốt lại đặc tả giao diện mục 1.1, vì nó mâu thuẫn với design system bản mẫu.
