# Trạng thái hiện tại

**Cập nhật lần cuối:** 01/10/2026, sau khi merge PR #13 (`main` = `29afc4f`). Agent cập nhật: Claude Code.

> Đọc file này trước khi làm bất cứ việc gì. Khi xong một task, sửa các mục bị ảnh hưởng và đổi dòng "Cập nhật lần cuối".
> `docs/PROJECT-REPORT.md` có số liệu cũ (ngày 29/09); khi hai file mâu thuẫn, tin file này và mã nguồn.

## 1. Sản phẩm

Đề tài môn ATI (thay khóa luận): **AI Workflow Automation Platform**. Người dùng mô tả công việc bằng một câu chat; AI chọn tool, lập plan nhiều bước, người dùng duyệt, hệ thống thực thi trên Trello, Slack, GitHub. Mục tiêu: một câu chat thay 4–5 thao tác thủ công trên ít nhất hai hệ thống.

- Khởi động dự án 10/09/2026. Giữa kỳ nộp 30/09. Cuối kỳ (nộp + bảo vệ) dự kiến khoảng 11/11/2026.
- Nhóm: Nguyễn Đạt Vinh (nhóm trưởng), Nguyễn Thành Long, Vũ Thị Loan, Mai Hải Yến.
- Báo cáo giữa kỳ: `docs/reports/MIDTERM-PROGRESS-2026-09-30.docx` (chỉ có ở máy nhóm trưởng, chưa commit).

## 2. Kiến trúc (v3)

| Thư mục | Vai trò |
|---|---|
| `apps/chat-web` | Frontend React 19, Vite, Tailwind, Zustand. Trang giới thiệu, đăng nhập, chat, plan preview, execution progress |
| `apps/chat-api` | Backend Express 5: JWT, hội thoại, approval (hash SHA-256, hạn 30 phút), thực thi, SSE |
| `packages/planner` | Router (keyword rule), prefetch resource directory, model tự gọi search tool, validator 5 lớp (JSON, schema, semantic, an toàn, grounding) |
| `packages/executor` | Resolve `$ref`/`$template`, chạy tuần tự, timeout qua AbortSignal, trạng thái `unknown` cho lệnh ghi không rõ kết quả |
| `packages/tool-schemas` | Catalog 16 tool: Trello 9, Slack 2, GitHub 5 (9 read, 7 write) |
| `packages/tool-adapters` | Adapter gọi API thật, allowed scope, rate limit, chuẩn hóa lỗi |
| `db/v3` | 6 bảng PostgreSQL |
| `evaluations/` | Golden set v2 (50 câu + 18 câu tự do), công cụ chạy thật có kiểm soát (`live-execution/`, `live-app/`) |

Các thư mục v2 (`apps/api`, `apps/web`, `packages/dsl`, `packages/engine`, `db/migrations`) là lưu trữ, **không sửa**.

## 3. Số liệu mới nhất

| Kiểm tra | Kết quả | Lệnh |
|---|---|---|
| Unit + integration v3 | 400/400 | `npm run test:v3` |
| Test của bộ đánh giá | 66/66 | `npm run test:eval:v3` |
| Browser E2E (sandbox, PostgreSQL thật) | 6/6 kịch bản | `npm run test:browser:v3` |
| Typecheck, build | đạt | `npm run typecheck:v3`, `npm run build:v3` |
| Golden 50 câu, model thật, 1 lần (01/10) | 50/50; p50/p95 5,5/14,8 s | xem `evaluations/README.md` |
| Golden 18 câu tự do, model thật, 1 lần (01/10) | 18/18; p50/p95 7,8/12,1 s | như trên |
| Chạy thật qua frontend (30/09) | GitHub issue → Trello card → Slack: thành công; thực thi 3,8 s | `evaluations/live-app/` |

Chỉ tiêu "tỉ lệ plan dùng được ≥ 70%" **chưa đo** (cần người dùng thật duyệt plan).

## 4. Đã làm gần đây (PR đã merge)

- #6–#9: chặn ID bịa (grounding), LLM qua cổng tương thích OpenAI, golden set có label, model tự gọi search tool.
- #10–#12: công cụ chạy thật có kiểm soát; giảm latency 31–37 s → 8–10 s; chạy thật qua frontend; sửa plan preview hiện `[object Object]`.
- #14: thiết kế lại frontend (trang giới thiệu, đăng nhập, lịch sử hội thoại, gợi ý yêu cầu, hộp thoại lỗi).
- #13 (tuần 1): retry khi model timeout; kiểm tra thành viên đúng board của card; liệt kê bằng query rỗng thay vì đoán tên; ghi thời lượng từng step; lưu plan vào hội thoại để "Sửa qua Chat" hoạt động.

