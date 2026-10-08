# W3-10 — phép đo live sau khi nhập main ngày 08/10

Nguồn sau sửa: `58d4fcdec284767c35f69e5d5c581046fb12f9ae`, nhập main `e269743` và giữ bản kiểm tên model/metrics của #102 khi xung đột với #113. Đối chứng: `7898aa7` = `8155c03` + exact alias, chỉ 2 file provider/test, không có Rule0/metrics/label mới. Cả năm campaign hoàn chỉnh.

Hai nhánh cùng request `ag/gemini-3.8-flash` qua 9router, served `gemini-3.8-flash-n`, llm/concurrency 2, deadline 30s/timeout retry 1/HTTP retry2 giữ nguyên. Chạy tuần tự các campaign, chỉ plan trên fixture. Không đổi cấu hình gateway hoặc thực thi plan. W3-06 lịch sử served flash; không quy chênh lệch xuyên ngày hoàn toàn cho code. Đối chứng hiện tại một run so với ba run sau sửa, có biến thiên model/thời điểm.

## Ba cột kết quả

| Bộ | W3-06 lịch sử (3 runs), flash | Đối chứng cùng ngày (1 run), -n | Sau sửa (3 runs), -n |
|---|---|---|---|
| core | 150/150 strict; 5.454/13.105s; 144/150 (96.0%) <15s; 171 calls | 50/50 strict; 7.527/18.995s; 46/50 (92.0%) <15s; 57 calls | 150/150 strict; 7.229/18.021s; 136/150 (90.7%) <15s; 168 calls |
| freeform | 51/54 strict; 5.942/13.092s; 52/54 (96.3%) <15s; 63 calls | NOT_RUN — không bắt buộc đối chứng freeform | 52/54 strict; 10.108/24.738s; 42/54 (77.8%) <15s; 63 calls |
| services | 111/132 strict; 6.105/31.097s; 107/132 (81.1%) <15s; 172 calls | 37/44 strict; 7.600/44.465s; 33/44 (75.0%) <15s; 57 calls | 129/132 strict; 8.242/20.138s; 117/132 (88.6%) <15s; 135 calls |

### core: theo nhóm câu

| Nhóm | W3-06 lịch sử | Đối chứng cùng ngày | Sau sửa |
|---|---|---|---|
| single_step | 30/30 strict; 4.387/9.084s; 30/30 (100.0%) <15s; 30 calls | 10/10 strict; 5.620/9.021s; 10/10 (100.0%) <15s; 10 calls | 30/30 strict; 5.002/9.589s; 30/30 (100.0%) <15s; 30 calls |
| multi_step | 30/30 strict; 4.863/7.890s; 30/30 (100.0%) <15s; 30 calls | 10/10 strict; 5.853/9.570s; 10/10 (100.0%) <15s; 10 calls | 30/30 strict; 6.591/19.152s; 27/30 (90.0%) <15s; 30 calls |
| cross_service | 45/45 strict; 6.660/12.359s; 45/45 (100.0%) <15s; 48 calls | 15/15 strict; 8.906/15.633s; 14/15 (93.3%) <15s; 16 calls | 45/45 strict; 8.922/16.129s; 42/45 (93.3%) <15s; 48 calls |
| clarification | 27/27 strict; 7.958/19.011s; 21/27 (77.8%) <15s; 45 calls | 9/9 strict; 8.086/20.217s; 6/9 (66.7%) <15s; 15 calls | 27/27 strict; 10.206/21.311s; 19/27 (70.4%) <15s; 42 calls |
| refusal | 18/18 strict; 4.720/8.300s; 18/18 (100.0%) <15s; 18 calls | 6/6 strict; 7.527/10.732s; 6/6 (100.0%) <15s; 6 calls | 18/18 strict; 5.915/9.370s; 18/18 (100.0%) <15s; 18 calls |

### freeform: theo nhóm câu

| Nhóm | W3-06 lịch sử | Đối chứng cùng ngày | Sau sửa |
|---|---|---|---|
| free_form | 36/36 strict; 6.041/15.103s; 34/36 (94.4%) <15s; 45 calls | NOT_RUN | 36/36 strict; 10.412/19.429s; 29/36 (80.6%) <15s; 45 calls |
| free_form_heldout | 15/18 strict; 5.294/12.840s; 18/18 (100.0%) <15s; 18 calls | NOT_RUN | 16/18 strict; 9.235/41.728s; 13/18 (72.2%) <15s; 18 calls |

