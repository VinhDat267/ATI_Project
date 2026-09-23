# Dataset contract — MVP v2

Status (23/09/2026): SPEC_APPROVED / RECONSTRUCTED_DATASET_CREATED /
CONTRACT_TESTS_PRESENT / SAAS_LIVE_NOT_RUN / AI_QUALITY_NOT_RUN /
CUSTOMER_VALIDATED_NOT_RUN.

Nguồn oracle: [đặc tả mục 8](superpowers/specs/2026-09-21-workflow-platform-mvp-v2-design.md).
Giữ đủ V2-01 đến V2-20, mỗi case có biến thể tiếng Việt và tiếng Anh.
Các tình huống tái dựng do nhóm viết, không phải dữ liệu khách hàng thu thập.
Không sửa `testdata/test-cases.json`, `testdata/tools.json` hoặc
`testdata/experiment-manifest.json` để biến evidence B/local thành v2.

`testdata/v2-dataset/cases.json` hiện có 20 case × vi/en = 40 records;
`testdata/v2-dataset/holdout.json` có 10 case × vi/en = 20 records. Các test
schema/acceptance dùng fixture tái dựng; [runner P6](plans/2026-09-22-mvp-v2-backend/P6-REVIEW.md)
không gọi provider. Holdout chưa là bằng chứng đo chất lượng AI.

## Dạng record và evidence cần giữ

Mỗi record có dữ liệu fixture và oracle; `evidence.verdict: NOT_RUN` không được
tự đổi thành live pass chỉ vì unit test đọc record:

| Trường | Nội dung bắt buộc |
|---|---|
| caseId / variantId | V2-01..V2-20 / định danh biến thể duy nhất |
| language / origin | vi hoặc en / reconstructed_synthetic |
| sourceRefs | S1..S5 hoặc E theo đặc tả, không ghi nguồn là khách được phỏng vấn |
| sourceFixture | Header + hàng Sheets giả lập, request ID ổn định; không secret/PII thật |
| prompt / principal / resourcePolicy | Prompt cụ thể, operator giả lập và allowlist |
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

Batch P1a ban đầu chỉ có unit fixtures; dataset và holdout đã được thêm sau đó.
Chưa có provider-backed run và nghiệm thu người dùng đại diện cho bộ v2.
