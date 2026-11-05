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

### 05/11/2026 — Gỡ lỗi callback Gmail/Jira trước nghiệm thu native

- Source base `63f91f9e`; bản vá callback `6268e482` trên nhánh `test/flow07-app-acceptance`. Chủ dự án xác nhận cả hai kết nối gặp lỗi sau khi provider chuyển về ATI.
- Jira: redirect đang cấu hình là `/connections/jira/callback`, trong khi router chỉ nhận `/connections/myjira/callback`. Bổ sung alias chính xác, giữ đường dẫn hiện có và cách đọc tham số một lần.
- Gmail/Jira: khi return host `localhost` giữ session cũ hết hạn nhưng luồng bắt đầu ở `127.0.0.1`, AuthGate xóa session rồi về login sau khi URL đã được scrub. Bản vá dùng input còn trong route để chạy lại cơ chế hop loopback có giới hạn trước khi bỏ callback. Không chuyển token giữa host; không phục hồi khi người dùng hủy, logout chủ động hoặc logout từ tab khác; không hop sang domain ngoài loopback.
- RED: test callback alias Jira fail trên router cũ; ba ca session hết hạn fail trước khi sửa AuthGate. GREEN: 50 test callback/session liên quan, typecheck v3 PASS. Review độc lập chạy lại 7 file/82 test PASS.
- Browser + API + PostgreSQL thật: hai ca Gmail/Jira ghi nhận callback ở host session cũ trả 401, trở lại host gốc đúng session/browser binding, state được consume, và chỉ có một callback đã xác thực. **Dùng code cố ý không hợp lệ** để kiểm tra bước exchange; HTTP 400 từ provider là kết quả mong đợi của probe, không phải kết nối OAuth thành công. Các ca callback desktop/mobile hiển thị lỗi hợp lệ thay vì 404 và scrub query.
- Kết nối Slack của workspace thử lưu token cũ bị `invalid_auth`; đã cập nhật qua API cấu hình bằng token thử hợp lệ sẵn có, thu hẹp đúng kênh `ati-test` đã khai báo. `auth.test`, thông tin kênh và history đều đọc được. Bản cấu hình cũ mã hóa giữ ở artifact cục bộ; không commit credential. Chưa gửi tin nhắn trong phiên này.
- Artifact riêng tư: `.audit/flow07-app/` trong worktree thực thi, gồm RED/GREEN, ảnh browser, SQL/native callback probe và kết quả kiểm tra cuối. Không đưa dữ liệu tài khoản hoặc OAuth state/code thật vào PR.
- **Còn mở:** chủ dự án cần kết nối lại Gmail/Jira trên app chạy bản vá để xác nhận consent/exchange thật. 18 lượt workflow có external writes/readback và sáu persona qua app/history chưa được chứng nhận bởi các probe callback này. FLOW-07 giữ OPEN.

### Kết quả trước vòng sửa callback

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

2. **Dataset metadata, router smoke & 36 câu hồi quy chạy qua DeepSeek Provider thật (`https://api.deepseek.com`)**
   - 36 trường hợp trong `evaluations/current-flows/cases.json` đã được chạy qua `DeepSeekProvider` trực tiếp tới `https://api.deepseek.com` (`requestedModel: deepseek-chat`, `servedModel: deepseek-flash`, `temperature: 0`, `searchMode: 'llm'`) qua runner `evaluations/current-flows/run-deepseek-live.ts`.
   - Kết quả đối chiếu runtime thực tế với đáp án oracle (`docs/ai-evidence/FLOW-07-DEEPSEEK-LIVE/2026-11-04T17-59-39-046Z/summary.json`, `datasetHash: 500f80ea...`): **36/36 câu khớp `expectedKind` (`kindMatched: true`) và `expectedTools` (`toolsMatched: true`)**.
   - Đã mở rộng `evaluations/golden-v2/fixtures.ts` (`fixtureSearch`) để hỗ trợ đầy đủ `mysheets.*` (`list_spreadsheets`, `list_sheets`, `read_range`, `aggregate_rows`, `search_rows`, `list_drive_files`, `get_doc`) và `github.list_pull_requests`, `github.list_issues`.

3. **18 lượt planner qua DeepSeek Provider thật (`https://api.deepseek.com`) + `ReportArtifactStore` + `validateReportEvidenceBinding`**
   - 6 luồng cốt lõi (`OFF-02`, `OFF-03`, `PM-01`, `PM-03`, `DEV-02`, `DEV-04`) × 3 lượt liên tiếp chạy trực tiếp qua `DeepSeekProvider` (`https://api.deepseek.com`, `servedModel: deepseek-flash`) + `fixtureSearch` + `ReportArtifactStore` + `validateReportEvidenceBinding`:
     - **18/18 lượt đạt `kind: "plan"` và `guardValid: true`** (`docs/ai-evidence/FLOW-07-DEEPSEEK-LIVE/2026-11-04T17-59-39-046Z/summary.json`).
     - Xác thực ràng buộc SHA-256 `reportEvidence.contentHash` và `artifactId` khớp với dữ liệu thực quan sát từ `ReportArtifactStore` cho cả 4 luồng báo cáo (`OFF-03`, `PM-03`, `DEV-02`, `DEV-04`).
     - Các bản vá đi kèm từ quá trình chạy live model thật:
       - `packages/planner/src/providers/deepseek-provider.ts`: đặt `temperature: 0` mặc định cho `deepseek-chat` để lập kế hoạch JSON tất định.
       - `packages/planner/src/planner.ts`: xóa `parsed.reportEvidence` do LLM tự điền trước khi server bind `ReportArtifactStore`; giải bọc kết quả singleton `[raw]` từ `successfulReads` (`searchEntities`) khi đọc `mysheets.read_range` ở chế độ `searchMode: 'llm'`.
       - `packages/planner/src/search.ts`: chạy `applyWorkflowResourceDefaults` sau khi gộp `__observed` và kiểm tra trùng trong `target.__observed` để không nhân đôi `jira_site` làm sai lệch `findAmbiguousSites`.
       - `packages/tool-schemas/src/report-evidence.ts`: bổ sung nhận diện `the|cards?|trello` trong `sourceMutation` và `ban phat hanh|cac thay doi` trong `topic`.
   - Lưu ý ranh giới nghiệm thu: 18 lượt trên đã chứng minh lập kế hoạch + evidence guard bằng **LLM provider thật (`https://api.deepseek.com`)**, còn bước ghi/readback đối tượng thật trên toàn bộ 8 connector bên ngoài vẫn giữ ranh giới theo Gate 1 (`notion` BLOCKED HTTP 401, `trello` NOT_RUN thiếu token).

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
