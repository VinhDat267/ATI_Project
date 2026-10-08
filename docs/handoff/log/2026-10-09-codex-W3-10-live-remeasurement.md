# W3-10 — nhập main, giữ guard model của #102 và đo lại live

- Ngày bàn giao: 09/10/2026 Asia/Saigon; các campaign ngày 08/10 UTC, từ 23:32 ngày 08 đến 00:18 ngày 09 tại Việt Nam.
- Task: `docs/handoff/tasks/W3-10-read-only-and-latency.md`; PR [#102](https://github.com/VinhDat267/ATI_Project/pull/102).
- Nhánh/worktree: `fix/w3-10-read-only-latency`, `C:/Users/VinhDat/orca/workspaces/ATI_Project/w3-10-read-only-latency`.
- Lý do tiếp tục: chủ dự án xác nhận model đã chạy lại qua live smoke (#115) và yêu cầu giữ bản #102 ở dòng kiểm tên model khi nhập main. Không gọi dịch vụ thật hoặc thực thi kế hoạch benchmark.

## Preflight và nhập main

Đọc AGENTS, handoff README/CURRENT-STATE, task card, REVIEW-CHECKLIST, ba log mới nhất (#115 live smoke, merge113, alias113) và log W3-10 fix trước. Kiểm `git status`, `git log -5`, `gh pr list`: root main e269743 có sửa user ở .gitignore/PRODUCT.md và docs/reports/skills-lock.json, không chạm. Worktree W3-10 sạch tại e1430a4, PR102 open, conflict với main.

Fetch và merge `origin/main=e269743859d6096eedafa4ea156c17b5770b3638`. Xung đột đúng hai file:

- `packages/planner/src/providers/openai-compatible-provider.ts`
- `packages/planner/tests/openai-compatible-provider.test.ts`

Giữ bản #102 theo yêu cầu: exact alias guard, raw served name và `lastCallMetrics`/usage/assertions còn nguyên. Test focused168/168 exit0; merge commit `5afc0a7f7a0168abb3776400394ea6edcedd2b3a`. Diff so main không có frontend, CURRENT-STATE hoặc ROADMAP. Main không đổi trong lần đo.

## Review và TDD bổ sung

Reviewer độc lập đọc diff thật tại5afc0a7, chạy361/361 trên node_modules riêng, eval tsc exit0. Sáu mutation ở bản sao bị bắt: bỏ prefetch trước call1, validator read-only, phase split, metrics, alias, response redaction. Không sửa shared source đang đo.

P2 mới: `run.ts` che response nhưng còn xuất nguyên search trace/score; model có thể đặt full prompt trong query hợp lệ của `sheets.list_spreadsheets`. Native exporter phải che cả projection sau scoring, không chỉ response.

| Bước | Output thật ngoài repo |
|---|---|
| Test mới gọi actual main/fixture/scorer/writer, trước sửa | 1 failed / 12 passed, exit1; decodedreport còn fullprompt trong query (`privacy-red.txt`) |
| Sửa native writer che toàn case projection sau scoring | planner+golden-v2 362/362,27files, exit0 (`privacy-green.txt`) |
| Thêm assertion lookup thật vào test phase/429 cũ, trước đổi tên tool | 1 failed / 12 passed, exit1; expected1trace,actual0 (`valid-search-red.txt`) |
| Đổi tool không tồn tại thành `sheets.list_spreadsheets`, kiểm result và không error | 362/362,27files, exit0; evaltsc exit0 (`final-focused-green.txt`) |

Commit `58d4fcdec284767c35f69e5d5c581046fb12f9ae`, chỉ `run.ts`/`run.test.ts`. Không đổi planner/prompt/model/labels trong delta này. Reviewer độc lập:362/362, tsc exit0; raw query vẫn nguyên trước export; mutation bỏ sanitizer tại writer làm đúng test mới fail (1 failed/12passed, exit1). P2 code đã khép.

Kiểm tra cuối phát hiện thêm cạnh của cùng lỗi export: prompt nằm trong tên khóa JSON vẫn lọt qua sanitizer chỉ xử lý giá trị. TDD tại `9e887d2`: `privacy-key-red.txt` ghi **1 failed / 12 passed, exit 1**; output còn full prompt trong nested object key. Sau sửa, **362/362, 27 files, exit 0**, evaluation typecheck exit 0 (`privacy-key-green.txt`). Test giữ bản gốc, kiểm cả khóa/giá trị lồng nhau và prompt `1` để số `[1, 11]` không bị thay đổi. Chỉ sửa hai file runner/test; không đổi đường lập kế hoạch, fixture hay rubric so với source đo `58d4fcd`. Không cần gọi lại model cho thay đổi export sau scoring này.

Review độc lập delta `9e887d2`: focused 362/362 + evaluation typecheck exit 0. Reviewer thêm probe deep-frozen raw/numeric/null/boolean/`__proto__` ở bản sao: baseline 14/14, mutation bỏ che tên khóa gây **2 fail/12 pass, exit 1**. Scan toàn packet 23 file gồm keys và values: **76.695 strings, 112 prompts + 23 env secret values, 0 violations**. 17 hash PUBLIC-AUDIT khớp; cả 7 report giữ score/passed/calls/latency và raw/public SHA. Không có P1/P2 mới trong phạm vi code/evidence; latency target vẫn thiếu.

## Model thật và provenance

Request `ag/gemini-3.8-flash`, served `gemini-3.8-flash-n`, 9router local20128. Giữ deadline 30s, timeout retry 1, HTTP retries 2; không thay cấu hình router/cx hoặc reasoning. Env gốc nạp bằng `--env-file`, không in/copy/commit.

Đối chứng local-only `7898aa72c7b4414d8c8d2861e0a7ae166326ce5c`:8155c03 cộng exact alias, chỉ2 file provider/test,26insertions/1deletion; npmci riêng; không đưa policy/metrics/label mới vào control, không push nhánh tạm. Sau sửa source 58d4fcd. Tất cả llm/concurrency 2, campaign tuần tự; diagnosticca04/concurrency 1 giữ riêng.

| Campaign | UTC bắt đầu → kết thúc | Kết quả / exit |
|---|---|---|
| Control core×1 | 16:32:33.218 →16:36:06.857 | 50/50strict,exit0 |
| Control services lần đầu | 16:36:06.862 →16:38:50.248 | 17/44attempted,12strict;exit2,ca04timeout60026ms,no01siblingcancel |
| Diagnostic ca04×1,concurrency 1 | 16:40:05.029 →16:40:21.534 | response16.500s,refusal,0/1strict;exit0;không tính acceptance |
| After core×3 | 16:44:41.561 →16:55:18.342 | 150/150strict,exit0 |
| After freeform×3 | 16:55:18.357 →17:00:52.259 | 52/54strict,exit0 |
| After services×3 | 17:00:52.267 →17:12:19.521 | 129/132strict,exit0 |
| Control services mới×1 | 17:13:19.919 →17:18:52.947 | 37/44strict,44/44attempted,exit0 |

Sau diagnostic đã nhận completion và cả336 lượt sau sửa hoàn tất, trạng thái provider đã khác lần control timeout. Chạy control services mới từ đầu một lần để đủ đối chứng, không ghép17lượt trước. Bốn sample dừng buổi sáng, sample17/44 mới và phương án deferred-directory50761b1 giữ nguyên riêng, không dùng thay phép đo hoàn chỉnh.

| Bộ | W3-06 strict lịch sử | Control mới:strict;p50/p95;calls | After:strict;p50/p95;calls/attempts/timeouts;<15s |
|---|---|---|---|
| core | 150/150 | 50/50;7.527/18.995s;57 | 150/150;7.229/18.021s;168/168/0;136/150(90.7%) |
| freeform | 51/54 | NOT_RUN, không bắt buộc | 52/54;10.108/24.738s;63/64/1;42/54(77.8%) |
| services | 111/132 | 37/44;7.600/44.465s;57 | 129/132;8.242/20.138s;135/137/2;117/132(88.6%) |

**Read-only 18/18**: clarification,1 call,0 model search rounds; prefetch được phép theo xác nhận08/10. Chấm lại độc lập services132 lượt và aggregate khớp. Core không giảm; freeform chỉff15runs1/3 hỏi lại thay vìplan, vấn đề đã biết ngoài scope; ca04refusal cả3 giống W3-06. Core3giảm/147bằng/0tăngcalls;services18giảm/114bằng/0tăng. Mọi ca ghi giữ calls;6 read-only giảm3→1 ở cả3 runs.

**Services p95 20.138s chưa đạt<15s.** Có15 slow rows, tất cả1 call/0 search:2 timeout rồi retry,13 thành công1 attempt. Lời gọi model chiếm 99.9623% tổng thời gian; directory0.0099%,search0.000073%,other0.0278% trong fixture. Hai services retry: ca04run2≈30.012+15.813s;wf03run3≈30.013+15.975s. Freeformff14run2≈30.014+11.713s. Không tách queue/mạng/suy luận; không gán429/account switch khi không có trace. Chưa đủ chứng cứ deadline ngắn hơn giúp13 slow rows không retry; giữ deadline, ghi khoảng cách latency để quyết định task riêng. Hedging/thinking variants đã thử không có lợi, không tái đưa vào.

Label795229e trước report66896ca (git ancestry exit0),112 prompt/labels không đổi trong lần đo. Sáu readonly bỏ tool/argument denominator; comparison ghi mẫu số thật theo service. Control giữ label cũ nên strict readonly khác rubric; lịch sửflash khácserved-n, đối chứng cùng cửa sổ dùng-n. Không nhân bản1 runcontrol thành3run hoặc khẳng định latency causal effect chính xác.

## Gate và ca browser chập chờn

`npm run check` tại58d4fcd: **1544v3** (47+340+212+25+353+567), **173eval**, typecheck/build/security/launcher/env đạt, **exit0**. Focused362/362 và evaltsc exit0.

Gate cuối tại `9e887d2`: **`npm run check` exit 0**, 1544 v3 + 173 eval; **`npm run test:browser:v3` 73/73, 11 scenarios, exit 0**. Đây là lần full browser đầu trên commit mới, không cần chạy lại. Output: `check-after-9e887d2.txt` và `browser-after-9e887d2.txt`. Benchmark vẫn dùng source `58d4fcd`; commit cuối chỉ che khóa JSON trên bản export.

Browser tại5afc0a7 trước sửa exporter:73/73exit0. Lần đầu tại58d4fcd: nhóm default55passed/1failed,exit1, FE-02scroll line113 expected80/received16268. Lưu output và DOM. Test mới gửi message rồi chờ usermessage attached trước cuộn lên; nghi auto-scroll/response đến sau khi đặt scrollTop nhưng chưa chứng minh thứ tự event. **Chưa sửa căn nguyên FE-02** trong scope W3-10. Chạy riêngrepeat5:5/5exit0. Sau đó chạy lại toàn bộ một lần: **73/73,11scenarios,exit0** (56default+2auth02+5auth04+2clarification+2partial+6single). Giữ cả lần fail, không thay timeout hoặc frontend.

PG `ati-w3-10-resumed-pg`,postgres16,HostConfig.Tmpfs=/var/lib/postgresql/data,127.0.0.1:55472;API3072/web5172;sandbox,migrate/provision riêng. Không dùng DB15433. Raw logs/evidence tạiC:/Users/VinhDat/AppData/Local/Temp/ati-w3-10-resumed-2026-10-08/. Review artefacts tạiC:/Users/VinhDat/.codex/w3-10-review-5afc0a7-890076ec/. Ảnh/DOM không commit.

Sau gate, dừng đúng container tmpfs trên. Không còn listener DB55472/API3072/web5172; 9router port20128/PID18976 vẫn hoạt động. Hash SHA256 của `.gitignore`, `PRODUCT.md`, `skills-lock.json` và file báo cáo DOCX ở root khớp trước khi làm; giữ nguyên thay đổi của người dùng. Fetch cuối vẫn `origin/main=e269743`.

## Bàn giao và giới hạn

[Comparison](../../ai-evidence/V3-GOLDEN-V2/W3-10-COMPARISON.md), [verification](../../ai-evidence/V3-GOLDEN-V2/W3-10-VERIFICATION.md), [manifest](../../ai-evidence/V3-GOLDEN-V2/w3-10-resumed-2026-10-08/CAMPAIGN.json), [analysis](../../ai-evidence/V3-GOLDEN-V2/w3-10-resumed-2026-10-08/ANALYSIS.json), [read-only policy](../../ai-evidence/V3-GOLDEN-V2/w3-10-resumed-2026-10-08/READ-ONLY-POLICY.json). README và task card cập nhật theo số thật. Bản public lọc recursive corpus/env secret sau scoring; 7 reports giữ nguyên score/passed/calls/latency, 1 string được che ở control mới; raw/public SHA256 trong analysis. Scan kiểm cả tên khóa và giá trị JSON: **17 files, 76.615 decoded strings, 112 corpus prompts, 0 violations**; kết quả trong PUBLIC-AUDIT.json.

Đã đủ phép đo yêu cầu; review độc lập code/read-only/strict parity đạt trong phạm vi. Latency p95 chưa đạt; usable-plan rate/live adapter/external write/frontend live timing NOT_RUN trong W3-10. CURRENT-STATE/ROADMAP giữ main, chỉ add file đúng task. Không tự merge; CI tại head bàn giao sẽ ghi vào PR khi hoàn tất, reviewer duyệt trước merge. PostgreSQL tmpfs riêng được dừng sau gate; không đụng runtime 9router hoặc DB khác.
