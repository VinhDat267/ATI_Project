# Runbook Demo Bảo Vệ Khóa Luận — ATI v3 (`DEMO-01`)

> **Phạm vi:** Runbook chuẩn tắc để dựng lại từ đầu, vận hành buổi bảo vệ, điều phối chuỗi **4–9 dịch vụ** trên một kế hoạch, chuyển đổi LLM dự phòng và xử lý sự cố trong buổi bảo vệ đồ án.
> **Cam kết bảo mật:** Tài liệu này chỉ chứa tên biến cấu hình, tên cờ tính năng và giá trị mẫu giả định — tuyệt đối không chứa khóa bí mật hay token thật.

---

## 1. Máy Trạm, Phần Mềm & Cổng Dịch Vụ

| Thành phần | Yêu cầu bắt buộc | Lệnh kiểm tra nhanh |
|---|---|---|
| **Node.js** | `>= 22.12.0` hoặc `>= 24.0.0` (khuyến nghị `v24.x`) | `node -v` |
| **Docker Desktop** | Engine đang chạy, hỗ trợ `docker compose` | `docker info` |
| **PostgreSQL 16** | Container `ati-v3-postgres-1` (cổng `55533`) hoặc DB demo riêng | `docker ps` |
| **Cổng LLM (`9router`)** | Hoạt động tại `http://localhost:20128/v1` (OpenAI-compatible) | `curl http://localhost:20128/v1/models` |
| **Cổng Backend (`chat-api`)** | `http://127.0.0.1:3000` (`/api/health` trả `200 OK`) | `curl http://127.0.0.1:3000/api/health` |
| **Cổng Frontend (`chat-web`)** | `http://127.0.0.1:5174` (Vite) | Mở trình duyệt Chromium / Chrome |

---

## 2. Cấu Hình Cờ Tính Năng (`.env`) & Khởi Tạo Từ Đầu

### 2.1. Bảng Cờ Tính Năng Đã Chuẩn Hóa Cho Buổi Bảo Vệ

Trong file `.env` tại thư mục gốc (không commit vào Git), đảm bảo các cờ sau đã được bật:

```dotenv
RUNTIME_MODE=live
PORT=3000

# LLM Gateway (9router)
LLM_PROVIDER=openai-compatible
LLM_BASE_URL=http://localhost:20128/v1
LLM_MODEL=kr/claude-sonnet-4.5
PLANNER_SEARCH_MODE=llm

# Bật đầy đủ các tính năng v3 đã nghiệm thu
PLANNER_READ_ANSWERS=on
SCHEDULES_ENABLED=on
GMAIL_ENABLED=on
MYCALENDAR_ENABLED=on
MYSHEETS_ENABLED=on
MYSLACK_ENABLED=off
```

### 2.2. Quy Trình Dựng Lại Từ Đầu (Clean Setup)

1. **Kiểm tra mã nguồn và cài đặt phụ thuộc:**
   ```bash
   git checkout main
   npm ci
   ```
2. **Khởi động PostgreSQL container (giữ volume dữ liệu bền vững giữa các lần chạy):**
   ```bash
   npm run db:up:v3
   ```
3. **Chạy toàn bộ 41 migrations (`0001` → `0032`) và khởi tạo tài khoản quản trị demo:**
   ```bash
   npm run db:migrate:v3
   npm run admin:provision:v3
   ```
4. **Khởi chạy đồng thời Backend (`:3000`) và Frontend (`:5174`):**
   ```bash
   npm run up
   ```
5. **Kiểm tra trạng thái 9 dịch vụ tại `/settings`:**
   - Đăng nhập bằng tài khoản quản trị demo.
   - Mở trang `/settings`, kiểm tra phần **Kết nối OAuth 2.0 1-Click** và **Cấu hình dịch vụ Workspace**:
     - **Google Calendar** (`calendar` / `mycalendar`) — `healthy`
     - **Google Sheets** (`sheets` / `mysheets`) — `healthy`
     - **Gmail** (`gmail`) — `healthy` (OAuth 2.0 cá nhân)
     - **Atlassian Jira** (`jira` / `myjira`) — `healthy` (OAuth 3LO hoặc Workspace)
     - **GitHub** (`github`) — `healthy`
     - **Trello** (`trello`) — `healthy`
     - **Notion** (`notion`) — `healthy`
     - **Telegram** (`telegram`) — `healthy` (`@ati_cnhn_bot`)
     - **Slack** (`slack`) — `healthy` (`#general` / `#ati-test`)
   - Bấm **"Kiểm tra kết nối"** trên từng thẻ dịch vụ để xác nhận trạng thái `healthy` trước giờ bảo vệ.

