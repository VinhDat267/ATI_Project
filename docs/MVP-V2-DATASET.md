# Dataset contract — MVP v2

Status: SPEC_APPROVED / DATASET_NOT_CREATED / ALL_EXECUTION_NOT_RUN.

Nguồn oracle: [đặc tả mục 8](superpowers/specs/2026-09-21-workflow-platform-mvp-v2-design.md).
Giữ đủ V2-01 đến V2-20, mỗi case có biến thể tiếng Việt và tiếng Anh.
Các tình huống tái dựng do nhóm viết, không phải dữ liệu khách hàng thu thập.
Không sửa `testdata/test-cases.json`, `testdata/tools.json` hoặc
`testdata/experiment-manifest.json` để biến evidence B/local thành v2.

## Dạng record cần tạo khi triển khai dataset

Mỗi record phải có các trường sau; chưa có record nào được tính là đã chạy:

| Trường | Nội dung bắt buộc |
|---|---|
| case_id / variant_id | V2-01..V2-20 / định danh biến thể duy nhất |
| language / origin | vi hoặc en / reconstructed_synthetic |
| source_refs | S1..S5 hoặc E theo đặc tả, không ghi nguồn là khách được phỏng vấn |
| source_fixture | Header + hàng Sheets giả lập, request ID ổn định; không secret/PII thật |
| prompt / principal / resource_policy | Prompt cụ thể, operator giả lập và allowlist |
| fault | none hoặc fault được định danh, thời điểm inject và transport giả lập |
| expected | Kết quả, trường thiếu, tool/args, write count, trạng thái và nguồn bằng chứng |
| evidence | Mode, commit, cấu hình đã redact, artifact path, observed và verdict |

Tách bốn trục evidence: CONTRACT_TESTED, SAAS_LIVE_EXERCISED,
AI_QUALITY_MEASURED và CUSTOMER_VALIDATED. Không nâng trục khác khi một trục pass.
Provider thật chạy trên nội dung giả lập vẫn là dữ liệu giả lập.

## Quy tắc oracle và đóng băng

- UC2: tối đa một create; 0 trước approval; đúng board/list/member/nội dung;
  ID/link từ response hợp lệ. HTTP 200 hoặc run succeeded không đủ.
- Case thiếu thông tin, ID trùng, sai quyền: 0 create; lý do phải khớp oracle.
- Unknown sau dispatch: không retry, không mất reservation, không báo rollback.
- Tách acceptance công khai và holdout paraphrase chưa dùng điều chỉnh prompt.
  Freeze hash dataset/catalog/prompt/model trước đo; thay đổi phải lập run mới.
- Cùng bộ dữ liệu/quyền cho manual role-play, workflow cố định và AI;
  báo riêng semantic/semantic+QE, mọi token/call/cost, lỗi và mẫu đo.
- V2-19 fault injection chỉ ở môi trường test; không cố gây lỗi tài khoản thật.
- Dữ liệu live, tài nguyên và ngân sách phải được duyệt riêng; thiếu thì NOT_RUN.

Batch P1a chỉ có unit fixtures cho identity/source/policy; không thay thế
20 acceptance cases, không tạo holdout và không tuyên bố đã đủ dataset.
