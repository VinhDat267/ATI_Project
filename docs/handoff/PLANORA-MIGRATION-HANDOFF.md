# Bàn giao chi tiết — chuyển toàn bộ giao diện sang Planora

**Ngày:** 02/11/2026 (Asia/Saigon). **Task:** [PLANORA-00](tasks/PLANORA-00-ui-migration-plan.md). **Nhánh tài liệu:** `codex/planora-migration-plan`.

## 1. Đọc phần này trước khi nhận việc

Chủ dự án muốn khôi phục giao diện Planora cũ cho toàn bộ sản phẩm hiện tại. Khi được hỏi giữa khôi phục bố cục và chỉ đổi phong cách, chủ dự án trả lời: **“Khôi phục cả bố cục Planora cũ”**.

Hướng đã được yêu cầu: sidebar, hội thoại làm trung tâm, nền kem/xanh rừng, nhận diện Planora. Sản phẩm vẫn cần đủ chức năng mới trên main. Không được coi việc quay về App/store/API cũ là cách hoàn thành yêu cầu này.

**Hiện đã có kế hoạch và thiết kế dự thảo; chưa triển khai migration giao diện.** Yêu cầu gần nhất là viết handoff và mở PR tài liệu. Yêu cầu đó không đồng nghĩa đã duyệt mọi chi tiết đề xuất hoặc yêu cầu bắt đầu PL-01.

## 2. Thứ tự tài liệu cần đọc

1. [CURRENT-STATE](CURRENT-STATE.md), [README bàn giao](README.md), ba log mới nhất và [team workflow](../team-workflow.md).
2. [Thiết kế và inventory Planora](../superpowers/specs/2026-11-02-planora-migration-design.md): nguồn thị giác, kiến trúc chuyển đổi, toàn bộ màn thiếu và tiêu chí nghiệm thu.
3. [Kế hoạch 15 task](../superpowers/plans/2026-11-02-planora-migration.md): file, interface, dependency và kiểm chứng cho từng PL-xx.
4. [Task PLANORA-00](tasks/PLANORA-00-ui-migration-plan.md), [log lập kế hoạch](log/2026-11-02-codex-planora-migration-plan.md) và [log bàn giao/PR](log/2026-11-02-codex-planora-handoff-pr.md).
5. [Đặc tả v3](../superpowers/specs/2026-09-29-ai-workflow-platform-v3-design.md), các spec feature hiện hành và code main cho từng task. CURRENT-STATE có thể chậm hơn các PR vừa merge; phải đối chiếu Git thực tế.

## 3. Các mốc và nguồn chuẩn

