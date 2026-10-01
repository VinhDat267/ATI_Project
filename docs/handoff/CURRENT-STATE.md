# Trạng thái hiện tại

**Cập nhật lần cuối:** 01/10/2026, sau khi PR #17 và #15 merge; `main` = `35f454a`. Agent cập nhật: Codex reviewer.

> Đọc file này trước khi làm bất cứ việc gì. **Chỉ reviewer sửa file này**, sau khi merge một PR; agent thi công ghi kết quả vào task card và `log/`.
> `docs/PROJECT-REPORT.md` có số liệu cũ (ngày 29/09); khi hai file mâu thuẫn, tin file này và mã nguồn.

> **Phân biệt nhánh:** PR #17 đã merge metadata vào `docs/agent-handoff` tại `adf472c`; PR #15 đã đưa handoff và W2-01 vào `main` tại `35f454a`. PR #18 (W2-02) còn OPEN, base `main`, head `31670bc`; W2-04 đang triển khai trên nhánh riêng đặt trên W2-02. Không coi hai phần chưa merge này là hiện trạng `main`.

## 1. Sản phẩm

Đề tài môn ATI (thay khóa luận): **AI Workflow Automation Platform**. Người dùng mô tả công việc bằng một câu chat; AI chọn tool, lập plan nhiều bước, người dùng duyệt, hệ thống thực thi trên Trello, Slack, GitHub. Mục tiêu: một câu chat thay 4–5 thao tác thủ công trên ít nhất hai hệ thống.

- Khởi động dự án 10/09/2026. Giữa kỳ nộp 30/09. Cuối kỳ (nộp + bảo vệ) dự kiến khoảng 11/11/2026.
- Báo cáo môn học chỉ lưu ở máy nhóm trưởng, không commit lên repo công khai.

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

Mỗi số liệu ghi kèm ngày đo và commit. Bảng dưới là bằng chứng cho source W2-01 hiện có trên `main`; ngày đo local vẫn là 01/10 trên `c8d122c`, được bổ sung CI tại head cuối PR #15 `adf472c`. Các bằng chứng golden/live cũ giữ nguyên ngày đo và giới hạn.

| Kiểm tra | Kết quả | Đo lúc | Lệnh |
|---|---|---|---|
| Unit + integration v3 | 416/416 | 01/10, `c8d122c`; reviewer chạy lại độc lập | `npm run test:v3` |
| Test của bộ đánh giá | 66/66 | 01/10, `c8d122c`; reviewer chạy lại độc lập | `npm run test:eval:v3` |
| Browser E2E (sandbox, PostgreSQL thật) | 6/6 kịch bản | 01/10, `c8d122c`; agent thi công chạy, CI `5c03224` đạt | `npm run test:browser:v3` |
| Typecheck, build | đạt | 01/10, `c8d122c`; reviewer chạy lại typecheck, build do agent thi công và CI `5c03224` | `npm run typecheck:v3`, `npm run build:v3` |
| Golden 50 câu, model thật, 1 lần | 50/50; p50/p95 5,5/14,8 s | 01/10, trước việc 5 của PR #13 | xem `evaluations/README.md` |
| Golden 18 câu tự do, model thật, 1 lần | 18/18; p50/p95 7,8/12,1 s | như trên | như trên |
| Chạy thật qua frontend | GitHub issue → Trello card → Slack: thành công; thực thi 3,8 s | 30/09, trước PR #13 | `evaluations/live-app/` |

