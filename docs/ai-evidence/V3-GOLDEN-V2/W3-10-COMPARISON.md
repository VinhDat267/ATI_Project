# W3-10 — đối chứng cùng ngày sau sửa review ngày 08/10

**Chưa đủ nghiệm thu P2.** Bốn campaign đối chứng đều dừng theo chính sách bảo toàn provider fault; chưa chạy campaign sau sửa. Không ghép các sample để đủ số câu, không dùng số liệu phương án đã bỏ để nhận xét bản sửa. Chưa đánh giá được strict parity, read_only 18/18, số lượt tăng/giảm model calls hoặc p95 services sau sửa.

Model request `ag/gemini-3.8-flash`, served alias `gemini-3.8-flash-n` được chủ dự án chấp nhận. Mọi lượt đối chứng dùng llm / concurrency 2, cùng deadline/retry mặc định. Không đổi model/cx hoặc cấu hình 9router. Nhánh đối chứng local-only từ `8155c03`, chỉ cherry-pick `845701c` thành `7898aa7`; conflict bỏ context timing chưa có, test bỏ hai assertion metrics; diff đúng 2 file provider/test,26 insertions/1 deletion. Npmci riêng, provider 19/19 exit 0, không push nhánh này.

Chủ dự án xác nhận ngày 08/10: read_only phải clarification, đúng 1 lời gọi model, 0 vòng do model mở (phase `search`); directory prefetch của nền tảng (phase `prefetch`) được phép. `searchRounds` đếm phase `search`, một vòng có thể nhiều tool calls. `searches` loại directory; `prefetches` chứa directory, mỗi trace có phase. Regex gather đo riêng, không tính model search. Các report cũ gộp thư mục vào searches; không dùng độ dài trường đó cho tiêu chí mới. Scorer/aggregate service kiểm số call/vòng của read_only; label `795229e` không đổi.

## Ba cột kết quả

Mỗi ô hoàn chỉnh: strict; p50/p95; số lượt và phần trăm dưới15s; tổng model calls. W3-06 có3 runs, đối chứng yêu cầu ít nhất1 run core/services, sau sửa yêu cầu3 runs cả3 bộ. Mẫu số không bằng nhau; không nhân số liệu một run thành ba run hoặc tuyên bố hiệu ứng nhân quả chắc chắn.

| Bộ | W3-06 lịch sử, model flash | Đối chứng cùng ngày, mã cũ, model -n | W3-10 sau sửa, model -n |
|---|---|---|---|
| core | 150/150 strict; 5.454/13.105s; 144/150 (96.0%) <15s; 171 calls | Chưa có campaign hoàn chỉnh | NOT_RUN |
| freeform | 51/54 strict; 5.942/13.092s; 52/54 (96.3%) <15s; 63 calls | Chưa có campaign hoàn chỉnh | NOT_RUN |
| services | 111/132 strict; 6.105/31.097s; 107/132 (81.1%) <15s; 172 calls | Chưa có campaign hoàn chỉnh | NOT_RUN |

### core: theo nhóm câu

| Nhóm | W3-06 lịch sử, flash | Đối chứng cùng ngày, mã cũ, -n | Sau sửa, -n |
|---|---|---|---|
| single_step | 30/30 strict; 4.387/9.084s; 30/30 (100.0%) <15s; 30 calls | Chưa có campaign hoàn chỉnh | NOT_RUN |
| multi_step | 30/30 strict; 4.863/7.890s; 30/30 (100.0%) <15s; 30 calls | Chưa có campaign hoàn chỉnh | NOT_RUN |
| cross_service | 45/45 strict; 6.660/12.359s; 45/45 (100.0%) <15s; 48 calls | Chưa có campaign hoàn chỉnh | NOT_RUN |
| clarification | 27/27 strict; 7.958/19.011s; 21/27 (77.8%) <15s; 45 calls | Chưa có campaign hoàn chỉnh | NOT_RUN |
| refusal | 18/18 strict; 4.720/8.300s; 18/18 (100.0%) <15s; 18 calls | Chưa có campaign hoàn chỉnh | NOT_RUN |

### freeform: theo nhóm câu

| Nhóm | W3-06 lịch sử, flash | Đối chứng cùng ngày, mã cũ, -n | Sau sửa, -n |
|---|---|---|---|
| free_form | 36/36 strict; 6.041/15.103s; 34/36 (94.4%) <15s; 45 calls | Chưa có campaign hoàn chỉnh | NOT_RUN |
| free_form_heldout | 15/18 strict; 5.294/12.840s; 18/18 (100.0%) <15s; 18 calls | Chưa có campaign hoàn chỉnh | NOT_RUN |

### services: theo nhóm câu