### services: theo nhóm câu

| Nhóm | W3-06 lịch sử | Đối chứng cùng ngày | Sau sửa |
|---|---|---|---|
| read_only | 0/18 strict; 25.354/53.021s; 0/18 (0.0%) <15s; 54 calls | 0/6 strict; 41.010/69.262s; 0/6 (0.0%) <15s; 18 calls | 18/18 strict; 8.708/26.458s; 17/18 (94.4%) <15s; 18 calls |
| single_step | 57/57 strict; 4.608/20.188s; 53/57 (93.0%) <15s; 60 calls | 19/19 strict; 7.130/13.732s; 19/19 (100.0%) <15s; 20 calls | 57/57 strict; 7.134/13.341s; 56/57 (98.2%) <15s; 60 calls |
| cross_service | 27/27 strict; 7.653/10.921s; 27/27 (100.0%) <15s; 27 calls | 9/9 strict; 13.040/18.170s; 6/9 (66.7%) <15s; 9 calls | 27/27 strict; 11.965/19.579s; 20/27 (74.1%) <15s; 27 calls |
| clarification | 12/15 strict; 7.150/41.108s; 13/15 (86.7%) <15s; 16 calls | 4/5 strict; 9.260/39.613s; 3/5 (60.0%) <15s; 5 calls | 12/15 strict; 10.036/45.826s; 9/15 (60.0%) <15s; 15 calls |
| refusal | 15/15 strict; 4.621/18.139s; 14/15 (93.3%) <15s; 15 calls | 5/5 strict; 6.811/7.498s; 5/5 (100.0%) <15s; 5 calls | 15/15 strict; 6.099/9.918s; 15/15 (100.0%) <15s; 15 calls |

## Phân rã thời gian sau sửa

W3-06 và nhánh đối chứng không có telemetry từng call: attempts/tokens/time share **N/A**, không suy ngược từ latency. Các pha directory/search dùng fixture, không đo latency adapter thật.

| Bộ | Calls / attempts / timeout | Phân bố attempt mỗi call | Model | Prefetch | Search | Gather | Other | Dưới15s |
|---|---|---|---|---|---|---|---|---|
| core | 168/168/0 | {"1":168} | 99.9649% | 0.0061% | 0.0002% | 0.0000% | 0.0288% | 136/150 (90.7%) |
| freeform | 63/64/1 | {"1":62,"2":1} | 99.9475% | 0.0089% | 0.0002% | 0.0000% | 0.0433% | 42/54 (77.8%) |
| services | 135/137/2 | {"1":133,"2":2} | 99.9623% | 0.0099% | 0.0001% | 0.0000% | 0.0278% | 117/132 (88.6%) |

Per-call duration gồm retry backoff; attempts đo transport đến hết response body. Missing token là null. Reasoning có thể đã nằm trong prompt_tokens, không cộng lần nữa. Model/share không tách queue, mạng và suy luận phía upstream. Không có per-account trace để gán nguyên nhân cho 429/account switch trong 9router.

## Read-only và mẫu số service

Chính sách08/10: clarification, 1 model call, 0phase search; prefetch trước call1 được phép. `searches` bỏ directory, `prefetches` chứa phase prefetch. Label `795229e` giữ nguyên và đứng trước report đầu `66896ca`. Không đổi prompt/label sau khi đo.

Read-only hiện tại: **18/18 đạt policy**, đủ18lượt.

