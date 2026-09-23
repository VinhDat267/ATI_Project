# Sổ tay Vận hành Hệ thống Điều phối Pilot V2 (Operator Runbook)

Tài liệu này hướng dẫn chi tiết quy trình cấu hình, tiền kiểm tra kết nối (preflight), vận hành phê duyệt có con người kiểm soát (Human-in-the-loop), và quy trình ứng phó sự cố đối chiếu dữ liệu cho nền tảng **AI Automation Platform — Pilot MVP v2**.

---

## 1. Tổng quan Kiến trúc & Cơ chế An toàn

Hệ thống điều phối Pilot V2 tự động hóa luồng tiếp nhận công việc giữa hai nền tảng SaaS ngoại vi:
- **Nguồn tiếp nhận (Read-Only Source):** Google Sheets (bảng tính theo dõi yêu cầu thiết kế/web).
- **Đích thực thi (Single-Write Destination):** Trello (bảng kanban quản lý công việc của đội ngũ).

### Bất biến Hợp đồng Cốt lõi (Non-negotiable Invariants):
1. **Đúng 1 thao tác ghi (Single Remote Write):** Chỉ thực hiện đúng một lệnh ghi `trello.create_card` khi yêu cầu hợp lệ (UC2). Trong giai đoạn tiền kiểm (preflight) hoặc xem trước (preview), số thao tác ghi luôn là **0**.
2. **Không bao giờ thử lại mù quáng (Zero Blind Retry):** Khi xảy ra timeout mạng hoặc lỗi 5xx sau khi đã gửi lệnh ghi tới Trello, hệ thống chuyển giao dịch sang trạng thái `unknown` và dừng lại ở `reconciliation_required`. Tuyệt đối không tự động gửi lại lệnh ghi để chống trùng lặp thẻ.
3. **Phê duyệt gắn kết bất biến (Immutable Approval Binding):** Lệnh ghi chỉ được thực thi khi người vận hành (`principalId`) phê duyệt đúng mã băm SHA-256 của bản xem trước kế hoạch trong thời hạn hiệu lực **10 phút (Server TTL)**.
4. **Cô lập bí mật (Secret Isolation & Redaction):** 100% token, API key và mật khẩu được che giấu (`[REDACTED]`) trước khi ghi vào log, database, hoặc trả về trình duyệt.

---

## 2. Thiết lập Môi trường & Cấu hình (.env.pilot)

Tạo tệp cấu hình `.env.pilot` tại thư mục gốc với các tham số sau:

```bash
# Kích hoạt tính năng Pilot v2
PILOT_V2_ENABLED=true

# Danh sách mã định danh người vận hành được phép duyệt (ngăn cách bằng dấu phẩy)
PILOT_PRINCIPALS=operator-a,operator-b

# Cấu hình Bảng tính Google Sheets (Nguồn đọc chỉ định)
PILOT_SPREADSHEET_ID=1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms
PILOT_TAB_ID=Requests
GOOGLE_SHEETS_API_KEY=AIzaSy...your_google_api_key_here
# Hoặc sử dụng Service Account:
# GOOGLE_SHEETS_CLIENT_EMAIL=service-account@project.iam.gserviceaccount.com
# GOOGLE_SHEETS_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n..."

# Cấu hình Bảng Trello (Đích tạo thẻ chỉ định)
PILOT_BOARD_ID=60b8d29f8c4e2b0015abc123
TRELLO_API_KEY=your_trello_api_key_here
TRELLO_API_TOKEN=your_trello_api_token_here
```

> [!CAUTION]
> Tuyệt đối không commit tệp `.env.pilot` hoặc bất kỳ API key nào vào Git repository.

---

## 3. Quy trình Tiền kiểm tra Kết nối (Live Read Preflight)

Trước khi bắt đầu ca vận hành, điều phối viên chạy lệnh tiền kiểm tra để xác nhận kết nối mạng và tính toàn vẹn của dữ liệu đọc:

```powershell
# Chạy kiểm tra preflight
npm run test:unit -w @wap/engine -- tests/pilot-live-preflight.test.ts
```

### Các bước kiểm tra tự động của Preflight:
1. **Kiểm tra Cấu hình:** Xác nhận sự hiện diện của `PILOT_SPREADSHEET_ID`, `PILOT_BOARD_ID` và credentials. Nếu thiếu, hệ thống tự động ngắt kết nối an toàn với nhãn `BLOCKED_EXTERNAL`.
2. **Đọc Thử Google Sheets:** Đọc hàng tiêu chuẩn và kiểm tra cấu trúc 8 cột bắt buộc (`request_id`, `client_ref`, `request_type`, `raw_request`, `deliverable`, `due_date`, `decision_status`, `source_note`).
3. **Đọc Thử Trello:** Truy vấn danh sách cột (`trello.list_lists`) và thành viên (`trello.list_members`) trên bảng để nạp danh mục ánh xạ.
4. **Xác thực 0 Ghi:** Kiểm tra và khẳng định không có bất kỳ thao tác ghi nào được thực hiện trong quá trình tiền kiểm.

