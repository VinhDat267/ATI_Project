# Planora — Design Brief & Đặc tả Chuẩn mực Trải nghiệm Business-First
**Phiên bản:** 2.0 (Đã hoàn thiện sau thẩm định độc lập của Claude Opus và Gemini 4 Argon)  
**Ngày cập nhật:** 05/11/2026  
**Cơ sở chuẩn tắc:**
- [Quyết định UX Business-First 05/11/2026](2026-11-05-planora-business-first-ux.md)
- [Báo cáo Thẩm định Độc lập của Claude Opus 5.5 High](../../handoff/log/2026-11-05-claude-opus-design-review.md)
- [Báo cáo Re-Review PL-07 Round 2 của Gemini 4 Argon High](../../handoff/log/2026-11-05-argon-review-pl-07-r2.md)
- [Đặc tả Kiến trúc v3](../../superpowers/specs/2026-09-29-ai-workflow-platform-v3-design.md) và [Main Sync 04/11](../../handoff/PLANORA-MAIN-SYNC-2026-11-04.md)

---

## I. TỔNG QUAN, TRIẾT LÝ & HỆ THỐNG TOKENS THỊ GIÁC

### 1. Tuyên ngôn Nhận diện & Trải nghiệm (Brand & Aesthetic)
- **Cảm hứng chủ đạo:** Bàn làm việc của một trợ lý điều hành thông thái, điềm đạm và chuẩn xác. Không gian thanh lịch, ấm cúng và có chủ đích, loại bỏ hoàn toàn cảm giác kỹ thuật, bảng điều khiển cockpit hay máy trạng thái khô cứng.
- **Bảng màu Chuẩn mực (Tokens Semantic & Đạt chuẩn WCAG AA):**
  
| Vai trò token | Chế độ sáng (Light Palette) | Chế độ tối (Dark Palette) | Tương phản thực tế (WCAG AA) | Ứng dụng nghiệp vụ |
| :--- | :--- | :--- | :--- | :--- |
| `canvas` | `#f8f4eb` (Giấy kem ấm) | `#171c18` (Rừng đêm sâu) | — | Nền tổng thể toàn bộ ứng dụng |
| `paper` | `#fffdf7` (Giấy viết mịn) | `#202820` (Bề mặt rêu tối) | — | Thẻ công việc, khung hội thoại, modal |
| `sidebar` | `#eee9dd` (Kem trầm) | `#151b16` (Rừng tối trầm) | — | Thanh điều hướng bên trái và mobile drawer |
| `text` | `#2e382d` (Than tự nhiên) | `#f5f1e7` (Kem sáng) | **12.0:1** (Light) / **13.4:1** (Dark) | Văn bản nội dung chính, tiêu đề |
| `muted` | `#656b5b` (Rêu trầm) | `#b5bcae` (Xám rêu sáng) | **5.4:1** (Light) / **7.7:1** (Dark) | Chú thích, thời gian, định danh phụ |
| `divider` | `#deded0` (Viền mộc) | `#394638` (Viền tối) | — | Đường phân cách nhẹ giữa các phần |
| `primary` | `#3c5741` (Xanh rừng Planora) | `#8fb68e` (Xanh mạ dịu mắt) | **7.98:1** (Light) / **6.6:1** (Dark) | Nút hành động chính (CTA), điểm nhấn |
| `on-primary` | `#ffffff` (Chữ trắng trên xanh) | `#171c18` (Chữ than trên xanh mạ) | **7.98:1** (Light) / **7.61:1** (Dark) | **Chữ trên nút primary (Tuyệt đối không dùng chữ trắng ở dark mode)** |
| `pending` | `#f6e6cf` / `#85532b` | `#332314` / `#f5c07a` | **5.24:1** (Light) / **9.13:1** (Dark) | Trạng thái chờ xử lý, chờ duyệt, offline |
| `error` | `#f8e6df` / `#9a3f32` | `#351a1a` / `#fca5a5` | **5.55:1** (Light) / **8.42:1** (Dark) | Trạng thái lỗi, nút dừng quy trình |
| `unknown` | `#eee6f2` / `#654576` | `#281a33` / `#d8b4fe` | **6.40:1** (Light) / **9.20:1** (Dark) | Trạng thái chưa xác nhận kết quả |
| `success` | `#e4e9d8` / `#3c5741` | `#1a2e1d` / `#a7f3d0` | **7.80:1** (Light) / **11.2:1** (Dark) | Trạng thái hoàn thành thành công |

- **Yêu cầu tương phản thành phần tương tác (WCAG 1.4.11 ≥ 3:1):**
  - Viền ô nhập liệu (`input`, `textarea`), viền thẻ radio và chỉ báo focus bàn phím phải đạt tỷ lệ tương phản tối thiểu **3.0:1** so với bề mặt nền `paper`/`canvas`. Không dùng đường viền mờ nhạt gây khó khăn cho người dùng khiếm thị.
