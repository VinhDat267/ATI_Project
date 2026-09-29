# AI Workflow Automation Platform (v3)

> **Đề tài #26:** Nền tảng tự động hóa quy trình làm việc bằng Trí tuệ Nhân tạo  
> **Kiến trúc v3:** Chat Agent + Tool Orchestration (Plan-then-Execute)  
> **Ngôn ngữ & Nền tảng:** TypeScript Monorepo (Node.js 22+, React 19, PostgreSQL, Docker)  
> **Trạng thái:** Hoàn thành Phase 0-5 + Remediation Audit F01-F14 (Gates G0-G5) — 117 tests passing (100%) & 16 Acceptance Probes OK

---

## 1. Tầm nhìn & Giá trị cốt lõi

Khác với các hệ thống cứng nhắc yêu cầu người dùng phải tự cấu trúc hóa dữ liệu vào bảng tính hoặc kéo thả luồng thủ công, **AI Workflow Platform v3** cho phép người dùng mô tả công việc hoàn toàn bằng **ngôn ngữ tự nhiên** (tiếng Việt/Anh) qua giao diện Chat:

1. **Hiểu ý định & Khảo sát bối cảnh (Chat Mode):** AI tự động tìm kiếm thông tin cần thiết (`search_boards`, `search_members`, `search_channels`) có giới hạn (`limit <= 10`) và hỏi làm rõ nếu thông tin chưa đầy đủ.
2. **Lập kế hoạch đa bước minh bạch (Plan Mode):** Sinh toàn bộ kế hoạch (DAG) liên dịch vụ trong 1 lần gọi duy nhất với **Thinking Layer (Chain-of-Thought)** và kiểm định qua **Validation 4 lớp**.
3. **Người dùng toàn quyền kiểm soát (Human-in-the-Loop):** Xem trước bản kế hoạch (Preview Card), duyệt, chỉnh sửa bằng chat, hoặc hủy bỏ trước khi bất kỳ tác vụ ghi nào diễn ra.
4. **Thực thi an toàn tuyệt đối (Execution Engine):** Chạy tuần tự, phân giải tham chiếu chéo (`$ref`, `$template`), khóa lạc quan (Optimistic Locking), và phân loại trạng thái `UNKNOWN` không tự ý retry khi gặp sự cố mạng/5xx ở lệnh ghi.

---

## 2. Tài liệu thiết kế & Kế hoạch thi công

Trước khi phát triển, tất cả thành viên và AI Agents cần đọc kỹ các tài liệu nền tảng đã qua 2 vòng phản biện chuyên sâu:

| Tài liệu | Đường dẫn | Nội dung chính |
|---|---|---|
| 📄 **Báo cáo Kỹ thuật Dự án** | [`docs/PROJECT-REPORT.md`](docs/PROJECT-REPORT.md) | Tổng quan toàn cảnh: mục tiêu, kiến trúc, AI planner, execution engine, tiến độ. |
| 📐 **Đặc tả Thiết kế v3** | [`docs/superpowers/specs/2026-09-29-ai-workflow-platform-v3-design.md`](docs/superpowers/specs/2026-09-29-ai-workflow-platform-v3-design.md) | Kiến trúc 2 chế độ, catalog 11 tools Trello+Slack, 4-layer validation, state machine, DB schema 6 tables. |
| 📋 **Kế hoạch Triển khai (28 Tasks TDD)** | [`docs/superpowers/plans/2026-09-29-ai-workflow-platform-v3.md`](docs/superpowers/plans/2026-09-29-ai-workflow-platform-v3.md) | Lộ trình chi tiết từng task, interface rõ ràng, test đỏ → code → test xanh, không test mock hình thức. |
| 🤝 **Quy ước Làm việc Nhóm & Git** | [`docs/team-workflow.md`](docs/team-workflow.md) | Phân chia quyền sở hữu module (Module Ownership) để chống conflict, conventional commits, nhánh Git. |
| 🤖 **Quy tắc cho AI Agents** | [`AGENTS.md`](AGENTS.md) | Ranh giới kỹ thuật, tiêu chuẩn kiểm thử, và quy trình nghiệm thu dành cho mọi AI coding assistant. |

---

## 3. Cấu trúc Monorepo

Repository sử dụng mô hình Monorepo với ranh giới phân tách trách nhiệm chặt chẽ:

```text
ATI_Project/
├── packages/
│   ├── tool-schemas/       ← [MỚI v3] Schema & types chuẩn cho tools (shared contract)
│   ├── tool-adapters/      ← [MỚI v3] SDK adapters (Trello, Slack), mã hóa AES-256-GCM, rate limiter
│   ├── planner/            ← [MỚI v3] AI Planner core: Router, Working Memory, 4-layer validator
│   ├── executor/           ← [MỚI v3] Sequential executor: $ref resolver, ACID transactions, UNKNOWN safety
│   ├── dsl/                ← [Legacy v2] DSL cũ (giữ nguyên làm tài liệu tham khảo)
│   └── engine/             ← [Legacy v2] Engine cũ (giữ nguyên làm tài liệu tham khảo)
├── apps/
│   ├── chat-api/           ← [MỚI v3] Backend Express: Auth JWT, Ingestion 202, SSE stream sequence
│   ├── chat-web/           ← [MỚI v3] Frontend React 19 + Tailwind + fetch-event-source
│   ├── api/                ← [Legacy v2] Backend cũ (lưu trữ)
│   └── web/                ← [Legacy v2] Frontend cũ (lưu trữ)
├── db/
│   ├── v3/                 ← [MỚI v3] Schema PostgreSQL v3 (6 tables, 4 FK indexes)
│   └── migrations/         ← [Legacy v2] Migrations 0001-0014
├── prompts/                ← [MỚI v3] System prompts có đánh phiên bản (v001, v002...)
├── evaluations/            ← [MỚI v3] Bộ 50 Golden Prompts đo lường chất lượng AI
├── docs/                   ← Specs, plans, evidence, và hướng dẫn vận hành
└── vitest.workspace.ts     ← Cấu hình test đa package cho toàn monorepo
```

---

## 4. Bắt đầu phát triển (Quick Start)

### Yêu cầu môi trường:
- **Node.js:** `>= 22.12.0` (khuyên dùng Node 22 LTS hoặc Node 24)
- **Docker & Docker Compose:** Để chạy PostgreSQL
- **Git**

### 1. Cài đặt dependencies:
```powershell
npm install
```

### 2. Cấu hình môi trường:
Sao chép template cấu hình và điền các API key:
```powershell
cp .env.example .env
```
Các biến môi trường bắt buộc:
- `DATABASE_URL`: Chuỗi kết nối PostgreSQL (VD: `postgresql://postgres:postgres@localhost:5432/ati_v3`)
- `JWT_SECRET`: Khóa bí mật ký token đăng nhập (tối thiểu 32 ký tự)
- `ENCRYPTION_KEY`: Khóa 32-byte mã hóa AES-256-GCM cho credentials
- `GEMINI_API_KEY`: Google Gemini API Key (sử dụng model `gemini-1.5-pro`)

### 3. Chạy kiểm tra toàn bộ hệ sinh thái v3:
```powershell
npm run test:v3
```

---

## 5. Nguyên tắc an toàn & Cam kết kỹ thuật

1. **Plan-then-Execute:** Tuyệt đối không gọi lệnh ghi (side-effect) tự phát. Mọi hành động ghi phải nằm trong Plan được hiển thị rõ ràng trên UI và chờ người dùng bấm **[Duyệt]**.
2. **Không ảo giác ID:** Mọi ID đối tượng (Board ID, List ID, Member ID, Channel ID) phải được khảo sát thật từ hệ thống và nạp vào **Working Memory** trước khi lập kế hoạch.
3. **Bảo vệ rủi ro ghi (Write Safety):** Bất kỳ lệnh ghi nào bị timeout hoặc trả về lỗi 5xx đều được đánh dấu trạng thái `UNKNOWN`. Hệ thống tạm dừng ngay lập tức để người dùng kiểm tra thực tế, không bao giờ retry mù gây trùng lặp dữ liệu.
4. **Bảo vệ xung đột đồng thời (Optimistic Locking):** API duyệt kế hoạch sử dụng mệnh đề `WHERE id = $1 AND status = 'pending'` để triệt tiêu hoàn toàn lỗi double-click gây thực thi 2 lần.
5. **Độc lập thông tin xác thực (Allowed Scope):** Quản trị viên chỉ định rõ danh sách Board/Channel được phép truy cập, ngăn ngừa rò rỉ dữ liệu ngoài phạm vi cho phép.
