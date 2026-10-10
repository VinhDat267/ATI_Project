> Lưu trữ phương án dời thư mục đã thử và bỏ sau review PR #102. Không dùng để nghiệm thu bản sửa 08/10. Đọc [bản đối chứng mới](W3-10-COMPARISON.md).

# W3-10 — kiểm chứng và các campaign model

Ngày 07–08/10/2026. Base `8155c03d5e93f7491c5d6136f121bf03dd3c4e3f`, worktree
`C:/Users/VinhDat/orca/workspaces/ATI_Project/w3-10-read-only-latency`, nhánh
`fix/w3-10-read-only-latency`. Chờ review độc lập; không tự merge.

## Thứ tự commit và lời gọi

```text
7bec3d0 fix(planner): measure model attempts and clarify read-only workflows
795229e test(eval): preregister read-only labels per product policy of 2026-10-05
2c47eb9 test(planner): normalize read-only regression fixture text
e8b06c9 docs(eval): record W3-10 verification and unavailable gateway
845701c fix(planner): accept confirmed 9router flash-n response alias
66896ca docs(eval): preserve W3-10 interrupted alias campaign
50761b1 fix(eval): redact echoed case prompts from public evidence
```

Commit label đầy đủ: `795229e24c64a38902e7efdce0680c729f37348a`.
Lý do commit là chính sách sản phẩm chốt 05/10, trước mọi lời gọi model của task.
Commit báo cáo model đầu tiên `66896ca999fdc332f45aedf1c8442e93778a2b66`
có sau commit label; `git log --reverse 8155c03..HEAD` chứng minh thứ tự.
Audit đối chiếu JSON với base: đúng sáu case read_only bỏ `expect.searches`,
44/44 prompt không đổi; mọi trường còn lại giữ nguyên.

## TDD và gate

| Lệnh / ca | Output thật |
|---|---|
| RED phần A, runner | 2 failed / 5 passed, exit 1: chưa có `modelCalls` |
| RED tổng hợp thời gian / lỗi public | 2 failed / 7 passed, exit 1: thiếu summary và lỗi còn chép nội dung từ provider |
| RED phần B, read-only policy | 10 failed / 1 passed, exit 1: ba plan lịch sử còn hợp lệ và directory chạy trước clarification |
| RED assertion label trước sửa JSON | 1 failed / 29 passed, exit 1 |
| GREEN planner + evaluations offline | 376/376, 33 files, exit 0 |
| GREEN planner + runner + Telegram integration | 217/217, 21 files, exit 0 |
| GREEN regression chỉ đọc cuối cùng | 11/11, exit 0 |
| `npx tsc -p evaluations/golden-v2/tsconfig.json --noEmit` | exit 0 |
| `npm run check` trên source `2c47eb9` | exit 0: 47 + 340 + 207 + 25 + 349 + 450 = **1418 v3**, **169 eval**; typecheck/build/bundle-security/launcher/node checks đạt |
| `npm run test:browser:v3` trên cùng source | exit 0, **61/61 qua 11 scenario**: default44, auth02 2, auth04 5, clarification2, partial_failure2, sáu scenario liên dịch vụ mỗi scenario1 |
| `git diff --check` | exit 0 sau chuẩn hóa LF; commit `2c47eb9` sửa encoding/newline của fixture test, không đổi production |
| RED alias đã được người dùng xác nhận | 1 failed / 18 passed, exit1 |
| GREEN alias, planner + runner | 220/220, exit0 |
| `npm run check` sau alias | **1422 v3 + 169 eval**, exit0 |
| Browser sau alias, source `66896ca` (planner tree giống `845701c`) | **61/61**, 11 scenario, exit0 |
| RED export privacy / JSON error classification | 2 failed / 9 passed, exit1 |
| GREEN planner + eval sau export fix | **382/382**, exit0; eval typecheck exit0 |
| `npm run check` trên source `50761b1` | **1422 v3 + 171 eval**, exit0; typecheck/build/security/launcher/node đạt |

Ca quá hạn dùng tín hiệu hủy thật: lần thử đầu chờ listener `abort`, tín hiệu
hủy theo deadline 30 ms, rồi lần thử thứ hai thành công. Báo cáo một lời gọi
`generatePlan` chứa hai attempt, một timeout, duration và token fixture. Có ca
429 → thành công và search round riêng. Test lỗi provider đưa nội dung nhạy cảm
giả vào error body và kiểm public evidence chỉ giữ HTTP status.

Ba plan của W3-06 lấy trực tiếp từ report lịch sử (sh07 lần 1/3, ca01 lần 1),
không chép lại hoặc sửa plan: validator từ chối không có bước ghi; planner trả
clarification không gọi sửa plan. Mixed read/write vẫn đạt; validator không cấm
từng bước đọc khi plan có ghi. Clarification ở mode llm không prefetch/search;
regex giữ thứ tự gather cũ, cũng có fallback cho plan không ghi.

