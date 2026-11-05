# Planora Current Flow Completion — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement task-by-task; chỉ dùng subagent-driven-development nếu chủ dự án chọn cách đó. Mỗi task có task card, nhánh và review riêng.

**Goal:** Sáu luồng hiện có chạy trọn vẹn, có nguồn dữ liệu, dễ thiết lập, duyệt và dùng lại; khắc phục F1/F2/F3.

**Architecture:** Giữ planner → preview/hash → approval → executor và các adapter hiện có. Bổ sung report artifacts do code dựng từ reads hợp lệ, Playbook local theo user/workspace, readiness/defaults theo job và nghiệm thu provider thật.

**Tech Stack:** TypeScript, React, Node, PostgreSQL, Vitest, Playwright; giữ dependencies và provider hiện có.

**Spec:** [Current flow completion design](../specs/2026-11-04-current-flow-completion-design.md), dưới đặc tả v3 29/09/2026.

## Global constraints

- Baseline lập kế hoạch `0b62372c4bdf4597fde0b560ada70cabec3ea393`; trước mỗi task ghi lại base/head hiện hành và đưa các thay đổi đã merge vào worktree mới. Không coi checkout feat/rebrand-planora là main mặc định.
- Giữ nguyên worktree đang có của người khác, branding Planora, OAuth scope và module ownership. Không sửa CURRENT-STATE/ROADMAP khi thi công; reviewer cập nhật sau merge.
- Đợt này không thêm connector, không đồng bộ Playbook lên server, không làm engine trigger/branch/loop mới, không tự share Drive.
- Người dùng chọn local Playbook, tách account/workspace. Không chuyển sang server persistence vì tiện triển khai.
- Reads/approvals dùng đúng user/workspace/connection; ambiguous write không retry/replan tự động.
- Không chạy fixture để chứng nhận AI/provider thật; không dùng sáu persona mô phỏng làm sáu người dùng nghiên cứu.
- Nghiệm thu kỹ thuật và live ghi riêng. Có tài khoản thử nhưng 401 hoặc thiếu consent không được đánh dấu PASS.

## Review focus

1. Model bịa ba PR khi chưa đọc — FLOW-01 chặn trước persist/approval; source/count/link render từ observations.
2. Đổi user/workspace khi Save đang mở — FLOW-02 không đọc/ghi namespace cũ, không auto nhận v1 không rõ owner.
3. Điền biến rồi sửa người nhận — FLOW-03 lưu đúng template đã sửa, không làm mất token hoặc gửi token chưa điền.
4. Defaults mất quyền hoặc đích mới mâu thuẫn defaults — FLOW-04/FLOW-06 hỏi/chặn, không dùng nhầm tài khoản hoặc nguồn.
5. Provider nhận write nhưng response mất — FLOW-06 dùng DB lock + HTTP fixture thật để chứng minh không replay.

## Thứ tự và các gate

| Chặng | Task | Gate |
|---|---|---|
| 1. Khắc phục lỗi đã xác nhận | FLOW-01, FLOW-02, FLOW-03 | F1/F2/F3 có regression RED → GREEN; source/report không bịa; dữ liệu mẫu không lẫn/mất |
| 2. Dùng được từ đầu đến cuối | FLOW-04, FLOW-05, FLOW-06 | Sáu job có readiness, defaults, preview/receipt đúng; lịch và lỗi rõ ràng |
| 3. Chứng minh trên tài khoản thử | FLOW-07 | Sáu luồng × ba lần live; 36 câu hồi quy; CI/review đúng head; mô phỏng sáu vai trò |

FLOW-01 trước FLOW-05/FLOW-06; FLOW-02 trước FLOW-03 và defaults của FLOW-04; FLOW-04/05/06 trước FLOW-07. FLOW-01 và FLOW-02 độc lập về sản phẩm nhưng không mặc định chạy nhiều agent.

**Rollout:** FLOW-01/02/03 có thể review và phát hành độc lập. FLOW-04/05/06 tích hợp trên nhánh `integration/current-flows`, không quảng bá sáu card là sẵn sàng khi composition chưa xong. Chỉ hợp nhất chặng 2 sau kiểm thử kết hợp và review; FLOW-07 chạy ở môi trường thử tách biệt trước khuyến nghị pilot. Nếu gate thất bại, giữ luồng đó chưa khả dụng và ghi lý do; không rollback về key Playbook toàn cục hoặc bỏ report guard để chạy demo. Backup v1/v2 phải còn nguyên khi rollback giao diện.