- **Typography:**
  - Font tiêu đề (Headings): Serif cổ điển, phong cách báo chí editorial tự host kèm subset tiếng Việt đầy đủ (`Merriweather` hoặc `Lora`).
  - Font nội dung & UI (Body): `Be Vietnam Pro` (400, 500, 600) tự host.
  - Số liệu & Định danh: Tabular figures, sạch sẽ. Tuyệt đối không dùng font monospace cho văn bản trò chuyện hay câu yêu cầu của người dùng.

---

### 2. Bốn Trụ cột "Business-First" Cốt lõi

1. **Ngôn ngữ Công việc, Tuyệt đối Không Dùng Thuật ngữ Kỹ thuật:**
   - Xóa bỏ hoàn toàn mã tool (`myjira.search_issues`, `slack.send_message`, `trello.list_cards`). Diễn đạt bằng hành động tự nhiên: *"Tìm công việc bị chặn trong dự án Marketing"*, *"Gửi thông báo tiến độ vào kênh #thong-bao"*.
   - Giữ lại các định danh có ích cho việc ra quyết định: Mã công việc (`PROJ-42`), tên kênh Slack (`#thong-bao`), email nhận, tên bảng tính Google Sheets, thời gian.
2. **Cấm Triệt để Rác Kỹ thuật trên Giao diện:**
   - Tuyệt đối không hiển thị raw JSON, UUID, mã băm `plan_hash`, HTTP code, hay enum máy (`unknown`, `reconciliation_required`, `needs_attention`, `delivery_unknown`) trên bề mặt người dùng, kể cả trong các accordion "Chi tiết kỹ thuật" hay "Nâng cao".
   - Loại bỏ toàn bộ dấu vết đồ thị orbital engine cũ (node bubbles, dotted lines, đếm step) và nhãn cũ ("Make.com Orbital Flow", "ATI", "Chưa lập kế hoạch").
3. **Một Composer Duy nhất & Feed Hội thoại Liền mạch:**
   - Duy nhất một thanh nhập liệu ở chân trang làm việc. Dock composer được neo với khoảng đệm an toàn (`padding-bottom`), **không bao giờ che khuất các nút hành động** của các thẻ bên trên.
   - Mỗi câu nói, yêu cầu, hoặc câu hỏi làm rõ chỉ xuất hiện **đúng một lần** trong feed; không render lặp lại câu hỏi vừa trong feed vừa trong thẻ card.
4. **Minh bạch Tác động & Phục hồi An toàn Tuyệt đối:**
   - Thẻ kế hoạch nói rõ: Sắp làm gì, lấy từ đâu, gửi cho ai, xem trước nội dung sẽ gửi/ghi. Nút bấm thể hiện đúng tác động: *"Duyệt và gửi tin ngay"*, *"Lưu vào bảng tính"*.
   - Khi có sự cố (mất mạng, hết hạn phiên, chưa rõ kết quả): Giải thích rõ ràng *"Việc gì đã hoàn thành, việc gì chưa rõ và hành động an toàn bạn có thể làm tiếp"*, không tự ý mở nút Retry khi chưa xác nhận kết quả trên server.

---

## II. ĐẶC TẢ CHI TIẾT 4 MẪU TRẢI NGHIỆM ĐẠI DIỆN

---

### MẪU 1: HÀNH TRÌNH KHÁM PHÁ, ĐĂNG NHẬP & BẮT ĐẦU (PL-03 / PL-04)
*Giúp người mới hiểu ngay giá trị Planora mang lại, đăng nhập an toàn theo đúng hợp đồng backend và thực hiện yêu cầu đầu tiên một cách tự nhiên.*

#### 1. Brief Nghiệp vụ
- **Đối tượng:** Trưởng nhóm, chuyên viên quản lý công việc, thành viên mới.
- **Mục tiêu:** Hiểu giá trị sản phẩm qua ví dụ thực tế → Đăng nhập / Đăng ký → Vào không gian làm việc đầu tiên mà không bị đưa vào trang thiết lập kỹ thuật.
- **Điểm vào:** Route `/` (khi chưa đăng nhập), `/login`, `/signup`, `/auth/action`.

#### 2. Bố cục & Nội dung Trình bày
- **Trang chủ (Landing Page):**
  - **Hero Editorial:**
    - Tiêu đề lớn (Serif): *"Tổ chức công việc xuyên suốt các công cụ nhóm bạn dùng mỗi ngày."*
    - Đoạn giới thiệu: *"Nói điều bạn cần bằng tiếng Việt tự nhiên. Planora tự động kết nối Jira, Slack, Google Calendar và Sheets để chuẩn bị công việc cho bạn."*
  - **Khối ví dụ thực tế (Có gắn nhãn "Ví dụ kịch bản"):**
    - Thẻ ví dụ 1: *"Tổng hợp 5 nhiệm vụ đang bị chặn từ Jira và gửi bản tin sáng lên Slack mỗi ngày lúc 8:00 AM"*
    - Thẻ ví dụ 2: *"Đọc danh sách đăng ký mới từ Google Sheets và tạo thẻ công việc tương ứng trên Trello"*
  - **CTA chính:** Nút lớn *"Bắt đầu với Google"* (Primary xanh rừng) và nút *"Đăng ký bằng email công việc"*.
