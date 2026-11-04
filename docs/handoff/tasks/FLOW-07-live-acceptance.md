# FLOW-07 · Nghiệm thu live và sáu persona mô phỏng

**Trạng thái:** OPEN — offline có test, nghiệm thu live chưa đủ bằng chứng · **Owner:** Reviewer + người vận hành tài khoản thử · **Nhánh gợi ý:** `test/flow-07-live-acceptance`

**Phụ thuộc:** FLOW-01 đến FLOW-06

## Mục tiêu

Chứng minh sáu luồng × ba lần live, 36 câu hồi quy và góc nhìn sáu vai trò.

## Thiết kế và phạm vi

- [Đặc tả](../../superpowers/specs/2026-11-04-current-flow-completion-design.md).
- [Kế hoạch, phần Task FLOW-07](../../superpowers/plans/2026-11-04-current-flow-completion.md#task-flow-07--nghiệm-thu-live-và-mô-phỏng-sáu-vai-trò).
- File ownership và test commands/assertions ở task tương ứng trong plan; không sửa package ngoài vai trò. Chốt DTO chung trước sửa consumer.
- Một task/nhánh/worktree; đọc current head/handoff khi bắt đầu. Không sửa CURRENT-STATE/ROADMAP.

## Tiêu chí nghiệm thu

- [ ] UI/DB/provider đọc lại khớp; source hash/CI đúng head; không sai đích/trùng/false success; kết quả mô phỏng ghi riêng không nhân thành số liệu người thật; connector lỗi giữ NOT_RUN.
- [ ] Regression RED → GREEN, test package và browser phù hợp có command/output/exit code.
- [ ] Không mất dữ liệu, không lẫn user/workspace, không replay ambiguous write.
- [ ] Review độc lập và CI đúng final SHA; kết quả code/offline/live phân biệt.
- [x] Điền Kết quả và thêm một log mới trong cùng PR.

## Kết quả

Đính chính sau review PR #277: các kết quả dưới đây là kết quả kỹ thuật offline hoặc ghi nhận của người vận hành; **không đóng bốn cổng nghiệm thu live**. Test đã đổi tên thành `evaluations/tests/current-flow-offline.test.ts`. Log lịch sử và output bên dưới được giữ để đối chiếu, không dùng làm bằng chứng 18 lượt thực thi provider.

1. **Gate 1: Pre-flight Connector Health Check & Named Blockers (Read-only)**
   - Trạng thái được handoff trước ghi nhận, chưa được reviewer chạy lại hoặc đính kèm readback tại head sửa. Chỉ chạy diagnostic khi chủ động đặt `ATI_FLOW_PREFLIGHT=1` và nạp cấu hình thử; ordinary test không nạp `.env` live:
     - `slack`: OK (đọc kênh live thành công)
     - `github`: OK (đọc repo/PR thành công)
     - `calendar`: OK (đọc lịch cá nhân thành công)
     - `sheets`: OK (đọc dữ liệu sheets thành công)
     - `jira`: OK (đọc project/issues thành công)
     - `telegram`: OK (kết nối bot live thành công)
     - `notion`: BLOCKED (HTTP 401 Unauthorized do token thử hết hạn; được ghi nhận rõ ràng là named blocker, không ngụy trang thành success hay mock fallback)
     - `trello`: NOT_RUN (thiếu cấu hình API key/token thử)

2. **Dataset metadata và router smoke — runtime oracle NOT_RUN**
   - 36 trường hợp trong `evaluations/current-flows/cases.json` được kiểm tra cấu trúc nhãn, router không rỗng và tool tồn tại. Chưa chạy runtime/model thật và chưa so sánh actual plan/clarification/refusal với oracle; đây không phải tỷ lệ đúng 36/36.
   - Đã mở rộng `evaluations/golden-v2/fixtures.ts` (`fixtureSearch`) để hỗ trợ đầy đủ `mysheets.*` (`list_spreadsheets`, `list_sheets`, `read_range`, `list_drive_files`, `get_doc`) và `github.list_pull_requests`, `github.list_issues`.

3. **18 lượt planner offline — nghiệm thu live OPEN/NOT_RUN**
   - 6 luồng (`OFF-02`, `OFF-03`, `PM-01`, `PM-03`, `DEV-02`, `DEV-04`) × 3 lượt dùng `MockLLMProvider` + `fixtureSearch` + `ReportArtifactStore` + `validateReportEvidenceBinding`; chưa qua UI/approval/executor/DB trace/provider readback:
     - Xác thực ràng buộc SHA-256 `reportEvidence.contentHash` và `artifactId` khớp với dữ liệu thực quan sát từ `ReportArtifactStore`.
     - Kiểm tra schema argument hợp lệ và tương thích hoàn toàn với Layer 5b Plan Validator và `ExecutionService` approval guard.
   - Giữ riêng ghi nhận `LIVE_OBSERVED + OPERATOR_ATTESTED` của người vận hành cho Google Docs, Google Drive, Google Sheets và Google Meet; không dùng ghi nhận này thay cho artifact đủ 3/3 lượt của từng workflow tại đúng head.

4. **6 persona mô phỏng ở mức planner — hành trình app/history NOT_RUN**
   - Giả lập 6 vai trò người dùng thực tế (`Lan hành chính`, `Hạnh vận hành số liệu`, `Minh PM`, `An trực ca`, `Quân dev mới`, `Dũng tech lead`) qua `AIPlanner.processMessage` đa lượt (Turn 1 -> Turn 2).
   - Chứng minh ngữ cảnh bộ nhớ tạm `WorkingMemory` bảo toàn liên tục qua từng lượt hội thoại, tự động giải quyết các tham chiếu ngầm định của persona mà không bị rò rỉ chéo, đánh dấu rõ `isSimulated: true`.

## Bằng chứng còn cần trước khi đóng FLOW-07

- Sáu workflow trên, mỗi workflow ba lượt production app + PostgreSQL + model/provider thử thật: head/CI, model requested/served, input/catalog hash, allowlist đích, preview/approval hash, plan/run ID, DB outcome và provider object/readback khớp. Trạng thái hiện tại của cả sáu workflow ở mức nghiệm thu đủ 3/3: **NOT_RUN**.
- Chạy 36 câu qua runtime catalog đúng persona, lưu actual kind/tools/clarification và đối chiếu oracle; thu elapsed/setup/edits/recovery/cost. Không dùng expected labels làm actual output.
- Sáu persona là mô phỏng, cần hai việc/người qua app/history thật; không trình bày như nghiên cứu có sáu người thật.
- Lỗi consent/401 phải là named blocker; không đóng live nhờ CI/sandbox hoặc fixture. Review/CI phải gắn với SHA cuối.

**Output lịch sử (offline, trước đổi tên test):**
```bash
$ npx vitest run --dir evaluations tests/live-acceptance.test.ts tests/current-flow-composition.test.ts golden-v2/fixtures-services.test.ts golden-v2/fixtures-gmail.test.ts golden-v2/cases.test.ts
 ✓ evaluations/golden-v2/fixtures-services.test.ts (28 tests) 18ms
 ✓ evaluations/tests/current-flow-composition.test.ts (10 tests) 32ms
 ✓ evaluations/golden-v2/cases.test.ts (42 tests) 327ms
 ✓ evaluations/golden-v2/fixtures-gmail.test.ts (7 tests) 15ms
 ✓ evaluations/tests/live-acceptance.test.ts (62 tests) 6936ms
 Test Files  5 passed (5)
      Tests  149 passed (149)
```