## Task FLOW-01 — Báo cáo PR có nguồn, đóng F1

**Card:** [FLOW-01](../../handoff/tasks/FLOW-01-trusted-reports.md). **Owner:** AI (planner, prompts, evaluations), backend (persist/dispatch), integration (shared DTO), frontend (metadata preview). Từng owner chỉ sửa module của mình.

**Files:** thêm `packages/tool-schemas/src/report-evidence.ts`, `packages/planner/src/reports/{artifacts,renderers}.ts`; tích hợp vào planner/validator và API chat/plan persistence/dispatch; bổ sung DTO/preview hiện có.

- [ ] Viết `packages/planner/tests/report-evidence.test.ts`: nhập lại plan F1 PR #128/#131/#134 không có read → không có plan gửi được; read thất bại không thành zero; fixture có 2 PR → count=2 và chỉ đúng hai link; title chứa prompt injection không thành instruction/mention.
- [ ] Viết `apps/chat-api/tests/integration/report-evidence.test.ts`: evidence model/client tự khai không hợp lệ; binding khác actor/workspace/connection, sửa nội dung sau hash hoặc old report plan thiếu binding đều không dispatch. Test bằng PostgreSQL và loopback HTTP adapter, không mock boolean.
- [ ] Chạy hai test file và chứng kiến fail vì hành vi thiếu; lưu RED. Chốt optional ReportEvidence contract theo spec trước sửa consumer.
- [ ] Thực hiện artifact store/renderer; normalize report intent từ template và freeform vào bốn kind, chưa rõ thì hỏi. Với kind github_prs dựng string trước preview từ actual read, đính metadata server-owned và hash; không thêm resolver syntax hay provider tool. Phạm vi các kind còn lại được nối ở FLOW-05.
- [ ] GREEN hai test file; chạy planner/executor regression và model PR ×3 với runtime catalog đúng user. Commit `fix(planner): ground PR reports in verified reads`; điền card/log mới.

**Nghiệm thu:** không chỉ thêm `github.list_pull_requests` vào plan rồi vẫn cho model bịa text; mọi factual text gửi trong report PR do renderer tạo. Ordinary user-authored notification vẫn hoạt động.

## Task FLOW-02 — Tách local Playbook theo account/workspace

**Card:** [FLOW-02](../../handoff/tasks/FLOW-02-playbook-isolation.md). **Owner:** frontend.

**Files:** thêm `apps/chat-web/src/services/playbook-storage.ts`; dùng từ RequestMoments/AuthGate/workspace context hiện có.

- [ ] Viết `apps/chat-web/tests/services/playbook-storage.test.ts`: A/B, personal/org, Jira context, đổi scope giữa Save, v1 không owner, quota/corrupt JSON, mẫu thứ 13. Xác nhận fail trên key toàn cục hiện tại.
- [ ] Viết browser `playbook-isolation.spec.ts`: A lưu → logout → B không thấy; B không xóa mẫu A; A trở lại vẫn có; đổi workspace không lẫn.
- [ ] Implement key v2 và migration quarantine nguyên dữ liệu theo spec. Không reset/delete toàn bộ localStorage, không tự gán v1 cho user đăng nhập.
- [ ] GREEN unit + browser desktop/mobile; lỗi storage không báo đã lưu. Commit `fix(chat-web): isolate local playbooks by user and workspace`.

## Task FLOW-03 — Sửa, điền và lưu mẫu không mất dữ liệu

**Card:** [FLOW-03](../../handoff/tasks/FLOW-03-playbook-editing.md). **Owner:** frontend. **Depends:** FLOW-02.

**Files:** state/editor trong RequestMoments; storage dùng API FLOW-02. Không tự refactor toàn bộ Cockpit.

