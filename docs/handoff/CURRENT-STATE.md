# Trạng thái hiện tại

**Cập nhật lần cuối:** 02/10/2026, sau khi PR #27 (FE-01) merge; `main` = `9d262c6`. Agent cập nhật: Claude Code (reviewer).

> Đọc file này trước khi làm bất cứ việc gì. **Chỉ reviewer sửa file này**, sau khi merge một PR; agent thi công ghi kết quả vào task card và `log/`.
> `docs/PROJECT-REPORT.md` có số liệu cũ (ngày 29/09); khi hai file mâu thuẫn, tin file này và mã nguồn.

> **Trạng thái merge:** Tuần 2: W2-01 vào `main` qua PR #15 (thi công ở #16); W2-02 và W2-04 qua #18 (W2-04 ở #20); task card W2-05 qua #22; W2-05 qua #23 tại `1029e55`. W2-03 chưa làm. Không còn PR mở của tuần 2.
>
> **Kế hoạch tuần 3–4** vào `main` qua #25 tại `af82961`. Mã nguồn sản phẩm không đổi so với `1029e55`; #24 và #25 chỉ sửa tài liệu. Các task chờ giao gồm bốn mảng:
> - **service mới:** W3-00 → W3-07, Sheets, Calendar, Notion, Telegram, Jira;
> - **tài khoản:** AUTH-01 → AUTH-06;
> - **frontend:** FE-01 → FE-03;
> - **đánh giá:** W4-01 → W4-04.
>
> **FE-01 xong** qua #27 tại `9d262c6`. Thứ tự và các mốc xem `ROADMAP.md`. Nên giao song song tiếp: W3-00, AUTH-01, FE-02.

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
| Unit + integration v3 | 526/526 | 02/10, `44f022e` (head PR #27); reviewer chạy lại | `npm run test:v3` (trong `npm run check`) |
| Test của bộ đánh giá | 66/66 | như trên | `npm run test:eval:v3` (trong `npm run check`) |
| Browser E2E (sandbox, PostgreSQL thật) | 9/9 kịch bản | như trên; CI PR #27 pass tại `20119b6` | `npm run test:browser:v3` |
| Typecheck, build | đạt | như trên | `npm run typecheck:v3`, `npm run build:v3` (trong `npm run check`) |
| Golden 50 câu, model thật, 1 lần | 50/50; p50/p95 5,5/14,8 s | 01/10, trước việc 5 của PR #13 | xem `evaluations/README.md` |
| Golden 18 câu tự do, model thật, 1 lần | 18/18; p50/p95 7,8/12,1 s | như trên | như trên |
| Chạy thật qua frontend | GitHub issue → Trello card → Slack: thành công; thực thi 3,8 s | 30/09, trước PR #13 | `evaluations/live-app/` |

Lần kiểm tra cuối: reviewer chạy `npm run check` tại `44f022e`, exit 0: v3 526 = 11 schema + 53 adapter + 128 planner + 25 executor + 148 API + 161 web; eval 66; typecheck/build; quét bản build không chứa mật khẩu; launcher 1/1; local-env 3/3. Browser 9/9. Mutation test FE-01: đóng hộp thoại lỗi gọi lại Stop → 3 test fail; modal gọi `onStop` khi thiếu `onClose` → 1 test fail; gỡ cả hai lớp chặn demo login → quét bản build fail (sau sửa của reviewer ở `20119b6`).

Audit tuần 2 (Claude Code) chạy probe trên PostgreSQL thật: chết giữa hai step → chạy tiếp được, plan `completed`, không gọi lại step đã xong; chết sau step cuối → tự thành `completed`; skip step `unknown` → step sau dùng đúng output đã lưu.

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
- #22: kết quả audit tuần 2 và task card W2-05.
- #24: ghi nhận W2-05 vào `CURRENT-STATE.md`.
- #27 (FE-01): đóng hộp thoại lỗi (Esc, bấm ngoài, ✕) chỉ ẩn, Stop cần xác nhận; bản build không còn chứa mật khẩu admin/demo (`scripts/test-v3-web-build-security.mjs` trong `npm run check`); trạng thái dịch vụ và quy trình mẫu lấy từ API (`GET /api/services` thêm `tools`, `configured`, `connectionStatus`); dải "Chế độ thử nghiệm" khi sandbox (`GET /api/health` trả `runtimeMode`); trang giới thiệu bỏ số liệu chưa đo; không còn ID giả; lỗi mạng tiếng Việt; chỉ đăng xuất khi refresh trả 401. Kết quả kiểm tra kết nối lưu theo tiến trình, mất khi restart.
- #25 (chỉ tài liệu): kế hoạch tuần 3–4. Thêm task card cho:
  - năm service mới, có W3-00 gỡ các chỗ viết cố định theo service trước khi thêm;
  - mảng tài khoản: đăng ký có admin duyệt, Gmail SMTP, Google, đăng xuất thu hồi token, trang tài khoản;
  - mảng frontend, lập sau khi review `apps/chat-web`.

  Đặc tả v3 §1.4 và §8.1 có đoạn cập nhật 02/10. W4-03 được sửa để đo ở chế độ live.
- #23 (W2-05): khôi phục an toàn hơn sau khi server khởi động lại. Plan có mọi step `succeeded`/`skipped` tự thành `completed`; plan không có step chưa rõ kết quả mà còn step `pending` được **chạy tiếp** (`POST /api/executions/:planId/continue`, nút "Chạy tiếp các bước còn lại"). Đặc tả v3 §5.8 đã được sửa theo. Bất biến "ghi `running` xong mới gọi service" có test khóa.

## 5. Lỗi và hạn chế đã biết

| Vấn đề | Ở đâu | Ghi chú |
|---|---|---|
| Phục hồi startup chưa có lease/fencing cho nhiều replica | startup reconciliation / recovery | Chỉ một API instance, executor cũ đã dừng; W2-01/W2-02 không cung cấp bảo đảm nhiều instance |
| Các ca lỗi của service thật (token hết hạn, ngoài scope, 429, timeout) mới test bằng dữ liệu giả | adapters | W2-03 chờ scope/plan live và người dùng duyệt lệnh ghi; live failure chưa chạy |
| Nhánh frontend streaming `text_*` chưa có timestamp và chưa giữ message khi `text_end` | `apps/chat-web` | Minor hoãn sau review W2-04; chưa tìm thấy production emitter, reachability chưa chứng minh (NOT_RUN); xử lý trước khi nối producer này |
| Sandbox dùng planner mock trả một plan soạn sẵn (giao diện đã báo "Chế độ thử nghiệm"); minor sau FE-01: tiêu đề mẫu "Phát hành Sprint" không khớp nội dung, chấm xanh nhấp nháy luôn hiện, dòng "Chưa xác định chế độ chạy" hiện thoáng khi tải | `server.ts`, `MissionControlLaunchpad.tsx`, `App.tsx` | Không demo sandbox như AI thật; minor gom vào FE-03 |
| Refresh token là JWT 7 ngày không lưu ở server: đăng xuất không thu hồi được, trái đặc tả §8.1; chưa có đăng ký, quên mật khẩu, chặn đoán mật khẩu | `apps/chat-api/src/auth/jwt.ts`, `routes/auth-routes.ts` | AUTH-01 → AUTH-05 |
| Plan preview chỉ hiện ID; kết quả thực thi là JSON thô; nút Back không hoạt động; tải lại trang mất hội thoại; lịch sử không có tiêu đề, tối đa 50 mục; SSE có thể ngừng im lặng khi token hết hạn (đọc code, chưa tái hiện) | `apps/chat-web` | FE-02, FE-03 |
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

- **Phạm vi chốt 02/10/2026:**
  - thêm Google Sheets, Google Calendar, Notion, Telegram, Jira; mốc chốt catalog 20/10;
  - đăng ký mở nhưng admin duyệt, vì credentials service dùng chung cả nhóm;
  - gửi email bằng Gmail SMTP (`nodemailer` là thư viện mới duy nhất được phép cho mảng tài khoản);
  - đăng nhập Google bằng OIDC.

- TDD: viết test fail trước, rồi mới sửa. Không mock hình thức; timeout phải test bằng `AbortSignal` thật; logic database phải test trên PostgreSQL thật.
- Không tuyên bố "xong" nếu chưa có output lệnh thật (test, exit code). Ghi rõ cái gì đã kiểm, cái gì chưa.
- Label của golden set được đăng ký trước. Chỉ sửa label trong commit riêng, có giải thích, không sửa để khớp kết quả.
- Mô tả PR và commit **không** có dòng "Generated with …" hay chữ ký của AI.
- Conventional Commits. Một task một nhánh một PR. Chỉ merge khi CI xanh.
- Repo công khai: không commit `.env`, token, `docs/ai-evidence/V3-LIVE-EXECUTION/` hay báo cáo môn học.
- Báo cáo môn học viết tiếng Việt, tiêu đề mục tiếng Anh, giữ thuật ngữ kỹ thuật tiếng Anh, file `.docx`, chữ đen, Times New Roman.
