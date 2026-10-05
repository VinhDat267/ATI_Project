# AI Workflow Automation Platform (v3)

> **Đề tài #26:** Nền tảng tự động hóa quy trình làm việc bằng Trí tuệ Nhân tạo  
> **Kiến trúc v3:** Chat Agent + Tool Orchestration (Plan-then-Execute)  
> **Ngôn ngữ & Nền tảng:** TypeScript Monorepo (Node.js 22+, React 19, PostgreSQL, Docker)  
> **Trạng thái kiểm chứng:** số liệu mới nhất, ngày đo và giới hạn nằm ở [`docs/handoff/CURRENT-STATE.md`](docs/handoff/CURRENT-STATE.md). Production readiness chưa được xác nhận.

---

## 1. Tầm nhìn & Giá trị cốt lõi

**Phạm vi sản phẩm:** nền tảng lập kế hoạch và thực thi workflow trên nhiều dịch vụ bên ngoài đã được tích hợp và cấp quyền. Một workflow có thể phối hợp quản lý công việc, nhắn tin, mã nguồn, bảng tính và các dịch vụ khác qua catalog công cụ chung. Trello và Slack là hai tích hợp đầu tiên, không phải giới hạn của đề tài.

**Hiện trạng mở rộng:** catalog có 33 tool trên 8 dịch vụ (Trello, Slack, GitHub, Google Sheets, Google Calendar, Notion, Telegram, Jira), dùng chung registry, adapter, allowlist tài nguyên và API/UI cấu hình theo metadata. Mức nghiệm thu của từng dịch vụ (sandbox, chạy thật qua script, chạy thật qua giao diện) ghi ở [CURRENT-STATE](docs/handoff/CURRENT-STATE.md) và [phạm vi đa dịch vụ](docs/MULTI-SERVICE-SCOPE.md).

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
| 📐 **Đặc tả Thiết kế v3** | [`docs/superpowers/specs/2026-09-29-ai-workflow-platform-v3-design.md`](docs/superpowers/specs/2026-09-29-ai-workflow-platform-v3-design.md) | Kiến trúc 2 chế độ, catalog công cụ mở rộng, 4-layer validation, state machine, DB schema 6 tables. |
| 📋 **Kế hoạch Triển khai** | [`docs/superpowers/plans/2026-09-29-ai-workflow-platform-v3.md`](docs/superpowers/plans/2026-09-29-ai-workflow-platform-v3.md) | 28 tasks nền ban đầu; Phase 7 có bằng chứng sandbox nhưng gate live còn mở. |
| 🤝 **Quy ước Làm việc Nhóm & Git** | [`docs/team-workflow.md`](docs/team-workflow.md) | Phân chia quyền sở hữu module (Module Ownership) để chống conflict, conventional commits, nhánh Git. |
| 🤖 **Quy tắc cho AI Agents** | [`AGENTS.md`](AGENTS.md) | Ranh giới kỹ thuật, tiêu chuẩn kiểm thử, và quy trình nghiệm thu dành cho mọi AI coding assistant. |

---

## 3. Cấu trúc Monorepo

Repository sử dụng mô hình Monorepo với ranh giới phân tách trách nhiệm chặt chẽ:

```text
ATI_Project/
├── packages/
│   ├── tool-schemas/       ← Schema & types chuẩn cho tools (shared contract), service registry
│   ├── tool-adapters/      ← Adapter 8 dịch vụ, mã hóa AES-256-GCM, allowlist, rate limiter
│   ├── planner/            ← AI Planner: router, working memory, prompt (src/prompts), validator
│   └── executor/           ← Sequential executor: $ref/$template resolver, timeout, UNKNOWN safety
├── apps/
│   ├── chat-api/           ← Backend Express: auth/phiên, hội thoại, approval, thực thi, SSE
│   └── chat-web/           ← Frontend React 19 + Tailwind + fetch-event-source
├── db/v3/                  ← Migrations PostgreSQL v3
├── evaluations/            ← Golden set, chạy thật có kiểm soát (live-execution, live-app)
├── scripts/                ← Launcher, runner test/browser, OIDC giả cho test
├── docs/                   ← Đặc tả, kế hoạch, handoff giữa các agent, bằng chứng v3
├── compose.v3.yaml         ← PostgreSQL 16 cho phát triển cục bộ
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
npm ci
```

### 2. Cấu hình môi trường:
Sao chép template vào file `.env` được Git bỏ qua. Mặc định là `RUNTIME_MODE=sandbox` với PostgreSQL trỏ vào cổng loopback không mở để dùng bộ nhớ tạm; không gọi Gemini/GitHub/Trello/Slack thật:
```powershell
Copy-Item .env.example .env
```