- **Xác thực & Vòng đời tài khoản (PL-04) — Chuẩn hóa theo Contract:**
  - **Đăng nhập / Đăng ký:** Form nhập Email + Mật khẩu với kiểm tra hợp lệ rõ ràng, báo lỗi thân thiện (VD: *"Email hoặc mật khẩu chưa chính xác. Vui lòng thử lại"* thay vì mã lỗi).
  - **Xác thực Email & Quên mật khẩu:**
    - Tuyệt đối không dùng copy "liên kết đăng nhập / magic link" (do backend không hỗ trợ).
    - Màn gửi email xác thực: *"Chúng tôi đã gửi mã xác thực tài khoản đến hòm thư nam@company.com. Vui lòng kiểm tra hộp thư của bạn."* Kèm nút *"Gửi lại mã"* (có đồng hồ đếm ngược lấy `deadline` từ server).
    - Màn đặt lại mật khẩu: Nhập mật khẩu mới với thanh đánh giá độ mạnh trực quan và nút *"Lưu mật khẩu mới và Đăng nhập"*.
  - **Bảng ánh xạ 13 chế độ `AuthAction` sang thông điệp người dùng:**

| Chế độ AuthAction | Tiêu đề hiển thị | Thông điệp hướng dẫn người dùng | Nút hành động (CTA) |
| :--- | :--- | :--- | :--- |
| `verify-email` | Xác thực tài khoản | "Tài khoản của bạn đã được xác thực thành công. Bạn có thể bắt đầu làm việc ngay." | [Vào không gian làm việc →] |
| `verify-expired` | Mã xác thực đã hết hạn | "Mã xác thực này đã hết thời gian hiệu lực để bảo vệ an toàn cho bạn. Vui lòng yêu cầu mã mới." | [Gửi lại mã xác thực mới] |
| `verify-used` | Mã đã được sử dụng | "Liên kết xác thực này đã được sử dụng trước đó. Vui lòng đăng nhập vào tài khoản của bạn." | [Đăng nhập ngay] |
| `reset-password` | Đặt lại mật khẩu | "Nhập mật khẩu mới cho tài khoản nam@company.com để tiếp tục." | [Cập nhật mật khẩu] |
| `blocked-pending` | Chờ quản trị viên duyệt | "Yêu cầu tham gia tổ chức của bạn đang chờ quản trị viên phê duyệt. Chúng tôi sẽ thông báo qua email khi hoàn tất." | [Kiểm tra lại trạng thái] |
| `blocked-locked` | Tài khoản tạm khóa | "Tài khoản tạm thời bị khóa vì lý do an toàn. Vui lòng liên hệ quản trị viên nhóm của bạn." | [Gửi hỗ trợ] |
| `google-*` | Lỗi kết nối Google | "Chưa thể hoàn tất đăng nhập bằng Google. Vui lòng thử lại hoặc dùng email." | [Thử lại với Google] |

- **Trải nghiệm Mobile (Responsive):**
  - Form căn giữa gọn gàng trên mobile, bàn phím số/email tự động hiển thị đúng loại input (`type="email"`, `inputMode="numeric"` khi nhập OTP).
  - Vùng chạm của nút bấm tối thiểu **44×44px**.

---

### MẪU 2: ĐIỀU HƯỚNG KHÔNG GIAN & HỘP THƯ ĐỀ XUẤT CHỜ XỬ LÝ (PL-02 / PL-09c)
*Giúp người dùng nắm bắt ngữ cảnh làm việc hiện tại, phát hiện ngay việc cần quyết định và quản lý các công cụ đã kết nối.*

#### 1. Brief Nghiệp vụ
- **Đối tượng:** Mọi người dùng đã đăng nhập (cá nhân hoặc thành viên tổ chức).
- **Mục tiêu:** Nhận diện nhóm hiện tại → Mở hội thoại mới → Kiểm tra các đề xuất chờ duyệt trong `/inbox` → Quản lý kết nối dịch vụ.
- **Điểm vào:** Thanh điều hướng Sidebar trên mọi màn hình, route `/inbox`, route `/settings`.

