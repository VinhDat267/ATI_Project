# W3-10 — kiểm chứng sửa review ngày 08/10

PR [#102](https://github.com/VinhDat267/ATI_Project/pull/102), cùng nhánh/worktree. Đọc [review Claude Code](https://github.com/VinhDat267/ATI_Project/pull/102#issuecomment-6052107879) trên `b2cbfa2` trước sửa. **P1 đã sửa, P2 còn thiếu đối chứng/đo hoàn chỉnh; chờ review lại, không tự merge.**

## Hành vi và cách đếm

Commit a9f1030 phục hồi directory trước lời gọi model đầu, vẫn `measure('prefetch')`, thư mục có trong `WorkingMemory.__observed` từ call 1. Prompt nói đúng thời điểm. Rule 0, validator `READ_ONLY_PLAN`, fixed clarification không tốn repair, mixedread/write và exactalias giữ nguyên. Không đổi catalog, production API hoặc frontend.

Chủ dự án xác nhận ngày 08/10: read_only phải clarification, đúng 1 lời gọi model, 0 vòng do model mở (phase `search`); directory prefetch của nền tảng (phase `prefetch`) được phép. `searchRounds` đếm phase `search`, một vòng có thể nhiều tool calls. `searches` loại directory; `prefetches` chứa directory, mỗi trace có phase. Regex gather đo riêng, không tính model search. Các report cũ gộp thư mục vào searches; không dùng độ dài trường đó cho tiêu chí mới. Scorer/aggregate service kiểm số call/vòng của read_only; label `795229e` không đổi.

## RED/GREEN và gate

| Ca/lệnh | Output thật |
|---|---|
| RED P1 trên mã `b2cbfa2`, trước sửa | 2failed/21passed, exit 1 |
| RED scorer sau P1, trước tách trace/score | 2failed/10passed, exit 1 |
| GREEN planner+golden-v2 | 361/361,27files,exit 0 |
| Eval tsc --noEmit | exit 0 |
| npm run check trên `6ed1095` | 1448v3=47+340+212+25+349+475;172eval;exit 0 |
| npm run test:browser:v3 trên `6ed1095` | 65/65,11scenario;exit 0 |
| Provider trên `7898aa7` đối chứng | 19/19,exit 0 |

RED write test mới: provider trả plan ngay call1 nhưng head b2cbfa2 chưa có directory, grounding đổi thành clarification. GREEN cùng fixture trả plan,đúng 1 call và memory call 1 có list/member/channel. Clarification test mới cho phép directory nhưng đúng 1 call/0phasesearch. RED scorer search→clarification còn pass; GREEN sốcall/round chặn đúng policy. Hai assertions lúcGREEN đầu đã chỉnh theo observed không giữ `isPrivate`/tên `calendar.list_calendars` hiệnhữu; không sửa schema. Model deadline vàdirectory budget vẫn test AbortSignal thật. Gate đầu fail do DB tạm chưa migrate; migrate/provision rồi chạy lại toàn bộ đạt. Logs C:/Users/VinhDat/.codex/w3-10-fix-*.txt ngoài repo.

PG riêng `ati-w3-10-fix-pg`, postgres16, mount tmpfs /var/lib/postgresql/data,127.0.0.1:55533; sandbox,tài khoản CI,API 3174 / web 5274. Không dùngDB dev 15433. Merge main `564b6cb`(#103–105) tại `fcc14ad`, rồi `eb48f0b`(#106) tại `6ed10953575b593b5f71160c777b0fafac2dd5b2` trước gate cuối, không conflict. CURRENT-STATE/ROADMAP giữ main; diff PR không sửa frontend/file cấm.

## Model thật và giới hạn

**Chưa đủ nghiệm thu P2.** Bốn campaign đối chứng đều dừng theo chính sách bảo toàn provider fault; chưa chạy campaign sau sửa. Không ghép các sample để đủ số câu, không dùng số liệu phương án đã bỏ để nhận xét bản sửa. Chưa đánh giá được strict parity, read_only 18/18, số lượt tăng/giảm model calls hoặc p95 services sau sửa.

Model request `ag/gemini-3.8-flash`, served alias `gemini-3.8-flash-n` được chủ dự án chấp nhận. Mọi lượt đối chứng dùng llm / concurrency 2, cùng deadline/retry mặc định. Không đổi model/cx hoặc cấu hình 9router. Nhánh đối chứng local-only từ `8155c03`, chỉ cherry-pick `845701c` thành `7898aa7`; conflict bỏ context timing chưa có, test bỏ hai assertion metrics; diff đúng 2 file provider/test,26 insertions/1 deletion. Npmci riêng, provider 19/19 exit 0, không push nhánh này.

| Campaign đối chứng | UTC bắt đầu → kết thúc | Đã thử / dự kiến | Strict của sample | Fault / hủy theo sibling |
|---|---|---|---|---|
| core 04:32:33 | 2026-10-08T04:32:33.902Z → 2026-10-08T04:33:35.920Z | 2/50 | 0/2 | ss01: Model request timed out, 60143ms, 1 calls; ss02: Evaluation stopped after provider failure, 60071ms, 1 calls |
| core 04:35:46 | 2026-10-08T04:35:46.975Z → 2026-10-08T04:36:47.927Z | 2/50 | 0/2 | ss01: Model request timed out, 60100ms, 1 calls; ss02: Evaluation stopped after provider failure, 60060ms, 1 calls |
| core 04:46:19 | 2026-10-08T04:46:19.809Z → 2026-10-08T04:51:34.563Z | 25/50 | 23/25 | cs02: Model request timed out, 60036ms, 1 calls; cs05: Evaluation stopped after provider failure, 4538ms, 1 calls |
| services 04:55:59 | 2026-10-08T04:55:59.107Z → 2026-10-08T05:00:09.534Z | 12/44 | 8/12 | ca01: Model request timed out, 103323ms, 3 calls; ca04: Evaluation stopped after provider failure, 49620ms, 1 calls |

GET models 200 và tiến trình9router có hoạt động. Đọc SQLite 9router bằng mode=ro&immutable=1 chỉ xuất metadata; usage có phản hồi ok nhưng không có requestDetails đủ để gắn từng record cho request của task. Probe cùng planner/model xác minh headers chậm: attempt đầu bị deadline 30 s hủy trước headers, retryHTTP 200 sau 23.885 s, body thêm 2.149 ms, tổng 53.952 s. Probe tối giản 10.750 s, headers 10.747 s / body 2.423 ms. Probe là chẩn đoán riêng, không benchmark. Không có bằng chứng lỗi đọc JSON; không tách được queue/mạng/suy luận hoặc gán 429/account switch. Completion chưa đủ ổn định với deadline hiện hữu để hoàn tất đối chứng. Đã dừng đo, cần trạng thái upstream thay đổi trước khi đo lại cùng cấu hình. [Diagnostic](w3-10-fix-2026-10-08/ROUTER-DIAGNOSTIC.md). [Manifest UTC](w3-10-fix-2026-10-08/CAMPAIGN.json), [comparison 3 cột](W3-10-COMPARISON.md). Raw control ngoài repo; publiccopy chỉ lọc prompt/bí mật/lỗi nhạy cảm sau scoring, không sửa nhánh đối chứng hoặc stored score.

## Nhãn và privacy

Label `795229e24c64a38902e7efdce0680c729f37348a` theo chính sách05/10 đứng trước report model đầu `66896ca999fdc332f45aedf1c8442e93778a2b66`; gitlog chứng minh. Không đổi 44 prompt hoặc label sau `795229e`. Env gốc nạp `--env-file`, không in/copy/commit. Không lưu prompt/header/APIkey trong diagnostics; public errors phân loại thay cho provider body. Trước commit scan secret từenv/corpus 112 prompt / private JSON fields, không in giá trị.

Scan trước commit: 24 file, 0 vi phạm (secret từ env, chuỗi đầy đủ của 112 prompt và private JSON fields). [Audit control public](w3-10-fix-2026-10-08/PUBLIC-CONTROL-AUDIT.json) xác minh stored score, calls và latency của 41 lượt ở 4 sample giữ nguyên sau lọc; đây không phải rescore các response đã che chuỗi. PostgreSQL tạm đã stop/remove sau gate, không đụng DB khác.

## Phương án cũ đã bỏ

Campaign source `50761b1` ngày 07–08/10 với directory dời sausearch là phương án đã thử và bỏ, không nghiệm thu hiện tại. Giữ nguyên report/log cũ; [verification lưu trữ](W3-10-VERIFICATION-DEFERRED-DIRECTORY.md),[comparison lưu trữ](W3-10-COMPARISON-DEFERRED-DIRECTORY.md). Hedging/thinking variants cũ không có lợi, không tái đưa vào. Giữ deadline/retry; không đổi model hoặc9router để vượtgate.
