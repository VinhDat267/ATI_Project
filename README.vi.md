<div align="center">

# Planora

**Tự động hoá quy trình trên các công cụ của nhóm bằng một câu chat, mọi lệnh ghi đều chờ người duyệt.**

[English](README.md) · **Tiếng Việt**

[![v3 check](https://github.com/VinhDat267/ATI_Project/actions/workflows/v3-check.yml/badge.svg)](https://github.com/VinhDat267/ATI_Project/actions/workflows/v3-check.yml)
![Node.js](https://img.shields.io/badge/node-%5E22.12%20%7C%7C%20%3E%3D24-339933?logo=nodedotjs&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?logo=postgresql&logoColor=white)

</div>

Planora biến một yêu cầu viết bằng tiếng Việt hoặc tiếng Anh thành một quy trình nhiều bước trên Trello, GitHub, Slack, Jira, Notion, Google Workspace và Telegram. Câu hỏi chỉ đọc được trả lời ngay. Việc nào ghi ra dịch vụ ngoài thì Planora lập kế hoạch, và chỉ chạy sau khi bạn duyệt đúng các bước và nơi nhận. Lịch bản tin định kỳ gửi tóm tắt từ các nguồn đã kết nối vào Slack hoặc Telegram.

Planora là bản v3 của đồ án đề tài #26, môn ATI (2026).

| Trước khi duyệt | Sau khi chạy |
| --- | --- |
| ![Kế hoạch 3 bước GitHub, Trello và Slack đang chờ duyệt](docs/images/plan-review.png) | ![Biên nhận kết quả từng bước](docs/images/receipt.png) |
| **Trang giới thiệu** | **Kết nối dịch vụ** |
| ![Trang giới thiệu Planora](docs/images/landing.png) | ![Trang kết nối dịch vụ](docs/images/settings.png) |

<sub>Ảnh chụp ở chế độ sandbox: dữ liệu mẫu và phản hồi dịch vụ giả lập, không gọi API thật.</sub>

## Mục lục

- [Điểm nổi bật](#điểm-nổi-bật)
- [Ví dụ](#ví-dụ)
- [Dịch vụ hỗ trợ](#dịch-vụ-hỗ-trợ)
- [Cách hoạt động](#cách-hoạt-động)
- [Cam kết an toàn](#cam-kết-an-toàn)
- [Công nghệ](#công-nghệ)
- [Bắt đầu](#bắt-đầu)
- [Cấu trúc repository](#cấu-trúc-repository)
- [Kiểm thử và đánh giá](#kiểm-thử-và-đánh-giá)
- [Trạng thái dự án](#trạng-thái-dự-án)
- [Đóng góp](#đóng-góp)
- [Tài liệu](#tài-liệu)
- [Giấy phép](#giấy-phép)

## Điểm nổi bật

- **Lập kế hoạch, xem trước, duyệt, rồi mới chạy.** Mọi lệnh ghi gắn với hash SHA-256 của đúng kế hoạch bạn đã xem (`plan_hash`). Không có đường nào ghi mà không qua duyệt.
- **Dựa trên tài nguyên thật của bạn.** Planner đổi các tên như "bảng Sprint" hay "#ati-test" thành ID thật bằng tool tra cứu chỉ đọc, và hỏi lại thay vì đoán.
- **Nhiều bước, xuyên dịch vụ.** Bước sau dùng kết quả bước trước qua `$ref` và `$template`, nên thẻ Trello có thể chứa link issue GitHub vừa tạo ở bước trước.
- **Xử lý lỗi trung thực.** Lệnh ghi không rõ kết quả sẽ dừng lượt chạy ở `needs_attention`. Planora không bao giờ tự gửi lại.
- **Bản tin định kỳ và trigger.** Bản tin hằng ngày hoặc hằng tuần từ Trello, GitHub, Jira, Sheets, Calendar và Gmail gửi vào Slack hoặc Telegram, cùng trigger nhắc họp và theo dõi thay đổi trên Google Calendar.
- **Workspace cá nhân và tổ chức.** Kết nối OAuth cá nhân chỉ thuộc về chủ của nó; kết nối tổ chức bị giới hạn trong một workspace và một allowlist tài nguyên rõ ràng.
- **Chạy được không cần mạng.** Chế độ sandbox dùng dữ liệu mẫu, không cần khoá model hay thông tin đăng nhập dịch vụ, nên demo và test browser cho kết quả lặp lại được.

## Ví dụ

> Tạo issue GitHub, thẻ Trello và thông báo Slack.

Planora xem trước ba bước. Sau khi bạn duyệt, hệ thống tạo issue GitHub, thêm thẻ Trello có link tới issue đó, rồi gửi tin Slack chứa cả hai link. Biên nhận ghi lại kết quả và nơi nhận của từng bước.

Một số yêu cầu khác:

| Yêu cầu | Điều xảy ra |
| --- | --- |
| "Những thẻ nào trên bảng Sprint đã quá hạn?" | Trả lời chỉ đọc từ Trello, không cần duyệt |
| "Mỗi sáng thứ Hai gửi bản tin issue Jira quá hạn vào #ati-test" | Xem trước lịch bản tin hằng tuần, sau khi duyệt thì tự chạy |
| "Nhắc tôi 15 phút trước mỗi cuộc họp qua Telegram" | Xem trước trigger nhắc họp trên Google Calendar |
| "Soạn thư trả lời khách hàng và chờ tôi duyệt" | Soạn thư nháp Gmail và xem trước trước khi gửi |

## Dịch vụ hỗ trợ

Số tool là số tool khai báo trong [`packages/tool-schemas`](packages/tool-schemas/). Tập tool planner thực sự thấy còn tuỳ workspace, kết nối, tài nguyên đã chọn và các cờ tính năng trong `.env`.

| Dịch vụ | Kết nối | Tool (đọc / ghi) | Thao tác tiêu biểu |
| --- | --- | :---: | --- |
| Trello | OAuth cá nhân | 6 / 11 | Tìm bảng và thẻ; tạo, chuyển, cập nhật thẻ; nhãn, checklist |
| GitHub | OAuth cá nhân | 7 / 6 | Tìm issue và PR, tạo issue, bình luận, yêu cầu review |
| Slack | Bot dùng chung | 4 / 1 | Tìm kênh và người dùng, đọc tin và thread, gửi tin Block Kit |
| Slack (cá nhân) <sup>1</sup> | OAuth cá nhân | 8 / 1 | Đọc kênh và DM của chính bạn, trả lời thread có duyệt, hộp đề xuất |
| Telegram | Bot cá nhân | 2 / 1 | Đọc tin gần đây trong chat (lưu 24 giờ), gửi tin và bản tin |
| Jira | OAuth cá nhân (3LO) | 5 / 4 | Tìm project và issue; tạo, cập nhật, bình luận, chuyển trạng thái |
| Notion | Integration token hoặc OAuth | 6 / 5 | Tìm trang, truy vấn database, thêm block, bình luận |
| Google Sheets (tổ chức) | Service account | 5 / 4 | Đọc vùng ô, lọc và tổng hợp dòng, thêm và upsert |
| Google Sheets (cá nhân) <sup>1</sup> | OAuth cá nhân | 7 / 8 | Bảng tính chọn qua Picker, kèm tool Drive và Docs <sup>2</sup> |
| Google Calendar (cá nhân) <sup>1</sup> | OAuth cá nhân | 5 / 5 | Sự kiện lặp, RSVP, trigger nhắc họp và theo dõi thay đổi |
| Gmail <sup>1</sup> | OAuth cá nhân | 5 / 10 | Tìm và đọc thư, thư nháp, nhãn, trả lời, chuyển tiếp, chuyển vào thùng rác (không xoá vĩnh viễn) |

<sup>1</sup> Tắt mặc định; bật bằng cờ `*_ENABLED` và OAuth client riêng.
<sup>2</sup> Bốn tool ghi Drive và Docs vẫn bị chặn trừ khi `ENABLE_MYSHEETS_DRIVE_WRITE_TOOLS=on`.

Mức nghiệm thu live của từng dịch vụ được theo dõi ở [`docs/handoff/CURRENT-STATE.md`](docs/handoff/CURRENT-STATE.md).

## Cách hoạt động

```mermaid
flowchart LR
  U([Yêu cầu chat]) --> R[Router<br/>chọn dịch vụ]
  R --> G[Gather<br/>danh mục tài nguyên +<br/>tool tra cứu chỉ đọc]
  G -->|chỉ đọc| A([Câu trả lời hoặc<br/>câu hỏi làm rõ])
  G --> P[Planner<br/>LLM soạn kế hoạch]
  P --> V[Validator<br/>schema · ngữ nghĩa ·<br/>an toàn · grounding]
  V -->|kế hoạch + plan_hash| DB[(PostgreSQL)]
  DB --> W[Xem trước trên chat-web]
  W -->|người dùng duyệt| E[Executor<br/>chạy tuần tự,<br/>$ref / $template]
  E --> T[Tool adapter<br/>allowlist · rate limit]
  T --> S([Dịch vụ ngoài])
  E -.->|tiến độ qua SSE| W
```

1. **Định tuyến và thu thập.** Router chọn các dịch vụ liên quan từ yêu cầu. Planner nạp danh mục tài nguyên mà kết nối được phép chạm tới, và model gọi tool tra cứu chỉ đọc để đổi tên thành ID. Yêu cầu chỉ đọc được hỗ trợ thì trả lời ngay.
2. **Lập và kiểm tra kế hoạch.** Model trả toàn bộ kế hoạch trong một lần. Validator kiểm cấu trúc JSON, schema của tool, luật ngữ nghĩa, ràng buộc an toàn và grounding: mọi ID phải đến từ kết quả tra cứu hoặc từ chính câu của người dùng.
3. **Xem trước và duyệt.** Kế hoạch được lưu kèm hash SHA-256 và thời hạn. Bản xem trước hiện từng bước và nơi nhận. Lệnh duyệt là compare-and-set trên kế hoạch đang chờ, nên bấm hai lần cũng không chạy hai lần.
4. **Thực thi và báo cáo.** Các bước chạy tuần tự với timeout bằng `AbortSignal` thật. Tiến độ đẩy về trình duyệt qua Server-Sent Events, và biên nhận giữ kết quả của từng bước.
5. **Khôi phục.** Sau khi khởi động lại, các lượt đang chạy dở được đối soát trước khi API nhận request. Lệnh ghi không rõ kết quả chuyển sang `needs_attention`; người dùng kiểm tra dịch vụ thật rồi đánh dấu đã gửi hoặc chạy lượt mới.

## Cam kết an toàn

Các bất biến dưới đây được thực thi trong code và có test bao phủ. Thay đổi nào làm yếu chúng sẽ không được chấp nhận.

| Cam kết | Cơ chế |
| --- | --- |
| Không ghi khi chưa duyệt | Chỉ thực thi kế hoạch đã duyệt có `plan_hash` lưu trữ khớp với kế hoạch đã xem |
| Không tự gửi lại | Kết quả ghi không rõ (`unknown`) chuyển lượt chạy sang `needs_attention`; không gì tự gửi lại |
| Quyền tối thiểu | Adapter từ chối mọi tài nguyên ngoài allowlist của kết nối và workspace đang dùng |
| Cô lập credential | Credential cá nhân và tổ chức không bao giờ lẫn giữa các workspace; bí mật được mã hoá AES-256-GCM khi lưu |
| Đổi schema an toàn | Migration database chỉ thêm, chạy lại được; migration đã merge không bao giờ bị sửa |

Gửi tin ra Slack, Telegram và Gmail là "tối đa một lần", không phải "đúng một lần": khi không rõ kết quả, Planora dừng lại và hỏi thay vì liều gửi trùng.

## Công nghệ

| Tầng | Công nghệ |
| --- | --- |
| Web app | React 19, Vite 8, Tailwind CSS 4, Zustand, Server-Sent Events |
| API | Node.js, TypeScript, Express 5, phiên JWT (HS256), đăng nhập Google |
| Lập kế hoạch | Gemini, DeepSeek hoặc bất kỳ gateway tương thích OpenAI `/v1/chat/completions` |
| Dữ liệu | PostgreSQL 16, migration SQL đánh số trong [`db/v3`](db/v3/) |
| Kiểm thử | Vitest, Playwright, đánh giá golden set |
| CI | GitHub Actions trên Ubuntu, Node 24, PostgreSQL 16 |

## Bắt đầu

### Yêu cầu

- Node.js `^22.12` hoặc `>=24`, kèm npm
- Docker có Compose (để chạy container PostgreSQL ở máy)

### Chạy ở chế độ sandbox

Chế độ sandbox dùng dữ liệu mẫu, không cần khoá model hay thông tin đăng nhập dịch vụ. Chạy các lệnh ở thư mục gốc repository.

```sh
npm ci
cp .env.example .env          # PowerShell: Copy-Item .env.example .env
npm run db:up:v3              # PostgreSQL 16 tại 127.0.0.1:55533
```

Đặt các giá trị sau trong `.env` ở máy bạn. Mật khẩu admin dài ít nhất 12 ký tự.

```dotenv
RUNTIME_MODE=sandbox
DATABASE_URL=postgresql://ati_v3:ati_v3_local_only@127.0.0.1:55533/ati_v3
CHAT_ADMIN_EMAIL=admin@localhost.test
CHAT_ADMIN_PASSWORD=<mật-khẩu-cục-bộ>
SANDBOX_SCENARIO=three_service
```

Sau đó migrate, tạo tài khoản admin (một lần) và chạy API cùng web app:

```sh
npm run db:migrate:local:v3
npm run admin:provision:local:v3
npm run up:local:v3
```

Mở <http://127.0.0.1:5174>, đăng nhập bằng tài khoản admin và gửi [yêu cầu ví dụ](#ví-dụ). API health ở <http://127.0.0.1:3000/api/health>.

Bỏ `SANDBOX_SCENARIO` rồi khởi động lại để dùng sandbox mặc định. Dừng app bằng <kbd>Ctrl</kbd>+<kbd>C</kbd>; `npm run db:down:v3` dừng PostgreSQL và giữ volume dữ liệu. [Hướng dẫn môi trường cục bộ](docs/V3-LOCAL-SETUP.md) có thêm chi tiết về database và test.

### Chạy ở chế độ live

Chế độ live gọi dịch vụ thật. Trong `.env` ở máy bạn:

1. Đặt `RUNTIME_MODE=live`, `DATABASE_URL`, `JWT_SECRET` và `ENCRYPTION_KEY`.
2. Cấu hình một model lập kế hoạch: `GEMINI_API_KEY`, hoặc `LLM_PROVIDER=deepseek` kèm `DEEPSEEK_API_KEY`, hoặc `LLM_PROVIDER=openai-compatible` kèm `LLM_BASE_URL`, `LLM_API_KEY` và `LLM_MODEL`.
3. Đăng ký OAuth app cho các dịch vụ định dùng và bật các dịch vụ tuỳ chọn (`GMAIL_ENABLED`, `MYCALENDAR_ENABLED`, `MYSHEETS_ENABLED`, `MYSLACK_ENABLED`, `MYJIRA_ENABLED`). Mỗi tích hợp Google cần một Google Cloud project riêng.

```sh
npm run db:migrate:v3
npm run admin:provision:v3
npm run up
```

Mọi biến đều có chú thích trong [`.env.example`](.env.example). Không bao giờ commit `.env` hay đưa bí mật vào prompt, log hoặc file bằng chứng. Để chạy có kiểm soát trên dịch vụ thật, xem [`evaluations/README.md`](evaluations/README.md).

## Cấu trúc repository

```text
.
├── apps/
│   ├── chat-web/        App React + Vite: chat, xem trước, kết nối, lịch, lịch sử
│   └── chat-api/        API Express: xác thực, workspace, hội thoại, thực thi, lịch
├── packages/
│   ├── tool-schemas/    Registry dịch vụ, định nghĩa tool và kiểu dùng chung
│   ├── tool-adapters/   Client API dịch vụ, kiểm phạm vi, rate limit, mã hoá
│   ├── planner/         Định tuyến, tra cứu tài nguyên, provider LLM, kiểm tra kế hoạch
│   └── executor/        Thực thi tuần tự, tham chiếu giữa các bước, xử lý lỗi
├── db/v3/               Migration PostgreSQL và script chạy migration
├── evaluations/         Golden set, chấm điểm offline, chạy thật có kiểm soát
├── prompts/             Mẫu prompt
├── scripts/             Launcher, bộ kiểm môi trường cục bộ, script chạy test
└── docs/                Thiết kế, bàn giao, runbook và báo cáo
```

## Kiểm thử và đánh giá

| Lệnh | Mục đích |
| --- | --- |
| `npm run typecheck:v3` | Kiểm kiểu cho API và web app |
| `npm run test:v3` | Unit và integration test (test PostgreSQL dùng `DATABASE_URL`) |
| `npm run test:eval:v3` | Logic đánh giá offline |
| `npm run test:browser:v3` | Test end-to-end Playwright trên app sandbox |
| `npm run check` | Toàn bộ: kiểm kiểu, test, đánh giá, build web và kiểm launcher |
| `npm run check:local:v3` | Toàn bộ, kèm kiểm `DATABASE_URL` là database sandbox cục bộ |

Test browser cần Chromium (`npx playwright install chromium`), một database sandbox riêng đã tạo tài khoản admin, và `.env` không có `SANDBOX_SCENARIO` để bộ chạy tự chọn dữ liệu mẫu. Dừng app trước để Playwright tự khởi động server của nó.

Thay đổi planner và prompt được đo bằng golden set trong [`evaluations/`](evaluations/), cả offline lẫn với model thật. CI chạy song song hai job `check` và `browser` cho mỗi pull request ([workflow](.github/workflows/v3-check.yml)).

## Trạng thái dự án

- Luồng chính (chat, lập kế hoạch, duyệt, thực thi, biên nhận) và lịch bản tin chạy được ở cả sandbox lẫn live.
- Mọi dịch vụ trong bảng trên đã được chạy thử với tài khoản thật trong workspace test. Các kiểm tra live còn lại của từng dịch vụ ghi ở [`CURRENT-STATE.md`](docs/handoff/CURRENT-STATE.md).
- **Chưa triển khai production.** Google OAuth project ở chế độ Testing làm refresh token hết hạn sau 7 ngày, nên hãy kết nối lại ngay trước buổi demo.

Việc sắp làm nằm trong [lộ trình](docs/handoff/ROADMAP.md).

## Đóng góp

1. Đọc [quy trình nhóm](docs/team-workflow.md) và [quy tắc repository](AGENTS.md), gồm cả các bất biến an toàn.
2. Tách nhánh từ `origin/main` theo dạng `feat|fix|chore|docs/<tên-ngắn>` và dùng [Conventional Commits](https://www.conventionalcommits.org/).
3. Thêm test cho hành vi bạn thay đổi; sửa bug thì kèm test tái hiện bug.
4. Chạy test phần mình sửa và `npm run typecheck:v3`, rồi mở pull request mô tả làm gì, vì sao, và đã test gì.

Pull request đụng tới migration, OAuth hoặc token, luồng gửi hay ghi ra dịch vụ thật, xoá dữ liệu hoặc CI cần thêm một lượt review trước khi merge ([checklist](docs/handoff/REVIEW-CHECKLIST.md)).

## Tài liệu

| Tài liệu | Nội dung |
| --- | --- |
| [Đặc tả v3](docs/superpowers/specs/2026-09-29-ai-workflow-platform-v3-design.md) | Kiến trúc và hành vi nghiệp vụ chuẩn |
| [Trạng thái hiện tại](docs/handoff/CURRENT-STATE.md) | Trạng thái và mức nghiệm thu live của từng dịch vụ |
| [Môi trường cục bộ](docs/V3-LOCAL-SETUP.md) | Chi tiết database, sandbox và môi trường test |
| [Đánh giá](evaluations/README.md) | Golden set và chạy thật có kiểm soát |
| [Chỉ mục tài liệu](docs/README.md) | Các tài liệu còn lại: ADR, runbook, báo cáo |

## Giấy phép

Repository chưa có giấy phép mã nguồn mở. Mọi quyền thuộc về nhóm dự án.
