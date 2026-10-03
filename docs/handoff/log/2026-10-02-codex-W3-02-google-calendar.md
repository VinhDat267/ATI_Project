# 2026-10-02 · W3-02 · Google Calendar

- Task: [W3-02](../tasks/W3-02-google-calendar.md), common service requirements; PR [#31](https://github.com/VinhDat267/ATI_Project/pull/31) draft, chưa merge.
- Base `716f568f0004b799d179306e3340786abf554c4d` sau PR30 merge. Managed worktree riêng, nhánh `vinhdat/feat-w3-02-google-calendar`; giữ năm file riêng primary theo SHA256. PR28 metadata riêng, không có trong implementation.
- Đọc CURRENT-STATE, README handoff, ba log mới nhất, PROJECT-REPORT, README, AGENTS, team-workflow, task/common và đặc tả v3 trước triển khai. Snapshot CURRENT/ROADMAP trên main còn cũ do PR28 chưa merge; dùng Git/PR và task card đã chốt làm bằng chứng nguồn.
- Baseline main: check626v3+85eval exit0. Không SDK/dependency mới, không sửa v2, production frontend, prompt, lõi planner/executor hoặc label/provider campaign.

## Thay đổi và commit

- `6979777d7f21b55a31563ff828ef02ca9f3121c6`: Calendar registry, ba tool schemas, adapter, transport/API, sandbox, browser và live registration.
- `93cd06cb41099ccb71f375115a4e319f86feff1b`: snapshot riêng. `golden:rf06`: legacy3 từ fallback sang[], full từ fallback sang['calendar'] đúng ngoại lệ đã duyệt. `golden:rf03` và `freeform:ff15`: full fallback thêm Calendar; legacy không đổi. Không câu nào khác đổi, không nới guard hay sửa label refusal.
- `eededde64e9add0701efe2e2c0a4ae2dddc33dd5`: chặn ID dot-segment có thể bị URL normalize sang đường dẫn khác.
- `e426215575a062f13b15be002ec5f5c8556527ae`: xử lý trang events rỗng còn nextPageToken, chặn token lặp và giới hạn20trang; không trả kết quả thiếu âm thầm.
- Sau đăng ký: **23 tools, năm service**; Google credentials mã hóa riêng theo service, token cache gồm scope. Calendar scopes events+readonly; không domain-wide delegation, attendees, notification hoặc tool xóa/chia sẻ.
- Trước mọi fetch: scope/ID, hình dạng input, ngày có thật, timezone, end>start, event≤24h/read window≤31 ngày. Ghi 5xx/mất mạng/body không xác định → UNKNOWN, không replay. Chỉ rate rejection rõ ràng retry một lần có AbortSignal/Retry-After.
- Cùng PR sửa live CLI check: mọi service dùng directory/listable contract, giữ child-resource check; trước đây service mới rơi vào nhánh GitHub và discovery thiếu import. Không thực hiện live request.

## Tài liệu API (đọc 2026-10-02)

- [calendars.get](https://developers.google.com/workspace/calendar/api/v3/reference/calendars/get), [events.list](https://developers.google.com/workspace/calendar/api/v3/reference/events/list), [events.insert](https://developers.google.com/workspace/calendar/api/v3/reference/events/insert).
- [Events](https://developers.google.com/workspace/calendar/api/v3/reference/events), [CalendarList](https://developers.google.com/workspace/calendar/api/v3/reference/calendarList), [errors](https://developers.google.com/workspace/calendar/api/guides/errors), [quota](https://developers.google.com/workspace/calendar/api/guides/quota).
- Ngoại lệ common403: chỉ rateLimitExceeded/userRateLimitExceeded → RATE_LIMIT theo Google;403 khác AUTH_ERROR. Calendar description hỗ trợ HTML nên escape dữ liệu người dùng. Limiter nội bộ60/phút/account là giới hạn bảo thủ, không khẳng định quota cấp thật. Calendar ID email/holiday/opaque ASCII bounded; không aliasprimary. ISO có giây và timezone; location≤1000.

## Bằng chứng local

- Foundation RED5failed/6 → GREEN47/47; adapter RED36/36 → GREEN36/36.
- HTTP + PostgreSQL thật + planner grounding/sandbox RED3/3 → GREEN3/3: encrypt/decrypt roundtrip, catalog có điều kiện, metadata không secrets, kết nối đọc nhẹ, factory thực, quan sát id/title, fabricated ID bị từ chối trước fetch.
- Live CLI check RED6/6 → GREEN6/6 cho năm service và child ids. Fetch/LLM trong các contract test là scripted, không phải nghiệm thu nhà cung cấp.
- Calendar browser RED1/1 (chưa đăng ký scenario) → GREEN1/1. Full browser tại93cd06c: **11/11**, gồm default5/clarification1/partial_failure2/three_service1/sheets_slack1/calendar_slack1. Calendar và Slack succeeded, URL/start từ event có trong Slack output_json thật. Screenshot xác nhận2/2; raw evidence ngoài repo.
- Dot-segment RED2/38 → GREEN39/39 adapter+schema; pagination RED2/40 → GREEN40/40. Real AbortSignal hủy request ghi in-flight → UNKNOWN, một dispatch; cùng service account dùng hai token đúng scope.
- Check sourcee426215 exit0: **675 v3 +91 offline eval**, typecheck/build/secret scan, launcher1/local-env3. Strict test/evaluation harness tsc exit0. Snapshot15/15, legacy guard[]; không đo lại model.

## Review và giới hạn

- Reviewer độc lập toàn nhánh `716f568..441f485`: Critical0/Important1/Minor0, verdict With fixes; check675v3+91eval, strict harness, browser11/11 và tám nhóm edge probes đều exit0. Báo cáo/diagnostics lưu ngoài repo; reviewer không sửa source/index/HEAD và không gọi thêm subagent.
- Sửa Important trong một pass tại `008969073906f279d5ef75578c6dc4ae8f032ec3`: helper chung cắt Retry-After xuống30giây; Calendar nay dừng RATE_LIMIT khi header giây/HTTP-date vượt ngân sách30giây, không replay sớm. RED2failed/42 → GREEN42/42; fullcheck **677v3+91eval**, strict harness, browser **11/11 exit0** sau sửa. Không re-review, không minor bị hoãn.
- Bàn giao tiếp ngày **2026-10-03**: CI source441f485 SUCCESS run37030150912; headfix0089690 chưa được coi là PASS vì lần đầu lỗi test reload đọc body response bị navigation bỏ qua, lần sau CANCELLED ở cài Chromium. Chỉ chuyển PR sang ready sau CI head cuối SUCCESS; chưa merge.
- Google/model thật **NOT_RUN**; không tài khoản thật được cấu hình, không paid/provider call hay external write. Thời gian tương đối và rf06label/guard dành W3-06, live read/write acceptance dành W3-07.
- Không sửa CURRENT-STATE/ROADMAP trong PR này; reviewer cập nhật sau merge.

## Quyết định và giới hạn sau review

Theo thứ tự ledger; mỗi mục ghi hệ quả nếu giả định không đúng:

1. Chỉ hai reason rate-limit403 được Google tài liệu hóa → RATE_LIMIT;403 khác AUTH_ERROR. Nếu sai, có thể thêm một request sau từ chối rõ ràng; không replay UNKNOWN.
2. Live CLI kiểm tra directory đã đăng ký và child-resource thay nhánh GitHub cố định; nếu sai, kiểm tra reachability có thể thiếu chẩn đoán riêng nhà cung cấp.
3. Credentials/quyền/quota, insert-readback, notifications và synchronization thật: NOT_RUN, W3-07; nếu sai, hành vi Google thật còn chưa được xác minh.
4. Reduced/private-event payload và htmlLink theo mọi sharing role: không có live role matrix, thiếu trường bắt buộc fail closed; nếu sai, cần cập nhật hợp đồng adapter cho response thật.
5. Provider response có trường chuỗi nhưng nội dung sai: không chứng nhận semantic response; nếu sai, có thể cần thêm kiểm tra timestamp/URL thay vì chỉ hình dạng.
6. Lỗi đọc body sau headers: SERVER_ERROR, hiển thị thất bại, không retry riêng; nếu sai, một số lỗi đọc tạm thời cần retry thủ công/chính sách mới.
7. Thời gian tương đối/model quality/semantic acceptance/rf06label: W3-06 và NOT_RUN; nếu sai, routing offline không chứng minh model đạt.
8. Invitation/domain-wide delegation/recurrence/update/delete/share/user OAuth: ngoài ba tools đã duyệt; hệ quả là các khả năng đó chưa có.
9. Allowlist rất lớn, throughput, refresh dedup/cache eviction, quota nhiều process và load: chưa benchmark; nếu sai, triển khai production cần bằng chứng vận hành/hiệu năng thêm.
10. Auth/session/UI/recovery toàn repo và fencing nhiều replica: ngoài diff này, chỉ chạy lại suites cũ; nếu sai, W3-02 không chứng nhận an toàn/khôi phục toàn nền tảng.
11. Tái dựng mọi RED lịch sử: reviewer chỉ chạy tests/probes hiện tại, giữ logs RED của implementer; nếu sai, các ghi nhận lịch sử chỉ là bằng chứng audit của implementer.
12. PR formatting/CI head cuối/merge/CURRENT-STATE/ROADMAP: agent chính hoàn tất PR+CI, cập nhật reviewer-owned state sau merge; nếu sai, không được tuyên bố merge readiness trước CI xanh và quyết định merge của người dùng.
