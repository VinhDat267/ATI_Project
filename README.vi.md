# ATI: Nền tảng tự động hoá quy trình bằng AI

[English](README.md) · **Tiếng Việt**

[![v3 check](https://github.com/VinhDat267/ATI_Project/actions/workflows/v3-check.yml/badge.svg)](https://github.com/VinhDat267/ATI_Project/actions/workflows/v3-check.yml)
![Node.js](https://img.shields.io/badge/node-%5E22.12%20%7C%7C%20%3E%3D24-339933)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6)

Mô tả công việc bằng một câu tiếng Việt hoặc tiếng Anh. ATI tìm đúng bảng, kênh, repository, lập kế hoạch nhiều bước trên các công cụ đã kết nối, và chỉ chạy sau khi bạn duyệt.

ATI là đồ án đề tài #26 của môn ATI (2026), do một nhóm nhỏ làm cùng các AI coding agent. Mã hiện tại là **v3**: chat agent điều phối công cụ theo kiểu lập kế hoạch rồi mới thực thi (plan-then-execute).

| Duyệt kế hoạch | Biên nhận |
|---|---|
| ![Kế hoạch 3 bước chờ duyệt](docs/images/plan-review.png) | ![Biên nhận sau khi chạy trên GitHub, Trello và Slack](docs/images/receipt.png) |
| **Trang giới thiệu** | **Kết nối dịch vụ** |
| ![Trang giới thiệu](docs/images/landing.png) | ![Trang kết nối dịch vụ](docs/images/settings.png) |

*Ảnh chụp ở chế độ thử nghiệm (sandbox): kế hoạch soạn sẵn, không gọi dịch vụ thật.*

## Mục lục

- [Cách hoạt động](#cách-hoạt-động)
- [Dịch vụ hỗ trợ](#dịch-vụ-hỗ-trợ)
- [Công nghệ](#công-nghệ)
- [Cấu trúc repository](#cấu-trúc-repository)
- [Bắt đầu](#bắt-đầu)
- [Kiểm thử](#kiểm-thử)
- [Trạng thái dự án](#trạng-thái-dự-án)
- [Làm việc trong repository](#làm-việc-trong-repository)
- [Tài liệu](#tài-liệu)

## Cách hoạt động

```mermaid
flowchart LR
  U([Tin nhắn người dùng]) --> R[Router<br/>luật từ khoá]
  R --> P[Planner<br/>nạp trước tài nguyên,<br/>LLM + tool tra cứu]
  P --> V[Validator<br/>json · schema · semantic<br/>security · grounding]
  V -->|kế hoạch + hash SHA-256| DB[(PostgreSQL)]
  DB --> W[Duyệt kế hoạch<br/>trên chat-web]
  W -->|duyệt| E[Executor<br/>tuần tự, $ref / $template]
  E --> A[Tool adapter<br/>allowlist, rate limit]
  A --> S([Trello · Slack · GitHub · Sheets<br/>Calendar · Notion · Telegram · Jira])
  E -.->|tiến độ qua SSE| W
```

1. **Hiểu yêu cầu.** Router dùng luật từ khoá để chọn các dịch vụ liên quan. Planner nạp trước danh sách tài nguyên được phép, và model có thể gọi các tool tra cứu (chỉ đọc) để đổi tên thành ID thật. Yêu cầu chưa rõ hoặc chỉ đọc thì ATI hỏi lại, không đoán.
2. **Lập kế hoạch.** Model trả toàn bộ kế hoạch trong một lần trả lời. Validator kiểm 5 lớp: JSON, schema, ngữ nghĩa, an toàn và grounding (mọi ID phải đến từ kết quả tra cứu hoặc từ chính câu của người dùng). Kế hoạch không có bước ghi nào bị từ chối.
3. **Duyệt.** Kế hoạch được lưu kèm hash SHA-256 và hết hạn sau 30 phút. Người dùng thấy từng bước và nơi sẽ ghi, rồi duyệt, huỷ hoặc sửa qua chat. Lệnh duyệt là compare-and-set trên `status = 'pending'`, nên bấm hai lần không chạy kế hoạch hai lần.
4. **Thực thi.** Các bước chạy tuần tự. Kết quả bước trước đi vào bước sau qua `$ref` và `$template`; timeout dùng `AbortSignal` thật; tiến độ đẩy về trình duyệt qua SSE.

**An toàn khi ghi.** Lệnh ghi hết thời gian chờ hoặc lỗi mà không rõ kết quả thì bước đó thành `unknown` và kế hoạch tạm dừng. ATI không bao giờ tự thử lại lệnh ghi đó. Người dùng kiểm tra dịch vụ thật rồi chọn bỏ qua bước hoặc dừng kế hoạch. Sau khi khởi động lại, các kế hoạch đang chạy dở được đối soát theo cùng cách trước khi API nhận request.

## Dịch vụ hỗ trợ

Catalog có 33 tool trên 8 dịch vụ: 19 tool đọc, 14 tool ghi.

| Dịch vụ | Số tool | Lệnh ghi tiêu biểu |
|---|---:|---|
| Trello | 9 | tạo/cập nhật thẻ, gán thành viên, thêm checklist |
| GitHub | 5 | tạo issue, gắn nhãn |
| Google Sheets | 4 | thêm dòng |
| Notion | 4 | tạo trang, thêm đoạn văn |
| Jira | 4 | tạo issue, thêm bình luận |
| Google Calendar | 3 | tạo sự kiện (không mời người khác) |
| Slack | 2 | gửi tin nhắn |
| Telegram | 2 | gửi tin nhắn |

Mỗi adapter từ chối tài nguyên nằm ngoài allowlist do quản trị viên cấu hình. Khoá dịch vụ được mã hoá AES-256-GCM khi lưu. Mức nghiệm thu của từng dịch vụ (sandbox, chạy thật qua script, chạy thật qua giao diện) ghi ở [CURRENT-STATE](docs/handoff/CURRENT-STATE.md).

## Công nghệ

| Tầng | Công nghệ |
|---|---|
| Frontend | React 19, Vite 8, Tailwind CSS 4, Zustand, `fetch-event-source` |
| Backend | Node.js 22+, Express 5, PostgreSQL 16 (`pg`), Nodemailer |
| AI | Gemini (`@google/genai`) hoặc gateway tương thích OpenAI; hiện dùng `ag/gemini-3.8-flash` qua 9router chạy ở máy |
| Xác thực | Access token JWT + refresh token xoay vòng lưu dạng SHA-256, xác minh email có quản trị viên duyệt, Google OIDC (PKCE) |
| Kiểm thử | Vitest, Testing Library, Playwright (Chromium) trên PostgreSQL thật |
| Công cụ | npm workspaces, TypeScript 5, GitHub Actions |

## Cấu trúc repository

```text
ATI_Project/
├── apps/
│   ├── chat-api/        API Express: xác thực, hội thoại, duyệt, thực thi, SSE
│   └── chat-web/        App React: giới thiệu, đăng nhập, cockpit, kết nối, lịch sử, cẩm nang
├── packages/
│   ├── tool-schemas/    Kiểu dùng chung, catalog tool, registry dịch vụ
│   ├── tool-adapters/   Mỗi dịch vụ một adapter, allowlist, mã hoá, rate limit
│   ├── planner/         Router, working memory, prompt, provider, validator
│   └── executor/        Executor tuần tự, $ref/$template, timeout, trạng thái unknown
├── db/v3/               Migration PostgreSQL 0001–0008 (11 bảng) và script chạy
├── evaluations/         Golden set, chấm điểm offline, chạy thật có kiểm soát
├── scripts/             Launcher, script chạy test, OIDC giả cho test
├── docs/                Đặc tả, kế hoạch, bàn giao, bản mẫu giao diện, bằng chứng
└── compose.v3.yaml      PostgreSQL 16 cho máy cá nhân
```

Mã v1/v2 đã xoá khỏi `main` ngày 05/10/2026. Tag `archive/v2-final` giữ ảnh chụp cuối; đọc một file bằng `git show archive/v2-final:<đường dẫn>`.

## Bắt đầu

### Yêu cầu

- Node.js `^22.12` hoặc `>=24`, npm
- Docker có Compose (để chạy PostgreSQL)
- Chromium cho test browser: chạy `npx playwright install chromium` một lần

### 1. Cài đặt và cấu hình

```bash
npm ci
cp .env.example .env        # PowerShell: Copy-Item .env.example .env
```

Git bỏ qua `.env`. Không commit file này, không dán giá trị trong đó vào log, issue hay PR.

### 2. Chạy sandbox có PostgreSQL (khuyến nghị)

Chế độ sandbox dùng planner soạn sẵn và phản hồi dịch vụ giả, nên không gọi model hay dịch vụ thật nào.

```bash
npm run db:up:v3            # PostgreSQL 16 tại 127.0.0.1:55533
```

Trong `.env`, giữ `RUNTIME_MODE=sandbox` và đặt:

```dotenv
DATABASE_URL=postgresql://ati_v3:ati_v3_local_only@127.0.0.1:55533/ati_v3
CHAT_ADMIN_EMAIL=admin@localhost.test
CHAT_ADMIN_PASSWORD=<mật khẩu cục bộ, ít nhất 12 ký tự>
```

Sau đó migrate, tạo tài khoản (một lần) và chạy app:

```bash
npm run db:migrate:local:v3
npm run admin:provision:local:v3
npm run up:local:v3
```

Mở <http://127.0.0.1:5174> và đăng nhập bằng `CHAT_ADMIN_*`. API health ở <http://127.0.0.1:3000/api/health>. `npm run db:down:v3` dừng container và giữ volume dữ liệu.

Các lệnh `:local:v3` từ chối chạy nếu `DATABASE_URL` không trỏ đúng container cục bộ này. Trên Windows, nếu cổng 55533 nằm trong dải cổng hệ thống đã giữ, đặt `V3_LOCAL_DB_PORT` sang cổng khác (ví dụ 56533) và dùng cổng đó trong `DATABASE_URL`. Chi tiết: [V3-LOCAL-SETUP](docs/V3-LOCAL-SETUP.md).

### Xem nhanh không cần database

Giữ `DATABASE_URL` như trong `.env.example` (trỏ tới cổng không mở, nên dữ liệu chỉ nằm trong bộ nhớ), đặt `SANDBOX_USER_EMAIL` và `SANDBOX_USER_PASSWORD`, rồi chạy `npm run up`.

### Chế độ live

Chế độ live gọi model thật và dịch vụ thật. Cần:

- PostgreSQL thật trong `DATABASE_URL`;
- `JWT_SECRET` (ít nhất 32 byte) và `ENCRYPTION_KEY` (32 byte hoặc 64 ký tự hex);
- một LLM: `GEMINI_API_KEY`, hoặc `LLM_PROVIDER=openai-compatible` kèm `LLM_BASE_URL`, `LLM_API_KEY` và đúng một `LLM_MODEL` cố định;
- `CHAT_ADMIN_*`, rồi chạy `npm run db:migrate:v3` và `npm run admin:provision:v3`.

Khởi động bằng `RUNTIME_MODE=live npm run up`. Thiếu cấu hình bắt buộc thì live từ chối khởi động. SMTP và Google OAuth là tuỳ chọn; xem chú thích trong [`.env.example`](.env.example) và mục "Through the app" của [evaluations/README.md](evaluations/README.md). Thêm khoá dịch vụ và allowlist tài nguyên ở trang **Kết nối dịch vụ**. Chỉ ghi lên dịch vụ thật qua kế hoạch bạn đã xem kỹ, và dùng bảng, kênh, repository dành cho thử nghiệm.

## Kiểm thử

| Lệnh | Nội dung |
|---|---|
| `npm run check` | Typecheck, unit và integration test của cả sáu workspace, test bộ đánh giá offline, build web, quét bản build tìm bí mật, test launcher và env |
| `npm run test:browser:v3` | E2E Playwright trên API, web và PostgreSQL thật, 11 kịch bản sandbox. Cần database đã tạo tài khoản (bước 2 ở trên) |
| `npm run check:local:v3` | `check`, kèm kiểm `DATABASE_URL` là container cục bộ |

CI ([`v3-check.yml`](.github/workflows/v3-check.yml)) chạy `npm ci`, migration, `npm run check` và bộ browser trên một PostgreSQL 16 mới cho mỗi pull request và mỗi lần đẩy lên `main`.

Tính đến 11/10/2026 (CI trên `828c21a`): **1.674** unit và integration test, **173** test bộ đánh giá, **101** test browser qua 11 kịch bản (thêm một ca bỏ qua có chủ đích).

Chạy riêng một test browser (Playwright tự khởi động server theo config):

```bash
node node_modules/playwright/cli.js test --config apps/chat-web/playwright.config.ts --grep "FE-11:"
```

## Trạng thái dự án

[`docs/handoff/CURRENT-STATE.md`](docs/handoff/CURRENT-STATE.md) là nguồn chuẩn cho trạng thái, số liệu đo và lỗi đã biết; mỗi số liệu ở đó có ngày và commit. Tóm tắt tính đến 11/10/2026:

- **Đã xong:** adapter cho cả 8 dịch vụ; tài khoản (đăng ký email có quản trị viên duyệt, Gmail SMTP, đăng nhập Google, quản lý phiên); giao diện mới (FE-04 → FE-11).
- **Đã đo với model thật** (08/10/2026, mỗi bộ 3 lần): bộ cơ bản 150/150 đúng, câu tự do 52/54, đa dịch vụ 129/132.
- **Chưa đạt:** mục tiêu p95 dưới 15 giây cho yêu cầu đa dịch vụ (hiện 20,1 s). Tỉ lệ kế hoạch dùng được với người dùng thật chưa đo.
- **Tiếp theo:** đường LLM dự phòng (W4-00), chạy thật 5 dịch vụ mới qua giao diện (W3-11), các phép đánh giá tuần 4. Xem [lộ trình](docs/handoff/ROADMAP.md).

Chưa tuyên bố sẵn sàng cho production.

## Làm việc trong repository

Nhiều người và AI agent (Codex, Claude Code và các agent khác) cùng làm ở đây, và không ai nhớ phiên làm việc của người khác. Trí nhớ chung nằm trong [`docs/handoff/`](docs/handoff/README.md).

1. **Trước khi làm**, đọc `CURRENT-STATE.md` và 3 file mới nhất trong `docs/handoff/log/`, rồi chạy `git status`. Nếu thư mục có thay đổi không phải của bạn, làm trong một `git worktree` riêng.
2. **Nhận một task card** trong [`docs/handoff/tasks/`](docs/handoff/tasks/), làm trên nhánh riêng. Viết test fail trước. Logic database test trên PostgreSQL thật, timeout test bằng `AbortSignal` thật; không mock hình thức.
3. **Khi xong**, điền phần kết quả của task card và thêm một file mới trong `docs/handoff/log/` ngay trong PR đó. Không sửa `CURRENT-STATE.md` hay `ROADMAP.md`; reviewer cập nhật sau khi merge.
4. **Review và merge.** Reviewer độc lập chạy lại test theo [`REVIEW-CHECKLIST.md`](docs/handoff/REVIEW-CHECKLIST.md). PR chỉ merge khi CI xanh và review đạt.

Quy ước:

- Conventional Commits; chỉ `git add` đúng các file của task.
- Mô tả PR theo [mẫu](.github/pull_request_template.md), có file đã sửa, output test thật và commit hash.
- Sở hữu module và chiến lược nhánh: [`docs/team-workflow.md`](docs/team-workflow.md). Quy tắc cho AI agent: [`AGENTS.md`](AGENTS.md).
- Repository công khai: không commit `.env`, token, bằng chứng chạy thật (`docs/ai-evidence/V3-LIVE-EXECUTION/`, `docs/ai-evidence/AUTH-LIVE/`) hay báo cáo môn học.

## Tài liệu

| Tài liệu | Nội dung |
|---|---|
| [CURRENT-STATE](docs/handoff/CURRENT-STATE.md) | Dự án đang ở đâu: số liệu, PR mới merge, lỗi đã biết, quyết định đã chốt |
| [ROADMAP](docs/handoff/ROADMAP.md) và [task card](docs/handoff/tasks/) | Việc tiếp theo và tiêu chí nghiệm thu từng task |
| [Đặc tả v3](docs/superpowers/specs/2026-09-29-ai-workflow-platform-v3-design.md) | Chuẩn về hành vi, luồng xử lý, catalog tool và schema |
| [Đặc tả giao diện mới](docs/superpowers/specs/2026-10-05-ui-redesign-agentic-design.md) và [design system](docs/design/design-system.md) | Giao diện Agentic và 12 bản mẫu |
| [Phạm vi đa dịch vụ](docs/MULTI-SERVICE-SCOPE.md) | Tiêu chí nghiệm thu khi thêm dịch vụ |
| [Đánh giá](evaluations/README.md) | Golden set, cách chấm, chạy thật có kiểm soát |
| [Môi trường cục bộ](docs/V3-LOCAL-SETUP.md) | Từng bước dựng sandbox PostgreSQL |
| [Chỉ mục tài liệu](docs/README.md) | Các tài liệu còn lại, gồm tài liệu đề tài ban đầu |

Dự án chưa chọn giấy phép mã nguồn mở.