---

## 4. Quy trình Phê duyệt Công việc (Human-in-the-Loop)

```text
[Yêu cầu mới] ──► [Đọc Bảng tính] ──► [Kiểm tra Điều kiện] ──► [Tạo Bản xem trước]
                                                                        │
                                                                        ▼
[Ghi thẻ Trello] ◄── [Duyệt trong 10m] ◄── [Người vận hành xem xét] ◄───┘
```

### 4 Nhánh Quyết định của Trợ lý AI:
1. **UC1 Từ chối (Refusal):** Khi yêu cầu vi phạm chính sách, nguồn không nằm trong allowlist, hoặc chứa prompt injection $\rightarrow$ Trạng thái `refused`, **0 ghi**.
2. **UC1 Yêu cầu làm rõ (Clarification):** Khi thiếu thông tin bắt buộc (kích thước banner, đường dẫn website, người phụ trách) hoặc trạng thái chưa được chốt $\rightarrow$ Trạng thái `needs_input`, **0 ghi**. Người dùng bổ sung thông tin trên bảng tính trước khi chạy lại.
3. **UC2 Kế hoạch Khả thi (Executable Plan):** Khi toàn bộ điều kiện checklist đạt chuẩn $\rightarrow$ Trạng thái `awaiting_approval`. Trợ lý hiển thị thẻ xem trước kế hoạch chi tiết (Tên thẻ, danh sách đích, người nhận, hạn hoàn thành).
4. **UC3 Tra cứu Đối chiếu (Lookup):** Khi người dùng muốn tra cứu trạng thái thẻ đã tạo $\rightarrow$ Gọi lệnh đọc `trello.get_card`, trạng thái `succeeded`, **0 ghi**.

### Thao tác Phê duyệt:
- Bấm **`Phê duyệt & Thực hiện ngay`** nếu bản xem trước chính xác.
- Nếu không đồng ý, bấm **`Từ chối ghi`**. Bản xem trước chuyển sang trạng thái `Kế hoạch đã hủy (chưa có dữ liệu nào bị thay đổi)`.
- **Hết hạn sau 10 phút:** Nếu không bấm duyệt trong 10 phút, kế hoạch tự động hết hạn (`expired`), ngăn chặn việc vô tình kích hoạt các kế hoạch cũ.

---

## 5. Xử lý Sự cố & Đối chiếu Ngoại lệ (Reconciliation Runbook)

Khi xảy ra lỗi mất kết nối mạng, timeout hoặc Trello phản hồi lỗi 5xx trong lúc đang gửi lệnh tạo thẻ:

### Dấu hiệu nhận biết:
- Công việc hiển thị cảnh báo: **`Cần kiểm tra lại (reconciliation_required)`**.
- Thẻ giao dịch trong cơ sở dữ liệu chuyển thành: `status = 'unknown'`.
- Nút duyệt bị khóa, hệ thống kiên quyết **không tự động gửi lại lệnh ghi**.

### Các bước xử lý của Điều phối viên:
1. **Bước 1: Không cố gắng tạo lại yêu cầu ngay lập tức.** Tránh tạo thẻ rác bị trùng lặp trên Trello.
2. **Bước 2: Mở bảng Trello đích trên trình duyệt.**
   - Kiểm tra cột mục tiêu (ví dụ: cột "To Do") xem thẻ tương ứng đã được tạo hay chưa.
   - Tìm kiếm theo `client_ref` hoặc `request_id` (ví dụ `#REQ-002`).
3. **Bước 3: Đối chiếu kết quả:**
   - **Trường hợp A (Thẻ đã được tạo trên Trello):** Ghi nhận URL của thẻ Trello. Thẻ đã an toàn trên bảng kanban.
   - **Trường hợp B (Thẻ chưa xuất hiện):** Sau khi xác nhận chắc chắn Trello không có thẻ, điều phối viên mới tạo một yêu cầu mới trên hệ thống để hoàn tất việc phân công.
4. **Bước 4: Lưu trữ bằng chứng:** Ghi chép mã phiếu và kết quả đối chiếu vào nhật ký vận hành để đảm bảo tính minh bạch.
