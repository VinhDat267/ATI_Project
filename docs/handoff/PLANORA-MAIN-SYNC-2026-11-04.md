# Planora — cập nhật phạm vi theo main ngày 04/11/2026

**Task:** PLANORA-00, cập nhật kế hoạch theo yêu cầu chủ dự án. **Phạm vi:** tài liệu và prompt local; không tự dispatch, đổi DAG đang chạy, tích hợp code hoặc xuất bản PR.

**Baseline chức năng đã fetch:** `origin/main@cb069061e53776c967ef13e887d7c2adae578716`.
**Mốc so sánh:** `6c235837efa6811064c652b570e8c91bf8f77ab6` (main khi soạn bộ prompt 03/11).
**Nguồn thị giác:** vẫn `Frontend_UXUI@ef13c56`, sidebar/chat Planora và palette đã chốt.

Đây là bổ sung phạm vi mới cho [spec](../superpowers/specs/2026-11-02-planora-migration-design.md), [plan](../superpowers/plans/2026-11-02-planora-migration.md) và [handoff](PLANORA-MIGRATION-HANDOFF.md). Các bảng 22 route/8 callback hoặc dòng “Jira chỉ đến JIRA-09A” trong snapshot cũ được thay bằng inventory dưới đây. Không dùng checklist lịch sử để tuyên bố implementation đã đạt.

**UX authority 05/11:** [Business-first UX](../superpowers/specs/2026-11-05-planora-business-first-ux.md) quyết định hình thức/trải nghiệm. Các từ “restyle/port/giữ panel/props” dưới đây chỉ còn ý nghĩa bảo toàn capability/behavior, không bắt giữ cấu trúc UI. Gate sync kỹ thuật phải đi cùng [audit và refactor phần đã làm](tasks/PLANORA-UX-01-business-first-redesign.md).

## 1. Các PR đã vào baseline

