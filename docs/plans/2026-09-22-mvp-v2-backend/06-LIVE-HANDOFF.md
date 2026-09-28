# Batch 06 — Live SaaS Hand-off & Live AI Evaluation

Ngày lập: 23/09/2026. **Trạng thái bằng chứng 25/09/2026:** `SAAS_READ_CONFIRMED / SAAS_LIVE_EXERCISED / PROVIDER_LIMITED / AI_QUALITY_NOT_MEASURED / CUSTOMER_VALIDATED_NOT_RUN / HANDOFF_BLOCKED`.

Tài liệu này ghi tiêu chuẩn nghiệm thu cho **BE-26..29**. Unit test P6 dùng transport giả; riêng [preflight](../../ai-evidence/PILOT-V2-LIVE/preflight-read-confirmed.json) và [phiên API sandbox một card](../../ai-evidence/PILOT-V2-LIVE/live-session-confirmed.json) có artifacts live ngày 25/09. CLI preflight và script phiên live tách khỏi runner P6 `live-uc2-runner`/`live-eval-runner` (runner đánh giá vẫn mô phỏng); [probe Gemini](../../ai-evidence/PILOT-V2-AI/PROBE-2026-09-25.md) không phải phép đo quality đầy đủ. Các DoD phía dưới là tiêu chí, không phải xác nhận mọi mục đã hoàn thành. Xem [audit P6](P6-REVIEW.md) và [runbook](../../PILOT-V2-RUNBOOK.md).

---

## 1. Danh mục Nhiệm vụ và Phụ thuộc Kỹ thuật

| Task ID | Tên Nhiệm vụ | Phụ thuộc | File Triển khai | File Kiểm thử | Trạng thái |
|---|---|---|---|---|:---:|
| **BE-26** | SaaS setup & live read preflight | BE-13 | `packages/engine/src/pilot/live-preflight.ts`, `live-preflight-cli.ts` | `packages/engine/tests/pilot-live-preflight.test.ts` + live artifact | **SAAS_READ_CONFIRMED** (một preflight sandbox) |
| **BE-27** | Live manual UC2 + receipt | BE-18, BE-26 | API `/pilot/v2` + `scripts/execute-pilot-v2-live.ts`; runner P6 riêng | HTTP/DB/Chromium giả + live artifact | **SAAS_LIVE_EXERCISED** (một card sandbox) |
| **BE-28** | Live AI / quality evaluation | BE-25, BE-27 | `packages/engine/src/pilot/live-eval-runner.ts` (mô phỏng); probe riêng | `packages/engine/tests/pilot-live-eval.test.ts` + probe artifact | **PROVIDER_LIMITED / AI_QUALITY_NOT_MEASURED** |
| **BE-29** | Runbook, evidence & handoff | BE-25, BE-27, BE-28 | `docs/PILOT-V2-RUNBOOK.md` | `docs/plans/2026-09-22-mvp-v2-backend/P6-REVIEW.md` | **DOC_UPDATED / HANDOFF_BLOCKED** |

---

## 2. Chi tiết Đặc tả Từng Nhiệm vụ

### BE-26: SaaS Setup & Live Read Preflight
- **Mục tiêu:** Thiết lập kết nối đọc an toàn tới Google Sheets và Trello, thẩm định tính hợp lệ của cấu hình và bảo vệ hệ thống trước sự cố rò rỉ credential.
- **Tiêu chuẩn hoàn thành (DoD):**
  1. Fail-closed: Nếu thiếu credential hoặc `PILOT_V2_ENABLED=false`, trả về trạng thái `BLOCKED_EXTERNAL`.
  2. Bất biến Zero-Write: Không có bất kỳ thao tác ghi nào xảy ra trong giai đoạn tiền kiểm (`writesAttempted === 0`).
  3. Kiểm tra che giấu secret trên các đường lỗi và log thực tế; unit test không chứng minh tỷ lệ 100%.
  4. Đọc thử thành công bảng tính và danh sách cột/thành viên Trello khi cấu hình hợp lệ.

### BE-27: Live Manual UC2 + Receipt Execution
- **Mục tiêu:** Thực thi trọn vẹn luồng tiếp nhận công việc thực tế Use Case 2 với sự phê duyệt của người vận hành và cơ chế an toàn chống trùng lặp.
- **Tiêu chuẩn hoàn thành (DoD):**
  1. Sửa runner để không tự phê duyệt; đọc approval đã lưu và kiểm owner/version/hash/TTL trước dispatch.
  2. Mã băm xem trước bất biến (SHA-256) và hạn sử dụng Server TTL 10 phút.
  3. Từ chối thực thi khi phát hiện sai lệch mã băm (`SNAPSHOT_MISMATCH`) hoặc hết hạn (`TTL_EXPIRED`).
  4. Đúng 1 thao tác ghi duy nhất: tạo thẻ trên Trello (`trello.create_card`).
  5. Zero Blind Retry: Khi timeout sau khi gửi, chuyển reservation sang `unknown` và dừng lại ở `reconciliation_required`.
  6. Khi `intentKey` đã `confirmed`, trả receipt cũ và không POST; lỗi sau POST phải giữ trạng thái `unknown` để đối chiếu.

### BE-28: Live AI / Quality Evaluation
- **Mục tiêu:** Đánh giá chất lượng và độ chính xác phân nhánh của mô hình AI trên bộ dataset chuẩn 40 biến thể (20 scenarios × 2 ngôn ngữ vi/en).
- **Tiêu chuẩn hoàn thành (DoD):**
  1. Gọi provider thật trên dataset đã freeze và holdout riêng; ghi observed outcome từng ca, không đọc nhãn `expected` để sinh kết quả.
  2. Kiểm chứng 0 ghi không được phép và đúng receipt cho UC2 bằng evidence từ SaaS/DB; chốt ngưỡng trước khi xem kết quả.
  3. Ghi token/chi phí từ usage và price card thực, gồm mọi lần gọi; báo riêng giá trị ước lượng nếu provider không trả usage.
  4. Xuất báo cáo có commit, model, cấu hình, nguồn giá, ngân sách, denominator và trường hợp `NOT_RUN`.

### BE-29: Runbook, Evidence & Handoff
- **Mục tiêu:** Xây dựng tài liệu vận hành và rà soát độc lập để sẵn sàng bàn giao cho người dùng và quản trị viên.
- **Tiêu chuẩn hoàn thành (DoD):**
  1. Xuất bản `docs/PILOT-V2-RUNBOOK.md` hướng dẫn chi tiết quy trình vận hành, phê duyệt và đối chiếu sự cố.
  2. Chỉ bàn giao vận hành sau khi các lỗi chặn trong [audit P6](P6-REVIEW.md) được sửa, kiểm thử lại và có bằng chứng live được phép.
