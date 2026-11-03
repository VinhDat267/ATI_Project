# Planora · Chuẩn tắc thiết kế giao diện (Design Authority)

**Cập nhật:** 03/11/2026 (Task PL-01).
**Phạm vi:** Toàn bộ tầng trình bày (visual presentation) của `apps/chat-web`.
**Đặc tả gốc:** [Planora migration design](../../docs/superpowers/specs/2026-11-02-planora-migration-design.md) và `ef13c56:apps/chat-web/DESIGN.md`.

---

## 1. Nguyên tắc cốt lõi & Ranh giới thẩm quyền

1. **Khôi phục cả bố cục và bản sắc thị giác Planora:**
   - Sidebar bên trái (248px desktop), ngăn kéo (drawer) trên tablet/mobile (&lt;1024px).
   - Hội thoại làm trung tâm: Một composer duy nhất ở đáy màn hình làm việc, feed cuộn tự nhiên chứa các bước khảo sát, làm rõ, kế hoạch, tiến trình và biên nhận.
   - Bảng màu giấy kem ấm (`#f8f4eb` canvas, `#fffdf7` paper, `#eee9dd` sidebar), chữ than tự nhiên (`#2e382d`), điểm nhấn xanh rừng Planora (`#3c5741`).
2. **Bảo tồn trọn vẹn nghiệp vụ và kiến trúc v3:**
   - Giữ nguyên 22 route entries, URL deep link `/c/:id`, navigation controller, SSE streaming, store và hooks hiện hành.
   - Giữ nguyên quy chuẩn an toàn: Khóa kế hoạch bằng cryptographic `plan_hash`, cơ chế phê duyệt có điều kiện, đối soát (reconciliation), và xử lý lỗi không thể phục hồi (`needs_attention`, `unknown`).
   - Giữ nguyên cơ chế chuyển đổi không gian làm việc (workspace switcher), cách ly dữ liệu giữa người dùng và tổ chức.
   - Giữ nguyên thiết lập giao diện `ati-theme` và sự kiện `ati:theme`.

---

## 2. Hệ thống Tokens thị giác (`--planora-*`)

### 2.1. Chế độ sáng (Light Palette)

| Vai trò | Giá trị Hex | Cách dùng |
| --- | --- | --- |
| `canvas` | `#f8f4eb` | Nền trang tổng thể, tạo cảm giác giấy tự nhiên |
| `paper` | `#fffdf7` | Thẻ card, composer, modal, bề mặt tương tác |
| `sidebar` | `#eee9dd` | Không gian điều hướng bên trái và ngăn kéo |
| `text` | `#2e382d` | Chữ nội dung chính (tương phản 12.0:1 trên paper) |
| `muted` | `#656b5b` | Chú thích, nhãn phụ, thông tin thứ cấp (5.4:1) |
| `divider` | `#deded0` | Đường phân tách nhẹ, viền thẻ |
| `primary` | `#3c5741` | Nút hành động chính (CTA), điểm nhấn nhận diện (7.8:1) |
| `primary-hover` | `#2f4633` | Trạng thái di chuột nút chính |
| `primary-soft` | `#e4e9d8` | Nền tin nhắn người dùng, điểm nhấn nhẹ |
| `pending` | `#f6e6cf` / `#85532b` | Trạng thái chờ phê duyệt (tương phản 5.2:1) |
| `error` | `#f8e6df` / `#9a3f32` | Trạng thái thất bại, lỗi hệ thống (5.5:1) |
| `unknown` | `#eee6f2` / `#654576` | Trạng thái chưa rõ kết quả thực thi (6.4:1) |
| `success` | `#e4e9d8` / `#3c5741` | Trạng thái thực thi hoàn tất |

### 2.2. Chế độ tối (Dark Palette — Đề xuất mở rộng)

| Vai trò | Giá trị Hex | Cách dùng |
| --- | --- | --- |
| `canvas` | `#171c18` | Nền canvas tối, ánh xanh rừng sâu |
| `paper` | `#202820` | Bề mặt thẻ card, modal |
| `sidebar` | `#151b16` | Bề mặt sidebar tối |
| `text` | `#f5f1e7` | Chữ chính sáng kem (tương phản 13.4:1 trên paper) |
| `muted` | `#b5bcae` | Chữ phụ, metadata (7.7:1) |
| `divider` | `#394638` | Viền thẻ tối |
| `primary` | `#8fb68e` | Điểm nhấn xanh lá mạ dịu mắt (6.6:1) |
| `on-primary` | `#132014` | Chữ hiển thị trên nền nút primary (7.4:1) |
| `pending` | `#332314` / `#f5c07a` | Huy hiệu chờ duyệt trong nền tối (9.1:1) |
| `error` | `#351a1a` / `#fca5a5` | Huy hiệu lỗi trong nền tối (8.4:1) |
| `unknown` | `#281a33` / `#d8b4fe` | Huy hiệu chưa rõ trong nền tối (9.2:1) |
| `success` | `#1a2e1d` / `#a7f3d0` | Huy hiệu thành công trong nền tối (11.2:1) |

*Ghi chú:* Toàn bộ các cặp màu trên đều đạt hoặc vượt tiêu chuẩn WCAG AA ≥ 4.5:1.

---

## 3. Typography & Nhận diện

- **Font thân bài (Body & UI):** `Be Vietnam Pro` (400, 500, 600) tự host trong `public/fonts/` kèm giấy phép SIL Open Font License (OFL 1.1). Không phụ thuộc CDN bên ngoài.
- **Font tiêu đề (Headings):** `Times New Roman`, `Georgia`, `serif` mang nét báo chí, cổ điển đặc trưng của Planora.
- **Font mã nguồn (Code & JSON):** `Consolas`, `'JetBrains Mono'`, `monospace`.
- **Monogram:** Logo Planora hình chữ P với nét chéo định hướng và 2 điểm tròn tọa độ, thể hiện hành trình từ Ý tưởng → Kế hoạch → Hành động.
- **Logo dịch vụ bên ngoài:** Sử dụng logo định dạng vector SVG chính thức tự host tại `public/logos/` (GitHub, Trello, Slack, Google Calendar, Google Sheets, Jira, Telegram, Notion).

---

## 4. Bốn mẫu tham chiếu thẩm mỹ (Reference Samples)

1. **Landing (Giới thiệu):** Nhận diện thương hiệu, minh họa quy trình 3 bước, danh mục 8 dịch vụ.
2. **Chat with Plan (Hội thoại có kế hoạch):** Bố cục sidebar 248px, feed hội thoại trung tâm, card kế hoạch 2 bước (`github.list_issues` và `trello.update_card`) kèm mã băm `plan_hash`, một composer duy nhất tại đáy màn hình.
3. **Settings (OAuth & Scope):** Cấu hình OAuth cá nhân cho GitHub, Trello, Sheets, Telegram kèm tính năng từ GitHub PR #260 (tìm kiếm nhanh, đếm 10/10 kho, nhãn Private/Public, đích gửi Telegram/Slack).
4. **History & Schedules (Nhật ký & Lịch chạy):** Quản lý lịch chạy tự động theo múi giờ, nhật ký thực thi và trạng thái an toàn `needs_attention`.