Các lần gate trung gian chưa đạt được giữ ngoài repo: sáu test extension dựa
vào eager prefetch, sau đó assertion Telegram đọc sai lượt hội thoại. Fixture
model nay yêu cầu search trước rồi plan; SQL, HTTP, quyền phạm vi và negative
grounding vẫn kiểm thật. Không sửa production API hoặc frontend.

Môi trường: container riêng `ati-w3-10-pg`, postgres16, tmpfs
`/var/lib/postgresql/data`, bind `127.0.0.1:55533`; sandbox, tài khoản ứng dụng
test của CI. Check dùng mật khẩu DB test CI; browser guard local yêu cầu mật khẩu
DB test local nên chỉ mật khẩu role trong container tạm được điều chỉnh. Lần
browser đầu dừng ở guard trước khi có scenario; không sửa guard để bỏ qua.
Không truy cập DB dev15433. Logs ngoài repo tại `C:/Users/VinhDat/.codex/w3-10-*.txt`.

## Preflight và lượt gián đoạn

GET `/v1/models` tại `http://localhost:20128/v1` sử dụng biến LLM đọc từ `.env`
gốc của người dùng bằng `node --env-file`. Không in biến, không sao chép `.env`.
Kết quả: exit 1, `ECONNREFUSED` trên cả `::1:20128` và `127.0.0.1:20128`.
Đã dừng trước đo. Sau đó người dùng báo cổng chạy; GET models mới HTTP200 có
request model. Không tự khởi động/sửa 9router, không đổi model/tài khoản/cx.

1. [Alias guard, 2/132](interrupted-services-llm-2026-10-07T16-02-38-022Z/CONTEXT.md):
   source `e8b06c9`, request `ag/gemini-3.8-flash`, response `gemini-3.8-flash-n`
   bị từ chối; sibling bị hủy. Hai call/two attempt, không retry/timeout/search,
   không phản hồi planner hợp lệ. Người dùng xác nhận alias đúng; `845701c`
   qua TDD chỉ chấp nhận cặp tên chính xác này, không bỏ guard model khác.
2. [Provider fault, 35/132](interrupted-services-llm-2026-10-07T16-19-34-072Z/CONTEXT.md):
   fresh GET200, source `845701c`, exit2 ở ji03, lỗi chung không có status/usage,
   ji02 bị hủy. 32/35 strict, chưa có run đầy đủ. Sáu read_only ở run1 đều
   clarification,1call,0search,0prefetch; chưa có run2/3. 59call/60attempt,
   1timeout+retry; model99.9476% thời gian,22/35 dưới15s; sample p95=24.972s.
   ca04 timeout30.013s rồi success27.321s,2577 reasoning token, model trả
   refusal thay vì clarification. Không đủ metadata cổng để kết luận 429 hay
   chuyển tài khoản; giữ deadline/retry vì retry này vẫn chậm hơn15s.

Model echo nguyên prompt tg02 vào response.summary của sample thứ hai. Bản
public lọc đúng chuỗi đó sau scoring; context ghi hashes trước/sau, deep-compare
xác minh mọi trường khác không đổi. `50761b1` bổ sung exporter qua TDD để lần
đo sau tự lọc prompt echo và phân loại JSON lỗi mà không ghi body. Hai sample
giữ riêng, không ghép vào campaign đầy đủ hoặc dùng nghiệm thu parity/p95.

Người dùng báo cổng đã sẵn sàng lần nữa; GET models mới HTTP200 trước campaign
core tại source `50761b1`. Core50×3 → freeform18×3 → services44×3 đã hoàn tất,
llm/concurrency2, fresh GET200 trước mỗi bộ, cùng source/model/fixture/labels.
Services44×1/concurrency1 cũng đã hoàn tất, tuần tự để không tăng concurrency ở cổng.

## Phép đo hoàn chỉnh, source `50761b1`

| Bộ | Strict W3-06 → W3-10 | p50 / p95 sau (s) | Dưới15s sau | Calls / attempts / timeout |
|---|---|---|---|---|
| [Core150](core-llm-2026-10-07T16-34-09-538Z/summary.md) | 150/150 → 150/150 | 15.067 / 25.285 | 73/150 (48.7%) | 258 / 261 / 3 |
| [Freeform54](freeform-llm-2026-10-07T16-53-33-903Z/summary.md) | 51/54 → 52/54 | 15.804 / 26.668 | 21/54 (38.9%) | 111 / 111 / 0 |
| [Services132](services-llm-2026-10-07T17-01-10-381Z/summary.md) | 111/132 → 129/132 | 13.090 / 27.042 | 79/132 (59.8%) | 225 / 228 / 3 |