---

## 3. Ba Kịch Bản Chính + Kịch Bản Flagship 9 Dịch Vụ

> **Quy tắc bất biến khi bảo vệ:** Giữ nguyên **từng chữ câu lệnh mẫu** dưới đây (hoặc bấm trực tiếp thẻ Playbook tương ứng trên màn hình Cockpit / trang `/guide`). Mọi bước ghi chỉ thực thi **sau khi người dùng bấm "Duyệt kế hoạch"** trên Moment 4.

### Kịch Bản 1 — Workflow 4 Dịch Vụ Liên Thông (`Jira → Notion → Telegram → Slack`)

- **Cách chọn nhanh:** Trên màn hình chính (Moment 1), bấm thẻ Playbook **"Ứng cứu sự cố P1 qua 4 dịch vụ"** hoặc dán câu lệnh:
  ```text
  Tạo ticket sự cố thanh toán P1 trên Jira, lập trang biên bản sự cố trên Notion kèm mã và liên kết Jira, gửi cảnh báo trực ca qua Telegram kèm liên kết biên bản và đăng tổng hợp vào kênh Slack #general
  ```
- **Điểm nhấn trình bày với Hội đồng:**
  1. **Moment 2 (Discovery):** Hệ thống tự động tra cứu dự án Jira, database Notion, nhóm Telegram và kênh Slack trong phạm vi được cấp quyền.
  2. **Moment 4 (Plan & Preview):** Hiển thị sơ đồ **WorkflowFlowCanvas** gồm 4 nút liên kết tuần tự (`jira.create_issue` → `notion.create_page` → `telegram.send_message` → `slack.send_message`) cùng các nhãn truyền dữ liệu tự động (`$ref` / `$template`).
  3. **Bấm "Xem trước" (Preview Drawer):** Chỉ rõ hệ thống chưa ghi bất kỳ dữ liệu nào ra dịch vụ thật khi chưa bấm duyệt.
  4. **Bấm "Duyệt kế hoạch" → Moment 6 (Receipt):** Tiêu đề hiển thị **"Đã xong 4 việc trên 4 công cụ"**, có pill mã ticket Jira (`🎫 Mã: ATI-...`), số thuộc tính Notion, mã tin nhắn Telegram (`📨 Tin nhắn #...`) và link mở trực tiếp từng kết quả.

### Kịch Bản 2 — Quyền Riêng Tư Gmail Cá Nhân (`GMAIL_ENABLED=on`) & Chỉnh Sửa Kế Hoạch Qua Chat

- **Câu lệnh mẫu (Trả lời / Gửi thư qua Gmail cá nhân và báo Slack):**
  ```text
  Đọc danh sách khách hàng trên bảng tính Google Sheets, soạn thư báo giá qua Gmail và báo tiến độ vào kênh Slack.
  ```
  *(Hoặc dùng câu lệnh trực tiếp: `"Tìm luồng thư báo giá mới nhất trên Gmail, tạo bản nháp trả lời xác nhận và gửi thông báo vào kênh Slack #ati-test"`)*
- **Điểm nhấn trình bày với Hội đồng:**
  1. **Ranh giới tài khoản cá nhân:** Trên thẻ bước Gmail tại Moment 4 và Moment 6, chỉ rõ dòng **"Gửi từ: `<email>` (Gmail của bạn)"** — chứng minh token OAuth 2.0 cá nhân tách biệt hoàn toàn giữa các người dùng.
  2. **Chỉnh sửa kế hoạch bằng hội thoại ("Sửa qua Chat"):** Tại Moment 4, bấm **"Sửa qua Chat"**, nhập yêu cầu đổi tiêu đề hoặc người nhận → kế hoạch cũ chuyển sang `superseded`, bản kế hoạch mới hiển thị để duyệt.
  3. **Hủy kế hoạch an toàn:** Bấm **"Hủy"** trên một kế hoạch nháp để chứng minh trạng thái `rejected` không sinh bất kỳ lệnh gọi ghi nào.

### Kịch Bản 3 — Lịch Chạy Định Kỳ (`SCHEDULES_ENABLED=on`) & Điểm Danh Lịch Họp Sáng

