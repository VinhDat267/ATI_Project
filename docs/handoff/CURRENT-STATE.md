# Trạng thái hiện tại

**Cập nhật lần cuối:** 01/10/2026, sau khi PR #20, #18 và #19 merge; `main` = `abbb55f`. Agent cập nhật: Codex reviewer.

> Đọc file này trước khi làm bất cứ việc gì. **Chỉ reviewer sửa file này**, sau khi merge một PR; agent thi công ghi kết quả vào task card và `log/`.
> `docs/PROJECT-REPORT.md` có số liệu cũ (ngày 29/09); khi hai file mâu thuẫn, tin file này và mã nguồn.

> **Trạng thái merge:** W2-01 đã vào `main` qua PR #15. PR #20 (W2-04) đã merge vào nhánh W2-02 tại `c30604b`; PR #18 đã đưa cả W2-02 và W2-04 vào `main` tại `9c652c4`; PR #19 cập nhật metadata rồi merge tại `abbb55f`. Không còn PR mở lúc đối chiếu. Task card và nhật ký thi công giữ nguyên thông tin lịch sử tại thời điểm bàn giao; trạng thái sau merge nằm ở file này và ROADMAP.

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

Mỗi số liệu ghi kèm ngày đo và commit. Bảng dưới dùng lần đo local cuối W2-04 ngày 01/10 trên source `63c3c63`. Diff từ source đó đến `main` tại `abbb55f` rỗng trong `apps/`, `packages/`, `db/`, `prompts/`, `evaluations/`. Các bằng chứng golden/live cũ giữ nguyên ngày đo và giới hạn.

| Kiểm tra | Kết quả | Đo lúc | Lệnh |
|---|---|---|---|
| Unit + integration v3 | 479/479 | 01/10, `63c3c63`; agent thi công chạy sau sửa review | `npm run test:v3` (trong `npm run check`) |
| Test của bộ đánh giá | 66/66 | 01/10, `63c3c63`; agent thi công chạy sau sửa review | `npm run test:eval:v3` (trong `npm run check`) |
| Browser E2E (sandbox, PostgreSQL thật) | 7/7 kịch bản | 01/10, `63c3c63`; agent thi công chạy sau sửa review; CI `c30604b` cũng có 7 pass | `npm run test:browser:v3` |
| Typecheck, build | đạt | 01/10, `63c3c63`; agent thi công chạy sau sửa review | `npm run typecheck:v3`, `npm run build:v3` (trong `npm run check`) |
| Golden 50 câu, model thật, 1 lần | 50/50; p50/p95 5,5/14,8 s | 01/10, trước việc 5 của PR #13 | xem `evaluations/README.md` |
| Golden 18 câu tự do, model thật, 1 lần | 18/18; p50/p95 7,8/12,1 s | như trên | như trên |
| Chạy thật qua frontend | GitHub issue → Trello card → Slack: thành công; thực thi 3,8 s | 30/09, trước PR #13 | `evaluations/live-app/` |

