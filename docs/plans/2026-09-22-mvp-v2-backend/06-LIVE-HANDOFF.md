# Batch 06 — Live SaaS Hand-off & Live AI Evaluation

Ngày lập: 23/09/2026. Trạng thái: **EXECUTED / VERIFIED**.

Tài liệu này đặc tả chi tiết kế hoạch thực hiện và tiêu chuẩn nghiệm thu cho 4 nhiệm vụ thuộc **Batch 06 (Tasks BE-26..29)** của lộ trình Backend MVP v2.

---

## 1. Danh mục Nhiệm vụ và Phụ thuộc Kỹ thuật

| Task ID | Tên Nhiệm vụ | Phụ thuộc | File Triển khai | File Kiểm thử | Trạng thái |
|---|---|---|---|---|:---:|
| **BE-26** | SaaS setup & live read preflight | BE-13 | `packages/engine/src/pilot/live-preflight.ts` | `packages/engine/tests/pilot-live-preflight.test.ts` | **DONE** |
| **BE-27** | Live manual UC2 + receipt | BE-18, BE-26 | `packages/engine/src/pilot/live-uc2-runner.ts` | `packages/engine/tests/pilot-live-uc2.test.ts` | **DONE** |
| **BE-28** | Live AI / quality evaluation | BE-25, BE-27 | `packages/engine/src/pilot/live-eval-runner.ts` | `packages/engine/tests/pilot-live-eval.test.ts` | **DONE** |
| **BE-29** | Runbook, evidence & handoff | BE-25, BE-27, BE-28 | `docs/PILOT-V2-RUNBOOK.md` | `docs/plans/2026-09-22-mvp-v2-backend/P6-REVIEW.md` | **DONE** |

---

## 2. Chi tiết Đặc tả Từng Nhiệm vụ

### BE-26: SaaS Setup & Live Read Preflight
- **Mục tiêu:** Thiết lập kết nối đọc an toàn tới Google Sheets và Trello, thẩm định tính hợp lệ của cấu hình và bảo vệ hệ thống trước sự cố rò rỉ credential.
- **Tiêu chuẩn hoàn thành (DoD):**
  1. Fail-closed: Nếu thiếu credential hoặc `PILOT_V2_ENABLED=false`, trả về trạng thái `BLOCKED_EXTERNAL`.
  2. Bất biến Zero-Write: Không có bất kỳ thao tác ghi nào xảy ra trong giai đoạn tiền kiểm (`writesAttempted === 0`).
  3. Che giấu bí mật (Secret Redaction): 100% token, key và URL query params được che giấu (`[REDACTED]`).
  4. Đọc thử thành công bảng tính và danh sách cột/thành viên Trello khi cấu hình hợp lệ.

### BE-27: Live Manual UC2 + Receipt Execution
- **Mục tiêu:** Thực thi trọn vẹn luồng tiếp nhận công việc thực tế Use Case 2 với sự phê duyệt của người vận hành và cơ chế an toàn chống trùng lặp.
- **Tiêu chuẩn hoàn thành (DoD):**
  1. Đánh giá checklist điều kiện: Chỉ thực thi khi checklist đạt `pass`.
  2. Mã băm xem trước bất biến (SHA-256) và hạn sử dụng Server TTL 10 phút.
  3. Từ chối thực thi khi phát hiện sai lệch mã băm (`SNAPSHOT_MISMATCH`) hoặc hết hạn (`TTL_EXPIRED`).
  4. Đúng 1 thao tác ghi duy nhất: tạo thẻ trên Trello (`trello.create_card`).
  5. Zero Blind Retry: Khi timeout sau khi gửi, chuyển reservation sang `unknown` và dừng lại ở `reconciliation_required`.
  6. Ngăn chặn chạy trùng lặp trên cùng `intentKey`.

### BE-28: Live AI / Quality Evaluation
- **Mục tiêu:** Đánh giá chất lượng và độ chính xác phân nhánh của mô hình AI trên bộ dataset chuẩn 40 biến thể (20 scenarios × 2 ngôn ngữ vi/en).
- **Tiêu chuẩn hoàn thành (DoD):**
  1. Đạt tỷ lệ chính xác phân nhánh quyết định 100% trên 40 ca kiểm thử.
  2. Không có bất kỳ vi phạm an toàn nào (0 ghi trên nhánh đọc/từ chối, đúng 1 ghi trên nhánh UC2).
  3. Kế toán token chính xác: Ghi nhận prompt tokens, completion tokens, và chi phí micro-dollars theo đơn giá Gemini.
  4. Xuất báo cáo tổng hợp Markdown chi tiết từng ca kiểm thử.

### BE-29: Runbook, Evidence & Handoff
- **Mục tiêu:** Xây dựng tài liệu vận hành và rà soát độc lập để sẵn sàng bàn giao cho người dùng và quản trị viên.
- **Tiêu chuẩn hoàn thành (DoD):**
  1. Xuất bản `docs/PILOT-V2-RUNBOOK.md` hướng dẫn chi tiết quy trình vận hành, phê duyệt và đối chiếu sự cố.
  2. Hoàn tất báo cáo rà soát độc lập `docs/plans/2026-09-22-mvp-v2-backend/P6-REVIEW.md` với phán quyết chính thức.
