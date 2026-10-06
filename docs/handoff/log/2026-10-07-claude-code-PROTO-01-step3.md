# 2026-10-07 · Claude Code · PROTO-01 bước 3: account, users, settings, history, guide

- **Yêu cầu:** người dùng nói "merge rồi làm tiếp bước 3".
  - PR #94 (bước 2) merge tại `852342c` lúc 19:43:58 ngày 06/10 (Việt Nam), sau khi CI `v3` xanh đúng head `27a9421`.
  - Bước 3 làm trong worktree `.claude/worktrees/proto-react-03`, nhánh `feat/proto-react-03` từ `main` `852342c`. Phiên bị ngắt một lần vì hết giới hạn và được nối lại từ bản tóm tắt.
- **Cách làm:**
  - sinh khung bằng `scripts/html-to-jsx.mjs`;
  - tách lõi bộ chuyển ra `scripts/lib/html-jsx.mjs`, thêm `template-to-jsx.mjs` (chuỗi template HTML trong JS → JSX) và `extract-data.mjs` (chép hằng dữ liệu sang `data.tsx`);
  - viết lại JS của bản mẫu bằng state React theo mô hình ảnh chụp: dữ liệu trong `useRef`, giao diện chỉ đổi khi bản mẫu gọi hàm vẽ lại;
  - khai trạng thái thao tác cho từng trang và sửa từng khác biệt mà script so tìm ra. Chi tiết RED → GREEN ở [task card](../tasks/PROTO-01-prototypes-to-react.md), các điểm tương thích mới và lỗi bản mẫu đang giữ ở [README](../../design/prototypes/react/README.md).
- **Phát hiện đáng chú ý:**
  - Chế độ tối của bản mẫu (`theme.css`) ghi đè gradient và màu `divide-*` theo tên class và biến của Tailwind v3. Hai nhóm class này phải giữ tên gốc và viết bằng CSS theo cách v3 (`src/styles/v3-theme-targets.css`), đồng thời loại khỏi v4.
  - `hidden` do JS thêm vào phần tử `inline-flex` thua ở v4 (v4 xếp theo tên class). Thêm vào phần tử `flex`/`grid` thì không sao.
  - React ghi `value` của ô nhập bằng thuộc tính DOM nên con trỏ nằm cuối chữ; ô hẹp vì thế cuộn khác bản mẫu khi focus.
  - Lệch thoáng qua phổ biến nhất là nét chữ Playfair Display, không lặp lại khi chạy lại. Script giờ giữ ảnh của lần lệch đầu để kiểm.
- **Sự cố nhỏ trong phiên:**
  - một lệnh thay thế qua heredoc làm mất dấu `\` trong selector CSS và regex; đã sửa bằng công cụ ghi file và kiểm lại.
  - một script nối state dùng regex dừng nhầm ở dấu `>` của arrow function, nhưng dừng trước khi ghi nên file không đổi.
- **Kết quả:** xem task card, mục "Kết quả bước 3". Typecheck, build exit 0.
- **Không làm:** không sửa `apps/`, không sửa 12 file HTML gốc, không gọi dịch vụ hay model. Bước 4 (`index`, `app-stage`) chưa làm.