Lần kiểm tra cuối `npm run check` tại `63c3c63` exit 0: v3 479 = 11 schema + 53 adapter + 128 planner + 23 executor + 127 API + 137 web, eval 66, typecheck/build, launcher 1/1 và local-env 3/3. Browser 7/7 cũng exit 0. [CI head bàn giao W2-04 `f0d4bd6`](https://github.com/VinhDat267/ATI_Project/actions/runs/36833133925), [CI sau merge #20 `c30604b`](https://github.com/VinhDat267/ATI_Project/actions/runs/36839816958) và [v3 CI trên `main` `abbb55f`](https://github.com/VinhDat267/ATI_Project/actions/runs/36840448668) đều SUCCESS. Số 479 là output local cuối được ghi trong [nhật ký W2-04](log/2026-10-01-codex-W2-04.md), không suy ra từ dấu chấm của CI reporter.

Reviewer đã chạy lại độc lập tại `49cb9c5` (source `30784eb`): check 472/472 v3, eval 66/66, browser 7/7, exit 0; phát hiện hai lỗi Important về pending preview và modal nhắm sai execution. Agent thi công sửa trong một lượt TDD, thêm guard cho phản hồi pending đến muộn và kiểm tra lại source cuối `63c3c63` như trên. **Reviewer chưa chạy lại fixed head**; lần cập nhật metadata sau merge chỉ đối chiếu source, ancestry, log và CI. Không chạy lại model hoặc ghi service thật; live UNKNOWN chưa được kiểm chứng.

Chỉ tiêu "tỉ lệ plan dùng được ≥ 70%" **chưa đo** (cần người dùng thật duyệt plan).

## 4. Đã làm gần đây (PR đã merge)

- #6–#9: chặn ID bịa (grounding), LLM qua cổng tương thích OpenAI, golden set có label, model tự gọi search tool.
- #10–#12: công cụ chạy thật có kiểm soát; giảm latency 31–37 s → 8–10 s; chạy thật qua frontend; sửa plan preview hiện `[object Object]`.
- #14: thiết kế lại frontend (trang giới thiệu, đăng nhập, lịch sử hội thoại, gợi ý yêu cầu, hộp thoại lỗi).
- #13 (tuần 1): retry khi model timeout; kiểm tra thành viên đúng board của card; liệt kê bằng query rỗng thay vì đoán tên; ghi thời lượng từng step; lưu plan vào hội thoại để "Sửa qua Chat" hoạt động.
- #16 (W2-01): đã merge vào `docs/agent-handoff` tại `1a0b623`, nay có trên `main` qua #15 tại `35f454a`. Startup đối soát trong transaction trước HTTP: step `running` thành `unknown`, plan cần kiểm tra thành `reconciliation_required`; giữ output đã thành công và step `pending`, không tự chạy lại. Lỗi đối soát thì rollback và không listen; API durable status trả `pausedStepId` theo thứ tự plan. Đặc tả mục 5.8 đã đồng bộ chính sách này. Phạm vi một instance, executor cũ phải đã dừng.
- #17 và #15: metadata reviewer đã merge vào nhánh bàn giao lúc 06:53:57 UTC và nhánh bàn giao đã merge vào `main` lúc 06:56:35 UTC ngày 01/10. Các nhật ký trước đó là lịch sử tại thời điểm viết, không thay thế trạng thái mới này.
- #20 và #18: #20 merge W2-04 vào nhánh W2-02 tại `c30604b` lúc 08:59:25 UTC ngày 01/10; #18 đưa cả hai vào `main` tại `9c652c4` lúc 09:03:35 UTC. W2-02 khôi phục controller từ approved plan và progress đã lưu, kiểm tra integrity/CAS trước dispatch; skip UNKNOWN, retry failed đã biết, Stop giữ bằng chứng, không chạy lại success. API latest execution snapshot theo owner cung cấp plan/steps/output/timing/recoveryActions; invalid recovery là Stop-only theo spec 5.8. W2-04 tải snapshot khi mở lại hội thoại, hiện ngữ cảnh UNKNOWN cùng Skip/Stop theo server, giữ preview mới và target execution đúng; tin nhắn gửi/lịch sử hiển thị giờ/ngày theo máy người dùng. Tham số hiển thị dựng lại từ saved plan/output, không phải log của request đã gửi service.
- #19: metadata hậu merge #15 được đưa vào `main` tại `abbb55f` lúc 09:04:40 UTC ngày 01/10. File này cập nhật tiếp trạng thái sau #18/#20; không sửa lại task card hoặc nhật ký thi công cũ.

## 5. Lỗi và hạn chế đã biết

| Vấn đề | Ở đâu | Ghi chú |
|---|---|---|
| Server chết giữa hai step (không có step `unknown`, còn step `pending`): sau khởi động lại chỉ được Stop, không chạy tiếp được | `startup-reconciliation.ts`, `execution-service.ts` | Audit 01/10 tại `e6ea708`, chứng minh bằng probe trên PostgreSQL thật; task [W2-05](tasks/W2-05-continue-safe-plans.md) |
| Server chết sau step cuối, trước khi ghi trạng thái plan: plan thành `reconciliation_required`, Stop xong thành `stopped` dù mọi step đã chạy xong | như trên | Như trên; W2-05 |
| Phục hồi startup chưa có lease/fencing cho nhiều replica | startup reconciliation / recovery | Chỉ một API instance, executor cũ đã dừng; W2-01/W2-02 không cung cấp bảo đảm nhiều instance |
| Các ca lỗi của service thật (token hết hạn, ngoài scope, 429, timeout) mới test bằng dữ liệu giả | adapters | W2-03 chờ scope/plan live và người dùng duyệt lệnh ghi; live failure chưa chạy |
| Nhánh frontend streaming `text_*` chưa có timestamp và chưa giữ message khi `text_end` | `apps/chat-web` | Minor hoãn sau review W2-04; chưa tìm thấy production emitter, reachability chưa chứng minh (NOT_RUN); xử lý trước khi nối producer này |
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