| Nguồn | Mốc | Cách sử dụng |
| --- | --- | --- |
| Main đã khảo sát | `1977ec7dc9735e058b64440f965e214b0751fbf8` | Nền chức năng, đến merge JIRA-09A #258. GitHub main vẫn cùng SHA khi bắt đầu phiên handoff |
| Planora cũ | `Frontend_UXUI@ef13c5695ce2da030ff613422b4f8d6e1d7e72c3` | Source bố cục, CSS, assets và component thị giác |
| Design đúng của bản cũ | `ef13c56:apps/chat-web/DESIGN.md` | Nền kem/xanh rừng, sidebar, chat, typography và motion |
| Design chuẩn hóa riêng | `codex/docs/planora-design@6b324aa` | Tài liệu tham khảo bổ sung, vẫn draft; không lấy trạng thái cloud ngày 05/10 làm capability hiện tại |
| Commit kế hoạch | `23b3eefa642b0970c153cb334a6c672ae1ea8641` | Spec, plan, task PLANORA-00 và log khảo sát |
| Repo xuất bản frontend cũ | [longnguyen005/planora](https://github.com/longnguyen005/planora) | Bối cảnh tham khảo; baseline migration đã khóa theo commit trong ATI_Project, không tự thay bằng HEAD của repo khác |

**Hai nguồn dễ dùng nhầm:** `Frontend_UXUI:DESIGN.md` vẫn là tài liệu Airtable/Warm Workshop cũ; `System Design/` là design system lịch sử khác. Không dùng chúng làm palette Planora. Không phục hồi code hoặc thư mục v1/v2 đã bị xóa.

**PR cũ:** [#262](https://github.com/VinhDat267/ATI_Project/pull/262) đưa `Frontend_UXUI` vào `main`, đang OPEN/DRAFT/CONFLICTING tại lần kiểm tra phiên này. Nhánh có 3 commit riêng, chậm 864 commit tại mốc khảo sát. Đây là bản lưu để đối chiếu, không phải nhánh nền triển khai. PR #47 và #87 lần lượt bổ sung backend/tài liệu vào Frontend_UXUI; chúng không chứng minh tương thích với main mới.

## 4. Quyết định đã chốt và những gì còn là đề xuất

**Đã chốt bởi chủ dự án:** chuyển toàn bộ giao diện về Planora và khôi phục cả bố cục cũ. Không chỉ đổi màu trong cockpit/top nav hiện tại.

**Đề xuất kỹ thuật đã ghi trong tài liệu:** bắt đầu từ main; giữ domain/controller/hooks/store; port lớp trình bày; tổ chức 15 task; sidebar desktop 248px với breakpoint 1024px; có bản tối mới; nhánh tích hợp `codex/planora-ui` và các task PR riêng. Đây chưa phải quyết định thi công đã được duyệt toàn bộ.

**Cần duyệt trước thi công hàng loạt:** bản thiết kế/kế hoạch; hình thức bổ sung cho các màn chưa có mẫu; palette tối; bốn mẫu ở PL-01. Nếu người dùng tiếp tục cấp quyền trực tiếp với lựa chọn cụ thể, ghi lại quyền đó và không hỏi lại điều đã được chốt.

## 5. Kiến trúc để nối giao diện

Giữ `App.tsx`, `AuthGate.tsx`, `routes.ts` và contract route hiện tại. Giữ `components/Workspace.tsx` làm controller cho hội thoại; controller tiếp tục dùng `use-sse`, `use-conversation-history`, `use-execution-recovery`, `chat-store`, `apiClient` và `workspace-storage`.

Thay lớp trình bày bằng Planora shell/sidebar, feed hội thoại và các card thao tác. Tổ chức dự kiến trong `apps/chat-web/src/planora/`: styles, component nền, layout và workspace renderer. Không chuyển logic sang thư mục mới chỉ để đổi tên.

Các page hiện tự chứa MainNav/main phải tháo wrapper trùng khi nối shell. Mục tiêu là một global nav, một main, một h1 cho trang và một composer; callback/public page dùng khung thích hợp.

Các module backend, planner, schemas, adapters, executor, DB và prompts không thuộc scope đổi UI. Nếu thiếu contract thật, ghi lại bằng chứng và tách task/interface agreement theo module ownership.

## 6. Những giao diện còn thiếu hoặc cần mở rộng

“Thiếu” dưới đây nghĩa là chưa có bản Planora tương ứng; không có nghĩa main chưa có chức năng.

| Nhóm | Việc cần chuyển/bổ sung |
| --- | --- |
| Khung cá nhân/tổ chức | Workspace switcher, tạo/join bằng mã, pending/disabled, vai trò, nav và dữ liệu phụ thuộc workspace |
| Auth nâng cao | Google login, resend, forgot/reset, expired/used token, pending/locked/rate-limit/unverified và hết phiên |
| Callback | 8 view: Google login và 7 connection Gmail/Calendar/Sheets/Trello/GitHub/Jira/Telegram; callback không cùng một state machine |
| Connections | OAuth cá nhân, account identity, chọn scope/tài nguyên, reconnect/denied/permission, trạng thái cấu hình thật |
| Jira | Những panel JIRA-09A đã có: workspace/site/project, yêu cầu quyền, pending/admin approval; không gọi là đầy đủ Jira execution |
| Chat và workflow | Answer, refusal/thiếu scope, clarification, saved conversation, chờ lâu, preview Gmail/Sheets, identity/resource binding và biên nhận |
| Recovery | Failed, unknown, reconciliation, restart, offline; thao tác lấy từ recoveryActions thật |
| Schedule/digest | Đề xuất và thay đổi lịch, manual/auto_digest, eligibility, nguồn/đích, từng run, delivery/needs_attention |
| Nhật ký | Trang đầy đủ ngoài sidebar: tìm/lọc/phân trang theo main, lịch và lượt chạy, archive/delete/restore đúng API |
| Account/admin | Hồ sơ, mật khẩu, Google link/unlink, sessions/revoke; members/approval/roles/lock/invite theo workspace |
| Public/support | Cẩm nang, chính sách dữ liệu, 404 và lỗi truy cập hội thoại |
| Theme/responsive | Bản tối mới, mobile/tablet, drawer/modal layering, bảng rộng và reduced motion |

Kiểm kê tại mốc main: **22 route entries**, 404 ngoài danh sách, **13 giá trị CockpitMoment**, trạng thái phụ và **8 callback view**. Không biến các con số này thành tuyên bố “22 màn” vì route/modal/state là các đơn vị khác nhau.

## 7. Bản đồ nhận task

| Task | Deliverable | Phụ thuộc chính |
| --- | --- | --- |
| PL-01 | Baseline, tokens/component nền, bốn mẫu để duyệt | Khóa main và duyệt tài liệu |
| PL-02 | Shell/sidebar, workspace picker, drawer mobile | PL-01 |
| PL-03 | Landing, login, signup | PL-01/02 |
| PL-04 | AuthAction, verify/resend/reset, Google callback | PL-03 |
| PL-05 | Feed chat, active card, một composer | PL-02/04 |
| PL-06 | Plan, preview, executing, receipt và workflow steps | PL-05 |
| PL-07 | Answer/refusal/clarification/errors/recovery | PL-05/06 |
| PL-08 | Settings chung, Gmail/Calendar/Sheets và callback frame | PL-02/04/07 |
| PL-09 | Trello/GitHub/Telegram | PL-08 |
| PL-10 | Jira UI hiện có | PL-02/08 |
| PL-11 | Schedule/digest và run states | PL-05 đến PL-10 |
| PL-12 | Nhật ký/lịch sử/archive và sidebar sync | PL-02/11 |
| PL-13 | Account/admin/member management | PL-02/04 |
| PL-14 | Guide/privacy/404/trạng thái chung | PL-03, PL-08 đến PL-13 |
| PL-15 | Gỡ runtime CSS cũ, visual QA, regression, tích hợp | Tất cả task trước |

Mặc định làm tuần tự, một task card/nhánh/PR. Khi bắt đầu task nào, tạo card của task đó từ yêu cầu trong plan, đọc lại spec và ghi rõ source/target SHA. Chưa có 15 task card triển khai; PLANORA-00 chỉ quản lý tài liệu hiện tại.

## 8. Các bất biến phải bảo vệ

- URL path, Back/Forward, deep link `/c/:id`, token link và anchor dịch vụ main đang hỗ trợ. Không chép query router của Planora cũ.
- Đổi workspace/user không lẫn response GET, SSE, history, services hoặc pending run; quyền admin tổ chức khác quyền global user.role.
- Callback xử lý code/state một lần; giữ returnTo an toàn. Kết nối xong chỉ cho người dùng bấm gửi lại, không tự gửi hay tự duyệt.
- Active plan/proposal/run đúng ID; history/SSE cũ không làm sống lại kế hoạch đã hủy hoặc hoàn tất. Một bản tương tác cho active card.
- Approval/hash/snapshot/binding, manual/auto_digest và eligibility giữ như main. UI không tự nới policy dựa vào tên/logo provider.
- Unknown/reconciliation/needs_attention không tự Retry hoặc gửi lại. Đóng hộp thoại không biến thành Stop; thao tác phục hồi theo recoveryActions.
- Số liệu/trạng thái/timestamp/links lấy từ dữ liệu thật; demo phải có nhãn. Capability tắt thì UI tắt tương ứng.
- Giữ theme preference `ati-theme` và event `ati:theme`. Brand hiển thị đổi sang Planora, identifier kỹ thuật không tự đổi theo.
- Test nghiệp vụ được giữ ý nghĩa. Test màu/layout prototype cam cũ được thay reference có chủ đích, không xóa assertion để che mất tính năng.

## 9. Cách tiếp tục từ một phiên mới

1. Đọc tài liệu mục 2, chạy git status và log; không checkout/sửa thư mục có thay đổi người khác. Dùng worktree do nền tảng quản lý khi cần.
2. Đọc yêu cầu mới nhất để xác định phạm vi đã được duyệt. Nếu chỉ yêu cầu review tài liệu thì dừng ở review, không bắt đầu code.
3. Sau khi có quyền thi công, kiểm tra main mới nhất và diff frontend/feature kể từ `1977ec7`. Inventory hiện tại là snapshot, không là trần phạm vi.
4. Kiểm tra các PR feature vừa merge, đặc biệt Slack/GitHub/Jira. #256/#259/#260/#261 chưa nằm trong baseline khảo sát; không dựng UI dựa trên giả định chúng đã merge. Bổ sung inventory nếu hiện trạng đã đổi.
5. Tạo nhánh tích hợp từ main mới nhất theo workflow đã duyệt, nhận PL-01 trên nhánh/task riêng. Không rebase/merge nhánh Frontend_UXUI vào nền mới để “lấy giao diện”.
6. Đọc source Planora từ Git, ví dụ các lệnh chỉ đọc dưới đây; port đúng markup/assets vào lớp trình bày đã quyết định. Binary assets phải được trích nguyên byte, không qua pipeline text.
7. Dựng baseline sandbox riêng và chụp mẫu. Chỉ sau duyệt bộ mẫu mới chuyển các nhóm màn tiếp theo. Không phát hành trạng thái giao diện chuyển dở vào main.

```powershell
git status --short --branch
git log -5 --format='%h %ar %s'
git show ef13c56:apps/chat-web/DESIGN.md
git show ef13c56:apps/chat-web/src/views/Workspace.tsx
git show ef13c56:apps/chat-web/src/components/LandingPageView.tsx
git diff --name-status 1977ec7..origin/main -- apps/chat-web docs/handoff
```

Không chạy git fetch/push/branch mutation chỉ vì chúng nằm trong ví dụ; thực hiện theo scope người dùng và workflow phiên nhận việc. Mốc origin/main cục bộ có thể cần cập nhật để lệnh diff phản ánh GitHub thực tế.

## 10. Môi trường và kiểm thử khi thi công

Repo đang dùng npm workspaces; engines Node `^22.12.0 || >=24.0.0`, CI dùng Node 24. Chạy cài dependency theo lockfile của baseline thi công, không dùng lockfile từ Frontend_UXUI.

Khi cần DB/browser, sử dụng PostgreSQL 16 riêng và sandbox. Đọc `scripts/v3-local-env.mjs`, `scripts/run-v3-local.mjs` và cấu hình Playwright trước khi chọn port/URL. Harness local chặn port 5432/15433 và yêu cầu URL dành riêng cho local test; không đưa chuỗi kết nối dev hoặc credential thật vào handoff/log. Kiểm port/container đang dùng trước khi dựng; không dừng/xóa DB/server của người khác.

Không copy `.env` cá nhân vào runner. Đặt môi trường test rõ ràng cho migration/API/web và fixture provider; không gọi model/provider thật để chứng minh đổi UI. Có thể tham khảo harness có sẵn nhưng phải ghi lại cấu hình đã thực sự chạy.

Lệnh kiểm chứng theo phạm vi task và gate cuối:

```powershell
npm run typecheck:v3
npm run test -w @wap/chat-web
npm run test:eval:v3
npm run build:v3
node scripts/test-v3-web-build-security.mjs
# Hai lệnh sau chỉ chạy khi đã cấu hình sandbox và PostgreSQL test riêng:
npm run check
npm run test:browser:v3
```

Đọc scenario runner để xác nhận file provider thật sự được chạy. Jira/Trello/GitHub/Telegram có thể cần target spec riêng; không suy ra full coverage từ một default scenario pass. Timeout/concurrency business logic vẫn theo AGENTS: AbortSignal thật và truy vấn/DB thật, không mock hình thức.

Visual QA: phần có mẫu so Planora cũ tại 1440×900 và 375×812; màn mới sáng/tối tại 1440/1024/768/375, kiểm overflow 320. Kiểm focus, drawer/dialog, bàn phím, reduced motion, bảng Sheets và chuỗi dài. Khác biệt do tính năng mới cần chú thích.

## 11. Bằng chứng đã có và giới hạn

- Commit `23b3eef` đã chứa spec, plan, PLANORA-00 và log khảo sát. Python validation phiên lập kế hoạch đã xác nhận 22 route entries, 13 state, 15 task theo thứ tự, 8 callback view, 24 path hiện có, link spec và whitespace; exit 0.
- Builder check độc lập đã đọc spec/code, đối chiếu route/state và kết luận “nothing important left”. Đây là kiểm tra đủ thông tin để lập kế hoạch, **không phải** code review hay nghiệm thu migration.
- Phiên handoff này kiểm lại tính nhất quán tài liệu/link/count và staged diff; output, exit code cùng giới hạn ghi trong [log bàn giao](log/2026-11-02-codex-planora-handoff-pr.md) và PR.
- Chưa viết product code, tạo mẫu chạy, chụp baseline mới, cài dependency hoặc chạy unit/integration/browser/model/provider live cho migration. Các kết quả cũ trong log khác không chứng nhận migration.
- Toàn bộ PL-01 đến PL-15 còn chưa bắt đầu. Dark palette/bố trí mở rộng vẫn là đề xuất cần duyệt; dữ liệu capability trên cloud cũ chỉ là lịch sử.

## 12. Prompt giao việc tiếp theo

Chỉ dùng đoạn này sau khi chủ dự án duyệt phạm vi thi công:

> Đọc AGENTS.md, docs/handoff/CURRENT-STATE.md, README bàn giao và ba log mới nhất. Sau đó đọc docs/handoff/PLANORA-MIGRATION-HANDOFF.md, spec và plan Planora ngày 02/11/2026. Kiểm main mới nhất và bổ sung inventory nếu feature đã thay đổi từ mốc 1977ec7. Chỉ nhận PL-01: baseline, nền tokens/component và bốn mẫu Planora để chủ dự án duyệt. Dùng worktree/nhánh/task card riêng, bảo vệ mọi chức năng main, không merge PR #262 hoặc phục hồi code v1/v2. Ghi bằng chứng thật, điền Kết quả và thêm log riêng. Chưa chuyển hàng loạt các màn và chưa merge/deploy khi chưa đến gate tương ứng.

Khi đóng từng task, dùng [REVIEW-CHECKLIST](REVIEW-CHECKLIST.md), chạy lại kiểm tương ứng, ghi SHA/output/exit code và tạo PR đúng template. Reviewer chỉ cập nhật CURRENT-STATE/ROADMAP sau merge.