- [ ] Mở rộng `playbook-variables-and-catalog.test.tsx` và browser: chọn mẫu có token → thêm “CHỈ GỬI HẠNH, KHÔNG GỬI KHÁCH” → Save/reload → câu đó còn nguyên; điền biến rồi chỉnh template không hoàn nguyên nội dung cũ.
- [ ] Test đổi/xóa biến, cùng token xuất hiện hai lần, reset chủ động, biến thiếu ngăn Gửi nhưng vẫn lưu mẫu, lỗi quota giữ draft. Lưu RED.
- [ ] Tách templateText/variableValues/rendered draft như spec; sửa template là thao tác rõ trong composer. Nút Lưu lấy template hiện tại; Gửi lấy bản đã điền.
- [ ] GREEN regression và browser 375px; không tạo hai composer khi không có biến. Commit `fix(chat-web): preserve playbook edits and variable templates`.

## Task FLOW-04 — Bắt đầu theo công việc và biết còn thiếu gì

**Card:** [FLOW-04](../../handoff/tasks/FLOW-04-job-onboarding.md). **Owner:** frontend + backend + shared DTO. **Depends:** FLOW-02/03.

**Files:** cockpit-services metadata, RequestMoment/Settings/Refusal hiện có; service readiness và chat request DTO.

- [ ] Viết `job-readiness.test.tsx`/`workflow-defaults.test.ts`: chỉ nối 2/9 không làm mẫu 9-service thành sẵn sàng; thiếu OAuth/resource/server config cho đúng CTA; Docs/Drive tìm được; reconnect giữ draft.
- [ ] API tests `workflow-context.test.ts`: defaults chỉ là gợi ý, khác quyền/workspace bị loại; đích người dùng chỉ rõ luôn thắng default; không mặc định email nhận. Lưu RED.
- [ ] Đưa sáu job lên trước, mẫu nâng cao xuống sau. Tận dụng `ServiceInfo.tools/personalStatus/connectionStatus` và catalog thực; không thêm readiness dựa trên logo.
- [ ] Lưu defaults cùng scope local, thêm optional workflowContext theo spec, kiểm server-side. Hiển thị các giá trị đang dùng; hỏi gộp những trường thiếu; không nhầm routed services thành configured services.
- [ ] GREEN unit/API/browser đầu vào mới và hồi quy chuyển workspace. Commit `feat(chat-web): guide existing jobs by readiness and scoped defaults`.

## Task FLOW-05 — Khép kín dữ liệu và kết quả sáu luồng

**Card:** [FLOW-05](../../handoff/tasks/FLOW-05-six-flow-composition.md). **Owner:** integration + AI + backend, frontend preview/receipt. **Depends:** FLOW-01/04.

**Files:** fixtures hiện có, adapter/schema trong phạm vi lỗi từng luồng; report renderers FLOW-01; API runtime composition; preview/receipt. Không thay toàn bộ adapter vì một lỗi.

- [ ] Tạo `evaluations/current-flows/cases.json`: chuyển 12×3 câu audit thành oracle rõ plan/clarification/refusal; thêm data answers và source/fixture hashes. Fixture chưa hỗ trợ read phải fail rõ; không trả canned success.
- [ ] Viết `current-flow-composition.test.ts` qua app/runtime production composition: connected personal catalog không dùng legacy union; real ChatService giữ context qua hỏi/sửa/reload. RED từng điểm đứt.
- [ ] Nối renderer cho sheet_summary/jira_progress/github_issue_aging; tests locale VN/US, số âm, ô sai/rỗng, khóa nhóm dài, partial pages, issue age và clock; không gửi LLM narrative thiếu nguồn ở digest pilot.
- [ ] Khép OFF-02 Meet/invite/Docs folder/Gmail, PM-01 card/member/due, report nguồn/đích. Tách catalog Docs/Drive khỏi điều kiện đã chọn spreadsheet, giữ allowlist Sheets và scope drive.file. Xử lý 401 bằng reconnect/consent có status rõ; chỉ sửa cấu hình local thử, không commit credential. Không coi có token là kết nối đã hoạt động.
- [ ] GREEN fixture/API/adapter tests; preview thể hiện snapshot, phạm vi và quyền chưa kiểm; receipt chỉ hứa đúng những bước đã xác minh. Commit `fix(workflows): complete six existing service compositions`.

**Giới hạn chốt:** Drive share tool và release-note builder không được lén thêm; account nhận thử dùng folder đã chia sẻ sẵn. Thiếu input thì hỏi, không làm “gần giống” rồi báo hoàn tất.

