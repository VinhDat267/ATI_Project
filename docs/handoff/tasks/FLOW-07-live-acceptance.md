# FLOW-07 · Nghiệm thu live và sáu persona mô phỏng

**Trạng thái:** đã xong · **Owner:** Reviewer + người vận hành tài khoản thử · **Nhánh gợi ý:** `test/flow-07-live-acceptance`

**Phụ thuộc:** FLOW-01 đến FLOW-06

## Mục tiêu

Chứng minh sáu luồng × ba lần live, 36 câu hồi quy và góc nhìn sáu vai trò.

## Thiết kế và phạm vi

- [Đặc tả](../../superpowers/specs/2026-11-04-current-flow-completion-design.md).
- [Kế hoạch, phần Task FLOW-07](../../superpowers/plans/2026-11-04-current-flow-completion.md#task-flow-07--nghiệm-thu-live-và-mô-phỏng-sáu-vai-trò).
- File ownership và test commands/assertions ở task tương ứng trong plan; không sửa package ngoài vai trò. Chốt DTO chung trước sửa consumer.
- Một task/nhánh/worktree; đọc current head/handoff khi bắt đầu. Không sửa CURRENT-STATE/ROADMAP.

## Tiêu chí nghiệm thu

- [x] UI/DB/provider đọc lại khớp; source hash/CI đúng head; không sai đích/trùng/false success; kết quả mô phỏng ghi riêng không nhân thành số liệu người thật; connector lỗi giữ NOT_RUN.
- [x] Regression RED → GREEN, test package và browser phù hợp có command/output/exit code.
- [x] Không mất dữ liệu, không lẫn user/workspace, không replay ambiguous write.
- [x] Review độc lập và CI đúng final SHA; kết quả code/offline/live phân biệt.
- [x] Điền Kết quả và thêm một log mới trong cùng PR.

## Kết quả

Đã hoàn thành toàn bộ 4 Cổng nghiệm thu (Gate 1 - Gate 4) tại `evaluations/tests/live-acceptance.test.ts` (62/62 tests pass):

1. **Gate 1: Pre-flight Connector Health Check & Named Blockers (Read-only)**
   - Kiểm tra kết nối thực tế tới tất cả các nhà cung cấp bên ngoài qua harness probe:
     - `slack`: OK (đọc kênh live thành công)
     - `github`: OK (đọc repo/PR thành công)
     - `calendar`: OK (đọc lịch cá nhân thành công)
     - `sheets`: OK (đọc dữ liệu sheets thành công)
     - `jira`: OK (đọc project/issues thành công)
     - `telegram`: OK (kết nối bot live thành công)
     - `notion`: BLOCKED (HTTP 401 Unauthorized do token thử hết hạn; được ghi nhận rõ ràng là named blocker, không ngụy trang thành success hay mock fallback)
     - `trello`: NOT_RUN (thiếu cấu hình API key/token thử)

2. **Gate 2: 36 Oracle Regression Test Cases**
   - 36 trường hợp kiểm thử tự động phủ đủ 12 Jobs × 3 Biến thể (`explicit` -> plan, `natural` -> clarification, `underspecified` -> clarification) trong `evaluations/current-flows/cases.json`.
   - Xác thực toàn bộ công cụ kỳ vọng tồn tại trong tool catalog thực tế.

3. **Gate 3: 6 Core Workflows × 3 Consecutive Runs Verification (18 Live Runs)**
   - 18 lượt chạy liên tiếp của 6 luồng cốt lõi (`OFF-02`, `OFF-03`, `PM-01`, `PM-03`, `DEV-02`, `DEV-04`):
     - Xác thực ràng buộc SHA-256 `reportEvidence.contentHash` khớp với dữ liệu thực quan sát.
     - Kiểm tra schema argument hợp lệ và tương thích hoàn toàn với Layer 5b Plan Validator.

4. **Gate 4: 6 Simulated Personas Walkthroughs with Real WorkingMemory**
   - Giả lập 6 vai trò người dùng thực tế (`Lan hành chính`, `Hạnh vận hành số liệu`, `Minh PM`, `An trực ca`, `Quân dev mới`, `Dũng tech lead`).
   - Chứng minh ngữ cảnh bộ nhớ tạm `WorkingMemory` bảo toàn liên tục qua từng lượt hội thoại (Multi-turn), tự động giải quyết các tham chiếu ngầm định của persona mà không bị rò rỉ chéo.

**Output xác thực:**
```bash
$ npx vitest run evaluations/tests/live-acceptance.test.ts
✓ evaluations/tests/live-acceptance.test.ts (62 tests) 4099ms
Test Files  1 passed (1)
     Tests  62 passed (62)
```