W2-01 có 16 test startup trên PostgreSQL thật, gồm row lock, rollback khi SQL lỗi, idempotence và kill tiến trình thực thi giữa write. Các lần chạy local trên `c8d122c` đều exit 0 sau RED 9 fail / 7 pass. [CI PR #16 tại `5c03224`](https://github.com/VinhDat267/ATI_Project/actions/runs/36817860975) và [CI cuối PR #15 tại `adf472c`](https://github.com/VinhDat267/ATI_Project/actions/runs/36827265860) đều SUCCESS. Diff `5c03224` → `35f454a` rỗng trong `apps/`, `packages/`, `db/`, `prompts/`, `evaluations/`; toàn bộ tree `adf472c` → `35f454a` cũng rỗng. Số liệu 416 v3 / 66 eval / 6 browser tiếp tục áp dụng cho source trên `main`; không chạy lại live model hoặc ghi service thật trong W2-01.

**Bằng chứng nhánh chưa merge:** PR #18 (W2-02) có v3 442/442, eval 66/66, browser 6/6, typecheck/build đạt ngày 01/10 tại head `2a2fc5a`, do agent thi công chạy sau sửa review. Đây không phải số liệu `main` hoặc lần reviewer chạy lại fixed head. [CI tại `2a2fc5a`](https://github.com/VinhDat267/ATI_Project/actions/runs/36822341262) và [CI sau tích hợp `main` tại `31670bc`](https://github.com/VinhDat267/ATI_Project/actions/runs/36827517047) đều SUCCESS; diff giữa hai head rỗng trong các thư mục source nêu trên. PR #18 vẫn OPEN.

Chỉ tiêu "tỉ lệ plan dùng được ≥ 70%" **chưa đo** (cần người dùng thật duyệt plan).

## 4. Đã làm gần đây (PR đã merge)

- #6–#9: chặn ID bịa (grounding), LLM qua cổng tương thích OpenAI, golden set có label, model tự gọi search tool.
- #10–#12: công cụ chạy thật có kiểm soát; giảm latency 31–37 s → 8–10 s; chạy thật qua frontend; sửa plan preview hiện `[object Object]`.
- #14: thiết kế lại frontend (trang giới thiệu, đăng nhập, lịch sử hội thoại, gợi ý yêu cầu, hộp thoại lỗi).
- #13 (tuần 1): retry khi model timeout; kiểm tra thành viên đúng board của card; liệt kê bằng query rỗng thay vì đoán tên; ghi thời lượng từng step; lưu plan vào hội thoại để "Sửa qua Chat" hoạt động.
- #16 (W2-01): đã merge vào `docs/agent-handoff` tại `1a0b623`, nay có trên `main` qua #15 tại `35f454a`. Startup đối soát trong transaction trước HTTP: step `running` thành `unknown`, plan cần kiểm tra thành `reconciliation_required`; giữ output đã thành công và step `pending`, không tự chạy lại. Lỗi đối soát thì rollback và không listen; API durable status trả `pausedStepId` theo thứ tự plan. Đặc tả mục 5.8 đã đồng bộ chính sách này. Phạm vi một instance, executor cũ phải đã dừng.
- #17 và #15: metadata reviewer đã merge vào nhánh bàn giao lúc 06:53:57 UTC và nhánh bàn giao đã merge vào `main` lúc 06:56:35 UTC ngày 01/10. Các nhật ký trước đó là lịch sử tại thời điểm viết, không thay thế trạng thái mới này.

W2-02 ở PR #18 trên nhánh `vinhdat/fix-w2-02-resume-after-restart`, base đã đổi về `main`, head `31670bc`; chưa merge. W2-04 đang triển khai trong worktree `w2-04-reconciliation-ui`, nhánh `vinhdat/feat-w2-04-reconciliation-ui` đặt trên W2-02; chưa có kết luận nghiệm thu hoặc merge.

## 5. Lỗi và hạn chế đã biết

| Vấn đề | Ở đâu | Ghi chú |
|---|---|---|
| Trên `main`, sau restart controller chưa được khôi phục; retry/skip/stop chưa tiếp tục được từ dữ liệu đã lưu | `apps/chat-api/src/services/execution-service.ts` | W2-02 đã có code/test trong PR #18 còn OPEN; giữ output thành công, chặn retry `unknown`, plan không có `unknown` chỉ Stop trong luồng recovery |
| Trên `main`, tải lại UI chưa lấy execution/step snapshot cần đối soát | `apps/chat-web`, API snapshot | API nằm trong PR #18 chưa merge; W2-04 đang triển khai UI trên nhánh đặt trên W2-02 |
| Phục hồi startup chưa có lease/fencing cho nhiều replica | startup reconciliation | Chỉ một API instance, executor cũ đã dừng; ngoài phạm vi W2-01 |
| Các ca lỗi của service thật (token hết hạn, ngoài scope, 429, timeout) mới test bằng dữ liệu giả | adapters | Task W2-03 |
| Thời gian dưới tin nhắn người dùng hiện dạng ISO thô | `apps/chat-web` | Task W2-04 |
| Ở sandbox, `vite.config.ts` đưa `CHAT_ADMIN_PASSWORD` vào bundle frontend; mật khẩu mặc định `Admin@12345678` viết cố định | `apps/chat-web/vite.config.ts`, `LoginView.tsx` | Live mode để trống; đừng dùng mật khẩu này cho tài khoản thật |
| Tin nhắn Slack chưa đọc lại tự động sau khi gửi | live-execution | |
| Chưa đo hành vi của model khi lịch sử có plan cũ (sau PR #13) | planner | Đo lại ở tuần 4 |
| Hai bộ câu đánh giá do một người viết; prompt đã được chỉnh trên bộ 50 câu | evaluations | Tuần 4: bộ câu do thành viên khác viết |

## 6. Môi trường chạy

- Database: `npm run db:up:v3` (PostgreSQL 16 tại `127.0.0.1:55533`, user/db `ati_v3`). Migration: `npm run db:migrate:v3`.
- `.env` (không commit, không in giá trị ra log): `RUNTIME_MODE` (`sandbox` mặc định), `DATABASE_URL`, `JWT_SECRET`, `ENCRYPTION_KEY`, `CHAT_ADMIN_EMAIL`, `CHAT_ADMIN_PASSWORD`, `SERVICE_ADMIN_USER_IDS`, `LLM_PROVIDER`, `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL`, `PLANNER_SEARCH_MODE`, `APP_TIME_ZONE`, `TRELLO_API_KEY`, `TRELLO_TOKEN`, `SLACK_BOT_TOKEN`, `GITHUB_TOKEN`, `LIVE_TRELLO_BOARD_IDS`, `LIVE_SLACK_CHANNELS`, `LIVE_GITHUB_REPOS`.
- LLM: model `ag/gemini-3.8-flash` qua một cổng tương thích OpenAI chạy ở máy (`LLM_PROVIDER=openai-compatible`, `LLM_BASE_URL`). Cổng này có thể ngừng hoạt động bất cứ lúc nào; trước buổi bảo vệ cần có đường dự phòng qua Gemini API chính thức (`LLM_PROVIDER=gemini`, `GEMINI_API_KEY`).
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