#### 2. Bố cục & Nội dung Trình bày
- **Sidebar Planora (Thanh điều hướng bên trái — 248px desktop / Drawer mobile):**
  - **Phần 1: Nhận diện & Bộ chọn không gian (Workspace Switcher):**
    - Logo Monogram Planora (chữ P thanh lịch) + Dropdown chọn không gian:
      - 🏢 *Công ty Cổ phần Công nghệ ABC (Quản trị viên)*
      - 👤 *Không gian cá nhân của Nam*
      - ➕ *Tạo hoặc tham gia nhóm mới...*
    - **Cơ chế chuyển đổi an toàn:** Khi chuyển không gian, toàn bộ request đang chờ của không gian cũ lập tức được hủy an toàn; danh sách hội thoại và inbox được tải mới hoàn toàn, **không bao giờ để lộ dữ liệu nhóm cũ sang nhóm mới**.
  - **Phần 2: Điều hướng Công việc:**
    - ✦ *Cuộc trò chuyện mới* (Nút nổi bật trên nền giấy kem)
    - 📥 *Hộp thư đề xuất (`/inbox`)* kèm badge số thực tế: `[3]` (Màu xanh rừng Planora, chỉ đếm các đề xuất thực sự cần người dùng duyệt hoặc trả lời).
    - 💬 *Hội thoại gần đây* (danh sách cuộn, gom nhóm theo "Hôm nay", "Tuần này", có thể tìm kiếm theo tiêu đề).
    - 📋 *Nhật ký & Lịch chạy (`/history`)* (Xem lịch tự động định kỳ và lịch sử đã chạy).
  - **Phần 3: Dịch vụ & Tài khoản (Chân sidebar):**
    - ⚡ *Kết nối dịch vụ (`/settings`)*: Hiển thị icon vector SVG tự host (Jira, Slack, Google Sheets, Calendar, Trello, GitHub, Notion, Telegram) kèm chỉ báo trạng thái thực tế từ API (Đã kết nối / Cần kết nối lại / Chưa kết nối).
    - 👤 *Hồ sơ & Đăng xuất*: Tên người dùng + Avatar ký tự tắt.
  - **Biểu tượng (Iconography):** Tuyệt đối dùng icon SVG vector chính thức `aria-hidden="true"`, không dùng ký tự emoji (✦📥💬📋) để tránh screen reader đọc sai tên emoji và giao diện bị vỡ hạt trên các hệ điều hành khác nhau.
- **Trang Hộp thư Đề xuất (`/inbox`) — Chuẩn hóa theo Contract:**
  - **Đầu trang:** Tiêu đề lớn: *"Hộp thư đề xuất"* kèm bộ chọn kết nối Slack (`connectionPicker` nếu người dùng kết nối nhiều workspace Slack) và số lượng việc cần chú ý.
  - **Ba bộ lọc chuẩn theo trạng thái backend:**
    - 🔘 *Cần xử lý* (Gồm các đề xuất trạng thái `action_needed`: đang chờ thông tin bổ sung hoặc chờ quyết định).
    - ⚪ *Chờ duyệt kế hoạch* (Các đề xuất trạng thái `awaiting_approval` đã có kế hoạch hoàn chỉnh).
    - ⚪ *Đã xử lý* (Các đề xuất trạng thái `resolved`: đã hoàn thành, đã từ chối hoặc hết hạn).
  - **Cấu trúc Thẻ Đề xuất (Proposal Card):**
    - **Nguồn gốc:** Biểu tượng Slack + Tên kênh `#du-an-moi` · Người yêu cầu: Linh Nguyễn (15 phút trước).
    - **Nội dung công việc:** *"Tạo công việc Jira: 'Nâng cấp bảo mật OAuth 2.0 cho cổng thanh toán'"*.
    - **Hành động nghiệp vụ chuẩn:**
      - Nếu đề xuất ở trạng thái `awaiting_approval`: Nút chính *"Xem nội dung & Duyệt"* (mở modal xem trước chi tiết kế hoạch) và nút *"Từ chối đề xuất"* (hiển thị hộp thoại xác nhận: *"Thao tác này sẽ từ chối và kết thúc đề xuất này trên Slack"*).
      - Nếu đề xuất ở trạng thái `needs_info`: Nút chính *"Bổ sung thông tin"* (chuyển sang chat kèm prefill ngữ cảnh) thay vì nút Duyệt.
      - Nếu đề xuất ở trạng thái `stale` hoặc đã bị thu hồi (`redacted`): Nút thao tác bị vô hiệu hóa, hiển thị nhãn: *"Đề xuất này đã hết hạn hoặc được cập nhật phiên bản mới"*.
      - Khi gặp lỗi xung đột phiên bản (HTTP 409): Tự động làm mới thẻ để hiển thị phiên bản mới nhất, không duyệt ngầm.

---

### MẪU 3: BÀN LÀM VIỆC HỘI THOẠI & LÀM RÕ THÔNG TIN (PL-05 / PL-07)
*Trao đổi tự nhiên, làm rõ thông tin thiếu một cách êm ái mà không gây rối màn hình và triệt tiêu hoàn toàn lỗi 2 nút gửi.*

