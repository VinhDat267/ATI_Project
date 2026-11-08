# Planora UI Migration Implementation Plan

> **For agentic workers:** Implement assigned tasks through Antigravity/Gemini using the task prompts linked below. Each worker follows superpowers:executing-plans for its own task; Gemini 4 Argon (High) in Antigravity performs independent task and final reviews under the local reviewer policy effective 05/11/2026. This revision updates the approved migration direction; execution and acceptance remain tied to the assigned task, current source and user authorization.

**Goal:** Thiết kế mới toàn bộ UI/UX từ công việc và quyết định của người dùng, nội dung business-first, tự do sáng tạo theo nhận diện Planora; bảo toàn đầy đủ chức năng main và refactor mọi phần đã làm nếu không đạt tiêu chí mới.

**Architecture:** Thiết kế từ user journey → information hierarchy/copy → layout và tương tác → typed presentation mapping vào chức năng main. Có thể viết lại composition, markup, CSS và props nội bộ frontend; không dùng component tree, CockpitMoment, schema hoặc graph hiện tại làm wireframe. Giữ behavior/domain/API, quyền, auth, isolation, approval/binding và recovery bằng regression; các file/hook hiện có là nguồn hợp đồng, không là chuẩn UX. Không merge nguyên nhánh Frontend_UXUI.

**Tech Stack:** React 19, TypeScript, Vite, Tailwind/CSS hiện tại, Zustand, SSE, Vitest/Testing Library, Playwright; PostgreSQL 16 riêng cho nghiệm thu.

**Spec hiện hành:** [Planora business-first UX — 05/11/2026](../specs/2026-11-05-planora-business-first-ux.md). [Spec gốc và inventory](../specs/2026-11-02-planora-migration-design.md) cùng revision main bổ sung phạm vi chức năng; chỉ dẫn giữ layout/port markup cũ trái spec UX mới hết hiệu lực.

**Status:** Bản gốc 02/11/2026, cập nhật phạm vi 04/11 và **định hướng business-first UX ngày 05/11/2026** theo yêu cầu chủ dự án. Baseline chức năng mới: **`cb069061e53776c967ef13e887d7c2adae578716`**. Mốc `1977ec7` chỉ là khảo sát lịch sử; source thị giác vẫn `Frontend_UXUI@ef13c56`. Trạng thái triển khai/review lấy từ card/run và head thực tế, không suy từ checkbox tài liệu.

**Revision bắt buộc:** [Main sync và inventory 04/11](../../handoff/PLANORA-MAIN-SYNC-2026-11-04.md) cập nhật Slack, Notion, Jira business v2 và Schedules default-on; đọc cùng plan này trước khi nhận task còn lại.

**Execution roles (03/11/2026):** Theo lựa chọn của chủ dự án, Antigravity/Gemini thi công và **Codex review**. [Bộ prompt điều phối, PL-01–15 và review](../../handoff/planora-prompts/README.md) ghi rõ phạm vi, dependency và packet bàn giao. Việc soạn prompt không khởi chạy agent hoặc thay trạng thái duyệt thiết kế.

**Reviewer hiện hành (05/11/2026):** Chủ dự án chuyển review từng task và toàn nhánh sang **Gemini 4 Argon (High) trong Antigravity**, model `gemini-4-argon-high`. Đọc [reviewer policy](../../handoff/planora-prompts/REVIEWER-POLICY.md); các gate ghi Codex bên dưới được thực hiện bởi Argon từ revision này. Giữ báo cáo/findings Codex lịch sử, không xóa gate CI/bằng chứng/duyệt hình thức.

**Quyết định UX mới 05/11/2026:** không dựa cấu trúc UI/UX hiện tại để refactor; agent tự do thiết kế theo Planora từ góc nhìn người dùng. Nội dung trang phải business-first. **Mọi phần đã thực hiện đều phải audit; phần không đạt phải thiết kế/refactor lại** dù từng review kỹ thuật Đạt. Xem [PLANORA-UX-01](../../handoff/tasks/PLANORA-UX-01-business-first-redesign.md).

## Global Constraints

- Planora là nguồn nhận diện/tinh thần sidebar và hội thoại; tự thiết kế cấu trúc/tương tác phù hợp công việc. 248px/1024px và kích thước card cũ là tham chiếu, không là tiêu chí pass. Không dùng cấu trúc UI hiện tại làm khuôn; luồng hội thoại vẫn có một nơi nhập yêu cầu chính.
- Business-first: mỗi màn có mục đích, nội dung giúp quyết định, CTA chính và bước tiếp theo. Không đưa tool names, JSON/raw payload, UUID/hash, endpoint, enum/callback/engine-step labels lên trang nghiệp vụ; giữ chúng trong logic/evidence kỹ thuật. Tên tài nguyên/mã công việc quen thuộc chỉ hiện khi cần cho quyết định.
- Baseline 04/11 có **25 route entries + 404, 10 callback view, 13 trạng thái selectMoment** và trạng thái phụ Slack/Jira mới; bảo toàn inventory hiện hành, không khôi phục query router/App/store/API cũ. Các số 22/8 ở khảo sát cũ chỉ là lịch sử.
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