| PR / merge commit | Chức năng mới phải được bảo toàn | Owner giao diện Planora |
| --- | --- | --- |
| [#259](https://github.com/VinhDat267/ATI_Project/pull/259) / `e7927e1d` | Slack OAuth cá nhân, consent xử lý dữ liệu, tra cứu/ghi, automation rules/AI/hybrid, proposal inbox và digest | PL-02/05/06/07/09/12/14 |
| [#265](https://github.com/VinhDat267/ATI_Project/pull/265) / `a4c9c878` | Trello nâng cấp; Notion OAuth, nhiều connection, chọn 1–10 database, callback, digest | PL-06/07/09/11/14 |
| [#268](https://github.com/VinhDat267/ATI_Project/pull/268) / `f52e1c8e` | Jira runtime, binding/guard theo workspace và site/project | PL-05/06/07/10/11 |
| [#269](https://github.com/VinhDat267/ATI_Project/pull/269) / `7b210e6e` | Jira Cockpit: preview, thực thi, receipt và recovery | PL-05/06/07/10 |
| [#270](https://github.com/VinhDat267/ATI_Project/pull/270) / `ef4e39e1` | Jira legacy schedule scanner và privacy disclosure | PL-11/12/14; scanner backend chỉ là nguồn hành vi, không thêm nút chạy scanner |
| [#271](https://github.com/VinhDat267/ATI_Project/pull/271) / `3ebb8611` | Jira regression/evaluation, browser và security coverage | PL-10/15 bảo toàn test và guard |
| [#272](https://github.com/VinhDat267/ATI_Project/pull/272) / `44680364` | Jira self-service workspace, 9 tools, Standup & Blocker digest, cross-service playbooks, polish Settings/Cockpit/Guide | PL-06/07/10/11/14 |
| [#274](https://github.com/VinhDat267/ATI_Project/pull/274) / `52a81374` | SCHED-04 evaluation và `SCHEDULES_ENABLED` mặc định on; vẫn cần PostgreSQL | PL-11/12/15 kiểm cả default-on và explicit-off |

GitHub #260 đã có trong mốc `6c235837`; không tính là feature mới lần này. Có 8 PR sản phẩm/eval merge kể trên; `cb069061` là commit handoff sau #274.

## 2. Inventory mới và quyền sở hữu

Đọc trực tiếp `routes.ts` ở baseline: **25 route entries + fallback 404**, **10 callback view** (Google login + 9 connection). `CockpitMoment` vẫn có **13 giá trị**; số này không bao phủ các trạng thái con Slack/Jira mới.

- Route bổ sung: `/inbox`, `/connections/myslack/callback`, `/connections/(?:my)?notion/callback`. Notion có hai URL alias cùng một route entry; không đếm thành hai màn khác nhau.
- **PL-02:** sidebar/deep-link `/inbox`, `NavTab='inbox'`, badge count thật; một shell/nav/main và focus drawer như cũ. Đây là revalidation phần đã làm sau đồng bộ main, không xóa bằng chứng review cũ.
- **PL-05:** giữ wiring Slack/Jira trong `App.tsx`, `Workspace.tsx`, `Cockpit.tsx` và hooks GET/SSE/recovery mới. Mỗi active turn chỉ render một lần; không nhân composer khi thêm provider controls.
- **PL-06:** PlanMoment, PreviewContents, ReceiptMoment, ExecutionProgress, WorkflowFlowCanvas và `components/SlackReadResult.tsx`, `pages/Cockpit/SlackReadControls.tsx`. Giữ scope đọc/ghi Slack, source refs/timestamp/result refresh, Jira site/project/issue/status/tool metadata và receipt liên kết thật. Không thay API/helper contract để làm skin.
- **PL-07:** refusal/connect-from-chat cho Notion/Slack/Jira; giữ `recovery-labels.json`, lỗi permission/reconnect/stale binding, read-result hết hiệu lực và unknown. Refresh nguồn không đồng nghĩa retry ghi; không phục hồi nội dung đã bị server thu hồi quyền.
- **PL-08:** Settings chung dành chỗ và anchor/callback frame cho Slack/Notion. Chỉ sở hữu frame/container; không sửa panel provider của PL-09 hoặc panel Jira PL-10 song song.
- **PL-09:** mở rộng từ Trello/GitHub/Telegram sang cả Notion và Slack. Sở hữu các panel connection/callback, `SlackAutomationSettings`, `SlackProposalInbox`, `SlackProposalCard`. Card ghi từng phần nghiệm thu độc lập 09a Trello/GitHub/Telegram, 09b Notion, 09c Slack; vẫn một worker xử lý tuần tự trong task PL-09, không tự tạo thêm ID DAG.
- **PL-10:** toàn bộ Settings/callback Jira đã merge, self-service create/join, personal connection, membership/approval, capability, site/project và nút mở chat theo contract thực. 9 tools là inventory backend hiện có, không phải yêu cầu tự thêm tools.
- **PL-11:** tất cả digest source hiện có: Calendar, Sheets, GitHub, Trello, Notion, Telegram aggregation và Jira `myjira_digest` Standup & Blocker. Destinations Slack/Telegram và eligibility lấy từ API; phân biệt Jira cá nhân `myjira` với legacy `jira`. Giữ proposal/config hash, disabledReason, pause_reason, delivery_unknown và needs_attention.
- **PL-12:** history/schedule thực theo main; liên kết tới run/conversation, empty/error/pending và lý do pause Jira legacy nếu API có trả. Inbox detail/filter do PL-09 sở hữu; không dựng thêm một inbox khác trong History.
- **PL-13:** giữ AccountPage thay đổi mới liên quan connection/session sau sync; chỉ đổi trình bày, không rollback auth/controller mới.
- **PL-14:** giữ Guide `data.tsx`, `gmail-data.tsx`, `mysheets-data.tsx`, Jira playbooks và Privacy disclosure mới (Slack/AI provider, Notion/Jira theo source). Không copy capability/cloud status ngày 05/10 vào sản phẩm.
- **PL-15:** nghiệm thu inventory 25 route + 404, 10 callback và expanded state matrix; kiểm tất cả provider browser specs được liệt kê dưới đây, đối chiếu main drift lần cuối.

### Files cần thêm vào card PL-09

`apps/chat-web/src/pages/Settings/{PersonalSlack,NotionConnection,TrelloConnection,GitHubConnection,TelegramConnection}.tsx`; `views/{SlackCallbackView,NotionCallbackView,TrelloCallbackView,GitHubCallbackView,TelegramCallbackView}.tsx`; `components/slack/{SlackAutomationSettings,SlackProposalInbox,SlackProposalCard}.tsx`.

Giữ nguyên public props, helpers `services/{slack-assistant,slack-connection,notion-connection}.ts`, auth/connection generation guards. File helper chỉ đổi nếu card được coordinator giao rõ và vẫn giữ contract; backend/packages/evaluations không thuộc task đổi UI.

## 3. Các tiêu chí nghiệm thu bổ sung

- [ ] **Slack connection:** nhiều workspace, identity/missingScopes, pending F1 consent, reconnect/disconnect và trạng thái chưa xác nhận revoke; không đồng nhất OAuth connected với quyền xử lý dữ liệu AI.
- [ ] **Slack automation:** giữ rules/AI/hybrid, filters keywords/authors/conversation types/mention, targets, budgets và timezone theo schema hiện tại. Không mở control nếu API không cho phép; lưu cấu hình không được tự approve/execute.
- [ ] **Slack inbox `/inbox`:** connection picker, filters action_needed/awaiting_approval/resolved, proposal/digest statuses và hành động server cho phép; stale/expired/denied có phản hồi. Bấm mở đề xuất/đổi bộ lọc không tự gửi tin hoặc thực thi plan.
- [ ] **Slack read/write:** chọn đúng tài nguyên đọc/ghi; giữ source provenance/expiry, directory/refresh, quyền private/DM và UI kết quả thật. Đổi user/workspace/connection khi request chậm không lộ dữ liệu cũ.
- [ ] **Notion:** hiển thị nhiều connection theo workspace; chọn/sửa 1–10 database bằng tên/ID thật; connected/needs_scope/reconnect_required, revoke/permission và callback `notion`/`mynotion` alias. URL dán vào selector không được thay thế kiểm quyền API.
- [ ] **Jira:** self-service create/join, workspace/site/project isolation, membership/permission pending, personal OAuth và capability thật; preview và receipt giữ issue key/status/site/project/nguồn. Digest Standup không dùng template legacy `jira` để giả `myjira`.
- [ ] **Schedules:** không đặt env giả định tất cả cờ mặc định off. Sandbox riêng kiểm env không đặt `SCHEDULES_ENABLED` (default on), rồi explicit `off`; UI theo capability API, không tự bật runtime production. Mỗi digest giữ manual vs auto_digest, destination và lý do không đủ điều kiện.
- [ ] **Callback/auth đã làm:** sau sync phải chạy lại auth deep-link/return, Google callback, user/workspace switch; shared callback generation/return-target thay đổi của main không được mất khi resolve conflict.
- [ ] **Public/privacy:** giữ nội dung chính sách/capability mới trên main; ví dụ cross-service chỉ là draft có nhãn minh họa; không auto-send khi nhấn playbook.

## 4. Kiểm chứng bằng test hiện có trên baseline

Các path dưới đây đã xác minh có trong cây `cb069061`, không có nghĩa đã chạy/PASS trong lượt cập nhật tài liệu này.

| Owner | Browser cần chạy trực tiếp trong sandbox PostgreSQL16 riêng | Unit/regression theo vùng thay đổi |
| --- | --- | --- |
| PL-02/05 | `fe-02-routing-history.spec.ts`, `fe-11-auth-return.spec.ts`, `fe-12-nav.spec.ts` | conversation-history, read-guard, SSE/recovery/store theo diff main |
| PL-06/07/09 Slack | `slack-oauth.spec.ts`, `slack-assistant.spec.ts`, `slack-read.spec.ts`, `slack-write.spec.ts` | `slack-oauth.test.tsx`, `slack-assistant-settings.test.tsx`, `slack-proposal-inbox.test.tsx`, `slack-read-controls.test.tsx`, `slack-read-refresh.test.ts`, `slack-read-results.test.tsx` |
| PL-09 providers | `trello-oauth.spec.ts`, `github-oauth-and-digest.spec.ts`, `telegram-oauth-and-digest.spec.ts` | `trello-connection.test.tsx`, `trello-ui-ux.test.tsx`, `notion-connection.test.tsx` và provider tests hiện có |
| PL-10 Jira | `jira-09a.spec.ts`, `jira-business-v2.spec.ts` | `jira-api.test.ts`, `jira-callback.test.tsx`, `jira-cockpit.test.tsx`, `jira-connection.test.tsx`, `jira-connection-responsive.test.tsx` |
| PL-11/12 | `sched-03.spec.ts`, `sched-03-calendar-delivery.spec.ts`, provider digest specs kể trên và Jira business v2 | `schedule-{calendar,github,telegram,trello}-digest-mode.test.tsx`, schedules/history theo source hiện có |
| PL-14/15 | Guide/privacy/routing cases trong runner và toàn bộ specs provider bên trên | FE-10 Guide/Privacy, full check ở gate tích hợp |

Browser paths tương đối với `apps/chat-web/tests/browser/`, unit paths tương đối với `apps/chat-web/tests/`. Baseline chưa có browser spec Notion riêng: PL-09 bổ sung `apps/chat-web/tests/browser/planora-notion.spec.ts` kiểm OAuth callback, scope picker và stale connection bằng API sandbox/fixture phù hợp; fixture không chứng nhận OAuth/provider live. Không ghi Notion “đã được browser cover” từ unit test.

Baseline có scenarios `slack_oauth`, `slack_assistant`, `slack_read`, `slack_write` và nhận pass-through arguments; kiểm thêm GREP của từng scenario để không lọc mất spec truyền vào. Baseline có scenarios `slack_oauth`, `slack_assistant`, `slack_read`, `slack_write` và nhận pass-through arguments; kiểm thêm GREP của từng scenario để không lọc mất spec truyền vào. Chạy thông qua harness/runner đã đọc đúng phiên bản. Xác minh `--list`/grep chỉ để kiểm test selection; vẫn phải chạy thật những ca được giao. Không ghi command `npm run test:browser:v3 -- <spec>` như đảm bảo universal nếu runner phiên bản thực không nhận path đó. Ghi SHA, env scenario, command, số ca, exit code và NOT_RUN; lỗi locator/strict mode là test failure cần sửa, không bỏ assertion 44px/overflow.

## 5. Cách coordinator áp dụng vào run đang có

1. Đọc tài liệu này và plan/prompt revision; lưu snapshot Task/Dispatch/head/base đang chạy qua CLI read-only. Không replay PL-01–04 chỉ vì header tài liệu gốc ghi draft.
2. Cho worker đang làm kết thúc/bàn giao đúng task; không sửa checkout/index/source của họ trong khi chạy. Dùng một task sync có ownership tích hợp rõ, worktree do công cụ nền tảng tạo, base từ head tích hợp hiện tại. Không reset/rebase/force-push nhánh đang có worker.
3. Kiểm `git diff <main-cũ>..<baseline> -- apps/chat-web`, hooks/services/types/routes/runner và conflict với Planora; merge main trong nhánh sync riêng, bảo toàn cả behavior mới và Planora UI đã review. Main cần đồng bộ cả backend/packages/migrations tương ứng; người tích hợp chịu trách nhiệm reconciliation, worker UI không tự viết lại backend để bù contract thiếu.
4. Chạy checks liên quan cho vùng đã xong PL-01–04: typecheck/build/web tests, route/nav/auth/browser callback và isolation. Codex review diff sync đúng base/head, ghi gaps/NOT_RUN. PASS task cũ chỉ chứng nhận head cũ; không chuyển PASS nguyên trạng sang cây sync.
5. Sau khi sync được chấp nhận theo quyền đã cấp, ghi integration SHA thật vào card PL-05–15. Giữ dependency IDs cũ; PL-05/PL-13 chỉ đủ điều kiện chạy khi PL-04 và gate sync đã đạt, không chỉ nhìn `ready` trong DAG. Nếu PL-05/13 đã khởi chạy thì làm reconciliation sau bàn giao thay vì thay base dưới chân worker.
6. Chuẩn bị card PL-09 có đủ 09a/09b/09c trước dispatch; PL-09 và PL-10 có thể song song sau PL-08 khi frame/container đã khóa. PL-11 vẫn chờ toàn bộ PL-05–10; PL-14 chờ PL-08–13; PL-15 kiểm tất cả. Không coi Slack đọc/ghi hoàn thành ở PL-09 nếu phần Cockpit của PL-06/07 chưa được kiểm.
7. Bộ prompt, thông tin điều phối và tài liệu local theo yêu cầu chủ dự án không xuất bản lên GitHub. Trước PR sản phẩm tạo nhánh sạch từ main, đưa đúng thay đổi sản phẩm được chọn vào, rồi kiểm cả diff **và lịch sử commit** để không mang private prompt ancestors. Không chỉ xóa prompt ở commit cuối vì lịch sử vẫn có nội dung.
8. Nếu main tiến sau `cb069061`, fetch/đối chiếu lại và mở rộng delta trước dispatch/gate cuối. PR DESIGN.md riêng #273 không đồng nghĩa cho phép publish bộ prompt hoặc merge tài liệu lịch sử để ghi đè design đã port.

## 6. Giới hạn phiên cập nhật

Chỉ khảo sát Git source/test inventory và cập nhật kế hoạch. Không chạy unit/browser/runtime/provider, không kết luận UI đã đạt; không chỉnh CURRENT-STATE/ROADMAP, không dispatch/integrate/merge/deploy. Coordinator đang chạy cần đọc revision này trước khi chuẩn bị các card tiếp theo; chỉ lưu tài liệu không tự cập nhật context hoặc DAG Orca.