#### 1. Brief Nghiệp vụ
- **Đối tượng:** Người dùng đang giao việc hoặc theo dõi một quy trình.
- **Mục tiêu:** Gõ yêu cầu bằng tiếng Việt tự nhiên → Hệ thống tiếp nhận, làm rõ thông tin còn thiếu → Xem xét và lựa chọn phương án tốt nhất.
- **Điểm vào:** Route `/` hoặc `/c/:id`.

#### 2. Bố cục & Nội dung Trình bày
- **Feed Hội thoại Liền mạch (Quy tắc Khử Trùng lặp Tuyệt đối):**
  - Feed hội thoại chịu trách nhiệm hiển thị lịch sử các lượt tương tác (tin nhắn của bạn và câu trả lời của trợ lý) theo đúng trình tự thời gian.
  - **Mỗi nội dung chỉ xuất hiện đúng 1 lần:** Thẻ làm rõ (Clarification) hoặc Thẻ kế hoạch (Plan) ở cuối feed chỉ tập trung vào phần **nội dung quyết định** (lựa chọn, xem trước, nút bấm); tuyệt đối không vẽ lại bong bóng câu yêu cầu của người dùng bên trong thẻ card.
- **Thẻ Làm rõ Thông tin (Clarification Card):**
  - **Tiêu đề nghiệp vụ:** *"Tôi đã chuẩn bị xong bản báo cáo tiến độ tuần từ Google Sheets. Bạn muốn gửi bản báo cáo này qua kênh nào dưới đây?"*
  - **Danh sách lựa chọn radio dạng thẻ card nhẹ:**
    - ◉ *Gửi tin nhắn vào kênh #marketing trên Slack* (Kèm chú thích: Kênh chính thức của phòng Marketing).
    - ○ *Gửi email đến marketing-team@company.com* (Kèm chú thích: Gửi thư kèm liên kết xem trực tiếp trang tính).
- **Cơ chế Tương tác "Duy nhất Một Nút Gửi" (Giải quyết dứt điểm `UX-F3`):**
  - **Đồng bộ ô soạn thảo:** Khi người dùng click chọn radio option (hoặc di chuyển bằng phím mũi tên `ArrowDown`/`ArrowUp`), tên lựa chọn lập tức được điền sẵn vào ô soạn thảo ở chân trang để người dùng có thể gõ thêm chỉ dẫn (ví dụ: gõ thêm *"kèm lời nhắc họp chiều nay"*).
  - **Triệt tiêu nút gửi thứ hai:**
    - Thanh Composer ở chân trang là **nơi kích hoạt hành động duy nhất**. Nút gửi của Composer tự động chuyển trạng thái: đổi nhãn thành *"Xác nhận và tiếp tục →"* với màu xanh rừng Planora nổi bật.
    - Thẻ làm rõ bên trên chỉ đóng vai trò hiển thị các tùy chọn, không đặt thêm một nút gửi trùng lặp trên thân thẻ.
    - **Hành vi văn bản:** Nội dung trong Composer chính là nội dung được gửi đi khi bấm xác nhận. Nếu người dùng xóa sạch văn bản hoặc gõ một nội dung hoàn toàn khác, các nút radio tự động bỏ chọn (`selected = null`) để tránh gửi nhầm dữ liệu không đồng nhất.
    - **Không tự động gửi:** Việc click radio chỉ cập nhật văn bản draft, **tuyệt đối không phát sinh request POST gửi tin** cho đến khi người dùng chủ động bấm nút xác nhận.
- **Layout Composer Chống Đè Nút Tương tác:**
  - Vùng feed cuộn được thiết lập `min-height: 0; overflow-y: auto; scroll-padding-bottom: calc(var(--composer-dock-height) + 24px)`.
  - Chiều cao của Composer dock được theo dõi thời gian thực bằng `ResizeObserver`. Khi ô nhập giãn nở nhiều dòng hoặc khi xuất hiện thông báo offline, khoảng đệm của feed tự động tăng tương ứng.
  - Khi một thẻ tương tác mới xuất hiện, hệ thống tự động cuộn nhẹ để toàn bộ thẻ và hàng nút tương tác nằm gọn gàng trong tầm mắt người dùng, cách thanh Composer tối thiểu **24px**.
  - Trên mobile: Áp dụng `100dvh`, kết hợp `visualViewport.height` để tự động đẩy vùng cuộn lên trên khi bàn phím ảo xuất hiện.

---

### MẪU 4: DUYỆT TÁC ĐỘNG, THEO DÕI TIẾN TRÌNH & PHỤC HỒI AN TOÀN (PL-06 / PL-07)
*Thấy rõ ràng và trung thực những gì sẽ xảy ra trước khi duyệt; phục hồi sự cố minh bạch, bảo vệ dữ liệu tối đa.*