- Nhánh tích hợp `codex/planora-ui` cần qua **gate đồng bộ main** trong [revision 04/11](../../handoff/PLANORA-MAIN-SYNC-2026-11-04.md#5-cách-coordinator-áp-dụng-vào-run-đang-có) trước task tiếp theo. Dùng nhánh/worktree sync riêng, không đổi base của worker đang chạy.
- Bộ prompt/điều phối giữ local theo yêu cầu chủ dự án; trước PR sản phẩm kiểm diff và toàn bộ lịch sử để loại private prompt ancestors.
- Mỗi PL-xx là một task card/nhánh/PR vào nhánh tích hợp; không phát hành giao diện chuyển dở sang main. Chỉ merge mỗi task khi kiểm tương ứng và CI xanh.
- PR cuối đưa nhánh tích hợp vào main sau regression đầy đủ, đối chiếu diff với main mới nhất và review độc lập.
- Mỗi task điền Kết quả và thêm log mới. Không cập nhật CURRENT-STATE/ROADMAP trong task frontend; reviewer ghi sau merge.
- Nếu một feature PR mới merge trong lúc thi công, cập nhật inventory và bổ sung test vào task sở hữu trước khi tiếp tục.
- Không thay đổi/đóng PR #262 trong nhiệm vụ lập kế hoạch này.

## Gate UX mới và đánh giá lại phần đã thực hiện

- [ ] Thực hiện [PLANORA-UX-01](../../handoff/tasks/PLANORA-UX-01-business-first-redesign.md) trên các head thật: audit mọi phần đã có, bao gồm PL-01–07; không sửa review log/nhãn completed cũ hoặc tự kết luận fail khi chưa kiểm.
- [ ] Từ audit lập brief/copy/layout mới, chốt mẫu đại diện với chủ dự án, giao phần refactor cho PL owner và Argon re-review trên head mới. Tính năng/test đạt nhưng UX chưa đạt thì chưa nghiệm thu theo revision này.
- [ ] Mỗi task mới hoặc phần làm lại phải có outcome/CTA/information hierarchy, screenshots, hành trình sử dụng và evidence behavior. Không dùng số component tái sử dụng/đổi mới hay pixel parity làm chỉ số hoàn thành.

## Bản đồ file và trách nhiệm

Các path/class/component dưới đây chỉ xác định nơi đọc contract và ownership ban đầu. Agent được thiết kế composition/props/layout mới trong frontend theo brief; coordinator cập nhật file ownership/test khi tách hoặc thay renderer. Không coi danh sách này là yêu cầu giữ cây UI, thứ tự panel, sidebar width hay card anatomy cũ.

| Phạm vi | File hiện tại cần giữ logic | File/lớp trình bày dự kiến |
| --- | --- | --- |
| Nền | index.css, hooks/use-theme.ts, main.tsx | planora/styles/*.css; planora/components/{Brand,Button,Field,StatusBadge}.tsx |
| Shell | components/layout/{MainNav,UserNavMenu,WorkspaceSwitcher,SidebarHistory}.tsx | planora/layout/{PlanoraShell,PlanoraSidebar,PlanoraPublicHeader}.tsx |
| Public/auth | pages/Landing; views/{LoginPage,SignupView,VerifyEmailView,ForgotPasswordView,ResetPasswordView,GoogleCallbackView,AuthFormFrame}; pages/AuthAction | planora/layout/PlanoraAuthFrame.tsx, public assets; các page/view hiện tại được đổi trình bày |
| Chat | components/Workspace.tsx; hooks/*; chat-store; services/cockpit-moment.ts | planora/workspace/{PlanoraChatWorkspace,PlanoraActiveTurn,PlanoraConversationFeed}.tsx |
| Plan/run/result | pages/Cockpit/{PlanMoment,ExecutionMoment,ReceiptMoment,PreviewContents,GmailPreview,PreviewModal}; WorkflowFlowCanvas | typed task/decision/result views mới theo brief; PlanoraWorkflowSteps chỉ là path triển khai hiện có cần audit |
| Recovery/response | RecoveryMoment/Editor, ScheduleRunRecovery, pages/Responses và Errors | các card hiện tại, bỏ wrapper cockpit riêng |
| Connections | pages/Settings/*.tsx; views/*CallbackView.tsx; services/*-connection.ts | khung kết nối và luồng chọn tài nguyên mới theo công việc; callback handlers giữ nội bộ |
| Slack automation/inbox | components/slack/{SlackAutomationSettings,SlackProposalInbox,SlackProposalCard}.tsx; services/slack-assistant.ts | PL-09 đổi panel/card/inbox; PL-02 nối sidebar /inbox |
| Slack read/write | components/SlackReadResult.tsx; pages/Cockpit/SlackReadControls.tsx; services/slack-read-refresh.ts | PL-06/07 đổi trình bày, giữ consent/source/expiry và refresh contract |
| Nhật ký/lịch | pages/History; ScheduleMoment/Actions/RunRecovery; hooks/use-schedules | các page/card hiện có trong shell |
| Account/admin/help | pages/{Account,Users,Guide,Privacy,NotFound} | các page hiện tại trong shell hoặc public header |

Không chuyển file logic chỉ để đặt vào thư mục Planora. Nếu cần tách file rất dài (AuthAction/JiraConnection), tách theo UI panel và giữ hook/handler/type hiện hành; giới hạn trong task của chính màn đó.

## PL-01: Chốt baseline, design tokens và component nền

**Mục tiêu UX theo quyết định 05/11:** Tạo design brief và mẫu trải nghiệm công việc theo nhận diện Planora; mẫu không dựa vào cây component/markup hiện tại. Bốn mẫu gồm hiểu giá trị sản phẩm, hội thoại có quyết định công việc, kết nối dịch vụ và lịch/bản tin. Rà lại tokens/contrast/components đã làm; màu đúng chưa đủ đạt UX. Phần đã làm phải audit; nếu không đạt, sửa lại rồi review trên head mới.

**Deliverable:** Bộ nền Planora dùng được và bộ mẫu tham chiếu đủ để duyệt hình thức trước khi đổi hàng loạt.

**Files:** tạo `apps/chat-web/src/planora/styles/{tokens,base,components}.css`, `planora/components/{Brand,Button,Field,StatusBadge}.tsx`; sửa `apps/chat-web/src/index.css`, `apps/chat-web/index.html`, `apps/chat-web/DESIGN.md`, `DESIGN.md`; copy có chọn lọc `public/fonts`, favicon/logo từ ef13c56. Task card/log riêng khi thi công.

**Interfaces:** CSS `--planora-*` cho canvas/paper/sidebar/text/muted/divider/primary và status; wrappers dùng props native HTML của button/input cùng children/variant, không bọc API logic.

- [ ] Khóa SHA main, đọc diff mới từ mốc khảo sát; dựng baseline browser riêng và chụp main + mẫu Planora ở 1440×900/375×812.
- [ ] Tạo bốn mẫu cần duyệt: landing, chat có plan, Settings có OAuth/scope, Nhật ký có lịch. Mẫu chưa nối backend phải gắn nhãn demo.
- [ ] Đưa light tokens đúng spec; dark tokens theo đề xuất trong spec, đo contrast, kiểm font license/loading và reduced motion. Đây là đổi trình bày: dùng kiểm ảnh/contrast/build, không viết unit test chỉ so hằng số màu với chính code.
- [ ] Cập nhật design authority để yêu cầu Planora mới thay phần thị giác Agentic; ghi rõ nghiệp vụ vẫn theo v3 + các spec feature hiện hành. Giữ tài liệu prototype lịch sử.
- [ ] Kiểm `npm run build:v3`, ảnh 320/375/768/1024/1440 và sáng/tối; duyệt bộ mẫu trước PL-03 trở đi.

## PL-02: Shell, sidebar và không gian cá nhân/tổ chức

**Mục tiêu UX theo quyết định 05/11:** Giúp người dùng biết đang ở nhóm/không gian nào và tìm được việc cần xử lý, hội thoại cũ, lịch, kết nối và tài khoản. Tự thiết kế hierarchy/nav/search/mobile theo công việc; sidebar Planora là hướng tham chiếu, không khóa kích thước/DOM cũ. Badge chỉ là số việc có ý nghĩa và có dữ liệu thật. Phần đã làm phải audit; nếu không đạt, sửa lại rồi review trên head mới.

**Dependencies:** PL-01.

**Files:** tạo `planora/layout/{PlanoraShell,PlanoraSidebar,PlanoraPublicHeader}.tsx`, `planora/styles/shell.css`; sửa `App.tsx`, `components/layout/{MainNav,WorkspaceSwitcher,SidebarHistory,UserNavMenu}.tsx`; test `tests/planora-shell.test.tsx`, `tests/browser/planora-shell.spec.ts`.

**Interfaces:** Shell/navigation tiêu thụ user/workspace, quyền, danh sách hội thoại và navigation actions thật; props nội bộ được thiết kế lại theo UX mới. Giữ route/deep-link/focus và một main/h1/nav phù hợp accessibility; không bắt sao chép SidebarHistory DOM hoặc signature shell cũ.

- [ ] Viết/chạy fail ca chuyển Settings→History, link mở tab mới, admin tổ chức khác user.role, badge pending lịch/người dùng và workspace picker trên mobile.
- [ ] Thiết kế điều hướng Planora theo việc người dùng cần tìm, đặt ngữ cảnh nhóm/cá nhân và việc cần xử lý rõ ràng. Bố trí workspace picker theo UX mới, giữ tạo/join/pending/disabled và ngữ nghĩa giữ trang khi đổi workspace.
- [ ] Test đổi workspace khi request trễ bằng deferred response thật trong component harness; kết quả A không xuất hiện ở B. Test trên browser/PostgreSQL cho isolation theo main.
- [ ] Ở breakpoint do thiết kế nội dung quyết định: kiểm drawer Escape/backdrop/focus restore/khóa nền và dialog create/join đúng tầng; chỉ có một nav hiện hành cho screen reader. Kiểm cả 320/375/768/1024/1440, không cố giữ breakpoint chỉ vì CSS cũ.
- [ ] Chạy web tests liên quan và nhóm browser workspace/admin hiện có; lưu ảnh cả hai theme.

**Bổ sung từ main 04/11/2026:**

- [ ] Sau sync main, thêm `/inbox`/NavTab inbox và badge thật vào sidebar; kiểm deep-link, mobile drawer, member/admin và không tạo shell/nav thứ hai cho SlackProposalInbox.


## PL-03: Landing, đăng nhập và đăng ký

**Mục tiêu UX theo quyết định 05/11:** Landing nói lợi ích và ví dụ công việc bằng nội dung thật; login/signup tập trung vào vào làm việc, không bắt người dùng hiểu nền tảng/kỹ thuật. Tự sáng tạo hero/luồng/nội dung theo Planora, không port nguyên hero hiện tại hoặc ép sao chép ảnh cũ. Phần đã làm phải audit; nếu không đạt, sửa lại rồi review trên head mới.

**Dependencies:** PL-01, PL-02.

**Files:** `pages/Landing/{LandingPage.tsx,page.css}`, `views/{LandingView,LoginPage,SignupView,AuthFormFrame}.tsx`, `components/GoogleAuthButton.tsx`; tạo `planora/layout/PlanoraAuthFrame.tsx`; tests `fe-08-landing-auth`, `auth-02-signup-reset` hiện có và `tests/browser/planora-public.spec.ts`.

**Interfaces:** Giữ ý nghĩa submit/auth actions, config/capabilities, return target và quyền từ main. Public/auth props và composition được thiết kế lại nếu cần qua typed mapping; frame không gọi API chỉ vì render.

- [ ] Sáng tạo hero/illustration/footer và luồng vào sản phẩm theo Planora, nói lợi ích công việc và CTA rõ. Không port DOM hero/cockpit hiện tại; ví dụ có nhãn và capability đúng thực tế.
- [ ] Dùng controller login/signup hiện tại: Google có điều kiện, vào không gian cá nhân/tổ chức, tạo/join theo flow main, return target và pending approval.
- [ ] Giữ form password validation, disabled/busy/error; không copy điều kiện cloud ngày 05/10 từ docs cũ làm feature flags.
- [ ] Chạy các browser auth/public hiện có; kiểm direct link `/c/:id` qua login, session đã có và signup bị tắt.
- [ ] Kiểm nhận diện theo tham chiếu Planora và hierarchy/copy/CTA theo brief mới, mobile và reduced motion; không lấy pixel parity ảnh cũ làm gate UX.

## PL-04: Xác thực nâng cao và vòng đời tài khoản

**Mục tiêu UX theo quyết định 05/11:** Giúp truy cập lại tài khoản: nói cần làm gì, gửi tới đâu, đã xong chưa và bước kế tiếp. Thiết kế lại phân nhóm/thứ tự/feedback theo tình huống người dùng; không hiển thị AuthAction mode/token/callback/internal errors, vẫn giữ xử lý auth đúng contract. Phần đã làm phải audit; nếu không đạt, sửa lại rồi review trên head mới.

**Dependencies:** PL-03.

**Files:** `views/{VerifyEmailView,ForgotPasswordView,ResetPasswordView,GoogleCallbackView}.tsx`; `pages/AuthAction/{AuthActionPage.tsx,page.css}`; `components/AuthGate.tsx` chỉ phần trình bày; tests auth02/auth04/auth-return hiện có.

**Interfaces:** Bao phủ mọi tình huống AuthAction hiện có và mới theo baseline; enum/API auth-return-target/callback giữ contract. UI props/composition được thiết kế lại, không render tên mode nội bộ cho người dùng.

- [ ] Thiết kế Planora cho resend, forgot/reset, expired/used token, reset success, Google pending/ready/error, pending/locked/attempts/unverified và loading.
- [ ] Rerun behavior tests hiện tại; thêm test có ý nghĩa nếu wrapper mới làm thay đổi focus/submit/routing. Không viết lại validation bằng rule khác.
- [ ] Ca bắt buộc: callback reload/StrictMode chỉ xử lý một lần; link token bị gỡ khỏi URL đúng như main; đổi user/session trong lúc callback không đưa về hội thoại người khác.
- [ ] Kiểm login lỗi/mất phiên trên mobile, timer cooldown bằng clock control và điều kiện render thay vì sleep mù.
- [ ] Chạy nhóm browser auth02/auth04 và auth deep link/return của main.

**Bổ sung từ main 04/11/2026:**

- [ ] Sau sync main, revalidate Google callback/return-target và auth regression trên head mới; browser auth02/auth04 phải thực chạy, không lọc bỏ ca lỗi locator. Review head cũ không chứng nhận cây sync.


## PL-05: Feed hội thoại Planora và một composer

**Mục tiêu UX theo quyết định 05/11:** Thiết kế cuộc hội thoại như nơi giao việc và theo dõi việc: yêu cầu, thông tin còn thiếu, quyết định hiện hành và kết quả. Không biến mỗi CockpitMoment thành một khối bắt buộc; tự quyết bố cục/density/composition, một composer và một vùng hành động hiện hành, giữ history/IME/race guards. Phần đã làm phải audit; nếu không đạt, sửa lại rồi review trên head mới.

**Dependencies:** PL-02, PL-04.

**Files:** tạo `planora/workspace/{PlanoraChatWorkspace,PlanoraActiveTurn,PlanoraConversationFeed}.tsx`; sửa `components/{Workspace,Cockpit}.tsx`, `pages/Cockpit/{ChatComposer,ConversationDrawer,SavedConversation}.tsx`; tests `tests/planora-chat.test.tsx`, `tests/browser/planora-chat.spec.ts`, regression conversation hiện có.

**Interfaces:** Typed presentation model nhận messages, current work/action, snapshot và callbacks từ controller hiện có; không bắt props kế thừa Cockpit hoặc mỗi moment thành một card. Có thể viết adapter UI thuần và thay renderers/composition. Giữ priority nghiệp vụ, đúng plan/run/proposal và stale guards; view không tạo API side effects chỉ để render.

- [ ] Viết/chạy fail ca một textbox/one send (IME không submit), feed đọc được toàn bộ hội thoại, mở lại hội thoại đã lưu, đổi hội thoại không lẫn state.
- [ ] Thiết kế feed/điểm quyết định mới từ brief công việc; nối typed mapping vào handlers/hooks thật và giữ ý nghĩa race guards. Được thay composition/props/render tree frontend; kiểm dữ liệu/thao tác không trùng và không dựa wireframe cockpit cũ.
- [ ] Render active card đúng một lần; tin lịch sử có nhãn, timestamp và nguồn scheduled run thật; preview lịch sử không còn nút duyệt hoạt động.
- [ ] Test GET lịch sử cũ về sau SSE mới, SSE trùng, plan bị reject/settled, late plan, current plan khác execution snapshot; không làm sống lại hành động cũ.
- [ ] Test auto-scroll gần cuối; người đang đọc cũ giữ vị trí; prefill chỉ điền draft, đóng dialog không gửi; layout một composer ở mọi active state.
- [ ] Chạy FE-02/03b/05 regression, SCHED-03 state/history và mở lại saved conversation.

**Bổ sung từ main 04/11/2026:**

- [ ] Bảo toàn wiring Slack/Jira mới trong App/Workspace/Cockpit, hooks GET/SSE/recovery, types và conversation read guards sau sync; kiểm một composer và stale user/workspace/connection.


## PL-06: Kế hoạch, thực thi, preview và biên nhận

**Mục tiêu UX theo quyết định 05/11:** Thiết kế màn duyệt theo tác động: việc sẽ làm, nội dung, nguồn, người/nơi nhận và cách sửa; tiến độ theo việc đang diễn ra, kết quả theo thứ đã hoàn thành. Không ép chuỗi step cards/graph theo engine, không đưa tool name/dependsOn/JSON/hash/UUID lên UI. Các quan hệ cần cho quyết định được diễn đạt bằng ngôn ngữ công việc; typed adapter bảo toàn binding và hành vi. Phần đã làm phải audit; nếu không đạt, sửa lại rồi review trên head mới.

**Dependencies:** PL-05.

**Files:** tạo `planora/workspace/PlanoraWorkflowSteps.tsx`; sửa `components/WorkflowFlowCanvas.tsx`, `pages/Cockpit/{PlanMoment,ExecutionMoment,ReceiptMoment,PreviewContents,GmailPreview,PreviewModal}.tsx`; tests readable-workflows/plan/preview/receipt/flow hiện có.

**Interfaces:** Thiết kế view-model theo quyết định của người dùng: mục đích, nội dung cần duyệt, nguồn/đích/tác động, tiến độ và kết quả. Dùng helper phân giải dữ liệu/quyền thật nhưng không bắt dùng WorkflowFlowCanvasProps/graph hoặc fixed step-card UI; mapping mới giữ actions/binding và các trường hợp preview/execution/receipt/schedule nghiệp vụ.

- [ ] Tự thiết kế cách duyệt/theo dõi công việc theo Planora: người dùng hiểu việc sẽ xảy ra, tác động và lựa chọn. Không ép chuỗi step cards/graph theo engine; chỉ diễn đạt thứ tự/phụ thuộc có ích cho quyết định bằng ngôn ngữ công việc. dependsOn/data-flow tiếp tục đúng trong nội bộ.
- [ ] Đổi plan action bar/approval và progress/receipt; giữ busy locking, hash, nguồn đích, danh tính provider, retryable status và safe result links.
- [ ] Preview bằng nội dung nghiệp vụ: thư có người nhận/tiêu đề/nội dung, công việc có dự án/người phụ trách, bảng tính có giá trị/vùng dữ liệu liên quan. Không hiện JSON/raw payload/UUID/hash hoặc field dump; mapping vẫn dùng dữ liệu thật, bảng cuộn trong vùng phù hợp không làm page rộng ra.
- [ ] Test double approve/cancel pending, stale plan/scope đổi, execution thuộc plan trước, preview không thực thi, server từ chối được hiển thị đúng.
- [ ] Chạy nhóm FE-03/05 + Gmail/Sheets/GitHub/Trello/Telegram/Jira preview regression liên quan; ảnh 320/375/1440 cả hai theme.

**Bổ sung từ main 04/11/2026:**

- [ ] Thiết kế mới trải nghiệm kết quả/tiến độ, đọc behavior trong `components/{SlackReadResult,ExecutionProgress}.tsx` và `pages/Cockpit/SlackReadControls.tsx`; giữ source provenance/expiry/refresh, private/DM permissions và read/write scope controls. Giữ Jira 9-tool preview, issue/site/project/status và receipt links; chạy `slack-read`, `slack-write`, `jira-business-v2` browser specs cùng regression.


## PL-07: Trả lời, hỏi lại, lỗi và phục hồi

**Mục tiêu UX theo quyết định 05/11:** Nói rõ việc đang vướng, ảnh hưởng và hành động an toàn tiếp theo bằng tiếng Việt; hỏi đúng thông tin người dùng còn thiếu, prefill không tự gửi. Không dùng moment 7/8/9, enum/status kỹ thuật hay stacktrace làm nhãn. Unknown phải diễn đạt chưa xác nhận, không khuyến khích retry ghi khi chưa an toàn. Phần đã làm phải audit; nếu không đạt, sửa lại rồi review trên head mới.

**Dependencies:** PL-05, PL-06.

**Files:** `pages/Responses/{ResponseMoment.tsx,page.css}`, `pages/Errors/{PlanningErrors.tsx,page.css}`, `pages/Cockpit/{ClarificationMoment,RequestMoments,RecoveryMoment,RecoveryEditor,RequestEcho}.tsx`, `components/CockpitDialog.tsx`; tests answer/refusal/clarification/recovery hiện có.

**Interfaces:** Dùng recoveryActions/quyền và state priority từ main, ánh xạ sang vấn đề/tác động/hành động người dùng hiểu được. Có thể thay UI props/composition/flows phụ trong frontend; không buộc giữ RecoveryControls DOM hay wrapper cũ, không đổi điều kiện an toàn của thao tác.

- [ ] Thiết kế card answer có nguồn; hỏi lại tài nguyên; từ chối/thiếu kết nối/thiếu phạm vi; chờ lâu/planning error/offline/auth error.
- [ ] Thiết kế thông báo theo việc bị ảnh hưởng, điều đã biết và lựa chọn an toàn; failure/unknown/reconciliation/restart là dữ liệu nội bộ, không dùng mã moment/enum làm nhãn UI. Không che sự chưa chắc chắn hoặc biến thành lỗi có thể retry tùy ý.
- [ ] Test unknown không hiện Retry; Stop có xác nhận; Escape chỉ đóng dialog; lỗi handler không giả thành success; edit recovery chỉ gửi yêu cầu mới khi Stop đúng plan thành công.
- [ ] Test connect-from-chat quay về đúng hội thoại và nút Gửi lại chỉ gửi khi bấm; không tự submit sau OAuth.
- [ ] Chạy FE-06A/B, answer và clarification browser scenarios; ảnh phục hồi ở mobile/dark.

**Bổ sung từ main 04/11/2026:**

- [ ] Giữ nhãn recovery/refusal mới cho Slack/Notion/Jira, reconnect/denied/consent/stale binding; refresh nguồn đọc không biến thành resend ghi. Đổi account/workspace/connection không làm lộ kết quả cũ.


## PL-08: Kết nối chung, Gmail, Google Calendar và Google Sheets

**Mục tiêu UX theo quyết định 05/11:** Thiết kế kết nối theo lợi ích công việc và mức sẵn sàng: chọn tài khoản/lịch/bảng dễ hiểu, giải thích quyền cần thiết, xác nhận đã sẵn sàng. Không dựng form theo schema/API hoặc đưa OAuth/scope/callback vào copy; dùng tên tài nguyên và preview hữu ích. Phần đã làm phải audit; nếu không đạt, sửa lại rồi review trên head mới.

**Dependencies:** PL-02, PL-04, PL-07.

**Files:** `pages/Settings/{SettingsPage,PersonalGmail,PersonalMyCalendar,PersonalMySheets}.tsx`, `useSettings.ts` chỉ phần nối UI nếu cần; `views/{GmailCallbackView,MyCalendarCallbackView,MySheetsCallbackView}.tsx`; tạo `planora/layout/ConnectionCallbackFrame.tsx`; tests gmail/mycalendar/mysheets hiện có.

**Interfaces:** Frame/panels được thiết kế theo ngữ cảnh kết nối của người dùng, không tiêu thụ OAuth state khi render. Service UI props được thiết kế lại qua typed mapping; helper/API/returnTo và auth handlers giữ ý nghĩa hiện tại.

- [ ] Dựng Settings Planora: nhóm cá nhân/tổ chức, trạng thái kết nối/phạm vi/quyền thật; số lượng từ danh sách thực, không hardcode “8 dịch vụ”.
- [ ] Thiết kế đủ connect/disconnect, expired/reconnect, chọn lịch, Google Picker/đã chọn spreadsheets và viewer permission. UI Google Picker do Google sở hữu không nằm trong yêu cầu skin.
- [ ] Giữ anchors `#gmail`, `#mycalendar`, `#mysheets` và các anchor scope hiện có; callback/error/selection dùng frame chung nhưng giữ state machine riêng.
- [ ] Test flag off/thiếu cấu hình/denied/scope_required và reconnect; workspace/user đổi giữa callback; request retry không tiêu thụ code lần nữa.
- [ ] Chạy browser scenarios gmail/mycalendar/mysheets + Settings; API thật trong sandbox/PostgreSQL riêng.

**Bổ sung từ main 04/11/2026:**

- [ ] Giữ Settings registrations/anchor cho Slack và Notion từ main; frame chung tương thích đủ 9 connection callbacks. Chốt ownership container/frame trước PL-09 và PL-10, không để worker provider ghi đè Settings/useSettings lẫn nhau.


## PL-09: Trello, GitHub, Telegram, Notion và Slack

**Mục tiêu UX theo quyết định 05/11:** Trello/GitHub/Telegram/Notion/Slack được trình bày theo công việc có thể làm; chỉ hỏi tài nguyên/giới hạn mà người dùng cần quyết định. Inbox ưu tiên việc cần xử lý và quyết định tiếp theo, automation diễn đạt quy tắc bằng ngôn ngữ nhóm làm việc, không phơi rule JSON/budget fields rời rạc. Giữ consent và mọi giới hạn thật; không auto-approve hoặc hứa tự động hóa chưa có. Phần đã làm phải audit; nếu không đạt, sửa lại rồi review trên head mới.

**Dependencies:** PL-08.

**Files:** `pages/Settings/{TrelloConnection,GitHubConnection,TelegramConnection,NotionConnection,PersonalSlack}.tsx`, `views/{TrelloCallbackView,GitHubCallbackView,TelegramCallbackView,NotionCallbackView,SlackCallbackView}.tsx`, `components/slack/{SlackAutomationSettings,SlackProposalInbox,SlackProposalCard}.tsx`; các service connection giữ nguyên logic; tests trello/github/telegram hiện có.

**Interfaces:** Giữ ranh giới OAuth cá nhân và scope nhóm; consume Frame từ PL-08. Không gộp polling Telegram thành redirect OAuth thông thường.

- [ ] Port card provider và scope selector Planora; Trello workspace/board membership, GitHub repos và Telegram chat/group hiển thị đúng tên.
- [ ] Giữ CTA admin/member khác nhau; scope_required có đường sửa scope, không thay bằng kết nối lại vô nghĩa.
- [ ] Telegram có pairing đang chờ, deep link cá nhân/nhóm, timeout/hết hạn, poll và chọn chat; disconnect/cancel không báo gửi thành công.
- [ ] Test đổi workspace khi load board/repo/chat, permission denied, callback đổi user và quay về chat/settings đúng anchor.
- [ ] Chạy trực tiếp browser spec trello-oauth, github-oauth-and-digest và telegram-oauth-and-digest theo fixture hiện có; không giả định default scenario runner đã gọi đủ file.

**Bổ sung từ main 04/11/2026:**

- [ ] Card chia nghiệm thu tuần tự **09a** Trello/GitHub/Telegram, **09b** Notion connection + callback + 1–10 database/multi-connection/needs_scope/reconnect, **09c** Slack OAuth/F1 consent + automation rules/AI/hybrid + proposal inbox `/inbox`. Giữ một task PL-09 trong DAG; mỗi phần có bằng chứng riêng.
- [ ] Slack inbox giữ connection picker, status filters, proposal/digest actions, pending locking và source/expiry; không auto-approve/execute. Kiểm nhiều workspace/missingScopes/revoke chưa xác nhận. Notion giữ cả callback alias notion/mynotion và API permission checks.
- [ ] Chạy `slack-{oauth,assistant,read,write}.spec.ts`, các unit Slack và `notion-connection.test.tsx`; bổ sung `tests/browser/planora-notion.spec.ts` cho callback/scope/stale connection vì baseline chưa có browser Notion riêng. Danh sách đầy đủ trong revision 04/11.


## PL-10: Jira workspace, site/project và yêu cầu quyền

**Mục tiêu UX theo quyết định 05/11:** Thiết kế Jira theo nhu cầu làm việc với nhóm/dự án: chọn kết nối, tham gia/tạo nhóm, xin quyền và chọn dự án dễ hiểu. Không port nguyên panel capability hoặc trưng “9 tools/3LO/siteId”; tên site/project/issue key chỉ hiện khi giúp nhận diện công việc. Thứ tự setup và feedback được thiết kế mới theo vai trò. Phần đã làm phải audit; nếu không đạt, sửa lại rồi review trên head mới.

**Dependencies:** PL-08, PL-02.

**Files:** `pages/Settings/JiraConnection.tsx`, `views/JiraCallbackView.tsx`; có thể tách các UI panel vào `pages/Settings/jira/`; giữ `services/jira-api.ts`, `jira-connection.ts`; tests `jira-09a*` và browser/jira-09a.spec.ts.

**Interfaces:** Giữ JiraConnectionProps, selectedWorkspace, API response/error, membership và capability của baseline `cb069061`. JIRA-08/09B/10/11 và Jira business-ready v2 đã merge (#268–272): bảo toàn self-service workspace, 9 tools và luồng Settings/Cockpit/Guide theo ownership; không giới hạn về JIRA-09A.

- [ ] Đổi đúng từng panel: account identity, workspace list/create/join, site/project, pending request/admin approval/capability notice theo code đã có.
- [ ] Giữ contract role của workspace Jira riêng; không suy ra từ global user.role hoặc chỉ từ workspace chung của sidebar.
- [ ] Kiểm race của request/status khi đổi lựa chọn/nhân vật; denial/reconnect/expired/empty/offline đúng thông báo main.
- [ ] Chạy Jira UI unit tests và browser spec trực tiếp; đối chiếu các regression của JIRA-09A đã sửa, không bỏ assertion lỗi/quyền để đổi layout.
- [ ] Ghi riêng mọi UI bổ sung do Jira PR khác vừa merge; cần cập nhật inventory trước khi đóng task.

**Bổ sung từ main 04/11/2026:**

- [ ] Bao phủ đầy đủ Jira business v2 theo UX mới: self-service create/join, membership/admin approval, personal OAuth, capabilities và site/project; không suy quyền Jira từ global role. Đối chiếu `jira-business-v2.spec.ts` cùng `jira-09a.spec.ts`, unit Jira API/callback/Cockpit/responsive; preview/recovery và digest do PL-06/07/11 sở hữu.


## PL-11: Lịch chạy và bản tin tự động

**Mục tiêu UX theo quyết định 05/11:** Thiết kế tạo lịch/bản tin như một câu công việc: gửi gì, từ đâu, cho ai, khi nào và lần tiếp theo. Phân biệt “Duyệt trước mỗi lần chạy” với “Tự gửi theo lịch”; không đưa auto_digest/config hash/delivery enum lên trang. Trạng thái bất định và lý do tạm dừng phải có ý nghĩa/hành động thật. Phần đã làm phải audit; nếu không đạt, sửa lại rồi review trên head mới.

**Dependencies:** PL-05–10.

**Files:** `pages/Cockpit/{ScheduleMoment,ScheduleActions,ScheduleRunRecovery}.tsx`, `pages/History/ScheduleSection.tsx`; giữ `hooks/use-schedules.ts`, schedule-text và conversation-messages; tests sched-03/Calendar delivery/provider digest hiện có.

**Interfaces:** Giữ ScheduleView/ScheduleRunView/ScheduleApprovalMode từ tool-schemas, snapshot và config hash; không tự dựng eligibility của auto_digest từ logo/provider name.

- [ ] Card chat create/update/pause/resume/cancel; giờ/múi giờ/tần suất/nguồn/đích/lần kế tiếp rõ ràng. Một lần xác nhận chỉ tác động đúng proposal.
- [ ] Manual và auto_digest có copy khác nhau: chờ duyệt mỗi lượt hoặc chấp thuận cấu hình gửi tự động. Chế độ chỉ xuất hiện nếu API hiện tại cho phép.
- [ ] Lượt chạy: pending/running/discarded/failed/completed/digest_sent/digest_failed/needs_attention và các giá trị enum thực tế khác được render đầy đủ.
- [ ] Test proposal stale/409, config/scope đổi, double confirm, reload/SSE, pause/cancel trong khi chạy và delivery đã bắt đầu; UI không tự replan/resend unknown.
- [ ] Chạy schedule scenario, sched-03-calendar-delivery và các digest provider spec trực tiếp; kiểm **default-on** khi env không đặt `SCHEDULES_ENABLED`, và explicit `off` trong sandbox riêng. Khôi phục env test, không đổi production flags. SCHED-04 default-on không tự chứng nhận provider live.

**Bổ sung từ main 04/11/2026:**

- [ ] Bao phủ Trello/Notion digest và Jira `myjira_digest` **Standup & Blocker**, source boards/databases/site/projects và một destination Slack/Telegram đúng config; eligibility/disabledReason lấy từ API. Phân biệt myjira với legacy jira, giữ pause_reason/delivery_unknown/needs_attention và cấm resend khi chưa rõ kết quả.


## PL-12: Nhật ký, lịch sử và lưu trữ hội thoại

**Mục tiêu UX theo quyết định 05/11:** Giúp tìm và tiếp tục công việc cũ theo tiêu đề/nội dung/thời gian/kết quả; lịch và việc cần xử lý có hierarchy rõ. Không biến Nhật ký thành technical event log, run-ID list hoặc replay mọi engine step; giữ liên kết bản ghi chính xác và không làm hành động cũ sống lại. Phần đã làm phải audit; nếu không đạt, sửa lại rồi review trên head mới.

**Dependencies:** PL-02, PL-11.

**Files:** `pages/History/{HistoryPage.tsx,page.css,useHistory.ts,ScheduleSection.tsx}`, `components/layout/SidebarHistory.tsx`; tests history/fe-09/sprint1-history-schedules-empty và browser hiện có.

**Interfaces:** Giữ pagination/filter/search/list request từ main; SidebarHistory là phần tóm tắt, HistoryPage là danh sách đầy đủ. Không coi tìm trên 50 tin đã tải là tìm server toàn bộ.

- [ ] Trang giấy Planora có hội thoại, lịch/lượt chạy, bộ lọc/phân trang theo main, empty/loading/error; mở lại đúng `/c/:id`.
- [ ] Thể hiện archive/delete/restore đúng API hiện có; chỉ cung cấp thao tác được main cho phép, không thêm pin/rename khi chưa có contract.
- [ ] Test refresh giữ lựa chọn, GET cũ không ghi lên workspace mới, sidebar đồng bộ sau thao tác, quyền sở hữu và hội thoại không còn truy cập.
- [ ] Kiểm lịch rỗng và pending badge; điều hướng từ run tới plan/hội thoại đúng nguồn.
- [ ] Chạy history/sidebar + SCHED state tests và browser tương ứng.

**Bổ sung từ main 04/11/2026:**

- [ ] Giữ history/run/source và pause reason Jira legacy khi API cung cấp; kiểm schedules default-on/explicit-off. Inbox detail/filter do PL-09 sở hữu, history chỉ giữ liên kết phù hợp và không dựng inbox trùng.


## PL-13: Tài khoản và quản trị thành viên

**Mục tiêu UX theo quyết định 05/11:** Tài khoản tập trung hồ sơ/an toàn truy cập; quản trị tập trung ai được làm việc với nhóm và điều cần duyệt. Sắp xếp theo vai trò/tác động thay vì database fields; nội dung quyền/sessions/connection dùng nhãn quen thuộc, không raw identity/session IDs. Phần đã làm phải audit; nếu không đạt, sửa lại rồi review trên head mới.

**Dependencies:** PL-02, PL-04.

**Files:** `pages/Account/{AccountPage.tsx,page.css,useAccount.ts}`, `pages/Users/{UsersPage.tsx,page.css,useUsers.ts}`; tests auth03/auth05/users/workspace hiện có.

**Interfaces:** Giữ current account/session types, hook actions, organization membership và quyền main; shell nhận current=null hoặc users như hiện tại.

- [ ] Account Planora: hồ sơ, đổi mật khẩu, Google link/unlink, passwordless, phiên hiện tại/các phiên khác và thu hồi.
- [ ] Users Planora: thành viên/yêu cầu đang chờ, vai trò, khóa/mở, mã mời và các action đã có; responsive table/cards.
- [ ] Test admin cá nhân/thành viên tổ chức/admin tổ chức khác nhau; đổi workspace trên trang Users mất quyền phải chuyển/ẩn theo behavior main.
- [ ] Test passwordless không mở unlink nguy hiểm; session revoke hiện tại và session hết hạn trả đúng login/return target.
- [ ] Chạy auth03/auth05, Google account và users/workspace browser regression.

**Bổ sung từ main 04/11/2026:**

- [ ] Revalidate các thay đổi AccountPage/connection/session từ main mới trong quá trình sync; không rollback auth/session behavior để lấy markup cũ.


## PL-14: Cẩm nang, chính sách, 404 và trạng thái chung

**Mục tiêu UX theo quyết định 05/11:** Cẩm nang dạy cách hoàn thành công việc bằng ví dụ/các bước dùng sản phẩm; chính sách giải thích dữ liệu/quyền/nhà cung cấp minh bạch bằng ngôn ngữ người dùng; lỗi trang chỉ đường quay lại. Không marketing quá capability, không tool catalog/code sample làm nội dung cốt lõi. Phần đã làm phải audit; nếu không đạt, sửa lại rồi review trên head mới.

**Dependencies:** PL-03, PL-08–13.

**Files:** `pages/{Guide,Privacy,NotFound}/*.tsx`, page.css/data của chúng, `views/{NotFoundView,ShellPageView}.tsx`, `components/layout/AppShell.tsx` nếu còn consumer; tests guide/privacy/404 hiện có.

**Interfaces:** Khi signed-in dùng PlanoraShell, khi public dùng PlanoraPublicHeader; nội dung capability/service theo nguồn hiện tại.

- [ ] Thiết kế ba nhóm trang và các notice/loading/empty/error dùng chung. Không thay chính sách lưu dữ liệu/provider bằng copy quảng cáo cũ.
- [ ] Đổi user-facing brand ATI thành Planora trong title/metadata/empty copy nhưng giữ identifier kỹ thuật.
- [ ] Test chưa login/đã login, flag Gmail/Sheets tắt/bật, link sidebar/public và không lộ UI admin qua link trực tiếp.
- [ ] Kiểm 404 cho URL không tồn tại và lỗi truy cập hội thoại trong shell; đúng focus heading.
- [ ] Chạy FE-10, 404/routing browser và kiểm ảnh nội dung dài/mobile/dark.

**Bổ sung từ main 04/11/2026:**

- [ ] Giữ nội dung Guide data/gmail-data/mysheets-data, Jira cross-service playbooks và Privacy disclosure Slack/AI/Notion/Jira từ main; chỉ đổi presentation/brand. Ví dụ chỉ prefill draft, không auto-send; kiểm đủ entry links tới Settings/inbox.


## PL-15: Cutover, visual QA và gate tích hợp

**Mục tiêu UX theo quyết định 05/11:** Nghiệm thu hành trình end-to-end từ góc nhìn người dùng theo spec UX mới, không chỉ parity screenshot hoặc tests xanh. Kiểm cả copy/hierarchy/CTA/preview/kết quả/lỗi và mobile/dark; mọi task đã làm phải có audit/giữ hoặc refactor với bằng chứng. UX chưa đạt vẫn chặn acceptance dù kỹ thuật PASS. Phần đã làm phải audit; nếu không đạt, sửa lại rồi review trên head mới.

**Dependencies:** Tất cả PL-01–14.

**Files:** `index.css`, `prototype/usePrototypePage.ts` và các runtime imports chỉ khi không còn consumer; legacy wrapper không dùng; `tests/browser/planora-*.spec.ts`; những test prototype/parity bị thay yêu cầu; `scripts/test-v3-browser.mjs` nếu cần gọi đủ coverage; cập nhật task cards/log và tài liệu Design.

**Interfaces:** Không thay production contract. Các test hành vi hiện tại tiếp tục kiểm cùng ý nghĩa sau migration; chỉ reference hình thức/selectors cần thay được liệt kê rõ.

- [ ] Tìm hết consumer trước khi bỏ prototype CSS/meta injection; app runtime không còn phụ thuộc `:root[data-proto-page]` để có màu/font/shell. Docs/prototypes lịch sử giữ nguyên.
- [ ] Lập bảng từng assertion parity màu cam/layout cockpit được thay bằng mẫu Planora đã duyệt; không bỏ assertions về nội dung, HTTP, quyền và hành vi.
- [ ] Walkthrough business journeys và chụp **25 route entries + 404, 10 callback** theo inventory 04/11 (kiểm drift), expanded state matrix Slack/Jira/Notion; đánh giá mục đích/copy/CTA/hierarchy/preview/kết quả/lỗi theo spec UX mới. Kiểm sáng/tối ở 1440/1024/768/375, overflow 320; không dùng core pixel parity cũ thay acceptance UX.
- [ ] Chạy `npm run typecheck:v3`, `npm run test -w @wap/chat-web`, `npm run test:eval:v3`, `npm run build:v3`, `node scripts/test-v3-web-build-security.mjs`.
- [ ] Trên PostgreSQL 16 riêng/sandbox, chạy `npm run check` và `npm run test:browser:v3`; xác nhận trực tiếp có chạy Jira/Trello/GitHub/Telegram/provider specs, bổ sung target qua `npm run test:browser:v3 -- <spec-path>` nếu runner mặc định chưa bao gồm.
- [ ] Runner phải trỏ DB/port riêng và override môi trường sandbox rõ ràng trước cả migration/API/web; không dùng DB dev của người dùng hay lấy live credentials từ .env. Không xem lỗi môi trường là fail hành vi RED.
- [ ] Review độc lập trên diff cuối, CI đúng head xanh; so main drift, cập nhật feature inventory; chỉ sau đó mở PR tích hợp vào main.
- [ ] Chủ dự án duyệt hình thức và đầy đủ luồng; merge/deploy là thao tác riêng theo ủy quyền sau đó.

**Bổ sung từ main 04/11/2026:**

- [ ] Trực tiếp chạy `slack-oauth`, `slack-assistant`, `slack-read`, `slack-write`, `jira-09a`, `jira-business-v2`, `trello-oauth`, `github-oauth-and-digest`, `telegram-oauth-and-digest`, `sched-03`, `sched-03-calendar-delivery` và Notion browser bổ sung. Kiểm runner selection rồi thực thi; không coi `--list` là PASS. Giữ auth deep-link/return và provider capability tests sau sync.
- [ ] Kiểm nhánh PR sản phẩm sạch: diff và lịch sử không mang bộ prompt/private coordinator. Fetch main, ghi head cuối và review diff tích hợp, không dùng tổng PASS task cũ để thay bằng chứng trên head mới.


## Thứ tự và bằng chứng

Gate đầu của revision UX: PLANORA-UX-01 audit phần đã có → brief/mẫu UX mới → giữ có bằng chứng hoặc refactor theo owner → Argon review và duyệt hình thức. Dependency code cũ không tự xác nhận dependency UX mới; coordinator ghi UX acceptance head vào card trước dùng làm nền task mới.

Trục chính sau gate UX: PL-01 → PL-02 → PL-03/04 → PL-05 → PL-06/07 → PL-08/09/10 → PL-11 → PL-12 → PL-14 → PL-15. PL-13 có thể làm sau PL-04 trong phạm vi riêng; mặc định thực hiện tuần tự để tránh nhiều người cùng sửa shell/styles.

Với thay đổi hành vi trình bày (nav/focus/one-composer/callback integration), viết test fail trước rồi chuyển implementation. Với palette/markup không đổi behavior, dùng test hiện có, kiểm ảnh, contrast và build; không viết mock test phản chiếu implementation.

Mỗi task ghi command, SHA, exit code, ảnh và giới hạn thực tế. Test hồi quy chạy theo nhóm thay đổi; full regression chỉ ở điểm tích hợp và khi finding yêu cầu. Không báo “toàn bộ test đạt” từ số liệu cũ.

## Self-review trước giao

- [x] Inventory 04/11 đối chiếu source tại `cb069061`: 25 route entries + 404, 13 moment + trạng thái phụ, 9 connection callback + Google login callback. Đây là kiểm kê source, chưa phải browser PASS.
- [x] Mỗi nhóm thiếu Planora có task sở hữu; dark/viewport, callback race, workspace race, unknown và digest có nghiệm thu cụ thể.
- [x] Mỗi file tham chiếu hiện có tồn tại; file mới gắn trách nhiệm và interface rõ ràng.
- [x] Đã đối chiếu builder-check và giải quyết câu hỏi quan trọng.
- [x] Chưa sửa product code, chạy migration, bật flag, sửa CURRENT-STATE/ROADMAP hoặc merge PR cũ.
