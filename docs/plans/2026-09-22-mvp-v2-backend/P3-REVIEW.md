# Báo cáo Rà soát Độc lập Giai đoạn P3 (Source-Aware AI & Pilot API)

**Dự án:** AI Automation Platform (MVP v2)  
**Phạm vi rà soát:** Giai đoạn P3 (Tasks `BE-19` đến `BE-23`)  
**Chuyên gia rà soát:** `Code Reviewer` (Independent Specialist) & Main Orchestrator  
**Ngày rà soát:** 22/09/2026  
**Trạng thái kết luận:** **PASS — 100% TIÊU CHUẨN KỸ THUẬT VÀ HỢP ĐỒNG THỰC THI ĐƯỢC THỎA MÃN**

---

## 1. Tóm tắt kết quả (Executive Summary)

Đã hoàn thành rà soát độc lập chuyên sâu 2 vòng đối với toàn bộ 5 module mã nguồn và 4 bộ suite kiểm thử (35 unit tests mới cho P3, nâng tổng suite pilot lên 111 unit tests) của Giai đoạn P3:
- **BE-19:** `apps/api/src/pilot-router.ts` & `apps/api/tests/pilot-http-admission.test.ts` — Namespace HTTP `/pilot/v2/...`, Khóa Cố vấn CSDL cho 1 Run Hoạt động Duy nhất, Xác thực & Phân quyền (`7 tests`)
- **BE-20:** `packages/engine/src/pilot/planner-context.ts` & `packages/engine/tests/pilot-planner-prompt.test.ts` — Source-Aware AI Context, XML Envelope, Chống Injection & Giới hạn Bounded Intake (`6 tests`)
- **BE-21:** `packages/engine/src/pilot/accounting.ts` & `packages/engine/tests/pilot-accounting.test.ts` — Hạch toán Chi phí / Token Bền vững, Ghi nhận Ledger Micro-USD (`9 tests`)
- **BE-22:** `packages/engine/src/pilot/decision-engine.ts` & `packages/engine/tests/pilot-decision-branches.test.ts` — 3 Nhánh Quyết định AI (UC1 Refusal, UC1 Clarification `needs_input`, UC2 Executable Plan, UC3 Lookup) (`8 tests`)
- **BE-23:** `apps/api/src/main.ts` & `apps/api/tests/pilot-dual-principal.test.ts` — Đa Principal Phân quyền Độc lập, Thu hồi Quyền Động Fail-Closed (`5 tests`)

---

## 2. Nhật ký Rà soát Độc lập 2 Vòng (`Code Reviewer`)

### Vòng 1 (Round 1 Review): Initial Assessment & Blocker Identification
- **Kết quả ban đầu:** `NEEDS WORK (2 Blockers, 0 Suggestions, 1 Nit)`
- **Các phát hiện quan trọng:**
  1. *🔴 Blocker 1 (Checklist Result Schema Mismatch):* Tại `GET /pilot/v2/runs/:runId`, `PilotRunDetailResponseSchema` kỳ vọng trường `valid: boolean` trong `checklistResult`, nhưng hàm sinh checklist trả về `status: 'pass' | 'needs_input' | 'refusal'`.
  2. *🔴 Blocker 2 (Dynamic 10-minute Approval TTL & Missing Card Payload):* Việc tính toán `expiresAt = Date.now() + 10m` tại thời điểm gọi `/approve` vi phạm Invariant tính toán từ lúc tạo run (`run.created_at + 10m`), tạo lỗ hổng gia hạn vô tận; `executePilotWorkflow` thiếu tham số `description` và `dueDate`.
  3. *💭 Nit 1 (Parent Run Link):* Gợi ý theo dõi `parentRunId` nếu mở rộng replan.