#### 1. Brief Nghiệp vụ
- **Đối tượng:** Người dùng duyệt đề xuất hoặc xử lý khi quy trình gặp sự cố gián đoạn.
- **Mục tiêu:** Kiểm tra nguồn gốc và đích đến → Xem trước nội dung thực tế → Duyệt có trách nhiệm → Theo dõi kết quả từng bước với liên kết thực tế → Xử lý sự cố mà không lo gửi/ghi trùng lặp.

#### 2. Bố cục & Nội dung Trình bày

#### A. Thẻ Đề xuất Kế hoạch (Plan Moment) — Bỏ Orbital Graph, Chuẩn hóa Tác động
- **Tiêu đề:** *"Tôi sẽ thực hiện 2 công việc dưới đây theo thứ tự:"*
- **Chuỗi Thẻ Công việc Trực quan (Step Cards):**
  - **Thẻ 1: Đọc dữ liệu công việc · Google Sheets**
    - Nguồn: Bảng tính *"Kế hoạch Sprint 42"* (Trang: *Nhiệm vụ hoàn thành*).
    - **Phân định trung thực dữ liệu (Chuẩn D1):**
      - Nếu bước này đã được chạy thử ở pha khảo sát trước: Hiển thị *"Đã đọc thành công 8 nhiệm vụ lúc 16:05"*.
      - Nếu bước này nằm trong kế hoạch sẽ thực thi: Hiển thị nhãn *"Sẽ đọc khi bạn duyệt kế hoạch"*. Tuyệt đối không bịa ra số lượng nhiệm vụ giả.
  - **Thẻ 2: Gửi thông báo tổng kết · Slack**
    - Nguồn & Đích: Gửi từ *Tài khoản cá nhân: Nam Nguyễn* (lấy từ kết nối thực) → Kênh *#thong-bao-chung*.
    - **Bản xem trước Nội dung Trung thực (Preview):**
      - Hiển thị khung xem trước tin nhắn Slack với định dạng mrkdwn chuẩn (không hiển thị format mà Slack không hỗ trợ; nếu gửi Telegram thì hiển thị văn bản thuần).
      - Nội dung tin nhắn:
        > *"🎉 Tổng kết tiến độ tuần: `‹danh sách 8 nhiệm vụ đọc ở bước 1›` đã hoàn thành đúng hạn..."*
      - Phần phụ thuộc kết quả bước trước được đặt trong placeholder có kiểu chữ nghiêng nhẹ và nhãn rõ ràng: `‹danh sách công việc đọc ở bước 1›`.
    - **Phủ đủ tham số nghiệp vụ (Chuẩn D1):** Hiển thị rõ người nhận, kênh, tiêu đề, tệp đính kèm (nếu có). Tuyệt đối không ẩn giấu các tham số quan trọng hay dump JSON.
- **Thanh Hành động Phê duyệt (Action Bar):**
  - **Nút chính:**
    - Nếu kế hoạch có 1 bước: Dùng động từ cụ thể (VD: *"Gửi tin nhắn Slack ngay"*, *"Lưu vào bảng tính"*).
    - Nếu kế hoạch có từ 2 bước trở lên: *"Duyệt và thực hiện 2 việc"* (Màu xanh rừng Planora).
    - **Chống bấm đúp (Double-click guard):** Ngay khi bấm, nút chuyển sang trạng thái bận (`isApproving = true`, `disabled = true`, hiển thị spinner nhẹ), ngăn chặn tuyệt đối việc phát sinh 2 request duyệt đồng thời.
  - **Nút phụ:** *"Sửa lại bằng chat"* và *"Hủy kế hoạch"*.
  - **Xóa bỏ hoàn toàn accordion "Chi tiết kỹ thuật"** và khối `<pre>{JSON.stringify(plan)}</pre>`.
- **Vòng đời Kế hoạch (Plan Lifecycle — Chuẩn D5):**
  - Khi người dùng bấm *"Sửa lại bằng chat"*: Thẻ kế hoạch cũ lập tức bị khóa, đổi nền mờ nhẹ và gắn huy hiệu: *"Đã thay thế bằng đề xuất mới trong cuộc trò chuyện"* để ngăn chặn việc bấm duyệt nhầm trên bản xem trước cũ.
  - Hết hạn TTL (30 phút): Thẻ chuyển sang trạng thái *"Kế hoạch đã hết hạn phê duyệt (quá 30 phút)"* kèm nút *"Lập lại kế hoạch"*.
  - Xung đột phiên bản (HTTP 409): Tự động làm mới thẻ và thông báo: *"Kế hoạch đã được cập nhật từ một phiên khác. Vui lòng xem lại trước khi duyệt."*

#### B. Thẻ Theo dõi Tiến trình Thực thi (Execution Moment)
- Theo dõi tiến trình từng bước theo sự kiện SSE thực tế của server (không có % tiến độ giả):
  - Bước 1: Đang đọc Google Sheets... ➔ ✓ Đã đọc xong 8 nhiệm vụ.
  - Bước 2: Đang gửi tin nhắn vào Slack... ➔ ✓ Đã gửi thành công.
