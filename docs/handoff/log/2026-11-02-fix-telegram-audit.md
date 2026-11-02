# 02/11/2026 · Sửa Telegram sau audit #242

Task: [TELEGRAM-01](../tasks/TELEGRAM-01-audit-fixes.md). Nhánh `fix/telegram-audit`, base `469825d1`. Chủ dự án yêu cầu sửa Telegram trước trong các lỗi audit sáu PR.

## Thay đổi

1. **F1, dispatch sau cancel/pause/update:** TelegramDigestRunner dùng PostgreSQL pool, khóa conversation/schedule/run ngay trước send và kiểm tra owner active, version, trạng thái, kind, digest hash, AbortSignal. Thao tác quản lý lịch và dispatch được serialize. ScheduleRunner lưu `digest_sent`/delivery nếu đã gửi thành công, kể cả có cancel sau send nhưng trước persist.
2. **F7, source GitHub sai tool:** tạo `github.search_issues` với `repo` và query `open` cho từng repo thuộc connection scope. ChatService đưa lookup GitHub hiện tại vào candidate. Thiếu scope/kết nối hợp lệ thì không đề xuất tự gửi. Adapter thật vẫn kiểm scope ở runtime.
3. **F8, pairing backlog:** migration `0020_telegram_update_inbox.sql`, TelegramUpdateRepo và shared BotClient xuyên server → createApp → route. Lưu cursor và update projection trong cùng transaction trước khi request kế tiếp xác nhận offset với Telegram. Chỉ lưu hash state, metadata danh tính/nhóm cần thiết; không lưu raw state hoặc nội dung tin nhắn thường. Private pairing receipt TTL10 phút, metadata group TTL24 giờ, prune khi poll.
4. **Góc giới hạn phát hiện trong review:** riêng getUpdates cho response tối đa1 MiB để nhận trang100 tin hợp lệ; method khác giữ128k. Telegram có thể đổi ngẫu nhiên update_id sau≥1 tuần im lặng; cursor reset sau6 ngày để tránh mốc ranh giới/clock skew, thời điểm last batch chỉ đổi khi có update, xóa ID hết hạn trước insert để nhận ID tái sử dụng.

Các lịch cũ có source `github.list_issues` không bị tự sửa config/hash; cần sửa/xác nhận lại lịch. Runner từ chối và tạm dừng source không còn hợp lệ.

Không đổi ALL_TOOLS, prompt, flag mặc định, frontend, CURRENT-STATE hoặc ROADMAP. Không copy các thay đổi OAuth chưa commit của agent khác trong checkout gốc.

## Bằng chứng RED → GREEN

PostgreSQL16 riêng: container `ati-telegram-fix-20261102`, loopback56672, database `ati_v3`. Test dùng schema riêng qua helper thật; không sửa dữ liệu ứng dụng đang chạy.

| Lượt | Kết quả |
|---|---|
| Baseline chọn lọc trước sửa | 3 files /9 tests PASS, exit0 |
| Cancellation RED | 4/4 FAIL: vẫn có write sau cancel/pause/version, receipt bị discarded |
| Cancellation GREEN | 6/6 PASS gồm2 existing; thêm test thực tế `FOR UPDATE NOWAIT` trả55P03 khi send đang giữ khóa |
| GitHub RED | 4/4 FAIL: adapter không có list_issues, thiếu scope vẫn quảng bá auto |
| GitHub GREEN | Candidate chạy qua GitHubAdapter thật, hai query literal `repo:acme/ati is:issue is:open`, `repo:acme/ops is:issue is:open`; proposal/confirm/runner cùng đạt |
| Pairing RED | Không tìm được update101; module durable store chưa có |
| App wiring RED | Callback HTTP200 nhưng inbox không có row vì createApp chưa truyền client |
| Pairing/app GREEN | Backlog nhiều trang, hai người/client restart, trigger SQL từ chối persistence, real AbortSignal, TTL và callback qua app đều đạt |
| Long-message RED → GREEN | Trang100 tin×4000 ký tự bị server(200) do cap128k; sau sửa BotClient7/7 PASS |
| Review idle-cursor RED | 3 FAIL: offset cũ xác nhận mất update101; empty poll đổi last timestamp; memory fallback mất pairing mới |
| Review fix GREEN | 3 files /19 tests PASS, exit0: cancellation5 + PostgreSQL inbox6 + BotClient8 |

Các fixture chỉ thay HTTP provider ở rìa. Cancellation/approval/state/query/transaction thực sự chạy trên PostgreSQL. Test GitHub gọi implementation adapter thật; Telegram write probe cũng đi qua TelegramAdapter thật với transport fixture. Không có mock boolean thay cho concurrency database.

## Kiểm tra cuối

- Focused trước các boundary cuối:8 files /32 tests PASS, exit0.
- `npm run typecheck:v3`: PASS, exit0.
- Full `npm run check` trước sửa boundary cuối: PASS, exit0.
- Full check cuối sau tất cả source edits: **PASS, exit0**. **3.160 test v3** (341 schemas +468 adapters +381 planner +42 executor +968 API +960 web), **406 eval fixture**, **32 Node adapter tests**, **1 launcher**, **66 Node infrastructure tests**, typecheck/build/build-security. Có19 regression test mới so với baseline backend.
- `git diff --check`: PASS.
- Fresh native provider/model và fresh local full browser: NOT_RUN. Không suy diễn fixture/model giả là acceptance live.

Lệnh kiểm tra:

```powershell
$env:DATABASE_URL='postgres://ati_v3:ati_v3_local_only@127.0.0.1:56672/ati_v3'
npm run db:migrate:v3
node node_modules/vitest/vitest.mjs run apps/chat-api/tests/services/schedules/telegram-digest-cancellation.test.ts apps/chat-api/tests/db/telegram-update-repo.test.ts apps/chat-api/tests/services/telegram-bot-client.test.ts --maxWorkers=1
npm run check
```

Log cục bộ ở `%TEMP%/ati-telegram-*`: baseline-tests, cancellation-red/green, github-red/green, pairing-red/green, app-wiring-red, body-limit-red/green, idle-red/green, focused-r2, typecheck, full-check-final.

## Review độc lập

Reviewer đọc toàn bộ diff cùng files mới; chạy lại3 files /13 tests PASS; phát hiện1P2 stale cursor sau bot idle≥1 tuần. Đã sửa bằng ba regression RED → GREEN. Re-review delta chạy lại2 files /14 tests PASS, exit0; repro cũ nay `matched:true`, không gửi offset cũ, inbox có101/cursor102. Reviewer xác nhận đóng P2, không còn P1/P2/P3 trong phạm vi sửa.

## Phụ thuộc triển khai và bàn giao

- [PR#246](https://github.com/VinhDat267/ATI_Project/pull/246), head `3c75e7c0`, đã có CI SUCCESS trong phiên. Cần tích hợp bản sửa rerun migration đó trước triển khai lên database đã có digest/OAuth state mới. Không trộn SQL của PR#246 vào task Telegram này.
- Không merge main, bật flags, ghi provider thật hoặc triển khai production.
- Commit implementation: `087ddd0f95f62337e9d49deceae9edcc2c6f2c19`. PR gửi từ `fix/telegram-audit` vào main; URL và CI được trả trong bàn giao phiên.
