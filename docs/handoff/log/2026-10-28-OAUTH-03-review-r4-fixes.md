# OAUTH-03 — sửa hai P2 của review vòng 4

Ngày: 28/10/2026. Task: [OAUTH-03](../tasks/OAUTH-03-personal-sheets.md).
PR: [#180](https://github.com/VinhDat267/ATI_Project/pull/180).
Nền sửa: `c4be6fa47c10220aed88c8028946194ce2f70aa3`; nhánh làm việc riêng `fix/pr180-lookup-safety`, cập nhật nhánh PR `feat/oauth-03-personal-sheets`.

Người dùng yêu cầu tự sửa hai P2 ở [review vòng 4](https://github.com/VinhDat267/ATI_Project/pull/180#issuecomment-6463497171). Phiên này chuyển sang thi công; kết quả dưới đây là bằng chứng của người sửa, chưa thay thế review độc lập.

## Thay đổi

- `apps/chat-api/src/services/chat-service.ts`: lookup runtime lỗi hoặc sai dạng phải làm lượt lập kế hoạch báo lỗi. Không nuốt lỗi rồi dự đoán đích ghi bằng tên Picker cũ; không thử nguồn khác để che lỗi của nguồn đã cấu hình. Caller không cấu hình lookup vẫn dùng helper tĩnh như trước.
- Truyền signal của `planScheduledRun` qua `prepareResponse`, `bindConnections` tới adapter. Lookup có deadline mặc định 10 giây, áp dụng cả chat và hook; race bảo đảm hook bỏ qua signal không giữ pipeline quá hạn. Kiểm lại signal sau khi lấy adapter để tránh gửi request muộn, và trước khi lưu kết quả lượt lịch.
- `apps/chat-api/src/services/gmail/connection-reference.ts`: hook tra cứu nhận context có signal tùy chọn.
- `apps/chat-api/tests/services/mysheets-planning-lookup.test.ts`: 9 ca kiểm PostgreSQL thật, MessageRepo/PlanRepo, AdapterFactory, PersonalSheetsAdapter và native HTTP cục bộ. Chỉ thay model/token provider bằng đầu vào kiểm soát; kiểm kết quả lưu plan, SSE và đóng kết nối HTTP thật.
- Chỉ cập nhật phần Kết quả của task card và thêm log này; không sửa CURRENT-STATE/ROADMAP, assertion cũ, prompt, label hay kết quả đo model.

## Bằng chứng mới

Các lệnh chạy trong worktree review `043f/ATI_Project`; log cục bộ ở `.codex/pr180-fix/`, không commit log chứa phiên trình duyệt.

1. RED trước sửa:
   `npx vitest run apps/chat-api/tests/services/mysheets-planning-lookup.test.ts`
   → **6 failed | 3 passed (9)**, exit **1**. Sáu ca bắt lỗi 503, 401, kết quả sai dạng, hủy lượt lịch sau dispatch, deadline chat và hook bỏ qua signal. Ba ca bình thường pass. Log `red.log`.
2. GREEN sau sửa, cùng hai file test MySheets/Schedules liên quan:
   → **3 files passed, 42 tests passed**, exit **0** (`green.log`).
3. `npm run check` → exit **0** (`check-ready.log`):
   - typecheck sạch;
   - **2.509 test v3** = 67 schemas + 443 adapters + 381 planner + 42 executor + **693 chat-api** + 883 chat-web;
   - **406 eval**, build và quét build đạt;
   - **11 launcher/env** đạt.
   Lượt đầu (`check.log`) exit 1 vì quên migrate schema public của DB tạm: 22 test API fail, 20 skip, kèm một rejection từ fixture khi cleanup sau lỗi thiếu bảng. Đã chạy `node db/v3/migrate.mjs` trên đúng DB tạm và chạy lại cả check; không sửa test để vượt lỗi.
4. Probe HTTP/OAuth giả từ review vòng 4 chạy lại sau sửa (`live-lookup-probe.mts`, `.log`) → exit **0**, **REAL_HTTP_REVIEW_FAILURES 0**:
   - hai chiều đổi tên vẫn đúng qua lookup thật, validator và executor resolver;
   - sau hai HTTP 503, kết quả **blocked**, không có plan dựa trên tên cũ;
   - sau AbortController thật: `adapterReceivedSignal:true`, `stateAfterAbort:rejected`, `pendingHttpResponses:0`, `cancellationIgnored:false`.
5. `node scripts/test-mysheets-mutations.mjs` → **13/13 caught**, runner exit **0**, từng mutant exit **1** (`mutations-original.log`).
6. Bốn đột biến hồi quy cục bộ (`mutate-regressions.mjs`, `mutations-new.log`) → **4/4 caught**, runner exit **0**:
   - nuốt lỗi lookup và dùng lại tên cũ;
   - bỏ signal của người gọi;
   - chỉ ngừng chờ nhưng không truyền signal hủy xuống HTTP;
   - bỏ race, khiến hook không hợp tác giữ lượt quá hạn.
   Mỗi mutant exit **1**; khôi phục `chat-service.ts` đúng SHA-256 `8cb3d21c083427a3c0105162ff3dd9bf1bced3bd9cd8c61a87d6d1263681ad29`. Chạy lại test mới sau khôi phục → **9/9 pass**, exit **0** (`green-restored.log`).
7. Browser, cùng mã nguồn sau sửa, không sửa assertion hay tăng timeout:
   - `npm run test:browser:v3`: exit **1** ở nhóm default — **92 pass, 4 fail, 1 skip** (`browser.log`). Các nhóm sau default chưa chạy trong lệnh này.
   - Bốn ca lỗi: FE-05 "late snapshot: new error ... after terminal" (`route.fetch: Test ended`), FE-08 "pending and disabled email accounts" (timeout `page.goto('/login')`), hai ca v3-sandbox "recovery after reload" và "Continue safe pending after reload" (timeout chụp ảnh/chờ font).
   - Chạy lại đúng bốn ca qua `SCENARIO=default GREP=... node scripts/test-v3-browser.mjs` → **4/4 pass**, exit **0**, 19,7 giây (`browser-retry.log`). Chỉ ghi nhận lỗi không tái hiện ở lần chạy riêng; chưa kết luận nguyên nhân.
   - Chạy riêng từng nhóm còn lại với `SCENARIO=<nhóm> node scripts/test-v3-browser.mjs`: **15/15 lệnh exit 0, tổng 71 pass**. Chi tiết: auth02 2, auth04 6, clarification 3, partial_failure 2, three_service 1, sheets_slack 1, calendar_slack 1, notion_slack 1, telegram_slack 1, jira_slack 1, answer 4, gmail 10, mycalendar 7, mysheets 9, schedule 22. Log `browser-<nhóm>.log`.
   - Các nhóm đã có bằng chứng pass qua nhiều lần chạy (**167 pass**, còn 1 skip ở default); **không có một lượt browser tổng exit 0**. Giữ nguyên giới hạn này khi review, không dùng kết quả chạy lại để gọi lượt đầu là xanh.

## Giới hạn và trạng thái

- DB kiểm thử riêng: unit/probe 56634, browser 56633. Không dùng `.env` hay DB dev ở 55533. Sau khi mọi lệnh kết thúc, đã xóa đúng hai container tạm `ati-pr180-fix-pg` (`19c9d1b99f8b`) và `ati-pr180-fix-browser-pg` (`697a58eb27a1`); DB dev `ati-v3-postgres-1` ở 55533 còn chạy.
- `EVAL_SET=mysheets` ×3 và Google thật/P-LIVE: **NOT_RUN**, thuộc các bước sau PR code. `MYSHEETS_ENABLED` vẫn mặc định **off**.
- Không merge. Cần review độc lập lại sau bản sửa; CI đúng head được đối chiếu trên PR sau push.
- Các thay đổi có sẵn ở main (.gitignore, PRODUCT.md, member-1..4.json, skills-lock.json) được giữ nguyên. Bốn log review cục bộ trước đó không được đưa vào commit sửa này.