## Task FLOW-06 — Lịch, khôi phục lỗi và quyền thay đổi

**Card:** [FLOW-06](../../handoff/tasks/FLOW-06-schedule-recovery.md). **Owner:** backend + frontend; adapter owner với AbortSignal. **Depends:** FLOW-01/04/05.

**Files:** ScheduleService/runner/digest hiện có, History/ScheduleMoment/RecoveryMoment; giữ giao kèo delivery marker và lock ordering.

- [ ] RED DB/browser tests cho manual approval vs supported auto-digest, timezone/next run, pause/resume/revoke/reconnect; resume không replay lượt bỏ lỡ.
- [ ] RED PostgreSQL lock-interleaving và loopback server: timeout trước gửi có thể retry theo policy; nhận write rồi response mất/500/JSON lỗi → needs_attention và không replan/send lại. Kiểm AbortSignal thật.
- [ ] UI nêu chế độ lịch, thời điểm và hành động tiếp theo. Đổi source/destination identity/phạm vi yêu cầu xác nhận mới; snapshot báo cáo dựng lại mỗi lượt. Không tự nâng plan schedule thành auto mode.
- [ ] GREEN tests; kiểm reload trong pending/planning/executing/needs_attention và giữ link kết quả đã thành công. Commit `fix(schedules): make recurring workflows and recovery explicit`.

## Task FLOW-07 — Nghiệm thu live và mô phỏng sáu vai trò

**Card:** [FLOW-07](../../handoff/tasks/FLOW-07-live-acceptance.md). **Owner:** reviewer + người vận hành tài khoản thử. **Depends:** FLOW-01…06.

- [ ] Chốt head/CI, flags, model requested/served, dataset hash và allowlist tài nguyên thử. Probe read-only tất cả connector hiện có; 401/consent thiếu là blocker live có tên, không sửa bằng shared fallback.
- [ ] Dùng production app + PostgreSQL + model/provider thực: OFF-02/OFF-03/PM-01/PM-03/DEV-02/DEV-04, mỗi luồng ba lượt liên tiếp; kiểm source/đích/provider object và DB, không chỉ HTTP 200/toast.
- [ ] Chạy 36 câu hồi quy qua real runtime catalog theo từng persona; câu thiếu thông tin phải hỏi đúng, không tính hỏi lại hợp lý là fail. Chạy sáu persona × hai việc, history/memory của app thật; ghi đây là mô phỏng.
- [ ] Thu elapsed/setup/clarifications/edits/recovery/cost từng pha; đối chiếu dữ liệu có đáp án. Không tái dùng thống kê “participants thật” trong usable-plan cho persona mô phỏng; chỉ dùng helper đọc DB nếu cần.
- [ ] `npm run check` và browser liên quan PASS, CI đúng final SHA xanh, review độc lập; tạo báo cáo acceptance, task results/log. Commit `test(workflows): certify existing flows with live evidence`.

**Khi thiếu điều kiện:** tiếp tục phần độc lập, ghi NOT_RUN theo connector/luồng, không đóng gate live. Đợt kỹ thuật có thể nghiệm thu code riêng; pilot chỉ được khuyến nghị cho luồng đã đủ 3/3 live và không còn F1/F2/F3.

## Kiểm tra và cách bàn giao chung

Mỗi task chạy RED → implement tối thiểu → GREEN → kiểm package liên quan → commit đúng file → reviewer chạy lại → CI đúng head → merge theo quyền chủ dự án. Các test file mới ở trên là đường dẫn phải tạo, không phải khẳng định đã có.

Lệnh tập trung: `npx vitest run <backend/planner/schema test files của task>`; web: `npm test -w @wap/chat-web -- <test files của task>`; browser dùng `scripts/test-v3-browser.mjs` với DB/user thử riêng và grep theo task. Cuối chặng dùng `npm run check`; model tests tách khỏi Vitest fixture.

Kế hoạch này chỉ được tự review về coverage, interfaces, dependency và acceptance; chưa triển khai/sửa product, chưa chạy lại test nguồn mới và chưa hứa tiết kiệm thời gian con người. Mốc thành công trước mắt là sáu luồng đúng, rõ và lặp lại an toàn.
