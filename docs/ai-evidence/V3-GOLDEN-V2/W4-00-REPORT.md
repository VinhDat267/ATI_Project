# W4-00 — model Codex dự phòng qua 9router

Ngày 12/10/2026. Chọn **`cx/gpt-6.1-sol`**, phản hồi **`gpt-6.1-sol`**.
Chuyển thủ công bằng `LLM_MODEL`; giữ provider `openai-compatible` và cùng
9router. Mã sản phẩm, prompt, label và các giới hạn timeout/retry không đổi.
[Runbook PowerShell/bash](../../../evaluations/README.md#w4-00-manual-codex-fallback-through-9router).

Model này giữ tham chiếu dữ liệu tốt hơn trong các lượt đã đo; bộ services
đạt ngưỡng tool/argument tổng thể và theo từng service mới. **Bộ core của
model được chọn vẫn partial do timeout**; không chứng nhận đã đạt toàn bộ
nghiệm thu sản phẩm, độ ổn định hay latency core. Quota tài khoản chưa rõ.

## Nguồn và phương pháp

- Source `305302b0901086344bf718f4f9be773867d3189b`.
- Core labels `1ab7f08d88546419048e0466f3214bb018c26592`, SHA-256
  `7edeac39d6531cdc8bcc4340b1e64f02684eff61ea3bd1f39ab2f5b5ad00aa5a`.
- Services labels `795229e24c64a38902e7efdce0680c729f37348a`, SHA-256
  `6281f0869a6ca781a1ceb4650578a3cc095397ef28a87339029f0819b0fe9372`.
- Planner tree `12e3047177b8e33fcfb6f3ea5040f6bd0f0a64ac`; schema tree
  `43fa555e7dd4a87dd1742de51eccf07fe6bb2159`.
- Catalog 33 tool/8 service, SHA-256
  `8e14ff40f2dd15760798b2050e46af93edd6d4cfc9682957dcdd55ed8b33f0ce`;
  fixture SHA-256 `fe490f012ebf4c638c8ce6b33844efc615cf71d4d2d8d6b2135cb9f73b64af4e`.
- Golden dùng model thật, tài nguyên fixture, `PLANNER_SEARCH_MODE=llm`;
  không thực thi plan. Full campaign: một lần mỗi bộ, concurrency 2, chạy
  tuần tự theo model; không sửa label sau khi thấy kết quả.
- Loại các biến thể `[1m]`, `-review`, reserve/auto-review/daybreak.
  Không so sánh số liệu này với campaign Gemini khác ngày/model.

## Probe chung: 8 câu mỗi model

Core `ss01,ms01,cl01`; services `sh01,sh02,sh03,ji06,no07`, concurrency 1.
`no07` thực sự mở một vòng search Notion rồi gọi model lần thứ hai; các ca
còn lại có cả directory prefetch, yêu cầu chỉ đọc và workflow liên service.
Median dưới đây là median tám lượt, không phải thời gian một lời gọi model.

| Model request | Served | Strict | Median lượt | Khoảng thời gian mỗi lời gọi | Calls |
|---|---|---:|---:|---:|---:|
| `cx/gpt-5.6-luna` | `gpt-5.6-luna` | 8/8 | 2,807 s | 1,767–3,645 s | 9 |
| `cx/gpt-6-luna` | `gpt-6-luna` | 8/8 | 3,469 s | 1,619–8,132 s | 9 |
| `cx/gpt-6.1-sol` | `gpt-6.1-sol` | 7/8 | 6,566 s | 3,338–8,030 s | 10 |

Cả tám kết quả cuối của từng ứng viên là JSON có cấu trúc; tên served khớp
request sau khi bỏ `cx/`. Probe nhỏ ban đầu ưu tiên `gpt-5.6-luna`; phép đo
đầy đủ bộc lộ lỗi tham chiếu nên đã kiểm cả hai ứng viên còn lại trước khi
chốt. Đây là các mẫu nhỏ theo thứ tự thời gian, không phải so sánh thống kê.

## Các chiến dịch đầy đủ

| Model | Bộ | Strict | Tools | Arguments khi tool đúng | p50 / p95 / max (s) | Trạng thái |
|---|---|---:|---:|---:|---|---|
| `cx/gpt-5.6-luna` | core | 45/50 | 97,1% | 88,2% | 2,950 / 6,066 / 11,328 | complete |
| `cx/gpt-5.6-luna` | services | 38/44 | 100% | 78,6% | 2,483 / 6,755 / 7,468 | complete |
| `cx/gpt-6-luna` | core | 45/50 | 94,3% | 90,9% | 2,848 / 6,434 / 10,075 | complete |
| `cx/gpt-6-luna` | services | 36/44 | 100% | 71,4% | 2,727 / 6,048 / 10,354 | complete |
| **`cx/gpt-6.1-sol`** | core | **48/50** | 100% | 100% | 6,034 / 11,959 / 62,773 | **partial** |
| **`cx/gpt-6.1-sol`** | services | **41/44** | **96,4%** | **96,3%** | **5,195 / 9,408 / 10,873** | **complete** |

Core `gpt-6.1-sol`: 50/50 lượt đã được dispatch, `complete=false`,
`evidence=provider_observed_partial`, exit 2. `cl04` có lời gọi thứ hai
timeout hai lần 30 giây; runner abort `rf07` đang chạy. Không có câu chưa
dispatch, nhưng không coi đây là một campaign hoàn chỉnh. Quantile core
trong bảng mô tả các lượt đã thử, gồm timeout/cancel; không dùng để đóng
gate latency. Có 56 model calls/57 attempts, hai timeout, một attempt bị
cancel. Giữ nguyên báo cáo và chưa đo lại toàn bộ core trong phiên này.

Một completion mới sau lần dừng đạt JSON/served model đúng trong 2,735 s.
Sau kiểm tra này, services được chạy thành **campaign riêng**: 44/44 lượt,
46 calls/46 attempts, không timeout/retry, tất cả lượt dưới 15 giây, exit 0.
Các ca chưa strict: `ca04` từ chối thay vì hỏi lại, `ji06` hỏi lại thay vì
plan, `wf02` sai matcher tham số `sheets.append_rows.rows`.

| Service mới, model được chọn | Tools | Arguments khi tool đúng |
|---|---:|---:|
| Sheets | 100% | 83,3% |
| Calendar | 100% | 100% |
| Notion | 100% | 100% |
| Telegram | 100% | 100% |
| Jira | 88,9% | 100% |

Bốn workflow ≥4 service: `gpt-5.6-luna` 0/4, `gpt-6-luna` 1/4,
`gpt-6.1-sol` 3/4 strict. Hai model Luna thường trả tham chiếu dưới dạng
chuỗi `${step.output.url}` thay vì cấu trúc `$ref`/`$template`; không được
coi các chuỗi này là kết quả liên kết hợp lệ. Không sửa prompt/validator
hay matcher để nâng điểm trong W4-00.

## Tương thích và giới hạn transport

Hai campaign của model được chọn có **100 HTTP 200 responses**, 100/100
content JSON hợp lệ, luôn request `response_format.type=json_object` và
served `gpt-6.1-sol`. Hai timeout và một cancel của core không có response
để kiểm JSON; không tính chúng là thành công.

Provider hiện tại chấp nhận `cx/gpt-6.1-sol` → `gpt-6.1-sol`; không thêm
alias hay nới kiểm model. Bộ provider hiện có: 19/19 test, exit 0. Probe
**HTTP localhost thật với lỗi chủ động**, tách khỏi bằng chứng 9router:
429→200 hai request; 503→200 hai request; 503 liên tục dừng ở ba request;
model khác bị từ chối sau một request; timeout 50 ms đóng kết nối HTTP
thật, một request. 5/5 đạt, exit 0. Deadline sản phẩm vẫn 30 giây,
`maxRetries=2`, `timeoutRetries=1`.

## App live: preview rồi Hủy

`npm run up` trên mã nguồn cùng commit, provider `openai-compatible`, model
`cx/gpt-6.1-sol`; health `runtimeMode=live`. PostgreSQL tmpfs riêng, database
preview mới, API/web riêng 3100/5274; chỉ cấu hình GitHub test repo qua API.
Trình duyệt Chromium thật đăng nhập, gửi câu chat tạo issue, nhìn thấy nút
Duyệt, chụp preview, rồi bấm **Hủy**.

- Preview **6,033 s**; gateway response **5,148 s**, HTTP 200, JSON hợp lệ,
  request `cx/gpt-6.1-sol`, served `gpt-6.1-sol`.
- Plan một bước `github.create_issue`, đúng repo/tiêu đề/nội dung thử nghiệm;
  PostgreSQL `pending` trước Hủy, `rejected` sau Hủy.
- **0 request approve; 0 dòng `execution_steps` trong toàn database preview**.
  Probe exit 0. Không tạo issue trên GitHub.
- Lượt app trước đó với `gpt-5.6-luna` cũng hủy được plan, nhưng assertion
  toàn DB fail vì ba execution rows còn lại từ `npm run check`. Giữ bằng
  chứng lượt đó; lượt nghiệm thu dùng database mới, không xóa fixture để
  làm assertion đạt. Lỗi preload Windows dùng đường dẫn thay vì file URL
  được sửa trong script bằng chứng riêng; không sửa mã sản phẩm.

Đã kiểm environment `LLM_MODEL` thắng `.env` với cả runner và `npm run up`;
gỡ override nạp lại route Gemini từ `.env`. SHA-256 `.env` gốc và bản riêng
khớp trước/sau; không sửa `.env` chính. Khởi động lại route chính chỉ kiểm
startup/health, không đo lại chất lượng Gemini.

## Kiểm chứng và bằng chứng gốc

`npm run check` với PostgreSQL riêng: exit 0, **1.674 v3 + 173 eval**,
typecheck/build/build-security/launcher 1/1/env-OIDC 10/10 đạt. Chỉ thay đổi
runbook, báo cáo, phần Kết quả task card và một log mới. Không thay mã sản
phẩm nên không có chu trình RED/GREEN cho implementation mới.

Raw reports, observer metadata, script probe, log và ảnh nằm ở máy nhóm
trưởng trong `docs/ai-evidence/V3-LIVE-EXECUTION/W4-00-2026-10-12/`
(ignored); manifest SHA-256 nằm cùng thư mục. PR chỉ chứa số liệu tổng hợp,
không chứa credentials, câu chat của người dùng thật hay thông tin quota
chưa xác minh. Usable-plan rate, chạy ghi live bằng model dự phòng, W3-11,
các phép đo chính thức tuần 4 và độ sẵn sàng khi chính 9router hỏng vẫn
**NOT_RUN** trong W4-00.
