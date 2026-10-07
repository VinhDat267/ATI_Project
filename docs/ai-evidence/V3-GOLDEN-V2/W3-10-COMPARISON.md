# W3-10 — đối chiếu phép đo hoàn chỉnh

Source `50761b16ff3f87d7160b533cbc77e387eea3e972`; request `ag/gemini-3.8-flash`, served `gemini-3.8-flash-n` theo xác nhận người dùng; llm, concurrency2, ba lần mỗi bộ. Các sample gián đoạn được giữ riêng và không tính ở đây. Chỉ planning với search fixtures, không thực thi plan/dịch vụ thật. Token reasoning có thể nằm trong prompt token; không cộng chúng thêm vào tổng token.

| Bộ | Strict W3-06 → W3-10 | p50 / p95 trước → sau (s) | Dưới 15s trước → sau | Model call trước → sau |
|---|---|---|---|---|
| core | 150/150 → 150/150 | 5.454 / 13.105 → 15.067 / 25.285 | 144/150 (96.0%) → 73/150 (48.7%) | 171 → 258 |
| freeform | 51/54 → 52/54 | 5.942 / 13.092 → 15.804 / 26.668 | 52/54 (96.3%) → 21/54 (38.9%) | 63 → 111 |
| services | 111/132 → 129/132 | 6.105 / 31.097 → 13.090 / 27.042 | 107/132 (81.1%) → 79/132 (59.8%) | 172 → 225 |

## core

[Báo cáo gốc](core-llm-2026-10-07T16-34-09-538Z/summary.md); labels `1ab7f08d88546419048e0466f3214bb018c26592`, SHA-256 `7edeac39d6531cdc8bcc4340b1e64f02684eff61ea3bd1f39ab2f5b5ad00aa5a`; fixture `fe490f012ebf4c638c8ce6b33844efc615cf71d4d2d8d6b2135cb9f73b64af4e`, catalog `8e14ff40f2dd15760798b2050e46af93edd6d4cfc9682957dcdd55ed8b33f0ce`.

| Nhóm | Lượt | Strict trước → sau | p50 / p95 trước → sau (s) | Dưới15s trước → sau | Calls trước → sau |
|---|---|---|---|---|---|
| single_step | 30 | 30/30 → 30/30 | 4.387 / 9.084 → 11.658 / 22.011 | 30/30 (100.0%) → 23/30 (76.7%) | 30 → 45 |
| multi_step | 30 | 30/30 → 30/30 | 4.863 / 7.890 → 14.071 / 18.519 | 30/30 (100.0%) → 18/30 (60.0%) | 30 → 51 |
| cross_service | 45 | 45/45 → 45/45 | 6.660 / 12.359 → 18.406 / 29.653 | 45/45 (100.0%) → 6/45 (13.3%) | 48 → 90 |
| clarification | 27 | 27/27 → 27/27 | 7.958 / 19.011 → 18.235 / 25.174 | 21/27 (77.8%) → 8/27 (29.6%) | 45 → 54 |
| refusal | 18 | 18/18 → 18/18 | 4.720 / 8.300 → 7.634 / 10.852 | 18/18 (100.0%) → 18/18 (100.0%) | 18 → 18 |

258 calls / 261 attempt; 3 timeout; phân bố attempt/call `{"1":255,"2":3}`, retry `{"timeout":3}`.

| Thành phần | Thời gian cộng lượt (ms) | Tỉ lệ |
|---|---|---|
| model | 2306764.743 | 99.9784% |
| prefetch | 54.978 | 0.0024% |
| search | 11.068 | 0.0005% |
| other | 431.211 | 0.0187% |

Tổng 2307262 ms cộng thời gian lượt; không phải wall time campaign ở concurrency2.

Case giảm strict so với W3-06: không có.

## freeform

[Báo cáo gốc](freeform-llm-2026-10-07T16-53-33-903Z/summary.md); labels `695ad8758d9d658bd3606d15d679845dce30f7e4`, SHA-256 `79812f905a3d51752d7f245f3f258b6f2f2673b42a9ecadf2404d706293f0f80`; fixture `fe490f012ebf4c638c8ce6b33844efc615cf71d4d2d8d6b2135cb9f73b64af4e`, catalog `8e14ff40f2dd15760798b2050e46af93edd6d4cfc9682957dcdd55ed8b33f0ce`.

| Nhóm | Lượt | Strict trước → sau | p50 / p95 trước → sau (s) | Dưới15s trước → sau | Calls trước → sau |
|---|---|---|---|---|---|
| free_form | 36 | 36/36 → 36/36 | 6.041 / 15.103 → 15.722 / 26.733 | 34/36 (94.4%) → 15/36 (41.7%) | 45 → 75 |
| free_form_heldout | 18 | 15/18 → 16/18 | 5.294 / 12.840 → 16.881 / 25.880 | 18/18 (100.0%) → 6/18 (33.3%) | 18 → 36 |