Để **đăng nhập và dùng giao diện sandbox**, điền cả `SANDBOX_USER_EMAIL` (một email bạn chọn) và `SANDBOX_USER_PASSWORD` (mật khẩu cục bộ bạn chọn) trong `.env`; không commit file này. Sandbox chỉ lắng nghe trên `127.0.0.1` và tạo JWT secret riêng cho mỗi lần chạy nếu bạn để trống biến đó. Để chạy `RUNTIME_MODE=live`, thay URL sandbox bằng PostgreSQL thật, đặt `JWT_SECRET` (ít nhất 32 byte), `ENCRYPTION_KEY` (32 byte hoặc 64 ký tự hex), `GEMINI_API_KEY` thật và `CHAT_ADMIN_EMAIL`/`CHAT_ADMIN_PASSWORD` (ít nhất 12 ký tự); sau đó chạy `npm run db:migrate:v3` và `npm run admin:provision:v3` trước khi khởi động. Live sẽ từ chối khởi động nếu thiếu cấu hình hoặc không kết nối được DB; việc kiểm thử nhà cung cấp thật vẫn chưa được nghiệm thu.

Để chạy **sandbox có PostgreSQL thật** (khuyến nghị khi kiểm thử v3), làm theo [hướng dẫn môi trường v3](docs/V3-LOCAL-SETUP.md): dùng container/cổng riêng `55533`, migrate và tạo tài khoản cục bộ.

Trong Settings, GitHub nhận personal access token và allowlist repository dạng `owner/repo`. Lệnh đọc/ghi issue chỉ được gửi tới repository đã cấu hình. Kết nối được kiểm tra qua lệnh đọc `/user`; điều đó chưa xác nhận token có quyền ghi issue. Theo [GitHub REST API](https://docs.github.com/en/rest/issues/issues), tạo issue cần quyền Issues write trên repository đích.

### 3. Chạy API và web v3:
```powershell
npm run up
```
Web: `http://127.0.0.1:5174`; API health: `http://127.0.0.1:3000/api/health`. Dừng bằng Ctrl+C. Có thể chạy riêng `npm run api:dev` và `npm run web:dev`.

### 4. Kiểm tra mã v3:
```powershell
npm run check
```
`check` chạy typecheck, 6 workspace test suites, build web và smoke test khởi động API/web sandbox; không chứng minh triển khai production hoặc chất lượng AI live.

Sau khi tạo tài khoản PostgreSQL sandbox theo hướng dẫn setup v3, chạy `npm run test:browser:v3` để kiểm tra các luồng chính bằng Chromium, API/web thật và trạng thái DB. Bằng chứng và giới hạn được ghi tại [phạm vi đa dịch vụ](docs/MULTI-SERVICE-SCOPE.md) và [Phase 6 sandbox browser evidence](docs/audits/2026-09-29-v3-review/PHASE6-SANDBOX-BROWSER.md).

CI v3 chạy `npm ci`, migration, `npm run check` và browser E2E trên PostgreSQL 16 riêng cho mỗi job tại [v3-check.yml](.github/workflows/v3-check.yml). Chạy CI từ GitHub vẫn cần xác nhận sau khi push.

Mã và tài liệu v1/v2 đã được xoá khỏi `main` ngày 05/10/2026; ảnh chụp trước khi xoá là tag `archive/v2-final`. Xem [chỉ mục tài liệu](docs/README.md).

---

## 5. Nguyên tắc an toàn & Cam kết kỹ thuật

1. **Plan-then-Execute:** Tuyệt đối không gọi lệnh ghi (side-effect) tự phát. Mọi hành động ghi phải nằm trong Plan được hiển thị rõ ràng trên UI và chờ người dùng bấm **[Duyệt]**.
2. **Không ảo giác ID:** Mọi ID đối tượng (Board ID, List ID, Member ID, Channel ID) phải được khảo sát thật từ hệ thống và nạp vào **Working Memory** trước khi lập kế hoạch.
3. **Bảo vệ rủi ro ghi (Write Safety):** Bất kỳ lệnh ghi nào bị timeout hoặc trả về lỗi 5xx đều được đánh dấu trạng thái `UNKNOWN`. Hệ thống tạm dừng ngay lập tức để người dùng kiểm tra thực tế, không bao giờ retry mù gây trùng lặp dữ liệu.
4. **Bảo vệ xung đột đồng thời (Optimistic Locking):** API duyệt kế hoạch sử dụng mệnh đề `WHERE id = $1 AND status = 'pending'` để triệt tiêu hoàn toàn lỗi double-click gây thực thi 2 lần.
5. **Độc lập thông tin xác thực (Allowed Scope):** Quản trị viên chỉ định rõ danh sách Board/Channel được phép truy cập, ngăn ngừa rò rỉ dữ liệu ngoài phạm vi cho phép.