| Câu/run | Kind | Calls | Search rounds | Prefetch traces | Policy |
|---|---|---|---|---|---|
| sh01/1 | clarification | 1 | 0 | 3 | PASS |
| sh07/1 | clarification | 1 | 0 | 3 | PASS |
| ca01/1 | clarification | 1 | 0 | 1 | PASS |
| no01/1 | clarification | 1 | 0 | 1 | PASS |
| tg01/1 | clarification | 1 | 0 | 1 | PASS |
| ji01/1 | clarification | 1 | 0 | 2 | PASS |
| sh01/2 | clarification | 1 | 0 | 3 | PASS |
| sh07/2 | clarification | 1 | 0 | 3 | PASS |
| ca01/2 | clarification | 1 | 0 | 1 | PASS |
| no01/2 | clarification | 1 | 0 | 1 | PASS |
| tg01/2 | clarification | 1 | 0 | 1 | PASS |
| ji01/2 | clarification | 1 | 0 | 2 | PASS |
| sh01/3 | clarification | 1 | 0 | 3 | PASS |
| sh07/3 | clarification | 1 | 0 | 3 | PASS |
| ca01/3 | clarification | 1 | 0 | 1 | PASS |
| no01/3 | clarification | 1 | 0 | 1 | PASS |
| tg01/3 | clarification | 1 | 0 | 1 | PASS |
| ji01/3 | clarification | 1 | 0 | 2 | PASS |

Read-only không có tool/argument denominator sau đổi chính sách. Đối chứng dùng label cũ nên strict read_only không cùng rubric; so riêng kind/calls/latency. Mẫu số mới của service được lấy từ aggregate, không giả định argument attempts bằng labelled tools.

| Service | Tool attempts lịch sử / sau sửa | Argument attempts lịch sử / sau sửa |
|---|---|---|
| sheets | 24 / 18 | 24 / 18 |
| jira | 30 / 27 | 30 / 27 |
| calendar | 24 / 21 | 24 / 21 |
| slack | 6 / 6 | 6 / 6 |
| notion | 27 / 24 | 27 / 24 |
| telegram | 30 / 27 | 30 / 27 |
| github | 6 / 6 | 6 / 6 |
| trello | 9 / 9 | 9 / 9 |

## Số lời gọi từng câu

Mỗi run sau sửa so với đúng1 run đối chứng; không nhân bản control thành ba run. `ANALYSIS.json` giữ danh sách từng lượt có delta.

| Bộ | Giảm | Bằng | Tăng | Thiếu cặp |
|---|---|---|---|---|
| core | 3 | 147 | 0 | 0 |
| services | 18 | 114 | 0 | 0 |

## Strict fail và đuôi chậm

core: không có strict fail.

freeform: `ff15` trượt ở run1 và3: model hỏi làm rõ thay vì plan; run2 đạt. Đây là vấn đề Slack/Telegram khi cùng có frontend đã ghi ngoài phạm vi. So với W3-06: cùng case, strict tăng51→52/54, không case nào giảm.

services: `ca04` trả refusal thay vì clarification ở cả3 runs. W3-06 cũng trượt cùng ca cả3 runs; không có regression strict mới.

Services p95: **20.138s**, đã đo đủ và **chưa đạt** mục tiêu <15s. Có15/132 lượt từ15s trở lên, tất cả đúng1 model call và0phase search. Hai lượt gồm timeout30s rồi retry thành công;13lượt còn lại thành công ngay attempt đầu. Lời gọi model chiếm 99.9623% tổng thời gian các lượt, gồm transport/body/backoff; directory0.0099%,search0.000073%,other0.0278%. Directory/search đang dùng fixture; chưa đo adapter thật. Số liệu này xác định phần chờ lời gọi model chi phối tail, không tách được queue/mạng/suy luận của9router/upstream.

| Ca/run ≥15s | Latency ms | Calls / search rounds | Attempts: duration ms + outcome |
|---|---|---|---|
| wf03/3 | 45991 | 1/0 | 30013.381 timeout; 15974.899 success |
| ca04/2 | 45826 | 1/0 | 30011.616 timeout; 15813.064 success |
| sh07/2 | 26458 | 1/0 | 26457.690 success |
| ca04/1 | 22627 | 1/0 | 22624.777 success |
| sh04/2 | 20322 | 1/0 | 20321.760 success |
| sh04/3 | 20291 | 1/0 | 20289.019 success |
| no04/2 | 20138 | 1/0 | 20136.906 success |
| wf02/1 | 19579 | 1/0 | 19577.485 success |
| ca04/3 | 19125 | 1/0 | 19124.392 success |
| wf02/2 | 18872 | 1/0 | 18869.635 success |
| wf03/1 | 18308 | 1/0 | 18306.657 success |
| wf04/3 | 17488 | 1/0 | 17486.139 success |
| wf04/1 | 16134 | 1/0 | 16131.465 success |
| ji06/3 | 15248 | 1/0 | 15246.802 success |
| wf04/2 | 15214 | 1/0 | 15209.840 success |

