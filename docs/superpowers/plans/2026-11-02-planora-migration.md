# Planora UI Migration Implementation Plan

> **For agentic workers:** Implement assigned tasks through Antigravity/Gemini using the task prompts linked below. Each worker follows superpowers:executing-plans for its own task; Codex performs independent task and final reviews. This document is a draft for approval; it does not authorize implementation.

**Goal:** Khôi phục toàn bộ bố cục và nhận diện Planora cũ trên nền chức năng main mới nhất, bao phủ các trang/trạng thái mới mà bản cũ chưa có.

**Architecture:** Bắt đầu từ main, giữ AuthGate, router, controller Workspace, hooks, store và API client. Chuyển assets/markup Planora có chọn lọc vào lớp trình bày và bù các màn thiếu; không merge nguyên nhánh Frontend_UXUI. Sidebar/chat là bố cục đích, route và quyền từ main là nguồn truth.

**Tech Stack:** React 19, TypeScript, Vite, Tailwind/CSS hiện tại, Zustand, SSE, Vitest/Testing Library, Playwright; PostgreSQL 16 riêng cho nghiệm thu.

**Spec:** [2026-11-02-planora-migration-design.md](../specs/2026-11-02-planora-migration-design.md).

**Status:** Dự thảo ngày 02/11/2026; user đã chọn phục hồi cả bố cục cũ. Cần duyệt bản thiết kế/kế hoạch trước khi thi công. Mốc khảo sát main `1977ec7`; source thị giác `Frontend_UXUI@ef13c56`.

**Execution roles (03/11/2026):** Theo lựa chọn của chủ dự án, Antigravity/Gemini thi công và **Codex review**. [Bộ prompt điều phối, PL-01–15 và review](../../handoff/planora-prompts/README.md) ghi rõ phạm vi, dependency và packet bàn giao. Việc soạn prompt không khởi chạy agent hoặc thay trạng thái duyệt thiết kế.

## Global Constraints

- “Khôi phục cả bố cục Planora cũ”: sidebar 248px trên desktop từ 1024px, feed hội thoại và một composer.
- Giữ đủ 22 route entries, 404, 13 trạng thái selectMoment và các trạng thái phụ; không khôi phục query router/App/store/API cũ.
- Canvas #f8f4eb; paper #fffdf7; sidebar #eee9dd; text #2e382d; muted #656b5b; divider #deded0; primary #3c5741.
- Không đổi API, DB, prompt, catalog, quyền, hash/binding hoặc giá trị feature flags; thay đổi backend nếu cần phải là task riêng có thỏa thuận.
- Dùng assets/font có giấy phép của Planora, không thêm framework/thư viện UI mới. Dark mode là thiết kế bổ sung, giữ preference `ati-theme`.
- Không merge #262 để thi công. Không phục hồi v1/v2 hay `System Design/`. Không đổi mã nội bộ/invite-code format chỉ để đổi brand.
- Không auto-send sau OAuth, không auto-approve plan. Giữ manual/auto_digest khác nhau theo policy main.
- Các fixture chỉ chứng minh UI/hợp đồng sandbox; không gọi chúng là nghiệm thu provider live.

## Review Focus

1. Đổi không gian/tài khoản khi GET hoặc SSE cũ chưa về: không trộn dữ liệu hoặc cho thao tác vào workspace trước. Test ở PL-02, PL-05, PL-08–10.
2. Callback nhận lại do reload/StrictMode, user hủy consent hoặc đổi phiên: tiêu thụ state đúng một lần, quay về route an toàn, không tự gửi yêu cầu. Test ở PL-04, PL-08–10.
3. Preview cũ, nhấn duyệt hai lần hoặc kết nối/scope đổi: server từ chối như main, UI hiện trạng thái thật và không nhận thành công giả. Test ở PL-06, PL-11.
4. Kết quả ghi unknown/restart hoặc digest needs_attention: không mở Retry/autoreplan vô điều kiện. Test ở PL-07, PL-11.
5. Mobile + nội dung không có dấu cách, bảng Sheets rộng, modal trên sidebar, theme/reduced motion: không tràn trang, một composer, đúng focus và quyền điều khiển. Test ở PL-01–02, PL-05–06, PL-15.