- Khi mất kết nối SSE: Hiển thị thông báo nhẹ nhàng: *"Đang kết nối lại với máy chủ để cập nhật tiến trình..."*, không coi đây là lỗi thất bại.
- **Biên nhận kết quả (Receipt Moment):** Cung cấp liên kết thật: *"Xem tin nhắn vừa gửi trên Slack"* (permalink thực tế) và liên kết mở bảng tính Google Sheets.

#### C. Thẻ Xử lý Sự cố & Phục hồi An toàn (Recovery Moment) — Chuẩn D2

1. **Trường hợp Chưa xác nhận được kết quả (`delivery_unknown`):**
   - **Thông báo nghiệp vụ:** *"Chưa thể xác nhận tin nhắn đã được gửi đến Slack hay chưa do máy chủ Slack phản hồi chậm. Bước 1 (đọc Sheets) đã hoàn thành an toàn."*
   - **Quy tắc an toàn tuyệt đối:**
     - TUYỆT ĐỐI KHÔNG hiển thị nút "Thử lại", "Sửa" hay "Tiếp tục".
     - Chỉ cung cấp 2 hành động an toàn:
       1. *"Kiểm tra trên Slack"* (liên kết an toàn mở kênh `#thong-bao-chung` để người dùng tự xác nhận).
       2. *"Dừng hẳn quy trình"* (để kết thúc phiên an toàn).
2. **Trường hợp Lỗi kết nối tài khoản / Hết hạn OAuth (`failed`):**
   - **Thông báo:** *"Chưa thể gửi tin nhắn do tài khoản Slack của bạn cần kết nối lại. Dữ liệu công việc vừa xử lý được lưu tạm thời."*
   - **Hành động tuần tự:**
     - Bước 1: Nút *"Kết nối lại Slack"* (mở cửa sổ cấp quyền OAuth).
     - Bước 2: Nút *"Thử gửi lại"* chỉ được kích hoạt sau khi tài khoản đã kết nối thành công VÀ server xác nhận bước trước đó thất bại rõ ràng (`failed`). Tuyệt đối không tự động gửi lại ngay sau khi vừa kết nối OAuth.
3. **Trường hợp Chỉnh sửa bước lỗi (Sửa rồi thử lại):**
   - Không dùng `RecoveryEditor` dạng textarea JSON thô hay nhãn "ID kênh".
   - Hiển thị form chỉnh sửa nghiệp vụ thân thiện: Dropdown chọn lại tên kênh Slack, ô nhập lại nội dung văn bản.
4. **Hộp thoại Xác nhận Dừng Quy trình:**
   - Khi bấm *"Dừng quy trình"*, hộp thoại mở ra giải thích: *"Không thể tiếp tục sau khi dừng. Các kết quả đã hoàn thành trước đó được giữ nguyên."*
   - Phím `Escape` chỉ đóng modal và trả focus về nút mở, **không bao giờ ngầm dừng quy trình**.
   - Nút *"Dừng hẳn quy trình"* sử dụng token semantic error của Planora, đảm bảo độ tương phản WCAG AA cao: **5.55:1** ở Light mode và **8.42:1** ở Dark mode.

---

### MẪU BỔ SUNG: BẢN TIN ĐỊNH KỲ & LỊCH TỰ ĐỘNG (PL-11 / PL-12 — Chuẩn D7)
*Phân biệt rành mạch giữa tự động hoàn toàn và cần phê duyệt trước mỗi lần chạy.*

- **Bố cục Thẻ Lịch chạy (Schedule Card):**
  - **Mục tiêu:** *"Bản tin tiến độ công việc hàng ngày"*
  - **Lịch trình:** *"Mỗi ngày lúc 8:00 AM (Múi giờ: Asia/Ho_Chi_Minh)"* · Lần chạy tiếp theo: *Ngày mai, 06/11 lúc 8:00 AM*.
  - **Nguồn & Đích:** Từ *Jira (Dự án Marketing)* ➔ Gửi vào *Kênh #marketing (Slack)*.
  - **Chế độ phê duyệt (Phân biệt rõ ràng):**
    - ◉ *Duyệt trước mỗi lần chạy (Mặc định an toàn):* Hệ thống sẽ chuẩn bị bản tin và đưa vào Hộp thư đề xuất (`/inbox`) để bạn duyệt trước khi gửi.
    - ○ *Tự động gửi theo lịch:* Tự động tổng hợp và gửi thẳng vào kênh Slack theo đúng giờ đã đặt.
  - **Quản lý lịch:** Nút *"Tạm dừng lịch"* (kèm giải thích: *"Lịch sẽ ngừng chạy cho đến khi bạn bật lại"*), *"Chỉnh sửa giờ gửi"*, *"Xóa lịch"*.
  - Khi lịch bị tạm dừng do lỗi quyền/hết hạn kết nối: Hiển thị nhãn cảnh báo rõ lý do: *"Đã tạm dừng: Tài khoản Jira cần cấp lại quyền truy cập"* kèm nút *"Cấp quyền lại"*.

