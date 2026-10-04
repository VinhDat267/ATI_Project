# Trạng thái hiện tại

**Cập nhật lần cuối:** 04/10/2026, sau khi #52 (AUTH-02), #53 (AUTH-03), #54 (FE-03) merge; `main` = `9709a2d`. Agent cập nhật: Claude Code (reviewer). Các mục trước đó do Codex và Claude Code ghi.

> Đọc file này trước khi làm bất cứ việc gì. **Chỉ reviewer sửa file này**, sau khi merge một PR; agent thi công ghi kết quả vào task card và `log/`.
> `docs/PROJECT-REPORT.md` có số liệu cũ (ngày 29/09); khi hai file mâu thuẫn, tin file này và mã nguồn.

> **Trạng thái merge:** Tuần 2: W2-01 vào `main` qua PR #15 (thi công ở #16); W2-02 và W2-04 qua #18 (W2-04 ở #20); task card W2-05 qua #22; W2-05 qua #23 tại `1029e55`. W2-03 chưa làm. Không còn PR mở của tuần 2.
>
> **Kế hoạch tuần 3–4** vào `main` qua #25 tại `af82961`; #24 và #25 chỉ sửa tài liệu. Các task còn mở gồm bốn mảng:
> - **service mới:** W3-00b và W3-07; cả năm adapter mới đã merge, W3-06 đã đo model thật với fixtures; nghiệm thu service thật còn chờ W3-07. Parity/latency và policy chỉ đọc cần follow-up riêng, chưa có task card sửa sản phẩm;
> - **tài khoản:** AUTH-02b, AUTH-04 → AUTH-06; AUTH-01 → AUTH-03 đã merge;
> - **frontend:** FE-01 → FE-03 đã merge;
> - **đánh giá:** W4-01 → W4-04.
>
> **FE-01 xong** qua #27 tại `9d262c6`; **W3-00 xong** qua #29 tại `c7a38c0`; **W3-01 xong** qua #30 tại `716f568`; **W3-02 xong** qua #31 tại `ab2c599`; **W3-03 xong** qua #32 tại `fca384d`; **W3-04 xong** qua #33 tại `4a4553b`; **W3-05 xong** qua #34 tại `dc80de4`; **W3-06 đo xong** qua #35 tại `a75ac35`, nhưng parity bộ cũ chưa đạt và nghiệm thu sản phẩm còn incomplete. `rf06` clarification đã được người dùng chốt trước commit/model call. **AUTH-01 xong** qua #41 tại `fbd993f`; **FE-02 xong** qua #42 tại `8b6c8e6`. AUTH-02 → AUTH-05, FE-03 và phần UI của W3-00b đã gỡ chặn; đăng ký vẫn tắt cho tới khi cả AUTH-02 và AUTH-03 merge. W3-07 chờ người dùng chuẩn bị tài khoản/tài nguyên và duyệt plan ghi thật. Thứ tự và các mốc xem `ROADMAP.md`.
>
> **Audit độc lập W3** (Claude Code, #37 tại `4171298`): đạt có điều kiện. Chạy lại check 874 + 151, browser 14/14; mutation 19 lần chạy: 17 bị bắt, 1 lọt (Calendar 403), 1 không hợp lệ; probe HTTP + PostgreSQL không lộ bí mật, `siteUrl` Jira độc hại bị chặn. Lỗi trung bình: kết quả đọc không giới hạn kích thước. Task card **W3-08** nên xong trước W3-07 và các phép đo tuần 4.
>
> **W3-08 xong, review độc lập đạt:** bản đầu #39 tại `c5ce8a0`; hai P2 phát hiện sau merge đã sửa qua #45 tại `81225de` (code `d1bd367`, head `44873b0`). Ngân sách search bao gồm tool/args/error/metadata; hủy hoặc mất kết nối khi đọc body token Google trả NETWORK, JSON sai vẫn SERVER_ERROR. Check955+165 và browser20/20 đạt, CI đúng head xanh. Giới hạn áp dụng từng outcome, không phải toàn bộ lịch sử hội thoại; model/service thật chưa nghiệm thu lại.
>
> **AUTH-02, AUTH-03, FE-03 xong** qua #52 (`e578520`), #53 (`46cc6e6`), #54 (`9709a2d`); review của Claude Code: #53, #54 đạt; #52 đạt có điều kiện. P2 lộ tài khoản qua thời gian phản hồi của quên mật khẩu/gửi lại xác minh (832 ms vs 6 ms với SMTP chậm 800 ms) → **AUTH-02b**, phải xong trước AUTH-06. Đăng ký giờ **bật mặc định**. Chế độ live **bắt buộc đủ biến SMTP**, nên `RUNTIME_MODE=live npm run up` lỗi cho tới khi cấu hình Gmail hoặc AUTH-02b mục 2 xong. W3-07: Telegram, Notion, Jira, workflow 4 service đã chạy thật.

## 1. Sản phẩm

Đề tài môn ATI (thay khóa luận): **AI Workflow Automation Platform**. Người dùng mô tả công việc bằng một câu chat; AI chọn tool, lập plan nhiều bước, người dùng duyệt, hệ thống có adapter cho Trello, Slack, GitHub, Google Sheets, Google Calendar, Notion, Telegram và Jira. Năm service mới thật còn chờ nghiệm thu W3-07. Mục tiêu: một câu chat thay 4–5 thao tác thủ công trên ít nhất hai hệ thống.

- Khởi động dự án 10/09/2026. Giữa kỳ nộp 30/09. Cuối kỳ (nộp + bảo vệ) dự kiến khoảng 11/11/2026.
- Báo cáo môn học chỉ lưu ở máy nhóm trưởng, không commit lên repo công khai.

## 2. Kiến trúc (v3)

| Thư mục | Vai trò |
|---|---|
| `apps/chat-web` | Frontend React 19, Vite, Tailwind, Zustand. Trang giới thiệu, đăng nhập, chat, plan preview, execution progress |
| `apps/chat-api` | Backend Express 5: JWT, hội thoại, approval (hash SHA-256, hạn 30 phút), thực thi, SSE |
| `packages/planner` | Router (keyword rule), prefetch resource directory, model tự gọi search tool, validator 5 lớp (JSON, schema, semantic, an toàn, grounding) |
| `packages/executor` | Resolve `$ref`/`$template`, chạy tuần tự, timeout qua AbortSignal, trạng thái `unknown` cho lệnh ghi không rõ kết quả |
| `packages/tool-schemas` | Catalog 33 tool/8 service: Trello 9, Slack 2, GitHub 5, Sheets 4, Calendar 3, Notion 4, Telegram 2, Jira 4 (19 read, 14 write) |
| `packages/tool-adapters` | Adapter gọi API thật, allowed scope, rate limit, chuẩn hóa lỗi |
| `db/v3` | 8 bảng PostgreSQL, gồm phiên đăng nhập và lịch sử hash refresh token; migrations 0001–0004 |
| `evaluations/` | Golden set v2 (50 câu + 18 câu tự do + 44 câu services), công cụ chạy thật có kiểm soát (`live-execution/`, `live-app/`) |

Các thư mục v2 (`apps/api`, `apps/web`, `packages/dsl`, `packages/engine`, `db/migrations`) là lưu trữ, **không sửa**.

## 3. Số liệu mới nhất

Mỗi số liệu ghi kèm ngày đo và commit. Số liệu phần mềm hiện tại từ [CI PR #45](https://github.com/VinhDat267/ATI_Project/actions/runs/37131563648), SUCCESS trên head `44873b0`, ngày 03/10/2026. Merge `81225de` có cây file bằng head đã kiểm thử (`git diff --exit-code` đạt). Ba phép đo model thật W3-06 vẫn dùng runtime `7ba60ef`, catalog33tool/8service và fixtures tổng hợp; không chạy lại model sau W3-08/AUTH-01/FE-02 hoặc bản sửa #45, không gọi service thật trong các task này. Các bằng chứng live cũ giữ ngày và giới hạn.

| Kiểm tra | Kết quả | Đo lúc | Lệnh |
|---|---|---|---|
| Unit + integration v3 | 1.063/1.063 | 04/10, head #54 `4859788` (cùng code với `9709a2d`); Claude Code chạy lại trên PostgreSQL tạm; CI #52–#54 pass | `npm run test:v3` (trong `npm run check`) |
| Test của bộ đánh giá (offline) | 165/165 | như trên | `npm run test:eval:v3` (trong `npm run check`) |
| Browser E2E (sandbox, PostgreSQL thật) | 25/25 ca, 10 scenario | như trên | `npm run test:browser:v3` |
| Typecheck, build | đạt | như trên | `npm run typecheck:v3`, `npm run build:v3` (trong `npm run check`) |
| Golden 50 câu, model thật, 3 lần | 150/150; p50/p95 5,454/13,105 s; 49 câu không đổi147/147, rf06 mới3/3 | 03/10, runtime `7ba60ef` | xem `evaluations/README.md` |
| Golden 18 câu tự do, model thật, 3 lần | 51/54; p50/p95 5,942/13,092 s; ff15=0/3 | như trên | như trên |
| Golden 44 câu services, model thật, 3 lần | 111/132; p50/p95 6,105/31,097 s; max53,021 s | như trên | như trên |
| Năm service mới: tools/args | tools100% cả năm; args Calendar87,5%, bốn service còn lại100% | như trên; successful read traces + labelled writes, args conditional đúng tool | `EVAL_SET=services`, xem denominator trong README |
| Chạy thật qua frontend | GitHub issue → Trello card → Slack: thành công; thực thi 3,8 s | 30/09, trước PR #13 | `evaluations/live-app/` |

Lần kiểm tra kết hợp AUTH-01/FE-02 sau retarget main: CI `37128235604` SUCCESS trên `c68b4b6`, `npm run check` đạt **948 v3** = 47 schema + 317 adapters + 172 planner + 25 executor + 203 API + 184 web; **165 offline evaluations**; typecheck/build/credential scan/launcher/guards đạt. Canonical browser script đạt **20/20** qua đủ 9 scenario trên PostgreSQL thật. Root đã chạy cùng toàn bộ suite local trong phiên thi công; hai reviewer độc lập chạy các test và probe thuộc phạm vi của mình, không gọi kết quả CI là nghiệm thu service/model thật.

Lần kiểm tra cuối W3-08 (Claude Code, `fbab62b`): `npm run check` exit 0: v3 895 = 47 schema + 317 adapters + 172 planner + 25 executor + 173 API + 161 web; eval 165; typecheck/build; quét bản build PASS. Browser 14/14. RED 14 test mới; mutation 10/10 bị bắt (gồm M15 Calendar 403 của audit). Model thật chưa chạy lại sau khi mô tả ba tool đổi nhẹ.

Lần kiểm tra cuối W3-06: npm run check exit0:874v3 =47schema+301adapters+167planner+25executor+173API+161web;151offline evaluations; strict eval typecheck exit0; CI browser14/14 trên PostgreSQL thật. Review độc lập `aaa345d..49dfc61`: C0/I1/M0, rerun check874+151/strict và audit415attempts/1921traces/276plans. I1 mô tả read-only sai được sửa một lượt: audit báo cáo thật RED→GREEN, 15refusal/3plan/0clarification; validator chấp nhận ba plan chỉ đọc, write-only là chỉ dẫn prompt chưa được validator enforce. Raw reports/labels/fingerprints/scores giữ nguyên; không re-review. CI xác nhận head cuối `0b34b64`; tree merge bằng head. Bốn workflow ≥4service đạt12/12. ff15 model hỏi Slack/Telegram khi cùng có frontend: giữ label Slack cũ, ghi parity chưa đạt; không tự kết luận semantic regression. Services p95 vượt15s; usable-plan rate null, quality gate incomplete. Xem [verification W3-06](../ai-evidence/V3-GOLDEN-V2/W3-06-VERIFICATION.md).

Bằng chứng W3-05 trước đó: sửa generic resource collection grounding tại `979a196`, corrected RED6fail25pass→GREEN31/31; SQL/factory/planner search→comment không chèn memory thủ công. Native/adversarial HTTP probes17/17; redirect không chuyển credentials, aborted201 body UNKNOWN không replay. Snapshot72legacy giữ nguyên; W3-06 cập nhật label rf06 trong commit riêng `1ab7f08` theo người dùng và giữ ngoại lệ Calendar unavailable legacy.

Bằng chứng FE-01 trước đó: đóng hộp thoại lỗi gọi lại Stop → 3 test fail; modal gọi `onStop` khi thiếu `onClose` → 1 test fail; gỡ cả hai lớp chặn demo login → quét bản build fail (sau sửa của reviewer ở `20119b6`).

Audit tuần 2 (Claude Code) chạy probe trên PostgreSQL thật: chết giữa hai step → chạy tiếp được, plan `completed`, không gọi lại step đã xong; chết sau step cuối → tự thành `completed`; skip step `unknown` → step sau dùng đúng output đã lưu.

Chỉ tiêu "tỉ lệ plan dùng được ≥ 70%" **chưa đo** (cần người dùng thật duyệt plan).

## 4. Đã làm gần đây (PR đã merge)

- #52 (AUTH-02), #53 (AUTH-03), #54 (FE-03), merge 04/10 theo thứ tự: đăng ký/xác minh email/quên mật khẩu (token SHA-256 một lần, reset thu hồi phiên, outbox ở sandbox, SMTP TLS ở live); trang quản trị duyệt/khóa/phân quyền trong transaction có khóa; plan hiện tên tài nguyên (`resource_labels` ngoài hash duyệt), kết quả có link an toàn, SSE tự refresh khi 401, chuỗi tiếng Việt. Review: [log](log/2026-10-04-claude-code-review-auth02-03-fe03.md). Golden cần đo lại vì câu chữ planner/registry đổi.
- #41 (AUTH-01), merge `fbd993f` lúc 21:01:00 Việt Nam ngày 03/10: access JWT gắn `sid`, refresh token ngẫu nhiên lưu SHA-256 ở PostgreSQL; CAS rotation một winner, grace 30 giây cho hash ngay trước, replay cũ thu hồi phiên; logout/logout-all và CLI đổi mật khẩu thu hồi phiên. Middleware kiểm phiên và trạng thái tài khoản; role admin và env allowlist dùng chung cho quyền cấu hình. Chặn đoán mật khẩu theo IP/email trong một API instance, burst 12 request sai cho 5×401 + 7×429 sau sửa review. Review độc lập đạt; [CI head `4f5aa47`](https://github.com/VinhDat267/ATI_Project/actions/runs/37126813181) SUCCESS, check927+165 và browser16/16. Chưa làm signup/email/Google/quản trị tài khoản.
- #42 (FE-02), merge `8b6c8e6` lúc 21:05:01 Việt Nam ngày 03/10: route `/`, `/login`, `/c/:id`, Back/Forward và direct reload phục hồi detail/preview/execution; App còn 12 dòng, AuthGate/Workspace/views/recovery hook. Lịch sử title 60 Unicode code points, tìm kiếm, đổi tên và cursor microsecond+UUID; migration0004 backfill một lần. Scroll giữ vị trí khi đọc phía trên. Review độc lập phát hiện rồi xác nhận sửa optional snapshot lỗi làm mất detail/SSE evidence; regression 2 ca và probe độc lập đạt. Retarget từ AUTH-01 sang `main`, tích hợp main chỉ thêm metadata #40, [CI head `c68b4b6`](https://github.com/VinhDat267/ATI_Project/actions/runs/37128235604) SUCCESS: check948+165, browser20/20; cây merge giống head. Không đổi catalog/prompt hoặc đo lại model.
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
- #29 (W3-00), merge tại `c7a38c0`: registry/transport/sandbox tách theo service; allowlist chung theo scopeKey/scopePattern và scopeLabel API; dữ liệu credentials cũ giữ nguyên; live harness đọc bảng service; grounding giữ thêm key. Có guard keyword/static/routing và hợp đồng mở rộng demo qua HTTP/PostgreSQL/planner/factory. Số file sản phẩm hiện có cần sửa khi thêm service giảm 9 → 7; chưa thêm service thật. Review độc lập Đạt, CI xanh trên `ff67b4c`; ngoại lệ `rf06` đã chốt trong W3-00/common/W3-02. W3-01 → W3-05 được gỡ chặn bởi W3-00, riêng W3-02 vẫn cần W3-01.
- #30 (W3-01), merge tại `716f568`: service-account Google và bốn Sheets tools có allowlist, local A1, chống công thức, bounded retries và UNKNOWN không replay; API mã hóa/grounding và sandbox Sheets→Slack. Module auth dùng lại cho Calendar; W3-02 đã gỡ chặn. Google thật/model chưa nghiệm thu.
- #31 (W3-02), merge tại `ab2c599`: ba tool Calendar (list_calendars, list_events, create_event), scope/token riêng khi dùng chung service account với Sheets; allowlist trước mạng, kiểm thời gian và phân trang có giới hạn, create không mời attendees và dùng sendUpdates=none. Lỗi ghi không rõ kết quả thành UNKNOWN, không replay; retry lỗi rate có giới hạn và AbortSignal. API dùng credentials mã hóa, catalog có điều kiện, grounding; browser Calendar→Slack đọc output thực thi từ PostgreSQL. Google thật/model chưa nghiệm thu. Primary `main` đã đồng bộ; worktree Calendar được archive sau khi xác minh tích hợp, giữ nguyên các file riêng của người dùng.
- #32 (W3-03), merge tại `fca384d` lúc 09:55:14 ngày03/10/2026 (Việt Nam): bốn tool Notion search_databases/query_database/create_page/append_text; UUID chuẩn hóa, Database ID allowlist, mapping data source theo API2026-03-11. Query/create yêu cầu một data source; append kiểm source cha tại execution trước ghi. Property values giữ formula/rollup/files/unique_id/place/verification và marker khi snapshot chưa đầy đủ; select chỉ option có sẵn. Limiter3request/giây/token, mọi lệnh ghi không rõ kết quả UNKNOWN không replay. Browser Notion→Slack kiểm URL từ PostgreSQL. CI head dd111c4 xanh, cây merge giống head; primary main đã đồng bộ, giữ nguyên năm file riêng của người dùng. Google/Notion/model thật chưa nghiệm thu.
- #33 (W3-04), merge `4a4553b` lúc11:29:10 Việt Nam ngày03/10: Telegram list_chats/send_message, signed Chat ID chuẩn hóa BigInt, allowlist trước fetch và getChat trước gửi, text thuần, redirect chặn; limiter per token/chat trong process. Indeterminate writes UNKNOWN không replay, 429 chờ có giới hạn. Browser Telegram→Slack kiểm messageId từ output_json PostgreSQL. Primary main đã đồng bộ, năm file riêng SHA256 giữ nguyên, worktree Telegram đã archive và nhánh local/remote đã xóa sau kiểm tích hợp. Telegram thật W3-07 và model W3-06 NOT_RUN.
- #34 (W3-05), merge `dc80de4` lúc13:40:43 Việt Nam ngày03/10: Jira search_projects/search_issues/create_issue/add_comment; Basic email/token, exact site domain, project allowlist, POST search/jql, hai lớp Lucene/JQL escape, plaintext ADF. Create đọc issue types, comment đọc lại project thật; write UNKNOWN không replay. Sửa generic search collection grounding tại `979a196`, SQL/factory/planner search→comment không chèn memory thủ công. Browser Jira→Slack kiểm key/URL từ PostgreSQL. CI head `089a871` xanh, cây merge giống head; primary main đồng bộ, năm file riêng giữ nguyên. Task DB tạm đã dọn, user DB15433 giữ nguyên. Jira/model thật NOT_RUN.
- #39 (W3-08), merge `c5ce8a0`: giới hạn kết quả adapter và phân loại lỗi token Google. Review độc lập sau merge phát hiện hai P2; #45 tại `81225de` đã sửa cả hai, review đạt và CI xanh. Log review trước sửa giữ nguyên lịch sử; kết quả hiện tại theo #45.
- #35 (W3-06), merge `a75ac35` lúc19:02:09 Việt Nam ngày03/10: 44 câu services đăng ký trước, 10 read-tool fixtures mới, scorer theo service và successful read traces, bounded provider pool/AbortSignal/checkpoint, routing116câu ở legacy/full. Label rf06 clarification commit riêng `1ab7f08`; 67 câu khác không đổi. Ba campaign đủ336attempts/source7ba60ef, model ag/gemini-3.8-flash/served gemini-3.8-flash; core150/150, freeform51/54, services111/132. Numeric tools/args đạt cả năm, parity/latency chưa đạt; không sửa sản phẩm/prompt, không thực thi plan. Campaign gián đoạn79/132 giữ riêng, fresh probe trước full rerun. CI head0b34b64 xanh/tree merge bằng head; review I1 docs đã sửa, các giới hạn còn mở ở mục5.
- #25 (chỉ tài liệu): kế hoạch tuần 3–4. Thêm task card cho:
  - năm service mới, có W3-00 gỡ các chỗ viết cố định theo service trước khi thêm;
  - mảng tài khoản: đăng ký có admin duyệt, Gmail SMTP, Google, đăng xuất thu hồi token, trang tài khoản;
  - mảng frontend, lập sau khi review `apps/chat-web`.

  Đặc tả v3 §1.4 và §8.1 có đoạn cập nhật 02/10. W4-03 được sửa để đo ở chế độ live.
- #23 (W2-05): khôi phục an toàn hơn sau khi server khởi động lại. Plan có mọi step `succeeded`/`skipped` tự thành `completed`; plan không có step chưa rõ kết quả mà còn step `pending` được **chạy tiếp** (`POST /api/executions/:planId/continue`, nút "Chạy tiếp các bước còn lại"). Đặc tả v3 §5.8 đã được sửa theo. Bất biến "ghi `running` xong mới gọi service" có test khóa.

## 5. Lỗi và hạn chế đã biết

| Vấn đề | Ở đâu | Ghi chú |
|---|---|---|
| Pure-read response kind và write-only prompt chưa được validator enforce | planner / W3-06 evidence | 18attempts:15refusal/3plan/0clarification; sh07 lượt1/3 và ca01 lượt1 có read plan hợp lệ theo validator. Sáu case0/3kind, ca04 invitation0/3; policy/enforcement cần task riêng, không fit label sau quan sát |
| Parity freeform và latency services chưa đạt | evaluations / W3-06 | ff15=0/3 vì Slack/Telegram cùng frontend; giữ label cũ. Services p95=31,097s vượt15s, max53,021s; usable-plan null, không nghiệm thu sản phẩm từ numeric PASS |
| Legacy Trello member fixture sai output schema | evaluations/golden-v2/fixtures.ts | 531trace thiếu fullName nhưng có name, đã tồn tại ở base; service mới zero schema mismatch. Sửa fixture cần documented rerun, không sửa ngầm context |
| Phục hồi startup chưa có lease/fencing cho nhiều replica | startup reconciliation / recovery | Chỉ một API instance, executor cũ đã dừng; W2-01/W2-02 không cung cấp bảo đảm nhiều instance |
| Các ca lỗi của service thật (token hết hạn, ngoài scope, 429, timeout) mới test bằng dữ liệu giả | adapters | W2-03 chờ scope/plan live và người dùng duyệt lệnh ghi; live failure chưa chạy |
| Notion query/create chưa chọn được data source trong database đa nguồn; relation/rollup là snapshot có giới hạn; page có thể bị di chuyển sau kiểm cha, trước PATCH | `packages/tool-adapters/src/notion/` | Ambiguous source trả VALIDATION; `[incomplete]` khi provider báo thiếu; không tuyên bố kiểm quyền nguyên tử tại API ngoài. Nghiệm thu provider thật W3-07 còn mở |
| Nhánh frontend streaming `text_*` chưa có timestamp và chưa giữ message khi `text_end` | `apps/chat-web` | Minor hoãn sau review W2-04; chưa tìm thấy production emitter, reachability chưa chứng minh (NOT_RUN); xử lý trước khi nối producer này |
| Sandbox dùng planner mock trả một plan soạn sẵn (giao diện đã báo "Chế độ thử nghiệm"); minor sau FE-01: tiêu đề mẫu "Phát hành Sprint" không khớp nội dung, chấm xanh nhấp nháy luôn hiện, dòng "Chưa xác định chế độ chạy" hiện thoáng khi tải | `server.ts`, `MissionControlLaunchpad.tsx`, `App.tsx` | Không demo sandbox như AI thật; minor gom vào FE-03 |
| Lộ tài khoản qua thời gian phản hồi của quên mật khẩu/gửi lại xác minh khi gửi SMTP thật; live không khởi động khi thiếu biến SMTP; chưa có Google login và trang hồ sơ; giới hạn đoán mật khẩu theo một API instance và chưa có giới hạn chung theo IP | `apps/chat-api/src/routes/auth/`, `config/env.ts` | AUTH-02b (trước AUTH-06), AUTH-04, AUTH-05 |
| Golden set chưa đo lại sau FE-03 (câu chữ planner/registry đổi) và sau W3-08 (mô tả tool đổi); thiếu test cho `openWhenHidden` của SSE | evaluations, `apps/chat-web/src/hooks/use-sse.ts` | Đo lại khi có quyền gọi model |
| Tin nhắn Slack chưa đọc lại tự động sau khi gửi | live-execution | |
| Chưa đo hành vi của model khi lịch sử có plan cũ (sau PR #13) | planner | Đo lại ở tuần 4 |
| Hai bộ câu đánh giá do một người viết; prompt đã được chỉnh trên bộ 50 câu | evaluations | Tuần 4: bộ câu do thành viên khác viết |

## 6. Môi trường chạy

- Database: `npm run db:up:v3` (PostgreSQL 16 tại `127.0.0.1:55533`, user/db `ati_v3`). Migration: `npm run db:migrate:v3`.
- `.env` (không commit, không in giá trị ra log): `RUNTIME_MODE` (`sandbox` mặc định), `DATABASE_URL`, `JWT_SECRET`, `ENCRYPTION_KEY`, `CHAT_ADMIN_EMAIL`, `CHAT_ADMIN_PASSWORD`, `SERVICE_ADMIN_USER_IDS`, `LLM_PROVIDER`, `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL`, `PLANNER_SEARCH_MODE`, `APP_TIME_ZONE`, `TRELLO_API_KEY`, `TRELLO_TOKEN`, `SLACK_BOT_TOKEN`, `GITHUB_TOKEN`, `LIVE_TRELLO_BOARD_IDS`, `LIVE_SLACK_CHANNELS`, `LIVE_GITHUB_REPOS`, `GOOGLE_CLIENT_EMAIL`, `GOOGLE_PRIVATE_KEY`, `LIVE_SHEETS_SPREADSHEET_IDS`, `LIVE_CALENDAR_IDS`, `NOTION_TOKEN`, `LIVE_NOTION_DATABASE_IDS`, `TELEGRAM_BOT_TOKEN`, `LIVE_TELEGRAM_CHAT_IDS`, `JIRA_SITE_URL`, `JIRA_EMAIL`, `JIRA_API_TOKEN`, `LIVE_JIRA_PROJECT_KEYS`.
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
- W3-06: người dùng chốt rf06 clarification trước commit `1ab7f08`; labels44services `20fa6f0` trước provider calls. Catalog33tool/8service đóng băng cho phép đo03/10; giữ mốc20/10 và đo lại nếu catalog đổi.
- Mô tả PR và commit **không** có dòng "Generated with …" hay chữ ký của AI.
- Conventional Commits. Một task một nhánh một PR. Chỉ merge khi CI xanh.
- Repo công khai: không commit `.env`, token, `docs/ai-evidence/V3-LIVE-EXECUTION/` hay báo cáo môn học.
- Báo cáo môn học viết tiếng Việt, tiêu đề mục tiếng Anh, giữ thuật ngữ kỹ thuật tiếng Anh, file `.docx`, chữ đen, Times New Roman.