111 calls / 111 attempt; 0 timeout; phân bố attempt/call `{"1":111}`, retry `{}`.

| Thành phần | Thời gian cộng lượt (ms) | Tỉ lệ |
|---|---|---|
| model | 899672.500 | 99.9683% |
| prefetch | 36.307 | 0.0040% |
| search | 5.148 | 0.0006% |
| other | 244.045 | 0.0271% |

Tổng 899958 ms cộng thời gian lượt; không phải wall time campaign ở concurrency2.

Case giảm strict so với W3-06: không có.
- ff15, lần 1: kind: expected plan, got clarification; 2 model call, 18 search, 18453 ms.
- ff15, lần 2: kind: expected plan, got clarification; 2 model call, 18 search, 17583 ms.

## services

[Báo cáo gốc](services-llm-2026-10-07T17-01-10-381Z/summary.md); labels `795229e24c64a38902e7efdce0680c729f37348a`, SHA-256 `6281f0869a6ca781a1ceb4650578a3cc095397ef28a87339029f0819b0fe9372`; fixture `fe490f012ebf4c638c8ce6b33844efc615cf71d4d2d8d6b2135cb9f73b64af4e`, catalog `8e14ff40f2dd15760798b2050e46af93edd6d4cfc9682957dcdd55ed8b33f0ce`.

| Nhóm | Lượt | Strict trước → sau | p50 / p95 trước → sau (s) | Dưới15s trước → sau | Calls trước → sau |
|---|---|---|---|---|---|
| read_only | 18 | 0/18 → 18/18 | 25.354 / 53.021 → 7.447 / 19.104 | 0/18 (0.0%) → 17/18 (94.4%) | 54 → 18 |
| single_step | 57 | 57/57 → 57/57 | 4.608 / 20.188 → 13.228 / 25.800 | 53/57 (93.0%) → 36/57 (63.2%) | 60 → 111 |
| cross_service | 27 | 27/27 → 27/27 | 7.653 / 10.921 → 21.452 / 33.204 | 27/27 (100.0%) → 2/27 (7.4%) | 27 → 54 |
| clarification | 15 | 12/15 → 12/15 | 7.150 / 41.108 → 13.090 / 18.841 | 13/15 (86.7%) → 11/15 (73.3%) | 16 → 27 |
| refusal | 15 | 15/15 → 15/15 | 4.621 / 18.139 → 7.491 / 24.034 | 14/15 (93.3%) → 13/15 (86.7%) | 15 → 15 |

225 calls / 228 attempt; 3 timeout; phân bố attempt/call `{"1":222,"2":3}`, retry `{"timeout":3}`.

| Thành phần | Thời gian cộng lượt (ms) | Tỉ lệ |
|---|---|---|
| model | 1982514.173 | 99.9732% |
| prefetch | 56.763 | 0.0029% |
| search | 12.450 | 0.0006% |
| other | 461.614 | 0.0233% |

Tổng 1983045 ms cộng thời gian lượt; không phải wall time campaign ở concurrency2.

Case giảm strict so với W3-06: không có.
- ca04, lần 1: kind: expected clarification, got refusal; 1 model call, 0 search, 18841 ms.
- ca04, lần 2: kind: expected clarification, got refusal; 1 model call, 0 search, 15189 ms.
- ca04, lần 3: kind: expected clarification, got refusal; 1 model call, 0 search, 14441 ms.

Read-only: 18/18 clarification/1call/0search/0prefetch.

| Case / run | Latency (ms) | Model calls | Attempts | Reasoning token từng call |
|---|---|---|---|---|
| ji03 / 2 | 58253 | 2 | 3 | 372, 789 |
| ji07 / 1 | 58180 | 2 | 3 | 2563, 253 |
| ca02 / 2 | 46920 | 2 | 3 | 334, 595 |
| wf02 / 1 | 33204 | 2 | 2 | 485, 2155 |
| ca03 / 2 | 32590 | 2 | 2 | 227, 600 |
| ca03 / 3 | 31720 | 2 | 2 | 255, 572 |
| wf04 / 3 | 27042 | 2 | 2 | 465, 1456 |
| wf04 / 2 | 26978 | 2 | 2 | 665, 1249 |
| ji08 / 2 | 25800 | 1 | 1 | 2632 |
| wf01 / 2 | 25251 | 2 | 2 | 967, 810 |
| ji08 / 3 | 25215 | 1 | 1 | 2447 |
| wf04 / 1 | 24342 | 2 | 2 | 456, 1755 |

## Kiểm tra concurrency1

[Một lượt services 44 case](services-llm-2026-10-07T17-18-22-282Z/summary.md), cùng source/model/labels; strict 43/44, p50/p95 13.312 / 29.845s, dưới15s 29/44 (65.9%); 75 call/76 attempt/1 timeout. So sánh concurrency theo các thời điểm khác nhau và 1 run với 3 run; không phải thí nghiệm ngẫu nhiên hoặc bằng chứng nhân quả của tranh chấp/tài khoản cổng.