| Nhóm | W3-06 lịch sử, flash | Đối chứng cùng ngày, mã cũ, -n | Sau sửa, -n |
|---|---|---|---|
| read_only | 0/18 strict; 25.354/53.021s; 0/18 (0.0%) <15s; 54 calls | Chưa có campaign hoàn chỉnh | NOT_RUN |
| single_step | 57/57 strict; 4.608/20.188s; 53/57 (93.0%) <15s; 60 calls | Chưa có campaign hoàn chỉnh | NOT_RUN |
| cross_service | 27/27 strict; 7.653/10.921s; 27/27 (100.0%) <15s; 27 calls | Chưa có campaign hoàn chỉnh | NOT_RUN |
| clarification | 12/15 strict; 7.150/41.108s; 13/15 (86.7%) <15s; 16 calls | Chưa có campaign hoàn chỉnh | NOT_RUN |
| refusal | 15/15 strict; 4.621/18.139s; 14/15 (93.3%) <15s; 15 calls | Chưa có campaign hoàn chỉnh | NOT_RUN |

## Phân rã thời gian

| Thành phần | W3-06 lịch sử | Đối chứng mã cũ cùng ngày | Sau sửa |
|---|---|---|---|
| Model/call/attempt/token | Không có telemetry từng call | Không có telemetry từng call | NOT_RUN |
| Prefetch/search/gather/other | Không đo riêng | Không đo riêng | NOT_RUN |

Không suy attempt/time share từ latency mã cũ. Instrumentation phầnA giữ nguyên và đã qua test AbortSignal thật. Chưa có dữ liệu model sau sửa để điền phân rã hoặc xác nhận mục tiêu p95.

## Từng câu và số lời gọi

Chưa có cặp campaign hoàn chỉnh nên chưa tính được số lượt tăng/bằng/giảm theo từng câu. Trong core sample 25/50, 23 câu hoàn tất đều 1 call ở mã cũ; test P1 mới kiểm bản sửa lập plan ghi ngay call1 với thư mục trong memory call 1. Đây là bằng chứng test, chưa thay thế phép so model thật. Khi đo lại sẽ so từng run sau sửa với số call quan sát ở một run đối chứng, nêu rõ biến thiên model và lý do search/validation của từng lượt tăng.

## Các sample gián đoạn — không gộp

| Campaign đối chứng | UTC bắt đầu → kết thúc | Đã thử / dự kiến | Strict của sample | Fault / hủy theo sibling |
|---|---|---|---|---|
| core 04:32:33 | 2026-10-08T04:32:33.902Z → 2026-10-08T04:33:35.920Z | 2/50 | 0/2 | ss01: Model request timed out, 60143ms, 1 calls; ss02: Evaluation stopped after provider failure, 60071ms, 1 calls |
| core 04:35:46 | 2026-10-08T04:35:46.975Z → 2026-10-08T04:36:47.927Z | 2/50 | 0/2 | ss01: Model request timed out, 60100ms, 1 calls; ss02: Evaluation stopped after provider failure, 60060ms, 1 calls |
| core 04:46:19 | 2026-10-08T04:46:19.809Z → 2026-10-08T04:51:34.563Z | 25/50 | 23/25 | cs02: Model request timed out, 60036ms, 1 calls; cs05: Evaluation stopped after provider failure, 4538ms, 1 calls |
| services 04:55:59 | 2026-10-08T04:55:59.107Z → 2026-10-08T05:00:09.534Z | 12/44 | 8/12 | ca01: Model request timed out, 103323ms, 3 calls; ca04: Evaluation stopped after provider failure, 49620ms, 1 calls |

Mỗi sample có report/summary/CONTEXT trong [campaign](w3-10-fix-2026-10-08/CAMPAIGN.json). Runner exit 2; fault và cancellation được giữ riêng. Core/service sample không dùng để tính p95 toàn bộ hoặc strict parity.

## Chẩn đoán cổng

GET models 200 và tiến trình9router có hoạt động. Đọc SQLite 9router bằng mode=ro&immutable=1 chỉ xuất metadata; usage có phản hồi ok nhưng không có requestDetails đủ để gắn từng record cho request của task. Probe cùng planner/model xác minh headers chậm: attempt đầu bị deadline 30 s hủy trước headers, retryHTTP 200 sau 23.885 s, body thêm 2.149 ms, tổng 53.952 s. Probe tối giản 10.750 s, headers 10.747 s / body 2.423 ms. Probe là chẩn đoán riêng, không benchmark. Không có bằng chứng lỗi đọc JSON; không tách được queue/mạng/suy luận hoặc gán 429/account switch. Completion chưa đủ ổn định với deadline hiện hữu để hoàn tất đối chứng. Đã dừng đo, cần trạng thái upstream thay đổi trước khi đo lại cùng cấu hình. [Bằng chứng](w3-10-fix-2026-10-08/ROUTER-DIAGNOSTIC.md).

## Phương án đã thử và bỏ

Source50761b1 dời thư mục sau model search là phương án đã bỏ vì reviewP1. Giữ nguyên mọi campaign ngày 07–08/10, gồm core 150/150, freeform 52/54, services 129/132 và concurrency 1; **không dùng nghiệm thu bản sửa này**. Services khi đó p95 27.042s,79/132 dưới 15 s, single_step 60→111 calls, cross_service 27→54 so W3-06. So sánh lịch sử còn có confound flash→flash-n. [Comparison lưu trữ](W3-10-COMPARISON-DEFERRED-DIRECTORY.md), [verification lưu trữ](W3-10-VERIFICATION-DEFERRED-DIRECTORY.md), [log cũ giữ nguyên](../../handoff/log/2026-10-08-codex-W3-10.md).