- **Cách chọn nhanh:** Bấm thẻ Playbook **"Đặt lịch điểm danh lịch họp mỗi sáng 08:00"** hoặc dán câu lệnh:
  ```text
  Mỗi sáng 08:00 từ thứ 2 đến thứ 6, kiểm tra lịch họp Google Calendar trong ngày và gửi bản tóm tắt vào kênh Slack #general
  ```
- **Điểm nhấn trình bày với Hội đồng:**
  1. **Moment 3B (Schedule Preview):** Hiển thị biểu thức cron (`0 8 * * 1-5`), múi giờ `Asia/Ho_Chi_Minh`, thời điểm chạy tiếp theo và cam kết **"Mỗi lượt chạy chỉ tạo kế hoạch chờ bạn duyệt"**.
  2. **Bấm "Xác nhận lịch" → Tab `/schedules`:** Lịch mới xuất hiện trong danh sách đang bật.
  3. **Bấm "Chạy lượt này ngay" (`Trigger Now`):** Hệ thống sinh một hội thoại có gắn nhãn `Lịch chạy`, lập kế hoạch mới và **dừng ở trạng thái chờ người dùng duyệt** (bảo toàn bất biến Human-in-the-Loop).

### Kịch Bản Bonus (Flagship) — Điều Phối Liên Thông Toàn Diện 9 Dịch Vụ Trong 1 Kế Hoạch

- **Cách chọn nhanh:** Bấm thẻ Playbook đầu tiên **"Điều phối liên thông toàn diện 9 dịch vụ"** trên màn hình Cockpit:
  ```text
  Tạo lịch họp khẩn trên Google Calendar, tạo ticket sự cố trên Jira kèm link lịch họp, mở issue trên GitHub tham chiếu mã Jira, tạo thẻ theo dõi trên Trello, lập trang biên bản sự cố trên Notion tổng hợp các liên kết, ghi dòng nhật ký vào bảng tính Google Sheets, gửi email báo cáo qua Gmail tới oncall@ati.local, gửi cảnh báo trực ca qua Telegram và đăng tổng hợp toàn bộ vào kênh Slack #general
  ```
- **Điểm nhấn trình bày với Hội đồng:**
  - Giải thích vì sao một câu lệnh duy nhất có thể điều phối đồng thời **9 dịch vụ thực tế** (`Calendar → Jira → GitHub → Trello → Notion → Sheets → Gmail → Telegram → Slack`) trong giới hạn an toàn `<= 10 bước` của `validatePlan`.
  - Ở chế độ kiểm thử hoặc khi rớt mạng bên ngoài, có thể chạy ngay kịch bản này với `RUNTIME_MODE=sandbox SANDBOX_SCENARIO=nine_service` để minh họa tức thì chuỗi 9 biên nhận **"Đã xong 9 việc trên 9 công cụ"**.

---

## 4. Dọn Dẹp Tài Nguyên Thử Nghiệm Sau Mỗi Lượt Chạy

| Dịch vụ | Tài nguyên sinh ra trong lượt chạy | Cách xử lý sau mỗi lượt diễn tập |
|---|---|---|
| **Jira** | Issue mới (`ATI-...`) | Giữ nguyên hoặc chuyển trạng thái sang `Done` (mỗi issue có key tăng dần, không gây xung đột). |
| **GitHub** | Issue mới (`#...`) | Đóng issue trên kho thử nghiệm `ati-test` nếu chạy quá 5 lần. |
| **Trello** | Thẻ mới trên cột `Doing` / `Sprint Backlog` | Dùng câu lệnh mẫu `p4` trên ATI để lưu trữ (`archive`) hoặc giữ nguyên. |
| **Notion** | Trang biên bản mới trong Database | Giữ nguyên (mỗi trang có UUID riêng). |
| **Google Sheets** | 1 dòng mới ở cuối tab `Tasks` / `Sprint 18` | Giữ nguyên để Hội đồng thấy lịch sử kiểm toán liên tiếp. |
| **Google Calendar** | Sự kiện họp War-room | Xoá tay các sự kiện trùng giờ nếu muốn giữ lịch trống trước giờ bảo vệ. |
| **Gmail** | Thư đã gửi / Thư nháp trong hộp thư thử nghiệm | Không cần xoá; dùng địa chỉ nhận nội bộ của nhóm. |
| **Telegram & Slack** | Tin nhắn tổng hợp trong nhóm & `#general` / `#ati-test` | Giữ nguyên làm bằng chứng thời gian thực. |
| **Lịch chạy (`/schedules`)** | Lịch chạy `0 8 * * 1-5` | Tạm dừng (`Pause`) hoặc xoá các lịch tạo thử trước khi bước vào lượt demo chính thức. |