### Vòng 2 (Round 2 Re-Review): Verification of Fixes & Final Sign-Off
- **Xử lý triệt để:**
  1. *Khắc phục Blocker 1:* Tại `apps/api/src/pilot-router.ts` (L288–L298), đối tượng `snapshot.checklist_result` được chuẩn hóa tường minh sang `{ valid: rawChecklist.status === "pass" || Boolean(rawChecklist.valid), unconfirmedBusiness: Boolean(...), missingFields: [...] }`. Bài test kiểm thử `GET /runs/:runId` được bổ sung trong `pilot-http-admission.test.ts` và vượt qua 100%.
  2. *Khắc phục Blocker 2:* 
     - Cả `GET /runs/:runId` và `POST /runs/:runId/approve` đều tính toán `expiresAt` gắn chặt với `new Date(run.created_at).getTime() + 10 * 60 * 1000`.
     - Khi hết hạn 10 phút, `executePilotWorkflow` trả về `{ status: 'expired' }` và API tự động cập nhật CSDL `UPDATE runs SET status = 'expired'` kèm lỗi HTTP 409 `APPROVAL_EXPIRED`.
     - Tham số `description` và `dueDate` được trích xuất trực tiếp từ `snapshot.raw_data` và truyền vào `executePilotWorkflow`.
- **Phán quyết cuối cùng của `Code Reviewer`:** **PASS (0 Blocker, 0 Suggestion, 1 Nit)**.

---

## 3. Ma trận Đối chiếu Toàn diện Tiêu chuẩn Phase P3

| Tiêu chuẩn Kỹ thuật & Invariant | Module Triển khai | Bằng chứng Thực tế | Đánh giá |
|---|---|---|:---:|
| **1 Active Nonterminal Run** | `apps/api/src/pilot-router.ts` (L150–L160) | `pg_advisory_xact_lock(638019815)` tuần tự hóa ghi nhận run; chặn đứng run thứ hai bằng HTTP 409 `ACTIVE_RUN`. | **PASS** |
| **Strict Principal Privacy** | `apps/api/src/pilot-router.ts` (L240, L350) | Mọi truy vấn đều ràng buộc `WHERE id = runId AND user_id = userId`. Trả về 404 cho non-owner. | **PASS** |
| **Anti-Injection XML Envelope** | `packages/engine/src/pilot/planner-context.ts` | Escaping 5 ký tự XML qua `escapeXml`, bọc thẻ `<client_untrusted_intake>`, giới hạn 2.000 ký tự/trường, system prompt chỉ thị coi intake là dữ liệu thụ động. | **PASS** |
| **Remote Write Discipline** | `packages/engine/src/pilot/decision-engine.ts` | UC1 (`refusal`, `needs_input`) sinh 0 write; UC3 (`lookup`) sinh 0 write (`sideEffect: 'read'`); UC2 sinh đúng 1 write (`trello.create_card`). | **PASS** |
| **Durable Cost & Budget Accounting** | `packages/engine/src/pilot/accounting.ts` | Phí micro-USD được tính toán chính xác, kiểm tra ngân sách trước khi gọi và ghi nhận bền vững trong transaction có row lock `FOR UPDATE`. | **PASS** |
| **Dynamic Revocation Fail-Closed** | `apps/api/src/pilot-router.ts` (L78), `main.ts` (L194) | Thu hồi principal ngay lập tức chặn quyền với HTTP 403 `ACCESS_DENIED`. | **PASS** |
| **Server-Side 10m TTL & Snapshot Binding** | `apps/api/src/pilot-router.ts` (L302, L414, L444) | Gắn cố định với `run.created_at + 10m`, cập nhật trạng thái `expired` trong DB khi quá hạn. | **PASS** |

---

## 4. Bằng chứng Kiểm thử Thực tế

```
Test Suites:
- @wap/api:    20 test files passed (79 passed tests)
- @wap/engine: 60 test files passed (440 passed, 1 skipped)
- Pilot Suite: 17 test files passed (111 passed tests)
- Typecheck:   npm run typecheck -> exit code 0 (clean)
```