## Tổ chức Git và nghiệm thu

- Nhánh tích hợp đề xuất `codex/planora-ui` bắt đầu từ main mới nhất khi thi công.
- Mỗi PL-xx là một task card/nhánh/PR vào nhánh tích hợp; không phát hành giao diện chuyển dở sang main. Chỉ merge mỗi task khi kiểm tương ứng và CI xanh.
- PR cuối đưa nhánh tích hợp vào main sau regression đầy đủ, đối chiếu diff với main mới nhất và review độc lập.
- Mỗi task điền Kết quả và thêm log mới. Không cập nhật CURRENT-STATE/ROADMAP trong task frontend; reviewer ghi sau merge.
- Nếu một feature PR mới merge trong lúc thi công, cập nhật inventory và bổ sung test vào task sở hữu trước khi tiếp tục.
- Không thay đổi/đóng PR #262 trong nhiệm vụ lập kế hoạch này.

## Bản đồ file và trách nhiệm

| Phạm vi | File hiện tại cần giữ logic | File/lớp trình bày dự kiến |
| --- | --- | --- |
| Nền | index.css, hooks/use-theme.ts, main.tsx | planora/styles/*.css; planora/components/{Brand,Button,Field,StatusBadge}.tsx |
| Shell | components/layout/{MainNav,UserNavMenu,WorkspaceSwitcher,SidebarHistory}.tsx | planora/layout/{PlanoraShell,PlanoraSidebar,PlanoraPublicHeader}.tsx |
| Public/auth | pages/Landing; views/{LoginPage,SignupView,VerifyEmailView,ForgotPasswordView,ResetPasswordView,GoogleCallbackView,AuthFormFrame}; pages/AuthAction | planora/layout/PlanoraAuthFrame.tsx, public assets; các page/view hiện tại được đổi trình bày |
| Chat | components/Workspace.tsx; hooks/*; chat-store; services/cockpit-moment.ts | planora/workspace/{PlanoraChatWorkspace,PlanoraActiveTurn,PlanoraConversationFeed}.tsx |
| Plan/run/result | pages/Cockpit/{PlanMoment,ExecutionMoment,ReceiptMoment,PreviewContents,GmailPreview,PreviewModal}; WorkflowFlowCanvas | planora/workspace/PlanoraWorkflowSteps.tsx; restyle các card đang có |
| Recovery/response | RecoveryMoment/Editor, ScheduleRunRecovery, pages/Responses và Errors | các card hiện tại, bỏ wrapper cockpit riêng |
| Connections | pages/Settings/*.tsx; views/*CallbackView.tsx; services/*-connection.ts | planora/layout/ConnectionCallbackFrame.tsx; restyle trong từng provider view |
| Nhật ký/lịch | pages/History; ScheduleMoment/Actions/RunRecovery; hooks/use-schedules | các page/card hiện có trong shell |
| Account/admin/help | pages/{Account,Users,Guide,Privacy,NotFound} | các page hiện tại trong shell hoặc public header |

Không chuyển file logic chỉ để đặt vào thư mục Planora. Nếu cần tách file rất dài (AuthAction/JiraConnection), tách theo UI panel và giữ hook/handler/type hiện hành; giới hạn trong task của chính màn đó.

## PL-01: Chốt baseline, design tokens và component nền

**Deliverable:** Bộ nền Planora dùng được và bộ mẫu tham chiếu đủ để duyệt hình thức trước khi đổi hàng loạt.

**Files:** tạo `apps/chat-web/src/planora/styles/{tokens,base,components}.css`, `planora/components/{Brand,Button,Field,StatusBadge}.tsx`; sửa `apps/chat-web/src/index.css`, `apps/chat-web/index.html`, `apps/chat-web/DESIGN.md`, `DESIGN.md`; copy có chọn lọc `public/fonts`, favicon/logo từ ef13c56. Task card/log riêng khi thi công.

**Interfaces:** CSS `--planora-*` cho canvas/paper/sidebar/text/muted/divider/primary và status; wrappers dùng props native HTML của button/input cùng children/variant, không bọc API logic.

- [ ] Khóa SHA main, đọc diff mới từ mốc khảo sát; dựng baseline browser riêng và chụp main + mẫu Planora ở 1440×900/375×812.
- [ ] Tạo bốn mẫu cần duyệt: landing, chat có plan, Settings có OAuth/scope, Nhật ký có lịch. Mẫu chưa nối backend phải gắn nhãn demo.
- [ ] Đưa light tokens đúng spec; dark tokens theo đề xuất trong spec, đo contrast, kiểm font license/loading và reduced motion. Đây là đổi trình bày: dùng kiểm ảnh/contrast/build, không viết unit test chỉ so hằng số màu với chính code.
- [ ] Cập nhật design authority để yêu cầu Planora mới thay phần thị giác Agentic; ghi rõ nghiệp vụ vẫn theo v3 + các spec feature hiện hành. Giữ tài liệu prototype lịch sử.
- [ ] Kiểm `npm run build:v3`, ảnh 320/375/768/1024/1440 và sáng/tối; duyệt bộ mẫu trước PL-03 trở đi.

## PL-02: Shell, sidebar và không gian cá nhân/tổ chức

**Dependencies:** PL-01.

**Files:** tạo `planora/layout/{PlanoraShell,PlanoraSidebar,PlanoraPublicHeader}.tsx`, `planora/styles/shell.css`; sửa `App.tsx`, `components/layout/{MainNav,WorkspaceSwitcher,SidebarHistory,UserNavMenu}.tsx`; test `tests/planora-shell.test.tsx`, `tests/browser/planora-shell.spec.ts`.

**Interfaces:** `PlanoraShell({user,current,navigate,onLogout,children})` dùng User, NavTab và callback hiện hành; sidebar dùng SidebarHistory thật. Mỗi protected page chỉ có một shell, một main và một h1.

- [ ] Viết/chạy fail ca chuyển Settings→History, link mở tab mới, admin tổ chức khác user.role, badge pending lịch/người dùng và workspace picker trên mobile.
- [ ] Port hình thức sidebar cũ; đưa đủ nav mới và WorkspaceSwitcher vào vị trí đầu sidebar. Giữ logic tạo/join, pending/disabled và giữ trang khi đổi workspace.
- [ ] Test đổi workspace khi request trễ bằng deferred response thật trong component harness; kết quả A không xuất hiện ở B. Test trên browser/PostgreSQL cho isolation theo main.
- [ ] Test drawer <1024: Escape, backdrop, focus restore, khóa nền và dialog create/join nằm trên drawer; chỉ có một nav hiện hành cho screen reader.
- [ ] Chạy web tests liên quan và nhóm browser workspace/admin hiện có; lưu ảnh cả hai theme.

## PL-03: Landing, đăng nhập và đăng ký

**Dependencies:** PL-01, PL-02.

**Files:** `pages/Landing/{LandingPage.tsx,page.css}`, `views/{LandingView,LoginPage,SignupView,AuthFormFrame}.tsx`, `components/GoogleAuthButton.tsx`; tạo `planora/layout/PlanoraAuthFrame.tsx`; tests `fe-08-landing-auth`, `auth-02-signup-reset` hiện có và `tests/browser/planora-public.spec.ts`.

**Interfaces:** Giữ PublicViewProps, onSubmit và config/capabilities hiện hành; auth frame chỉ nhận children/header/artwork.

- [ ] Port hero/illustration/footer/login story Planora; bỏ orbital Make ở landing, giữ các ví dụ gắn nhãn minh họa và nội dung dịch vụ đúng capabilities hiện tại.
- [ ] Dùng controller login/signup hiện tại: Google có điều kiện, vào không gian cá nhân/tổ chức, tạo/join theo flow main, return target và pending approval.
- [ ] Giữ form password validation, disabled/busy/error; không copy điều kiện cloud ngày 05/10 từ docs cũ làm feature flags.
- [ ] Chạy các browser auth/public hiện có; kiểm direct link `/c/:id` qua login, session đã có và signup bị tắt.
- [ ] Kiểm ảnh đối chiếu mẫu cũ + nội dung tính năng mới, mobile và reduced motion.

## PL-04: Xác thực nâng cao và vòng đời tài khoản

**Dependencies:** PL-03.

**Files:** `views/{VerifyEmailView,ForgotPasswordView,ResetPasswordView,GoogleCallbackView}.tsx`; `pages/AuthAction/{AuthActionPage.tsx,page.css}`; `components/AuthGate.tsx` chỉ phần trình bày; tests auth02/auth04/auth-return hiện có.

**Interfaces:** Giữ AuthActionMode/AuthActionPageProps; đủ 13 mode hiện tại. Không đổi auth-return-target hay callback contract.

- [ ] Thiết kế Planora cho resend, forgot/reset, expired/used token, reset success, Google pending/ready/error, pending/locked/attempts/unverified và loading.
- [ ] Rerun behavior tests hiện tại; thêm test có ý nghĩa nếu wrapper mới làm thay đổi focus/submit/routing. Không viết lại validation bằng rule khác.
- [ ] Ca bắt buộc: callback reload/StrictMode chỉ xử lý một lần; link token bị gỡ khỏi URL đúng như main; đổi user/session trong lúc callback không đưa về hội thoại người khác.
- [ ] Kiểm login lỗi/mất phiên trên mobile, timer cooldown bằng clock control và điều kiện render thay vì sleep mù.
- [ ] Chạy nhóm browser auth02/auth04 và auth deep link/return của main.

## PL-05: Feed hội thoại Planora và một composer

**Dependencies:** PL-02, PL-04.

**Files:** tạo `planora/workspace/{PlanoraChatWorkspace,PlanoraActiveTurn,PlanoraConversationFeed}.tsx`; sửa `components/{Workspace,Cockpit}.tsx`, `pages/Cockpit/{ChatComposer,ConversationDrawer,SavedConversation}.tsx`; tests `tests/planora-chat.test.tsx`, `tests/browser/planora-chat.spec.ts`, regression conversation hiện có.

**Interfaces:** `PlanoraChatWorkspace` nhận `ComponentProps<typeof Cockpit>` để giữ callback hiện tại. `PlanoraActiveTurn` nhận state/snapshot từ useChatStore và dùng selectMoment hiện có; render card gắn đúng plan/run/proposal. `PlanoraConversationFeed` nhận messages hiện hành và children cho active card, không tự load API.

- [ ] Viết/chạy fail ca một textbox/one send (IME không submit), feed đọc được toàn bộ hội thoại, mở lại hội thoại đã lưu, đổi hội thoại không lẫn state.
- [ ] Đổi điểm render trong Workspace sang shell/feed Planora; giữ tất cả handlers, race guards và hooks hiện tại.
- [ ] Render active card đúng một lần; tin lịch sử có nhãn, timestamp và nguồn scheduled run thật; preview lịch sử không còn nút duyệt hoạt động.
- [ ] Test GET lịch sử cũ về sau SSE mới, SSE trùng, plan bị reject/settled, late plan, current plan khác execution snapshot; không làm sống lại hành động cũ.
- [ ] Test auto-scroll gần cuối; người đang đọc cũ giữ vị trí; prefill chỉ điền draft, đóng dialog không gửi; layout một composer ở mọi active state.
- [ ] Chạy FE-02/03b/05 regression, SCHED-03 state/history và mở lại saved conversation.

## PL-06: Kế hoạch, thực thi, preview và biên nhận

**Dependencies:** PL-05.

**Files:** tạo `planora/workspace/PlanoraWorkflowSteps.tsx`; sửa `components/WorkflowFlowCanvas.tsx`, `pages/Cockpit/{PlanMoment,ExecutionMoment,ReceiptMoment,PreviewContents,GmailPreview,PreviewModal}.tsx`; tests readable-workflows/plan/preview/receipt/flow hiện có.

**Interfaces:** PlanoraWorkflowSteps dùng `WorkflowFlowCanvasProps` hiện tại và giữ các mode preview/executing/receipt/schedule/blueprint. Giữ callbacks onStepPreview/onSelectService. Helpers `presentation.tsx`, toolDefinition và resourceDestination tiếp tục phân giải dữ liệu như main.

- [ ] Chuyển orbital canvas thành chuỗi step card Planora (desktop nhiều cột khi đủ chỗ; mobile dọc) với thứ tự, dependsOn, read/write, trạng thái và data-flow còn đầy đủ.
- [ ] Đổi plan action bar/approval và progress/receipt; giữ busy locking, hash, nguồn đích, danh tính provider, retryable status và safe result links.
- [ ] Giữ preview Gmail, người gửi/nhận/nguồn; Sheets grid từng ô/range; payload JSON/ID/labels thật; bảng cuộn trong card, không làm page rộng ra.
- [ ] Test double approve/cancel pending, stale plan/scope đổi, execution thuộc plan trước, preview không thực thi, server từ chối được hiển thị đúng.
- [ ] Chạy nhóm FE-03/05 + Gmail/Sheets/GitHub/Trello/Telegram/Jira preview regression liên quan; ảnh 320/375/1440 cả hai theme.

## PL-07: Trả lời, hỏi lại, lỗi và phục hồi

**Dependencies:** PL-05, PL-06.

**Files:** `pages/Responses/{ResponseMoment.tsx,page.css}`, `pages/Errors/{PlanningErrors.tsx,page.css}`, `pages/Cockpit/{ClarificationMoment,RequestMoments,RecoveryMoment,RecoveryEditor,RequestEcho}.tsx`, `components/CockpitDialog.tsx`; tests answer/refusal/clarification/recovery hiện có.

**Interfaces:** Giữ selectMoment priority, RecoveryControls, snapshot.recoveryActions và current connect/resend handlers; sửa wrapper/markup/style phù hợp feed.

- [ ] Thiết kế card answer có nguồn; hỏi lại tài nguyên; từ chối/thiếu kết nối/thiếu phạm vi; chờ lâu/planning error/offline/auth error.
- [ ] Chuyển recovery 7/8/9 và unsuccessful sang Planora; giữ phân biệt failure/unknown/reconciliation/restart.
- [ ] Test unknown không hiện Retry; Stop có xác nhận; Escape chỉ đóng dialog; lỗi handler không giả thành success; edit recovery chỉ gửi yêu cầu mới khi Stop đúng plan thành công.
- [ ] Test connect-from-chat quay về đúng hội thoại và nút Gửi lại chỉ gửi khi bấm; không tự submit sau OAuth.
- [ ] Chạy FE-06A/B, answer và clarification browser scenarios; ảnh phục hồi ở mobile/dark.

## PL-08: Kết nối chung, Gmail, Google Calendar và Google Sheets

**Dependencies:** PL-02, PL-04, PL-07.

**Files:** `pages/Settings/{SettingsPage,PersonalGmail,PersonalMyCalendar,PersonalMySheets}.tsx`, `useSettings.ts` chỉ phần nối UI nếu cần; `views/{GmailCallbackView,MyCalendarCallbackView,MySheetsCallbackView}.tsx`; tạo `planora/layout/ConnectionCallbackFrame.tsx`; tests gmail/mycalendar/mysheets hiện có.

**Interfaces:** Frame nhận title/children/status presentation, không tiêu thụ OAuth state. Giữ service props, connection helper signatures, returnTo và API handlers.

- [ ] Dựng Settings Planora: nhóm cá nhân/tổ chức, trạng thái kết nối/phạm vi/quyền thật; số lượng từ danh sách thực, không hardcode “8 dịch vụ”.
- [ ] Thiết kế đủ connect/disconnect, expired/reconnect, chọn lịch, Google Picker/đã chọn spreadsheets và viewer permission. UI Google Picker do Google sở hữu không nằm trong yêu cầu skin.
- [ ] Giữ anchors `#gmail`, `#mycalendar`, `#mysheets` và các anchor scope hiện có; callback/error/selection dùng frame chung nhưng giữ state machine riêng.
- [ ] Test flag off/thiếu cấu hình/denied/scope_required và reconnect; workspace/user đổi giữa callback; request retry không tiêu thụ code lần nữa.
- [ ] Chạy browser scenarios gmail/mycalendar/mysheets + Settings; API thật trong sandbox/PostgreSQL riêng.

## PL-09: Trello, GitHub và Telegram

**Dependencies:** PL-08.

**Files:** `pages/Settings/{TrelloConnection,GitHubConnection,TelegramConnection}.tsx`, `views/{TrelloCallbackView,GitHubCallbackView,TelegramCallbackView}.tsx`; các service connection giữ nguyên logic; tests trello/github/telegram hiện có.

**Interfaces:** Giữ ranh giới OAuth cá nhân và scope nhóm; consume Frame từ PL-08. Không gộp polling Telegram thành redirect OAuth thông thường.

- [ ] Port card provider và scope selector Planora; Trello workspace/board membership, GitHub repos và Telegram chat/group hiển thị đúng tên.
- [ ] Giữ CTA admin/member khác nhau; scope_required có đường sửa scope, không thay bằng kết nối lại vô nghĩa.
- [ ] Telegram có pairing đang chờ, deep link cá nhân/nhóm, timeout/hết hạn, poll và chọn chat; disconnect/cancel không báo gửi thành công.
- [ ] Test đổi workspace khi load board/repo/chat, permission denied, callback đổi user và quay về chat/settings đúng anchor.
- [ ] Chạy trực tiếp browser spec trello-oauth, github-oauth-and-digest và telegram-oauth-and-digest theo fixture hiện có; không giả định default scenario runner đã gọi đủ file.

## PL-10: Jira workspace, site/project và yêu cầu quyền

**Dependencies:** PL-08, PL-02.

**Files:** `pages/Settings/JiraConnection.tsx`, `views/JiraCallbackView.tsx`; có thể tách các UI panel vào `pages/Settings/jira/`; giữ `services/jira-api.ts`, `jira-connection.ts`; tests `jira-09a*` và browser/jira-09a.spec.ts.

**Interfaces:** Giữ JiraConnectionProps, selectedWorkspace, API response/error và membership status hiện hành. Chỉ main JIRA-09A đã được khảo sát; các luồng JIRA-08 chưa merge không tự đưa vào.

- [ ] Đổi đúng từng panel: account identity, workspace list/create/join, site/project, pending request/admin approval/capability notice theo code đã có.
- [ ] Giữ contract role của workspace Jira riêng; không suy ra từ global user.role hoặc chỉ từ workspace chung của sidebar.
- [ ] Kiểm race của request/status khi đổi lựa chọn/nhân vật; denial/reconnect/expired/empty/offline đúng thông báo main.
- [ ] Chạy Jira UI unit tests và browser spec trực tiếp; đối chiếu các regression của JIRA-09A đã sửa, không bỏ assertion lỗi/quyền để đổi layout.
- [ ] Ghi riêng mọi UI bổ sung do Jira PR khác vừa merge; cần cập nhật inventory trước khi đóng task.

## PL-11: Lịch chạy và bản tin tự động

**Dependencies:** PL-05–10.

**Files:** `pages/Cockpit/{ScheduleMoment,ScheduleActions,ScheduleRunRecovery}.tsx`, `pages/History/ScheduleSection.tsx`; giữ `hooks/use-schedules.ts`, schedule-text và conversation-messages; tests sched-03/Calendar delivery/provider digest hiện có.

**Interfaces:** Giữ ScheduleView/ScheduleRunView/ScheduleApprovalMode từ tool-schemas, snapshot và config hash; không tự dựng eligibility của auto_digest từ logo/provider name.

- [ ] Card chat create/update/pause/resume/cancel; giờ/múi giờ/tần suất/nguồn/đích/lần kế tiếp rõ ràng. Một lần xác nhận chỉ tác động đúng proposal.
- [ ] Manual và auto_digest có copy khác nhau: chờ duyệt mỗi lượt hoặc chấp thuận cấu hình gửi tự động. Chế độ chỉ xuất hiện nếu API hiện tại cho phép.
- [ ] Lượt chạy: pending/running/discarded/failed/completed/digest_sent/digest_failed/needs_attention và các giá trị enum thực tế khác được render đầy đủ.
- [ ] Test proposal stale/409, config/scope đổi, double confirm, reload/SSE, pause/cancel trong khi chạy và delivery đã bắt đầu; UI không tự replan/resend unknown.
- [ ] Chạy schedule scenario, sched-03-calendar-delivery và các digest provider spec trực tiếp; giữ cờ tắt đúng main sau test.

## PL-12: Nhật ký, lịch sử và lưu trữ hội thoại

**Dependencies:** PL-02, PL-11.

**Files:** `pages/History/{HistoryPage.tsx,page.css,useHistory.ts,ScheduleSection.tsx}`, `components/layout/SidebarHistory.tsx`; tests history/fe-09/sprint1-history-schedules-empty và browser hiện có.

**Interfaces:** Giữ pagination/filter/search/list request từ main; SidebarHistory là phần tóm tắt, HistoryPage là danh sách đầy đủ. Không coi tìm trên 50 tin đã tải là tìm server toàn bộ.

- [ ] Trang giấy Planora có hội thoại, lịch/lượt chạy, bộ lọc/phân trang theo main, empty/loading/error; mở lại đúng `/c/:id`.
- [ ] Thể hiện archive/delete/restore đúng API hiện có; chỉ cung cấp thao tác được main cho phép, không thêm pin/rename khi chưa có contract.
- [ ] Test refresh giữ lựa chọn, GET cũ không ghi lên workspace mới, sidebar đồng bộ sau thao tác, quyền sở hữu và hội thoại không còn truy cập.
- [ ] Kiểm lịch rỗng và pending badge; điều hướng từ run tới plan/hội thoại đúng nguồn.
- [ ] Chạy history/sidebar + SCHED state tests và browser tương ứng.

## PL-13: Tài khoản và quản trị thành viên

**Dependencies:** PL-02, PL-04.

**Files:** `pages/Account/{AccountPage.tsx,page.css,useAccount.ts}`, `pages/Users/{UsersPage.tsx,page.css,useUsers.ts}`; tests auth03/auth05/users/workspace hiện có.

**Interfaces:** Giữ current account/session types, hook actions, organization membership và quyền main; shell nhận current=null hoặc users như hiện tại.

- [ ] Account Planora: hồ sơ, đổi mật khẩu, Google link/unlink, passwordless, phiên hiện tại/các phiên khác và thu hồi.
- [ ] Users Planora: thành viên/yêu cầu đang chờ, vai trò, khóa/mở, mã mời và các action đã có; responsive table/cards.
- [ ] Test admin cá nhân/thành viên tổ chức/admin tổ chức khác nhau; đổi workspace trên trang Users mất quyền phải chuyển/ẩn theo behavior main.
- [ ] Test passwordless không mở unlink nguy hiểm; session revoke hiện tại và session hết hạn trả đúng login/return target.
- [ ] Chạy auth03/auth05, Google account và users/workspace browser regression.

## PL-14: Cẩm nang, chính sách, 404 và trạng thái chung

**Dependencies:** PL-03, PL-08–13.

**Files:** `pages/{Guide,Privacy,NotFound}/*.tsx`, page.css/data của chúng, `views/{NotFoundView,ShellPageView}.tsx`, `components/layout/AppShell.tsx` nếu còn consumer; tests guide/privacy/404 hiện có.

**Interfaces:** Khi signed-in dùng PlanoraShell, khi public dùng PlanoraPublicHeader; nội dung capability/service theo nguồn hiện tại.

- [ ] Thiết kế ba nhóm trang và các notice/loading/empty/error dùng chung. Không thay chính sách lưu dữ liệu/provider bằng copy quảng cáo cũ.
- [ ] Đổi user-facing brand ATI thành Planora trong title/metadata/empty copy nhưng giữ identifier kỹ thuật.
- [ ] Test chưa login/đã login, flag Gmail/Sheets tắt/bật, link sidebar/public và không lộ UI admin qua link trực tiếp.
- [ ] Kiểm 404 cho URL không tồn tại và lỗi truy cập hội thoại trong shell; đúng focus heading.
- [ ] Chạy FE-10, 404/routing browser và kiểm ảnh nội dung dài/mobile/dark.

## PL-15: Cutover, visual QA và gate tích hợp

**Dependencies:** Tất cả PL-01–14.

**Files:** `index.css`, `prototype/usePrototypePage.ts` và các runtime imports chỉ khi không còn consumer; legacy wrapper không dùng; `tests/browser/planora-*.spec.ts`; những test prototype/parity bị thay yêu cầu; `scripts/test-v3-browser.mjs` nếu cần gọi đủ coverage; cập nhật task cards/log và tài liệu Design.

**Interfaces:** Không thay production contract. Các test hành vi hiện tại tiếp tục kiểm cùng ý nghĩa sau migration; chỉ reference hình thức/selectors cần thay được liệt kê rõ.

- [ ] Tìm hết consumer trước khi bỏ prototype CSS/meta injection; app runtime không còn phụ thuộc `:root[data-proto-page]` để có màu/font/shell. Docs/prototypes lịch sử giữ nguyên.
- [ ] Lập bảng từng assertion parity màu cam/layout cockpit được thay bằng mẫu Planora đã duyệt; không bỏ assertions về nội dung, HTTP, quyền và hành vi.
- [ ] Chạy ảnh 22 route entries + 404 và state matrix; core theo mẫu cũ, expanded screens cả hai theme ở 1440/1024/768/375, overflow 320.
- [ ] Chạy `npm run typecheck:v3`, `npm run test -w @wap/chat-web`, `npm run test:eval:v3`, `npm run build:v3`, `node scripts/test-v3-web-build-security.mjs`.
- [ ] Trên PostgreSQL 16 riêng/sandbox, chạy `npm run check` và `npm run test:browser:v3`; xác nhận trực tiếp có chạy Jira/Trello/GitHub/Telegram/provider specs, bổ sung target qua `npm run test:browser:v3 -- <spec-path>` nếu runner mặc định chưa bao gồm.
- [ ] Runner phải trỏ DB/port riêng và override môi trường sandbox rõ ràng trước cả migration/API/web; không dùng DB dev của người dùng hay lấy live credentials từ .env. Không xem lỗi môi trường là fail hành vi RED.
- [ ] Review độc lập trên diff cuối, CI đúng head xanh; so main drift, cập nhật feature inventory; chỉ sau đó mở PR tích hợp vào main.
- [ ] Chủ dự án duyệt hình thức và đầy đủ luồng; merge/deploy là thao tác riêng theo ủy quyền sau đó.

## Thứ tự và bằng chứng

Trục chính: PL-01 → PL-02 → PL-03/04 → PL-05 → PL-06/07 → PL-08/09/10 → PL-11 → PL-12 → PL-14 → PL-15. PL-13 có thể làm sau PL-04 trong phạm vi riêng; mặc định thực hiện tuần tự để tránh nhiều người cùng sửa shell/styles.

Với thay đổi hành vi trình bày (nav/focus/one-composer/callback integration), viết test fail trước rồi chuyển implementation. Với palette/markup không đổi behavior, dùng test hiện có, kiểm ảnh, contrast và build; không viết mock test phản chiếu implementation.

Mỗi task ghi command, SHA, exit code, ảnh và giới hạn thực tế. Test hồi quy chạy theo nhóm thay đổi; full regression chỉ ở điểm tích hợp và khi finding yêu cầu. Không báo “toàn bộ test đạt” từ số liệu cũ.

## Self-review trước giao

- [x] Kiểm inventory/spec đủ 22 routes + 404, 13 moment + trạng thái phụ, 7 connection callback + Google login callback.
- [x] Mỗi nhóm thiếu Planora có task sở hữu; dark/viewport, callback race, workspace race, unknown và digest có nghiệm thu cụ thể.
- [x] Mỗi file tham chiếu hiện có tồn tại; file mới gắn trách nhiệm và interface rõ ràng.
- [x] Đã đối chiếu builder-check và giải quyết câu hỏi quan trọng.
- [x] Chưa sửa product code, chạy migration, bật flag, sửa CURRENT-STATE/ROADMAP hoặc merge PR cũ.