---

## III. MA TRẬN TIÊU CHÍ NGHIỆM THU ĐO LƯỜNG ĐƯỢC (ACCEPTANCE GATES)

Trước khi coi một module UI hoàn thành đợt refactor, bắt buộc phải vượt qua các bài kiểm chứng đo lường thực tế sau:

| Mã tiêu chí | Hạng mục kiểm tra | Phương pháp đo lường & Tiêu chuẩn đạt |
| :--- | :--- | :--- |
| **GATE-01** | Không đè nút hành động (`UX-F3`) | Dùng Playwright đo bounding box: Bounding box của thanh Composer dock **không giao nhau (intersection = 0)** với bounding box của các nút hành động trên card ở mọi viewport (320px, 375px, 768px, 1024px, 1440px) cả khi Composer cao 4 dòng. |
| **GATE-02** | Khử trùng lặp tin nhắn (`UX-F2`) | Kiểm tra DOM: Mỗi chuỗi câu hỏi làm rõ hoặc câu yêu cầu của người dùng **chỉ xuất hiện đúng 1 lần duy nhất** trong DOM của cây hội thoại. |
| **GATE-03** | Tương phản màu sắc (WCAG AA) | Kiểm tra computed style: Toàn bộ chữ chính, chữ phụ, nút primary (kể cả Dark mode `#8fb68e` / `#171c18`), nút dừng, nhãn cảnh báo đều đạt tỷ lệ tương phản **≥ 4.5:1** (thành phần tương tác ≥ 3.0:1). |
| **GATE-04** | Tuyệt đối sạch rác kỹ thuật (`UX-F1`) | Quét chuỗi trên DOM: Không chứa bất kỳ từ khóa nào trong danh sách: `plan_hash`, `UUID`, `tool`, `myjira.`, `slack.`, `trello.`, `JSON`, `needs_attention`, `delivery_unknown`, `Make.com Orbital Flow`, `ATI`. |
| **GATE-05** | Duy nhất một nút gửi | Kiểm tra trạng thái: Tại màn hình làm rõ thông tin, **chỉ có duy nhất 1 nút gửi hoạt động** trên toàn màn hình; click radio không phát sinh request POST. |
| **GATE-06** | Phủ đủ tham số nghiệp vụ (D1) | Kiểm tra dữ liệu: Mọi tham số có tác động ra bên ngoài đều được ánh xạ sang nhãn nghiệp vụ; phần phụ thuộc kết quả bước sau hiển thị placeholder `‹...›`, không dựng dữ liệu giả. |
| **GATE-07** | Không tràn ngang trên Mobile | Đo document width: Chiều rộng toàn bộ tài liệu không vượt quá viewport width ở kích thước **320px** và **375px** (overflow-x = 0). |

---

## IV. LỘ TRÌNH TRIỂN KHAI THEO NHÓM TASK (OWNERSHIP)

Sau khi bản Brief này được phê duyệt:
1. **Giai đoạn 1 (PL-06 & PL-07):**
   - Refactor `PlanMoment.tsx`: Loại bỏ accordion JSON dump, chuyển sang thẻ step cards tác động trung thực (placeholder phụ thuộc).
   - Refactor `PlanoraWorkflowSteps.tsx`: Loại bỏ đồ họa orbital engine bubbles.
   - Refactor `ResponseMoment.tsx`, `RecoveryMoment.tsx`, `RecoveryEditor.tsx`: Đóng dứt điểm các lỗi `UX-F1`, `UX-F2`, `UX-F3`, `UX-P3-1`.
2. **Giai đoạn 2 (PL-05 & PL-02):**
   - Refactor `PlanoraChatWorkspace.tsx` & `PlanoraActiveTurn.tsx`: Cơ chế 1 composer không đè nút, feed khử trùng lặp tin nhắn.
   - Refactor `PlanoraSidebar.tsx`: Bổ sung `/inbox`, badge đề xuất, SVG icons, phân cấp không gian làm việc.
3. **Giai đoạn 3 (PL-03 & PL-04):**
   - Refactor `LandingPage.tsx`: Phong cách editorial, ví dụ thực tế.
   - Refactor `AuthActionPage.tsx`: Chuẩn hóa 13 trạng thái xác thực bằng copy tiếng Việt thân thiện.
4. **Giai đoạn 4 (PL-11 & PL-12):**
   - Triển khai Lịch chạy và Bản tin tự động theo đúng Mẫu bổ sung (D7).

*Mọi giai đoạn đều do **Gemini 3.8 Flash High** thi công và **Gemini 4 Argon High** thẩm định độc lập theo đúng quy chuẩn.*