Giữ deadline/retry hiện hữu: chỉ2retry thành công trong15lượt chậm, trong khi13lượt chậm không cần retry; chưa có bằng chứng deadline ngắn hơn cải thiện p95. Diagnostic ca04/concurrency 1 trảrefusal trong16.500s, không dùng suy ra hiệu ứng concurrency của cả bộ. Hedging/thinking variants cũ không có lợi. Ghi khoảng cách latency để quyết định task riêng thay vì điều chỉnh nhiều biến sau đo.

Core: 48/50case có calls giống control ở cả3 runs. `cl03`:3→[3,3,2]; `rf06`:3→[2,3,2]. Services: chỉ6 read_only giảm3→1 call ở cả3 runs (18 cặp giảm); mọi ca còn lại giữ sốcall, kể cảghi. Control1 run và after3 runs có biến thiên model, không khẳng định causal effect chính xác của latency từng ca.

| Bộ | Prompt tokens được báo | Completion tokens được báo | Reasoning tokens được báo |
|---|---|---|---|
| core | 1053453 | 20021 | 78584 |
| freeform | 408631 | 6428 | 32739 |
| services | 794825 | 16610 | 79278 |

Mọi call sau sửa có usage được trả về. Đây là tổng usage nhận được theo call thành công, không phải tổng chi phí upstream của cả timeout attempts. Không cộng reasoning vào tổng prompt/completion vì gateway có thể đã gộp nó vào prompt_tokens. Control/historical usage và attempts **N/A**, không ghi0.

## Campaign và giới hạn

| Nhánh/bộ | Source | UTC bắt đầu → kết thúc | Exit |
|---|---|---|---|
| control/core×1 | 7898aa7 | 2026-10-08T16:32:33.218Z → 2026-10-08T16:36:06.857Z | 0 |
| control/services×1 | 7898aa7 | 2026-10-08T16:36:06.862Z → 2026-10-08T16:38:50.248Z | 2 |
| diagnostic/services ca04×1, concurrency 1 | 5afc0a7 | 2026-10-08T16:40:05.029Z → 2026-10-08T16:40:21.534Z | 0 |
| after/core×3 | 58d4fcd | 2026-10-08T16:44:41.561Z → 2026-10-08T16:55:18.342Z | 0 |
| after/freeform×3 | 58d4fcd | 2026-10-08T16:55:18.357Z → 2026-10-08T17:00:52.259Z | 0 |
| after/services×3 | 58d4fcd | 2026-10-08T17:00:52.267Z → 2026-10-08T17:12:19.521Z | 0 |
| control/services×1 | 7898aa7 | 2026-10-08T17:13:19.919Z → 2026-10-08T17:18:52.947Z | 0 |

[Manifest](w3-10-resumed-2026-10-08/CAMPAIGN.json), [phân tích/audit public](w3-10-resumed-2026-10-08/ANALYSIS.json). Raw output nằm ngoài repo; bản public lọc prompt/secret sau scoring và giữ nguyên stored scores, passed, calls, latency. Control đầu cửa sổ này lúc 16:36Z dừng ở 17/44: ca04 timeout 60026ms, no01 bị hủy khi đang gọi model lần 3. Diagnostic ca04 lúc 16:40Z nhận response sau 16.500s với concurrency 1; kết quả này không chứng minh nguyên nhân concurrency. Sau 366 calls hoàn tất ở ba bộ sau sửa, chạy control mới từ đầu lúc 17:13Z, đủ 44/44, không ghép 17 lượt trước. Mọi campaign cũ gián đoạn ở [manifest trước](w3-10-fix-2026-10-08/CAMPAIGN.json) giữ riêng, không ghép vào phép đo mới.

Phương án deferred-directory source 50761b1 đã bỏ vì P1: giữ [comparison lưu trữ](W3-10-COMPARISON-DEFERRED-DIRECTORY.md) và [verification lưu trữ](W3-10-VERIFICATION-DEFERRED-DIRECTORY.md), không dùng nghiệm thu hiện tại. Hedging/thinking variants từng thử không có lợi, không tái đưa vào. Usable plan rate, live adapter/external write và frontend end-to-end timing vẫn NOT_RUN trong W3-10.