---

## 5. Quy Trình Chuyển Đổi LLM Dự Phòng (`Fallback Drill` < 60 Giây)

Thực hiện ngay khi model chính (`kr/claude-sonnet-4.5`) có độ trễ cao (> 45 giây) hoặc trả lỗi từ upstream provider:

1. **Mở file `.env` và đổi biến `LLM_MODEL` sang model dự phòng đã kiểm chứng:**
   ```dotenv
   # Phương án dự phòng 1 (trên 9router):
   LLM_MODEL=cx/gpt-5.4

   # Phương án dự phòng 2 (Gemini trực tiếp không qua 9router):
   LLM_PROVIDER=gemini
   GEMINI_MODEL=gemini-2.5-flash
   ```
2. **Khởi động lại tiến trình API (`Ctrl+C` rồi chạy lại):**
   ```bash
   npm run up
   ```
3. **Kiểm tra nhanh (15 giây):** Gửi câu lệnh Kịch bản 1 tới màn hình duyệt (Moment 4), xác nhận 4 bước hiển thị đầy đủ rồi bấm **"Hủy"** để sẵn sàng cho phần trình bày chính.

---

## 6. Kịch Bản Xử Lý Sự Cố Khẩn Cấp (Contingency Matrix)

| Sự cố phát sinh | Dấu hiệu nhận biết | Hành động xử lý tức thì (< 30 giây) |
|---|---|---|
| **1. `9router` ngừng phản hồi** | `curl http://localhost:20128/v1/models` lỗi kết nối | Khởi động lại `9router` hoặc đổi `.env` sang `LLM_PROVIDER=gemini` + `GEMINI_MODEL=gemini-2.5-flash`, chạy lại `npm run up`. |
| **2. Một dịch vụ ngoài trả `401 Unauthorized`** | Thẻ dịch vụ ở `/settings` báo `unhealthy` hoặc dừng ở Moment 7 | Mở `/settings`, bấm **Kết nối lại OAuth 1-Click** cho dịch vụ đó; hoặc tại Moment 7 bấm **"Bỏ qua việc này"** (`Skip`) để minh họa tính năng phục hồi lỗi cục bộ (Partial Failure Recovery). |
| **3. Lập kế hoạch quá 60 giây** | Màn hình Moment 2 hiện thông báo chờ lâu | Bấm nút **"Thôi chờ"**, chuyển `LLM_MODEL` theo Mục 5 và gửi lại câu lệnh. |
| **4. Mất kết nối Internet tại phòng bảo vệ** | Toàn bộ OAuth / API bên ngoài không truy cập được | Chuyển sang chế độ Sandbox nội bộ (`RUNTIME_MODE=sandbox SANDBOX_SCENARIO=nine_service npm run up`) để demo trực tiếp trên trình duyệt + PostgreSQL thật tại máy, kết hợp phát video dự phòng (`VIDEO-01`). |

---

## 7. Checklist 15 Phút Trước Giờ Bảo Vệ (`Pre-Flight Checklist`)

- [ ] **T-15 phút:** Cắm sạc máy tính, tắt chế độ Sleep, đóng các tab không liên quan.
- [ ] **T-12 phút:** Kiểm tra `docker ps` (PostgreSQL container `healthy`) và `curl http://localhost:20128/v1/models` (`9router` sẵn sàng).
- [ ] **T-10 phút:** Chạy `npm run up`, mở `http://127.0.0.1:5174` và đăng nhập sẵn.
- [ ] **T-08 phút:** Mở `/settings`, xác nhận các dịch vụ hiển thị trạng thái **Đã kết nối (`healthy`)**.
- [ ] **T-05 phút:** Mở sẵn các tab đích trên trình duyệt: Jira Project `ATI`, GitHub repo `ati-test`, bảng Trello, trang Notion, bảng tính Google Sheets, Google Calendar, Gmail, Telegram Web và kênh Slack `#general` / `#ati-test`.
- [ ] **T-02 phút:** Quay về màn hình chính Cockpit (`/`), kiểm tra 4 thẻ Playbook liên dịch vụ hiển thị rõ ràng, sẵn sàng bắt đầu trình bày.
