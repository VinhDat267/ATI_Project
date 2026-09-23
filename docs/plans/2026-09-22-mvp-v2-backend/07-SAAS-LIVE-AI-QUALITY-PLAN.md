# Kế hoạch triển khai SaaS live và AI quality — MVP v2

Ngày lập: 23/09/2026. Đây là kế hoạch; **chưa gọi SaaS hoặc AI provider thật**.

## 1. Điểm xuất phát đã kiểm

- `HEAD 87e4cc4`: API/PostgreSQL/browser đã kiểm owner isolation và UC1/UC3 trên fixture; approval UC2 có DB binding và cờ ghi tắt mặc định.
- BE-26/27 vẫn `SAAS_LIVE_NOT_RUN`; ba runner P6 chưa nối vào một lệnh/API vận hành. Adapter Sheets có nhánh service account nhưng chưa cấp bearer token.
- BE-28 vẫn `AI_QUALITY_NOT_RUN`: runner P6 dùng `expected`/case ID và token, latency, cost ước tính; không gọi provider.
- Dataset v2 có 40 bản public và 20 bản holdout tái dựng. Pipeline AI live B/local có cơ chế freeze/ledger, nhưng kết quả hoặc kiểm thử của nó không phải quality evidence cho v2.
- Handoff vẫn `BLOCKED`; nghiệm thu người dùng đại diện vẫn `CUSTOMER_VALIDATED_NOT_RUN`.

## 2. Thứ tự triển khai và điểm dừng

| Cổng | Công việc | Bằng chứng để qua cổng | Dừng khi |
|---|---|---|---|
| G0 — Khóa phạm vi | Chốt một Sheet/tab/request ID, một Trello board/list sandbox, hai principal, chủ tài khoản; chốt phương thức auth và tách DB/credential | Manifest tài nguyên và commit, không chứa secret | Thiếu quyền, không biết target chính xác |
| G1 — Sửa đường đọc | Làm CLI preflight chỉ GET; sửa auth Sheet riêng tư nếu cần; test fail-closed, allowlist, redaction, zero POST | Unit/integration pass và command chạy được khi thiếu cấu hình theo hướng chặn | CLI fallback sang fixture hoặc dùng credential không hoạt động |
| G2 — BE-26 read live | Giữ cờ write off; đọc một hàng Sheet và Trello lists/members thật | Timestamp, commit, source revision, board/list, GET trace, 0 POST, lỗi đã che secret | Một GET lỗi hoặc trả sai nguồn/board |
| G3 — An toàn UC2 | Regression API/DB/browser cho owner, TTL, hash, source/list drift, race, restart, receipt, unknown; chỉ dùng API approval đã lưu DB | `npm run check:backend`, browser tests, tối đa một POST trong fake transport | Bất kỳ nhánh nào có thể POST lại hoặc báo thành công sai |
| G4 — BE-27 write live | Sau duyệt phạm vi **một card**, chạy UC1 → preview/approval UC2 → Trello create một lần → GET kiểm card → UC3; kiểm A/B isolation | Card ID/URL thật, board/list/member/nội dung khớp preview, DB receipt và remote GET khớp, UC1/UC3 zero write | Timeout/unknown, sai đích/nội dung, approval hết hạn, owner sai; ngừng ghi và đối chiếu |
| G5 — Khóa phép đo AI | Chốt rubric và ngưỡng số, 40+20 record, prompt/catalog/model/mode, price card, budget, nguồn đối chứng; manifest hash | Bản freeze được review và phê duyệt cho số call/chi phí giới hạn | Thiếu giá, budget, rubric, quyền provider, oracle chưa tách |
| G6 — Runner provider v2 | Tạo runner source-aware không nhìn `expected`; ghi observed trước khi grader đối chiếu; ledger toàn bộ call, lỗi, token/giá thực | Fake-provider tests, accounting tests, không remote write ở trial lặp | Rò oracle, không thể kiểm ngân sách, usage/cost bị gắn nhãn actual sai |
| G7 — BE-28 đo thật | Probe có cap → smoke vi/en/UC1–3 → public 40/mode → holdout 20 một lần; review độc lập | Báo cáo từng case và tổng hợp có denominator, fail, safety, latency, token/cost, semantic vs semantic+QE; receipt SaaS tách riêng | Safety violation, vượt budget, provider schema không tương thích, thiếu ledger |
| G8 — BE-29 handoff | Đối chiếu evidence, runbook, status và giới hạn kết luận | Reviewer ký verdict theo từng trục evidence | Bằng chứng fixture bị trình bày thành live hoặc chưa đối chiếu unknown |

G1/G3 và phần kỹ thuật G5/G6 có thể làm song song. G4 chỉ chạy sau G2/G3; G7 chỉ chạy sau G5/G6 và cần receipt G4 nếu muốn kết luận end-to-end. Không bật ghi chỉ để làm preflight. Việc cho phép **một write cụ thể** và **ngân sách provider cụ thể** là hai quyết định riêng, sau khi cấu hình và payload/manifest đã sẵn sàng để xem.

## 3. Quy tắc nghiệm thu

- `SAAS_READ_CONFIRMED`: hai dịch vụ GET thật thành công đúng allowlist; 0 remote write.
- `SAAS_LIVE_EXERCISED`: UC1 zero write, đúng một UC2 create sau approval, UC3 đọc card thật, owner B không xem/duyệt run A, remote receipt khớp DB. Unknown không được tính pass.
- `AI_QUALITY_MEASURED`: provider thật chạy trên v2, oracle tách, đủ số mẫu theo manifest, ledger đối chiếu được, grading độc lập và tất cả fail được công bố. Đạt ngưỡng chất lượng là verdict riêng; ngưỡng phải khóa trước khi đo.
- `CUSTOMER_VALIDATED`: vẫn `NOT_RUN` cho tới khi có nghiệm thu của người dùng đại diện. Không suy từ synthetic data hoặc role-play.

## 4. Tài liệu thực thi

- [Plan SaaS live chi tiết](../../superpowers/plans/2026-09-23-pilot-v2-saas-live.md): file, test, cổng preflight, một write và reconciliation.
- [Plan AI quality chi tiết](../../superpowers/plans/2026-09-23-pilot-v2-ai-quality.md): freeze, runner oracle-blind, ledger, provider run và review.
- [Runbook hiện tại](../../PILOT-V2-RUNBOOK.md), [dataset contract](../../MVP-V2-DATASET.md), [BE-26..29 handoff](06-LIVE-HANDOFF.md).

## 5. Đầu vào cần chuẩn bị trước vận hành live

Chủ project xác định tài khoản thử, Sheet/tab/request ID và Trello board/list sandbox, hai principal, phương thức chia sẻ quyền đọc Sheet, credential Trello, provider/model muốn đo, trần chi phí/call, nguồn giá và người chấm rubric. Nhóm triển khai có thể hoàn thành G1/G3/G6 bằng fake transport trước khi nhận những đầu vào này. Trước G4/G7, trình payload card và manifest AI cụ thể để chủ project duyệt phạm vi live.
