# 2026-10-07 · Claude Code · PROTO-01 bước 4: index, app-stage

- **Yêu cầu:** sau khi tìm xong nguyên nhân 9 pixel của bước 3, người dùng hỏi "chúng ta có thể tiếp tục bước tiếp theo luôn được không" rồi hai lần "ok tiếp tục đi".
  - Lúc bắt đầu, bước 3 (#95) chưa merge. Bước 4 làm trong worktree `.claude/worktrees/proto-react-04`, nhánh `feat/proto-react-04` tách từ nhánh bước 3.
  - Giữa chừng người dùng nói "merge #95 rồi tiếp tục đi": #95 merge tại `458c5ad` (cây merge bằng head `4dc4a39` đã kiểm, CI PR và CI main xanh); nhánh và worktree bước 3 đã xoá. Nhánh bước 4 nằm trên `4dc4a39` nên PR bước 4 chỉ còn phần bước 4. Việc merge #95 được ghi vào CURRENT-STATE/ROADMAP trong PR này, như bước 3 đã ghi #94.
  - Phiên bị ngắt một lần vì hết ngữ cảnh và được nối lại từ bản tóm tắt.
- **Cách làm:** giống bước 3: sinh khung bằng bộ chuyển, viết lại JS của bản mẫu (`index` 750 dòng, `app-stage` 1.109 dòng) bằng state React theo mô hình ảnh chụp, khai trạng thái thao tác (`index` 23, `app-stage` 34) và sửa từng khác biệt mà script so tìm ra. Chi tiết RED → GREEN ở [task card](../tasks/PROTO-01-prototypes-to-react.md), điểm tương thích mới ở [README](../../design/prototypes/react/README.md).
- **Phát hiện đáng chú ý:**
  - Biến `--font-body/--font-display/--font-mono` của trang trùng tên biến theme Tailwind v4 khai trên `:root`, bị đè; `index` lệch font ở 777 phần tử. Đổi tên thành `--page-font-*` ở cả 7 trang có biến này.
  - Class `transform` của v3 luôn đặt ma trận đơn vị (phần tử có lớp vẽ riêng), v4 không đặt gì. Chỉ lộ thành 594 pixel ở `index` (chữ nút "Quay lại đăng nhập" được khử răng cưa xám thay vì khử răng cưa điểm ảnh con), nhưng có ở 20 chỗ trong 9 trang. Script so trước đó không so `transform`, nên các bước 1–3 không bắt được; nay so transform thực tế và so lại cả 12 trang.
  - Chế độ giảm chuyển động của `index` ẩn hẳn sân khấu tương tác; trạng thái cần sân khấu khai `motion: true`.
  - Trạng thái có hẹn giờ phải chọn mốc chờ cách xa mốc đổi giao diện, vì bản React chạy dev chậm hơn vài trăm ms. Rõ nhất ở chữ gõ dần của `index`: bản React dev gõ ~55 ms/ký tự vì mỗi ký tự dựng lại cả trang, bản gốc ~38 ms; bản build production ngang bản gốc. Chữ chỉ gõ lại khi lần trước đã xong, nên bấm chấm lúc một bản còn đang gõ thì hai bản khác nhau. Không sửa trang; trạng thái chờ lần gõ xong.
- **Sự cố trong phiên:**
  - commit tự động đêm 06–07/10 của bước 3 (`c50f382`) đưa nhầm hai script dò tạm `_crop.mjs`, `_px.mjs` vào PR #95; phát hiện khi làm bước 4, gỡ ở `ca3c1cd` trên nhánh bước 3.
  - heredoc làm mất dấu `\` trong một script dò tạm; sửa bằng công cụ ghi file. Script dò tạm đã xoá trước khi commit.
- **Người dùng tắt máy giữa chừng** (lần so toàn bộ thứ hai dừng ở 372/464, 0 lệch); phiên sau chạy lại từ đầu.
- **Kết quả:** lần so toàn bộ 12 trang 462/464 (`index` 44/44, `app-stage` 72/72); hai trường hợp lệch là dao động (nét chữ Playfair; hover sau khi nút bị đẩy khỏi con trỏ, đã thêm bước `move`), chạy lại riêng `account settings` 116/116 exit 0. Chi tiết ở task card, mục "Kết quả bước 4".
- **Không làm:** không sửa `apps/`, không sửa 12 file HTML gốc, không gọi dịch vụ hay model, không merge.