Không case nào giảm strict. ff15 vẫn là lỗi ngoài phạm vi đã biết, fail run1/2,
pass run3. ca04 vẫn refusal vì Calendar không mời attendee thay vì clarification,
fail3/3 như W3-06; không đổi label. Sáu read_only **18/18 clarification,1call,
1attempt,0search,0prefetch**; strict mới tăng đúng18 lượt theo chính sách05/10.
Read-only latency p50/p95 7.447/19.104s,17/18 dưới15s (sh07 run3 =19.104s).

**Mục tiêu p95 services dưới15s chưa đạt**: 27.042s. [Đối chiếu theo nhóm,
phân rã và case lỗi](W3-10-COMPARISON.md) giữ số liệu cả trước/sau. Model chiếm
99.9784%/99.9683%/99.9732% thời gian core/freeform/services. Services tổng cộng
1983045ms: model1982514.173ms, directory56.763ms, search12.450ms,
còn lại461.614ms. Đây là tổng thời gian lượt; fixture I/O không chứng minh
latency adapter thật hoặc wall time toàn campaign concurrency2.

Hai nguồn đuôi chậm quan sát được: thêm vòng model cho write request do directory
trì hoãn (services single_step60→111call, cross_service27→54, read_only54→18),
và attempt chậm/timeout. ji03 run2 =58.253s, ji07 run1 =58.180s,
ca02 run2 =46.920s đều có timeout30s rồi success. Retry ji07 vẫn23.013s,
2563 reasoning token; wf02 run1 có2call không retry,33.204s, call sau2155
reasoning token. Một-call refusal cũng chậm hơn W3-06, nên không gán toàn bộ
chênh lệch cho vòng tra cứu thêm. Client timing gộp mạng/cổng/suy luận, không
tách queueing; không có log cổng gán được 429/chuyển tài khoản cho các lượt.

Chọn đo [concurrency1](services-llm-2026-10-07T17-18-22-282Z/summary.md) kiểm tranh
chấp:43/44strict,13.312/29.845s p50/p95,29/44dưới15s(65.9%),75call/76attempt/
1timeout. Cùng source/model/labels; p95 không cải thiện so27.042s concurrency2.
Một run so ba run ở thời điểm khác nhau không chứng minh nhân quả tranh chấp.
Giữ concurrency2 và deadline/retry vì các retry không
đều nhanh và những lượt2call không timeout vẫn vượt15s. Chưa có thử nghiệm chứng
minh rút deadline giữ quality. Không dùng lại hedging/thinking variants đã không
có lợi. Catalog vẫn33tool; hash khác W3-06 do metadata/schema bounded outputs
của W3-08 trước task, không phải W3-10. Core/freeform label hash và fixture hash
giữ nguyên, services chỉ đổi6read_only theo commit preregister. Đây là đối chiếu
theo thời điểm, không phải thí nghiệm kiểm soát mọi biến ở gateway.

README đã điền bảng trước/sau, phần trăm dưới15s và phân rã; mẫu số tool/argument
mới được ghi rõ. Hai campaign gián đoạn giữ riêng, không gộp vào ba bộ hoàn chỉnh.

## Audit public evidence trước commit

Scan20file báo cáo/tổng hợp/README/task/log với112nguyên prompt và giá trị khóa/
secret từ môi trường nạp qua `.env` gốc: **0match**; không in giá trị hoặc ghi
header/request messages. Cụm21ký tự của core cl07 trùng mô tả/summary ff04 ở
freeform được che bảo thủ ở2field; [audit hash trước/sau](freeform-llm-2026-10-07T16-53-33-903Z/PUBLIC-REDACTIONS.md)
xác minh mọi field khác giữ nguyên. Exporter50761b1 lọc prompt của case đang
chạy; cl07 không phải input trong bộ freeform này. Không đổi input/labels.

Re-score toàn bộ bản public bằng `scoreCase` hiện tại: **380/380 case-run có
score giữ nguyên**, gồm150core+54freeform+132services+44concurrency1. Lọc evidence
không làm tăng strict/đổi args/timing/usage. Không commit bản còn nguyên chuỗi.
Logs/script kiểm ngoài repository, không copy `.env` vào worktree; container
PostgreSQL tạm đã stop/remove sau gate. Source test/model50761b1 có CI xanh
[run37653838963](https://github.com/VinhDat267/ATI_Project/actions/runs/37653838963).
Request hedging/thinking variants từng không có lợi được giữ là bằng chứng
lịch sử, không được mô tả như phép thử mới.
