# 2026-10-02 · Codex · W3-01 Google Sheets

- Task: `docs/handoff/tasks/W3-01-google-sheets.md`, cùng `W3-service-common.md`.
- Base: `c7a38c0c79aa7753771315b95759431158054977` (W3-00 PR #29 đã merge).
- Nhánh: `vinhdat/feat-w3-01-google-sheets`; PR [#30](https://github.com/VinhDat267/ATI_Project/pull/30), chưa merge.
- Implementation: `4df22690aae871fc3372e6e09ecc37bcf4dbb10f`; snapshot riêng: `3a68a65d91494c7f6cd530eda8f24ef264b789ba`.

## Thay đổi

- Module `tool-adapters/src/google/service-account.ts` ký RS256 bằng node:crypto, cache email/scope/key, refresh trước hạn 60 giây, hỗ trợ PEM literal backslash-n. Calendar dùng lại module với scope riêng.
- Schema/registry Sheets và các index đăng ký bốn tool: list_spreadsheets, list_sheets, read_range, append_rows. Tên/tab trả id và title phù hợp grounding, gồm sheetId=0.
- Adapter/transport: explicit allowlist trước mạng, bucket 60/phút/account, local A1, kiểm tab thuộc spreadsheet trước append, chống công thức = + - @ sau whitespace. AbortSignal tới mọi fetch; timeout/mất mạng/5xx hoặc response ghi không xác nhận được → UNKNOWN, không tự chạy lại. CheckConnection chỉ đọc title nhẹ.
- Sandbox sheets_slack đọc → append → Slack qua `$template` updatedRange; browser spec và runner kiểm output_json thật. Live-services và .env.example khai báo ba env Sheets, không giá trị thật.
- Test riêng auth/adapter/schema/router/API/sandbox/live config; các assertion cũ chỉ tăng count/list catalog và mục missing credentials. Không dependency mới, không sửa routing policy, prompt, v2, production frontend, CURRENT-STATE hoặc ROADMAP.

## Snapshot riêng

72/72 tuyến catalog Trello/Slack/GitHub giữ nguyên; 69/72 tuyến full catalog giữ nguyên. Ba câu dùng fallback full catalog nay thêm Sheets, đã giải thích trong commit riêng:

1. `golden:rf03`, "Gửi email cho khách hàng về lịch bảo trì hệ thống": không khớp service đã đăng ký; fallback mở rộng, không tuyên bố hỗ trợ email.
2. `golden:rf06`, "Schedule a Google Calendar meeting with the frontend team tomorrow at 3pm": Calendar chưa đăng ký; fallback mở rộng, không áp dụng ngoại lệ Calendar hoặc đổi label refusal.
3. `freeform:ff15`, "Let the frontend team know the deploy finished": không service keyword, fallback mở rộng.

Không đổi prompt/label hoặc kết quả model.

## Bằng chứng

- Baseline `npm run check` exit 0: 569 v3 +84 offline evaluations.
- TDD foundation RED 13/15 → GREEN 15/15; adapter RED 27/27 → GREEN 27/27; API/sandbox RED 2/2 → GREEN 2/2. JWT kiểm chữ ký bằng public key thật; write timeout kiểm AbortSignal thật; lỗi sanitized và allowlist zero-fetch.
- API dùng HTTP + PostgreSQL thật: credentials ciphertext round-trip, API metadata không trả bí mật, catalog có điều kiện, planner search/prefetch spreadsheet và tab id=0, grounding từ chối ID/title giả.
- Live config/router snapshot RED 2/16; evaluation đầu RED 2/85. Regression đầu có năm assertion count/list cũ cần tăng theo service mới; không bỏ kiểm hành vi cũ.
- `npm run check` exit 0: **613 v3** (41 schema, 94 adapters, 133 planner, 25 executor, 159 API, 161 web), **85 offline evaluations**; typecheck, build, secret scan, 1 launcher +3 local-env đạt.
- `npm run test:browser:v3` exit 0: **10/10** (default5, clarification1, partial_failure2, three_service1, sheets_slack1), HTTP/SSE + PostgreSQL thật và planner/adapters sandbox. Ba bước Sheets → Slack succeeded; Slack output_json chứa updatedRange của append.
- Log đầy đủ và screenshot để ngoài repo tại Codex W3-01 evidence directory; không commit raw logs/private key fixture. Database riêng ati-w301-pg, localhost5432; không dùng database của người dùng localhost15433.
- Review độc lập và CI head cuối đang chờ; cập nhật trước hoàn tất PR.

## Tài liệu chính thức đọc ngày 02/10/2026

- [Service-account JWT](https://developers.google.com/identity/protocols/oauth2/service-account).
- [spreadsheets.get](https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets/get), [values.get](https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets.values/get), [values.append](https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets.values/append).
- [A1 notation](https://developers.google.com/workspace/sheets/api/guides/concepts), [USER_ENTERED](https://developers.google.com/workspace/sheets/api/reference/rest/v4/ValueInputOption), [usage limits](https://developers.google.com/workspace/sheets/api/limits). Bucket chung 60/phút/account thận trọng hơn tách quota read/write.

## Giới hạn và tiếp theo

- Google Sheets thật NOT_RUN; không credentials thật hoặc live writes. Live read khi có tài khoản W3-07, ghi thật thuộc W3-07. Model/golden campaign thuộc W3-06.
- Service mới dùng planner search llm, không regex gather theo yêu cầu chung. Grounding chưa giữ parent tab/spreadsheet; adapter kiểm tab trước POST, không sửa core planner theo card.
- Quyết định phạm vi: bốn tool trong card W3-01 người dùng đã giao thay appendix catalog ứng viên cũ có update_cells. Nếu sai, cần chốt lại scope trước live acceptance; không tool update/delete được mở.
- PR #28 metadata riêng; reviewer cập nhật CURRENT-STATE/ROADMAP sau merge. W3-02 dùng auth chung sau khi W3-01 merge, tách token scope và giữ quyết định rf06.
