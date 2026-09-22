# Báo cáo Rà soát Độc lập Giai đoạn P4 (Testing, Dataset & Backend Acceptance Gate)

**Dự án:** AI Automation Platform (MVP v2)  
**Phạm vi rà soát:** Giai đoạn P4 (Tasks `BE-24` và `BE-25`)  
**Chuyên gia rà soát:** `Code Reviewer` (Independent Specialist) & Main Orchestrator  
**Ngày rà soát:** 22/09/2026  
**Trạng thái kết luận:** **PASS — 100% TIÊU CHUẨN KỸ THUẬT VÀ HỢP ĐỒNG THỰC THI ĐƯỢC THỎA MÃN**

---

## 1. Tóm tắt kết quả (Executive Summary)

Đã hoàn thành rà soát độc lập chuyên sâu đối với toàn bộ các module mã nguồn, bộ dataset song ngữ, tập holdout độc lập, bộ runner nghiệm thu chấp nhận backend, bộ hồi quy bất biến, bộ kiểm thử lỗi tiêm vào (fault injection), và tầng kiểm thử tích hợp cơ sở dữ liệu PostgreSQL thực tế của Giai đoạn P4:
- **BE-24:** 
  - `packages/engine/src/pilot/dataset-schema.ts` — Zod schema bất biến cho bộ dataset V2
  - `testdata/v2-dataset/cases.json` — 20 kịch bản nghiệp vụ × 2 biến thể ngôn ngữ vi/en = 40 records chuẩn cấu trúc 8 cột header
  - `testdata/v2-dataset/holdout.json` — 10 kịch bản holdout độc lập × 2 biến thể ngôn ngữ vi/en = 20 records
  - `packages/engine/tests/pilot-dataset-validation.test.ts` — Kiểm thử tính toàn vẹn và hợp lệ của dataset (`10 tests`)
- **BE-25:**
  - `packages/engine/tests/pilot-v2-acceptance.test.ts` — Runner nghiệm thu 40 biến thể kịch bản qua các tầng intake, checklist, decision engine (`41 tests`)
  - `packages/engine/tests/pilot-v2-invariants.test.ts` — Kiểm thử hồi quy 7 bất biến hợp đồng cốt lõi trực tiếp trên code sản xuất (`8 tests`)
  - `packages/engine/tests/pilot-v2-fault-acceptance.test.ts` — Bộ kiểm thử 6 kịch bản tiêm lỗi mạng, phân quyền, timeout và dữ liệu tampered (`6 tests`)
  - `packages/engine/tests/pilot-v2-concurrency.integration.test.ts` — Kiểm thử tích hợp khóa cố vấn PostgreSQL (`pg_advisory_xact_lock`) và race condition trên PostgreSQL Docker thực tế (`4 tests`)

---

## 2. Nhật ký & Phán quyết của Subagent `Code Reviewer`

- **Phán quyết chính thức:** **PASS (0 Blocker, 3 Suggestions đã khắc phục, 2 Nits đã tinh chỉnh)**.
- **Chi tiết các đề xuất cải tiến đã thực hiện ngay:**
  1. *Bổ sung kiểm tra chuẩn 8-column header:* Thêm test case xác thực nghiêm ngặt mọi fixture trong cả `cases.json` và `holdout.json` đều khớp với mảng 8 cột `['request_id', 'client_ref', 'request_type', 'raw_request', 'deliverable', 'due_date', 'decision_status', 'source_note']`.
  2. *Tái cấu trúc bộ kiểm thử bất biến gọi module sản xuất:* `pilot-v2-invariants.test.ts` đã được refactor để gọi trực tiếp các module sản xuất `executePilotWorkflow`, `assertPilotAccess`, `InMemoryReservationStore`, xác thực chính xác các thông điệp lỗi thực tế `FORBIDDEN: Principal does not own this run` và `SNAPSHOT_MISMATCH: Snapshot hash has drifted`.
  3. *Xử lý mã lỗi PostgreSQL 23505 (unique_violation):* Trong `packages/engine/src/pilot/postgres-store.ts`, bắt lỗi vi phạm ràng buộc duy nhất đồng thời và ném lỗi có cấu trúc `INTENT_ALREADY_RESERVED`.
  4. *Chuẩn hóa kiểm tra missing fields:* Làm chặt chẽ điều kiện assertion missing fields và ghi chú phân định rõ việc ủy thác kiểm thử runtime fault injection cho `pilot-v2-fault-acceptance.test.ts`.

---

## 3. Ma trận Đối chiếu Toàn diện Tiêu chuẩn Phase P4

| Tiêu chuẩn Kỹ thuật & Invariant | Module Triển khai | Bằng chứng Thực tế | Đánh giá |
|---|---|---|:---:|
| **Dataset 20 Cases × vi/en** | `testdata/v2-dataset/cases.json` | 40 records chuẩn xác thực qua Zod schema `.strict()`, đầy đủ UC1/UC2/UC3 và các ca biên/lỗi. | **PASS** |
| **Quarantine Holdout Set** | `testdata/v2-dataset/holdout.json` | 20 records (H-01..10) không trùng lặp caseId với tập đánh giá chính, bảo toàn tính khách quan. | **PASS** |
| **Ethical Evidence Labels** | Toàn bộ dataset fixtures | 100% bản ghi ghi rõ `origin: "reconstructed_synthetic"` và `verdict: "NOT_RUN"`, đúng tiêu chuẩn baseline. | **PASS** |
| **Acceptance Gate Runner** | `pilot-v2-acceptance.test.ts` | 41/41 tests pass; 100% khớp expected kind/status, UC1/UC3 0 write, UC2 1 write. | **PASS** |
| **Zero Blind Retry Gate** | `pilot-v2-invariants.test.ts`, `pilot-v2-fault-acceptance.test.ts` | Timeout sau dispatch dừng ở `reconciliation_required` và reservation `unknown`; từ chối re-reserve. | **PASS** |
| **10m Server TTL & Approval Binding** | `pilot-v2-invariants.test.ts`, `pilot-v2-fault-acceptance.test.ts` | Gắn cố định với `created_at + 10m`, hash sai lệch bị từ chối với `SNAPSHOT_MISMATCH`. | **PASS** |
| **PostgreSQL Advisory Lock Concurrency** | `pilot-v2-concurrency.integration.test.ts` | Chạy trên PostgreSQL Docker thật, tuần tự hóa tạo run đồng thời, từ chối run thứ 2 với `CONCURRENCY_LIMIT`. | **PASS** |
| **PostgresReservationStore Race Safe** | `pilot-v2-concurrency.integration.test.ts`, `postgres-store.ts` | Ngăn chặn race condition đặt trước đồng thời cùng `intentKey`, bắt lỗi 23505 ném `INTENT_ALREADY_RESERVED`. | **PASS** |
| **Credential & Secret Redaction** | Toàn bộ test suites | Kiểm tra regex và `redactObject`: không có bất kỳ secret/token/password nào lọt vào trace, URL hoặc payload. | **PASS** |

---

## 4. Bằng chứng Kiểm thử Thực tế Toàn diện

```
- @wap/engine (Unit):        64 test files passed (504 passed, 1 skipped)
- @wap/engine (Integration): 1 test file passed (4/4 passed trên PostgreSQL Docker)
- @wap/api (Unit):           20 test files passed (79 passed)
- @wap/api (Integration):    25 test files passed (46 passed trên PostgreSQL Docker & Worker)
- TypeScript Compilation:    npx tsc --noEmit -> 0 errors (Clean)
```