## 5. Lỗi và hạn chế đã biết

| Vấn đề | Ở đâu | Ghi chú |
|---|---|---|
| Server khởi động lại giữa lúc thực thi thì plan kẹt ở `approved`, step kẹt ở `running`, retry/skip trả 409 | `apps/chat-api/src/services/execution-service.ts` | Task W2-01, W2-02 |
| Các ca lỗi của service thật (token hết hạn, ngoài scope, 429, timeout) mới test bằng dữ liệu giả | adapters | Task W2-03 |
| Thời gian dưới tin nhắn người dùng hiện dạng ISO thô | `apps/chat-web` | Task W2-04 |
| Ở sandbox, `vite.config.ts` đưa `CHAT_ADMIN_PASSWORD` vào bundle frontend; mật khẩu mặc định `Admin@12345678` viết cố định | `apps/chat-web/vite.config.ts`, `LoginView.tsx` | Live mode để trống; đừng dùng mật khẩu này cho tài khoản thật |
| Tin nhắn Slack chưa đọc lại tự động sau khi gửi | live-execution | |
| Chưa đo hành vi của model khi lịch sử có plan cũ (sau PR #13) | planner | Đo lại ở tuần 4 |
| Hai bộ câu đánh giá do một người viết; prompt đã được chỉnh trên bộ 50 câu | evaluations | Tuần 4: bộ câu do thành viên khác viết |

## 6. Môi trường chạy

- Database: `npm run db:up:v3` (PostgreSQL 16 tại `127.0.0.1:55533`, user/db `ati_v3`). Migration: `npm run db:migrate:v3`.
- `.env` (không commit, không in giá trị ra log): `RUNTIME_MODE` (`sandbox` mặc định), `DATABASE_URL`, `JWT_SECRET`, `ENCRYPTION_KEY`, `CHAT_ADMIN_EMAIL`, `CHAT_ADMIN_PASSWORD`, `SERVICE_ADMIN_USER_IDS`, `LLM_PROVIDER`, `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL`, `PLANNER_SEARCH_MODE`, `APP_TIME_ZONE`, `TRELLO_API_KEY`, `TRELLO_TOKEN`, `SLACK_BOT_TOKEN`, `GITHUB_TOKEN`, `LIVE_TRELLO_BOARD_IDS`, `LIVE_SLACK_CHANNELS`, `LIVE_GITHUB_REPOS`.
- LLM: model `ag/gemini-3.8-flash` qua cổng 9router ở `http://localhost:20128/v1` (gói thuê bao cá nhân). Rủi ro: tài khoản có thể bị khóa; trước buổi bảo vệ cần có đường dự phòng qua Gemini API chính thức (`LLM_PROVIDER=gemini`, `GEMINI_API_KEY`).
- Chạy app: `npm run up` (API cổng 3000, web cổng 5174). Chế độ live: `RUNTIME_MODE=live npm run up`, xem mục "Through the app" trong `evaluations/README.md`.
- Tài nguyên thử nghiệm thật: Trello board "To Do", Slack `#ati-test`, GitHub `VinhDat267/ati-test`. Chỉ ghi ra service thật khi người dùng đã duyệt đúng plan đó.

## 7. Quy tắc đã chốt

- TDD: viết test fail trước, rồi mới sửa. Không mock hình thức; timeout phải test bằng `AbortSignal` thật; logic database phải test trên PostgreSQL thật.
- Không tuyên bố "xong" nếu chưa có output lệnh thật (test, exit code). Ghi rõ cái gì đã kiểm, cái gì chưa.
- Label của golden set được đăng ký trước. Chỉ sửa label trong commit riêng, có giải thích, không sửa để khớp kết quả.
- Mô tả PR và commit **không** có dòng "Generated with …" hay chữ ký của AI.
- Conventional Commits. Một task một nhánh một PR. Chỉ merge khi CI xanh.
- Repo công khai: không commit `.env`, token, `docs/ai-evidence/V3-LIVE-EXECUTION/` hay báo cáo môn học.
- Báo cáo môn học viết tiếng Việt, tiêu đề mục tiếng Anh, giữ thuật ngữ kỹ thuật tiếng Anh, file `.docx`, chữ đen, Times New Roman.
