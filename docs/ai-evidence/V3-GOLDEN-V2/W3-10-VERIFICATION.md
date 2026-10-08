# W3-10 — kiểm chứng cập nhật main và đo live

PR [#102](https://github.com/VinhDat267/ATI_Project/pull/102), nhánh `fix/w3-10-read-only-latency`. Đã đủ đối chứng core/services một lượt và ba lượt cho cả ba bộ sau sửa. Read-only 18/18 và strict parity đạt. **Services p95 20.138s: chưa đạt mục tiêu dưới 15s.** Các campaign chạy ngày 08/10 UTC, từ tối 08/10 đến rạng sáng 09/10 tại Việt Nam.

## Source và review

- `5afc0a7` nhập main `e269743`. Conflict hai file provider/test với #113 được giải quyết bằng bản #102: giữ guard alias, `lastCallMetrics` và assertions. Focused sau merge: 168/168, exit 0.
- P1 của review `b2cbfa2` đã sửa tại `a9f1030`: prefetch trước model call đầu, phase `prefetch`, directory có trong `WorkingMemory.__observed`. Rule0, `READ_ONLY_PLAN`, câu hỏi cố định không gọi repair và mixed read/write vẫn có test. [Log sửa trước](../../handoff/log/2026-10-08-codex-W3-10-fix.md).
- Reviewer độc lập tại `5afc0a7`: 361/361, 27 files; evaluation typecheck exit 0; 6/6 mutation bị bắt (prefetch, validator, phase, metrics, alias, redaction).
- P2 mới: exporter che response nhưng còn để prompt đầy đủ trong `searches[].args.query`. Commit `58d4fcd` che toàn bộ case projection sau scoring. Test đi qua `main()`, planner, fixture, scorer và writer; dữ liệu chấm điểm gốc vẫn giữ. Test phase/429 cũ cũng được sửa dùng tool hợp lệ, kiểm lookup thật.
- Review độc lập `58d4fcd`: 362/362, evaluation typecheck exit 0; raw probe giữ query trước export; mutation bỏ sanitizer writer làm đúng test mới fail (1 fail/12 pass, exit 1). Review code đạt; reviewer chấm lại services 132 lượt và aggregate đều khớp.
- TDD bổ sung tại `9e887d2`: prompt còn có thể nằm trong tên khóa JSON. RED 1 fail/12 pass, exit 1; sanitizer nay che cả khóa và giá trị trên bản public, giữ số nguyên và dữ liệu gốc. GREEN 362/362 và evaluation typecheck exit 0. Commit này chỉ sửa export sau scoring; planner/provider/prompt/labels/fixtures giống source đo `58d4fcd`, nên không gọi lại model.
- Reviewer độc lập `9e887d2`: 362/362 + evaluation typecheck exit 0. Probe thêm bản gốc deep-frozen, số/null/boolean và khóa `__proto__`: baseline 14/14; mutation bỏ che tên khóa gây 2 fail/12 pass, exit 1. Packet 23 file, 76.695 decoded keys/values, 112 prompt + 23 secret env, 0 vi phạm; 17 hash PUBLIC-AUDIT và cả 7 raw/public report khớp. Code/evidence đạt trong phạm vi review; mục tiêu p95 vẫn chưa đạt.

## RED/GREEN và kiểm tra local

| Ca/lệnh | Output thật |
|---|---|
| RED P1 trước `a9f1030` | 2 failed / 21 passed, exit 1 |
| RED phase/scorer trước sửa | 2 failed / 10 passed, exit 1 |
| RED export trace trước `58d4fcd` | 1 failed / 12 passed, exit 1; decoded report chứa full prompt trong query |
| RED lookup thật trước sửa tên tool | 1 failed / 12 passed, exit 1; expected 1 trace, actual 0 |
| RED tên khóa JSON trước `9e887d2` | 1 failed / 12 passed, exit 1; prompt còn trong nested object key |
| GREEN planner + golden-v2 | 362/362, 27 files, exit 0 |
| `npx tsc -p evaluations/golden-v2/tsconfig.json --noEmit` | exit 0 |
| `npm run check` tại `9e887d2` | 1544 v3 = 47+340+212+25+353+567; 173 eval; exit 0 |
| `npm run test:browser:v3` tại `9e887d2` | 73/73, 11 scenarios, exit 0 |

Lần browser đầu tại `58d4fcd` có 55 pass/1 fail trong nhóm default, exit 1: FE-02 scroll tại line113 chờ80 nhưng nhận16268. Lưu DOM và output ngoài repo. Test chỉ chờ user message được gắn vào DOM trước khi cuộn lên; khả năng phản hồi/auto-scroll còn đến muộn là suy luận, chưa chứng minh event ordering. Chạy riêng `--repeat-each 5`: 5/5, exit 0. Sau đó chạy lại toàn bộ một lần: 73/73, exit 0. Không sửa frontend trong lần cập nhật này; chưa sửa căn nguyên ca FE-02 chập chờn. Kết quả xanh không xóa lần fail trước.

PostgreSQL riêng `ati-w3-10-resumed-pg`, postgres16, `--tmpfs /var/lib/postgresql/data`, DB55472/API3072/web5172, `RUNTIME_MODE=sandbox`. Migrate và provision trước kiểm tra. Không dùng DB15433. Timeout model/directory và sibling abort dùng `AbortSignal` thật. RED/GREEN không gọi model.

Output tại `C:/Users/VinhDat/AppData/Local/Temp/ati-w3-10-resumed-2026-10-08/`: `privacy-red.txt`, `valid-search-red.txt`, `final-focused-green.txt`, `privacy-key-red.txt`, `privacy-key-green.txt`, `check-after-58d4fcd.txt`, `browser-after-58d4fcd.txt`, `fe02-browser-failure-context.md`, `fe02-repeat5.txt`, `browser-rerun-58d4fcd.txt`, `check-after-9e887d2.txt`, `browser-after-9e887d2.txt`. Artefact review tại `C:/Users/VinhDat/.codex/w3-10-review-5afc0a7-890076ec/`.

## Model thật

Request `ag/gemini-3.8-flash` qua 9router, served `gemini-3.8-flash-n`. Source sau sửa `58d4fcdec284767c35f69e5d5c581046fb12f9ae`; control `7898aa7` = `8155c03` + exact alias, diff chỉ provider/test (26 insertions, 1 deletion). Control có node_modules riêng, không thêm policy/metrics/label mới. Deadline30s, timeout retry 1, HTTP retries 2 và cấu hình gateway giữ nguyên. Mỗi campaign chạy tuần tự, concurrency 2; diagnostic riêng ca04 concurrency 1.

| Bộ | Control hiện tại | Sau sửa | Calls / attempts / timeout sau sửa | p50/p95 sau sửa | Dưới15s |
|---|---|---|---|---|---|
| core | 50/50 strict, 57 calls | 150/150 strict | 168/168/0 | 7.229/18.021s | 136/150 (90.7%) |
| freeform | NOT_RUN, không yêu cầu control | 52/54 strict | 63/64/1 | 10.108/24.738s | 42/54 (77.8%) |
| services | 37/44 strict, 57 calls | 129/132 strict | 135/137/2 | 8.242/20.138s | 117/132 (88.6%) |

Read-only 18/18: clarification, 1 call, 0 phase search; directory prefetch được phép. Core giữ150/150; freeform tăng51→52/54, chỉ ff15 trượt runs1/3. Services chỉ ca04 refusal cả3 runs, giống W3-06. So từng lượt với một control run: core3 giảm/147 bằng/0 tăng; services18 giảm/114 bằng/0 tăng. Mọi ca ghi giữ số call.

Đuôi services có15 lượt chậm: tất cả1 call/0 search; 2 timeout rồi retry, 13 thành công trong1 attempt. Thời gian lời gọi model chiếm 99.9623%; directory/search dùng fixture, chưa đo adapter thật. Không tách được queue/mạng/suy luận phía gateway. Chưa có bằng chứng rút deadline giúp13 lượt chậm không retry; giữ deadline/retry, ghi khoảng cách p95 để quyết định task tiếp.

Control lúc16:36Z dừng17/44 vì ca04 timeout60026ms, no01 bị hủy ở call3; giữ riêng. Diagnostic ca04 nhận response16.500s lúc16:40Z. Sau cả336 lượt sau sửa hoàn tất, chạy control services mới từ đầu lúc17:13Z, đủ44/44. Không ghép sample hoặc tự retry campaign đến khi xanh.

[Comparison](W3-10-COMPARISON.md), [manifest UTC](w3-10-resumed-2026-10-08/CAMPAIGN.json), [analysis/audit](w3-10-resumed-2026-10-08/ANALYSIS.json), [read-only](w3-10-resumed-2026-10-08/READ-ONLY-POLICY.json). Label `795229e` đứng trước report đầu `66896ca` (git ancestry exit0); không đổi112 prompt hay label trong lần đo này. Raw giữ ngoài repo; public copies lọc toàn report sau scoring, giữ stored score/passed/calls/latency và SHA256 đối chiếu. Control/history attempts và usage N/A. Usage sau sửa là phần nhận được, không tính tokens của timeout không có response và không cộng reasoning hai lần.

## Giới hạn bàn giao

Đủ phép đo được yêu cầu; **latency p95 vẫn chưa đạt**. Usable-plan rate, ghi dịch vụ thật, latency adapter production và đo live qua frontend: NOT_RUN trong W3-10. Một lượt control so ba lượt sau sửa có biến thiên model/thời điểm, không khẳng định nhân quả chính xác. Env gốc nạp bằng `--env-file`, không in/copy/commit. Không sửa CURRENT-STATE/ROADMAP, không tự merge. Packet đã review độc lập; CI trên head bàn giao được cập nhật ở PR trước merge.
