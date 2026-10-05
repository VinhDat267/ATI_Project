---
version: alpha
name: Planora
description: >-
  A warm editorial workflow workspace. Cream canvas and paper surfaces,
  forest-green actions, expressive serif headings and Vietnamese sans-serif
  controls make planning feel human, legible and deliberate. Motion tells
  the request-to-plan-to-action story without competing with the work.
status: draft-for-review
updated: "2026-10-05"
scope: "Planora v3 frontend; apps/chat-web only"
reference: "https://getdesign.md"
implementation_reference: "ef13c5695ce2da030ff613422b4f8d6e1d7e72c3"
colors:
  canvas: "#f8f4eb"
  paper: "#fffdf7"
  sidebar: "#eee9dd"
  ink: "#2e382d"
  muted: "#656b5b"
  divider: "#deded0"
  primary: "#3c5741"
  primary-hover: "#2f4633"
  primary-soft: "#e4e9d8"
  on-primary: "#fffdf7"
  pending-surface: "#f6e6cf"
  pending-ink: "#85532b"
  error-surface: "#f8e6df"
  error-ink: "#9a3f32"
  unknown-surface: "#eee6f2"
  unknown-ink: "#654576"
typography:
  sans: "Be, 'Segoe UI', sans-serif"
  serif: "'Times New Roman', Georgia, serif"
  body-size: "14px"
  body-line-height: 1.65
  body-weights: [400, 500, 600]
spacing:
  scale: [4, 8, 12, 16, 24, 32, 48, 64]
  unit: px
  sidebar-width: "248px"
  chat-max-width: "1120px"
  public-max-width: "1280px"
  auth-max-width: "1360px"
  settings-max-width: "1040px"
radius:
  control: "12px"
  dropdown: "14px"
  story-card: "18px"
  surface: "20px"
  hero: "24px"
  auth-editorial: "26px"
  pill: "999px"
motion:
  fast: "160ms"
  panel: "320ms"
  enter: "520ms"
  ease: "cubic-bezier(0.22, 1, 0.36, 1)"
---

# Planora — DESIGN.md

Tài liệu thiết kế chính cho frontend v3. Giữ hướng B đã được chủ dự án chọn;
bản chuẩn hóa này chờ review, không phải yêu cầu thay đổi giao diện đã chạy.
Front matter là danh sách token có vai trò; chín mục dưới đây giải thích cách
dùng theo cấu trúc tham khảo [getdesign.md](https://getdesign.md/) và
[collection của VoltAgent](https://github.com/VoltAgent/awesome-design-md).
Đây là tài liệu viết riêng từ code Planora, không phải file tải từ dịch vụ trả phí
hoặc chứng nhận tuân thủ một JSON schema của Google.

**Quyền lực:** DESIGN.md quy định thị giác và tương tác. Hành vi nghiệp vụ,
quyền hạn, phê duyệt và phục hồi vẫn theo
[đặc tả v3](docs/superpowers/specs/2026-09-29-ai-workflow-platform-v3-design.md).
`apps/chat-web/DESIGN.md` chỉ trỏ về tài liệu này. `System Design/DESIGN.md`
là tham khảo lịch sử; không lấy palette Apple/indigo hoặc nhãn ATI cũ cho UI mới.
Không áp dụng tài liệu này để sửa các package v2 được AGENTS.md bảo vệ.

## 1. Visual Theme & Atmosphere

Planora là không gian tổ chức công việc: một lời nhắn, một kế hoạch có thể
kiểm tra, các hành động được người dùng quyết định. Cảm giác như bàn làm việc
với giấy và mực xanh, có trật tự nhưng không lạnh. Tên sản phẩm là **Planora**;
ATI chỉ xuất hiện trong tài liệu môn học/lịch sử, không ở logo hay footer sản phẩm.

Trang công khai thoáng và có điểm nhấn serif. Workspace ưu tiên đọc nội dung,
đích nhận và quyết định; không thu nhỏ nội dung công việc thành poster quảng cáo.
Giữ tinh thần khoảng 80% tĩnh, 20% chuyển động có mục đích.

### Phạm vi hoạt động — xác minh ngày 05/10/2026

Website: https://planora-ivory-tau.vercel.app. Đã đọc `/api/health` và
`/api/auth/config`, cả hai HTTP200; deployment `accounts-workspace`:

| Mảng | Hiện trạng phải phản ánh trong UI |
| --- | --- |
| Giới thiệu, đăng nhập, workspace shell | Đã triển khai; đăng nhập bằng tài khoản đã cấp |
| Hội thoại | API lưu thật; tạo, lịch sử, lưu trữ, xóa mềm và khôi phục |
| Tài khoản | Thông tin phiên và đăng xuất thật; chưa có UI chỉnh hồ sơ/đổi mật khẩu |
| Dịch vụ | Có UI/schema cấu hình theo quyền; logo không chứng minh đã kết nối |
| AI chat, lập kế hoạch, thực thi | Có UI/luồng trong mã nguồn đầy đủ; **chưa bật ở backend cloud hiện tại** (`planning=false`, `execution=false`) |
| Đăng ký/xác minh email | Có view trong code; **cloud đang đóng** (`signupEnabled=false`) |
| Google, quên/reset mật khẩu | Chưa khả dụng; `googleEnabled=false`; không thêm nút giả |
| Sheets, Calendar, Notion, Telegram, Jira | Roadmap; không hiển thị như tích hợp đang hoạt động |

Đối với cloud, không hứa gửi tin nhắn sẽ tạo kế hoạch ngay. Nội dung minh họa
trên landing mang nhãn ví dụ; success/running/connected trong workspace chỉ
được suy ra từ API của chính thao tác đó. Render Free có cold start; trạng thái
chờ mạng không được biến thành tiến độ AI giả.

## 2. Color Palette & Roles

Token khai báo ở [index.css](apps/chat-web/src/index.css); tên semantic ở front
matter ánh xạ tới CSS hiện có, không giả định các biến `--color-*` đã được tạo.

| Vai trò | CSS / giá trị | Quy tắc |
| --- | --- | --- |
| Canvas | `--bg` / `#f8f4eb` | Nền toàn trang, không gradient chủ đạo |
| Paper | `--paper` / `#fffdf7` | Composer, kế hoạch, menu, modal |
| Sidebar | `--side` / `#eee9dd` | Tách khu điều hướng bằng surface |
| Ink | `--ink` / `#2e382d` | Heading, nội dung và tài nguyên quan trọng |
| Muted | `--muted` / `#656b5b` | Metadata/giải thích; không giảm opacity nội dung bắt buộc đọc |
| Divider | `--line` / `#deded0` | Hairline1px; không dùng để viết chữ |
| Primary | `--green` / `#3c5741` | Một CTA chính trong mỗi vùng quyết định |
| Primary hover | `#2f4633` | Hover nút xanh; chữ `--paper` |
| Soft | `--soft` / `#e4e9d8` | Selected nav, nền status nhẹ |
| Pending | `--warm` / `#f6e6cf`, `--clay` / `#85532b` | Chờ duyệt; focus outline dùng clay |
| Error | `#f8e6df` / `#9a3f32` | Lỗi và xóa; bắt buộc có nhãn/icon |
| Unknown | `#eee6f2` / `#654576` | Chưa rõ kết quả; không đồng nhất failed |

Success dùng xanh và dấu kiểm; running có icon/nhãn trạng thái, không suy ra
% nếu server không cung cấp. Chip roadmap viền đứt/nền trung tính với “Dự kiến”.
Các nền minh họa hiện có: hero `#e9e9dc`, editorial auth `#e7eadb`, CTA `#e8ecdd`.
Đây là các surface theo ngữ cảnh, không thêm accent mới cho mỗi service.

## 3. Typography Rules

Sans **Be Vietnam Pro**, tên family CSS `Be`, tự host400/500/600 ở
`apps/chat-web/public/fonts/`, giấy phép OFL. Serif hệ thống **Times New Roman**
rồi Georgia; không tải font mạng mới. Giữ dấu tiếng Việt, không upper-case
đoạn văn dài. Code/ID/JSON dùng Consolas hoặc monospace hệ thống.

| Ngữ cảnh | Mốc CSS hiện tại | Hướng dùng |
| --- | --- | --- |
| Body | Sans14px /1.65,400 | Văn bản thao tác; không ép còn10–11px |
| Hero landing | Serif66px /1.08 ở desktop rộng | Chia dòng có chủ ý; italic xanh chỉ một phần |
| Heading workspace chung | Serif40px /1.15 | Rõ hierarchy; không tranh với plan CTA |
| How heading | Serif38px | Reveal theo dòng, giữ đủ chỗ cho dấu |
| Auth heading | Serif50px /1.05 | Form dễ đọc, không tăng thành hero toàn màn |
| Auth editorial | Serif46px /1.1 | Một thông điệp ngắn, không lặp quy trình homepage |
| Heading cấp2 chung | Serif30px /1.25 | Tên vùng và kế hoạch |
| Button chung | Sans13px,500 | Nhãn động từ rõ, giữ target44px |
| Eyebrow | Sans11px,600, tracking0.1em | Nhãn section ngắn, không thay heading |
| Metadata | Sans11–12px trong UI hiện có | Chỉ thời gian, nhãn phụ; không giấu lỗi ở đây |

Các mốc trên là selector desktop, không một thang bắt buộc cho mọi component.
CSS context/media query có override; ưu tiên CSS cuối cùng được import.
Yêu cầu cho UI mới: body/control tối thiểu14px, input mobile16px, title wrap
tự nhiên. Đây là yêu cầu chất lượng cho lần sửa UI sau, chưa phải refactor đã làm.
Không thêm weight700 cho family chỉ có ba tệp; ưu tiên500/600.

## 4. Component Stylings

### Buttons, inputs, feedback

Primary pill: xanh rừng, chữ paper, target tối thiểu44px, padding10×18px,
gap9px, nhãn13px/500. Secondary: paper/viền1px, ink; tertiary nền trong.
Danger là chữ đất đỏ và xác nhận riêng cho xóa. Disabled: opacity0.55,
không hover/submit; pending có aria-busy và khóa thao tác trùng.
Focus-visible outline2px clay, offset4px; không xóa focus keyboard.

Auth input cao54px, bo12px, icon và toggle không chồng chữ; label luôn thấy,
required/autocomplete đúng mục đích. Focus border xanh + ring nhẹ3px.
Hiện/ẩn mật khẩu là nút có accessible name; không điền credential mẫu.
Lỗi đặt gần form, `role=alert`, giữ dữ liệu có ích, không echo secret.

### Brand and service marks

[Brand.tsx](apps/chat-web/src/components/Brand.tsx) sở hữu monogram P và
wordmark planora; favicon/avatar dùng cùng hình. Không vẽ lại logo ở mỗi view.
`ServiceLogo` dùng asset tự host trong `public/logos`; icon chức năng dùng Lucide.
Giữ màu, tỷ lệ và tên GitHub/Trello/Slack. Logo có tên cạnh bên là decorative.
Nguồn/điều kiện dùng: [logo README](apps/chat-web/public/logos/README.md).
Mốc kích thước: card32px, hero22px, plan23px, icon chung20px; không xoay logo
service theo hover. Roadmap có logo nhưng vẫn phải mang trạng thái dự kiến.

### Public landing and footer

Thứ tự giữ nguyên: hero → marquee `#ecosystem` → Cách hoạt động `#how` và
roadmap → thông tin Dịch vụ `#services` → CTA → footer. Navbar Dịch vụ tới
`#services`, không tới marquee. CTA đi login/workspace theo phiên; dịch vụ
yêu cầu login giữ đích `next=services`.

How01/02/03 dùng paper card bo18px, border hairline, số serif và miniature
UI request → plan → result. Mini UI có nhãn ví dụ, không đồng hồ/% giả.
Footer dùng wordmark, hai dòng serif, link Cách hoạt động/Dịch vụ/Workspace
và lên đầu trang có đích thật. Không ghi “Dự án ATI”, không link pháp lý rỗng.

### Auth editorial

[LoginStory](apps/chat-web/src/components/LoginStory.tsx): lớp giấy và seal P,
một thông điệp ngắn “Điều lớn lao, từ một khởi đầu nhỏ.”. Artwork decorative,
không phải mini dashboard và không đưa lại ba tab quy trình homepage.
Login/signup/verify chia sẻ editorial/footer; form là nội dung ưu tiên.
CTA tạo tài khoản chỉ mở khi auth config cho phép. Đăng ký không tự cấp phiên;
xác minh thành công không tự duyệt user. Hiện chờ admin khi backend trả trạng thái đó.

### Workspace, history and menus

Shell dùng `Workspace`; sidebar: brand → Hội thoại mới → Hội thoại/Dịch vụ →
tìm kiếm → **Gần đây** → tài khoản/đăng xuất. Lưu trữ và Đã xóa nằm ở Settings,
không tạo ba tab cạnh lịch sử. Timestamp/tên lấy API, không dùng UUID như tên
người dùng tự viết; ID fallback hợp lệ khi chưa có title.

Menu ⋯ paper212px, bo14px, padding6px, hàng42px desktop/44px mobile,
icon16px; separator trước Xóa. Popover ở top layer, canh phải/gap8px,
clamp12px và lật lên nếu thiếu chỗ. Keyboard: Arrow/Home/End, Escape trả focus,
click ngoài/scroll/resize đóng. Xóa cần modal xác nhận và là xóa mềm, khôi phục
được ở Settings; không đổi nó thành xóa vĩnh viễn trong một lần “làm đẹp”.

Composer chung: Enter gửi, Shift+Enter xuống dòng, IME không bị gửi sớm.
Giữ draft riêng theo hội thoại trong phiên, không persist nội dung vào localStorage.
Feed chỉ autoscroll khi gần cuối; `role=log`, không cướp vị trí đang đọc.

### Plan, progress, result and recovery

Các trạng thái dùng **cùng workspace**, không thêm page cho mỗi giai đoạn.
Plan step trình bày logo, số thứ tự, hành động/tool, read/write, tài nguyên,
payload và phụ thuộc. Không bịa tên từ ID: dùng tên server cung cấp, nếu thiếu
ghi “(ID)”. Cho đọc payload trước duyệt; JSON chỉ là fallback thu gọn.

Review dock phía trên composer: “Duyệt và thực thi” primary; “Sửa qua chat”
secondary; “Hủy” tertiary. Thiếu plan ID hoặc đang submit thì khóa đúng nút.
Sửa qua chat chỉ điền draft, không tự thực thi. Hủy lỗi thì giữ kế hoạch.

Gather/clarification dùng sự kiện thật; chạy/hoàn tất dựa snapshot/SSE/API,
không suy diễn từ animation. Result ưu tiên tài nguyên/link HTTP(S) an toàn,
`noopener noreferrer`; duration chỉ khi dữ liệu có. UNKNOWN nói rõ chưa biết
đã ghi hay chưa, không Retry mù. Chỉ hiển thị Skip/Continue/Retry mà server cho
phép. Đóng/Escape hộp thoại lỗi không Stop; Stop cần xác nhận riêng.

### Services and account settings

Service card có logo, mô tả, trạng thái thật, Allowed Scope và hai thao tác
**Kiểm tra kết nối / Cấu hình**. Credential input không điền sẵn secret, không
lưu trong localStorage. Lưu thành công không đồng nghĩa kiểm tra kết nối thành
công. Fields/scope lấy schema API; roadmap không có nút cấu hình hoạt động.

Settings: account, archived, deleted; admin có duyệt tài khoản theo quyền API.
Account hiển thị tên/email thật, link dịch vụ và đăng xuất; chưa hứa edit profile,
avatar upload, đổi role/password bằng các control chưa được nối backend/UI.
Restore cập nhật danh sách sau API success; mục Deleted không mở chat trước restore.

### Lazy loading and process loading

| Chờ loại gì | Hiện trạng / cách hiển thị | Lỗi |
| --- | --- | --- |
| Chunk Services/Settings | React.lazy + Suspense; skeleton gần layout đích | ViewBoundary, nút tải lại |
| Chunk Signup/Verify | Lazy, fallback status bằng chữ hiện có | Không claim đã có skeleton hoàn chỉnh |
| API history/catalog/settings | Loading riêng vùng dữ liệu; empty chỉ sau success | Lỗi/thử lại, không coi lỗi là danh sách trống |
| Login/approve/restore/config | Nút busy, khóa gửi trùng | Giữ ngữ cảnh, phản hồi theo thao tác |
| Gather/planning | Nội dung tiến trình theo sự kiện thật | Clarification/lỗi kết thúc trạng thái đang chờ |
| Execution | Timeline từng bước và snapshot bền vững | Recovery theo quyền server; không reset success |
| Cloud cold start/offline | Đang kết nối/chưa truy cập được | Thử lại rõ ràng; không dựng AI progress |

Landing, login và workspace hiện import trực tiếp; không nói “mọi page lazy”.
Skeleton không chạy vô hạn khi request lỗi. Cache/optimistic UI không được cấp
thành công cho thao tác ghi trước khi API xác nhận. Không phát thông báo screen
reader mỗi frame của motion.

## 5. Layout Principles

Nhịp4/8/12/16/24/32/48/64px; khoảng lớn dành cho phân tách nội dung, không
phải lấp bằng card. Desktop shell248px + `minmax(0,1fr)`, chat/review tối đa
1120px. Public max1280px, lề48px; hero2cột gap70px. Auth max1360px,
grid1.2/0.8, form max420px, gap52–100px. Settings max1040px, nav220px/gap42px.
Đây là kích thước của các vùng khác nhau, không gom về một container tùy ý.

### Bốn vùng trải nghiệm, bảy view hiện có

| View | Route | Ghi chú |
| --- | --- | --- |
| Giới thiệu | `/` hoặc `/?view=landing` | Công khai kể cả khi đã login |
| Đăng nhập | `/?view=login` | Trả về đích protected đã yêu cầu |
| Đăng ký | `/?view=signup` | Phụ thuộc config; cloud hiện đóng |
| Xác minh | `/?view=verify-email&token=…` | Token bỏ khỏi URL; không đưa vào log/ảnh |
| Workspace | `/?view=workspace&c=…` | Chat/review/progress/result/recovery chung view |
| Dịch vụ | `/?view=services&c=…` | Dùng workspace shell, cần phiên |
| Cài đặt | `/?view=settings&c=…&section=account` | account/archived/deleted; admin là nội dung có điều kiện |

History API/query string hiện có; không thêm router để đổi tên page.
Protected route khi chưa có phiên chuyển login, whitelist `next`; giữ `c`/section
khi thích hợp. Back/Forward, direct fragment và reload phải có nghĩa.
Giữ lựa chọn ngay khi click; guard request chậm để hội thoại cũ không đè hội thoại mới.
Plan state, error modal và menu không được tính như page riêng.

## 6. Depth & Elevation

Surface + border là công cụ chính. Paper khác canvas đủ nhẹ; card không “bay”
mặc định. Shadow hero hiện có `0 6px 16px #2e382d08, 0 22px 42px -16px #2e382d24`.
How hover được phép bóng mềm; không copy mức đó sang mọi input/menu.
Modal/backdrop có mục đích tách quyết định, không blur/glassmorphism toàn trang.

### Motion contract

| Vùng | Biên độ/thời gian đã có | Ràng buộc |
| --- | --- | --- |
| Hero idle | Y0→−6→0px,4s ease-in-out | Wrapper float tách rotator; không scale/glow |
| Hero drag | Y0.35°/px vô hạn; X−0.15°/px,±12° | Threshold5px, giữ click con, pause float/resume400ms |
| Hero inertia | ≤0.08°/ms,≤240ms, friction85ms | Grab mới hủy, không reset rotation |
| Hero mặt/cạnh | Perspective1200px; dày14px/10px | Backface hidden, mặt khuất inert/aria-hidden |
| Marquee |18s linear,4nhóm, dịch−25% | Một accessible list; bản sao aria-hidden; không nút pause theo lựa chọn chủ dự án |
| How story | Token6px + hairline theo scroll | Desktop ngang, mobile dọc; không giả tiến độ hệ thống |
| How hover | Lift−6px,280ms | Fine pointer; không phóng chữ/logo |
| Reveal |650–750ms, stagger75–150ms | Chỉ khi vào viewport; heading mask không cắt dấu |
| Roadmap | Unfold350ms, line400ms | Click/keyboard/tap; không hover-only hay mốc thời gian bịa |
| CTA | Magnetic±3px, arrow4px, paper shift±8px | Desktop fine pointer; không đuổi con trỏ |
| Auth artwork | Float6px/6s, seal thêm3px/nghiêng2° | Chữ/form/bóng đứng yên |
| Press/menu | Scale0.985/160ms; menu entrance160ms | Không bounce; focus không dịch khỏi màn |

Hero mở desktop X6°/Y−12°, mobile X0°/Y0°; chỉ khởi tạo lúc mount, không reset
khi float resume. Touch dùng `pan-y pinch-zoom`, vẫn cuộn trang dọc; arrow keys
xoay15° khi rotator focus, không lấy phím controls con.

Native IntersectionObserver/rAF/transform/opacity, refs cho scroll/pointer;
không setState mỗi frame, không loop idle, không thêm animation library.
Observer/listener/timer/frame được cleanup. Content tĩnh là baseline; enhancement
chỉ bật khi API trình duyệt có sẵn. Reduced-motion tắt float/marquee/token/
parallax/magnetic/inertia/reveal movement; manual hero drag và roadmap vẫn dùng
được, nội dung không bị ẩn. CSS hiện tại còn tắt transition toàn cục ở reduce;
không mô tả “opacity animation vẫn bật” như đã triển khai.

## 7. Do's and Don'ts

**Làm:** hierarchy bằng serif + khoảng trống; CTA rõ; payload/tài nguyên dễ đọc;
labels tiếng Việt ngắn; status có chữ + icon; ví dụ đặt nhãn ngay trong vùng;
focus/empty/error/retry có ý nghĩa. Tích hợp/capability căn cứ API, không logo.

**Không:** neon/glow, gradient rực, particle, số liệu chưa đo, connected giả,
avatar người dùng bịa, dashboard AI tương lai, card lồng vô cớ, chữ marketing
lặp trên auth. Không hứa tính năng roadmap đang hoạt động, không khóa dọc bằng
`touch-action:none`, không che nội dung bằng reveal khi JS/observer thiếu.
Không công khai secret trong docs, build, URL, localStorage hoặc ảnh.

Các trạng thái bắt buộc review cho component mới: default/hover/focus-visible/
pressed/disabled/loading/error/empty/success nếu có. Không chỉ review screenshot
happy path. Đối với dịch vụ, thêm denied/not-configured/disconnected; execution
thêm failed/unknown/reconciliation-required. Các nhãn này phải khớp contract API,
không tự đặt enum backend mới.

## 8. Responsive Behavior

| Breakpoint hiện có | Hành vi |
| --- | --- |
| ≥1024px | Sidebar shell cố định; content không tràn theo cột |
| ≤1023px | Sidebar drawer; Escape/backdrop đóng, focus return, inert phía sau |
| ≤1180px | Plan step chuyển chuỗi dọc (media761–1180 và mobile) |
| ≤760px | Hero/How/Services1cột; workflow token dọc; auth form trước editorial; lề16–20px |
| ≤700px | Settings nav thành hàng, profile fields xếp dọc |
| 320px | Target44px, input16px, title/payload/ID wrap, không overflow page |

Desktop hover/magnetic không chạy trên coarse pointer. Drawers/modals có focus
trap/return, Escape theo đúng cấp; Escape menu không đóng cả drawer cùng lúc.
Composer/review dock không che tin nhắn khi mở bàn phím. Dùng min-width0 cho
cột và overflow-wrap cho ID; không sửa lỗi layout bằng overflow-x:hidden ở body.

Yêu cầu nghiệm thu cho lần sửa UI sau:320×740,390×844,768×1024,1440×900;
zoom200%, keyboard-only, reduced-motion, request lỗi/chậm. Đây là checklist,
không phải tuyên bố toàn bộ matrix đã chạy trong lượt tài liệu này.

## 9. Agent Prompt Guide

Đọc DESIGN.md trước khi sửa UI; đọc AGENTS.md, handoff và spec v3 cho nghiệp vụ.
Xác định component/CSS/hook đang sở hữu tương tác, mở rộng tại chỗ. Dùng token
đã có; không tạo bản copy Brand/ServiceLogo/Modal hoặc rewrite hero logic.
Nếu cần token mới, giải thích vai trò và cập nhật source lẫn tài liệu cùng task.

Prompt áp dụng:

> Thiết kế [component/view] cho Planora theo DESIGN.md tại gốc repo. Giữ nền
> kem, paper, xanh rừng, serif editorial và Be Vietnam Pro. Tái sử dụng component
> v3 hiện có; đọc capability/API trước khi hiện control. Có keyboard focus,
> loading/error/empty, mobile và reduced-motion. Không thay bố cục ngoài phạm vi,
> không thêm dịch vụ/metric/success giả; không gọi provider ghi khi chưa duyệt.

### Evidence and maintenance

Nguồn triển khai: [App](apps/chat-web/src/App.tsx),
[base CSS](apps/chat-web/src/index.css), [auth CSS](apps/chat-web/src/login.css),
[sidebar CSS](apps/chat-web/src/sidebar.css), [settings CSS](apps/chat-web/src/settings.css),
[story CSS](apps/chat-web/src/landing-story.css), [motion CSS](apps/chat-web/src/motion.css),
[hero hook](apps/chat-web/src/hooks/use-hero-motion.ts),
[story hook](apps/chat-web/src/hooks/use-landing-story.ts).
Cloud account/workspace được triển khai từ
[backend commit669a413](https://github.com/VinhDat267/ATI_Project/tree/669a4131699445a54863d42521e92380abe92fbd/apps/chat-api/deploy).

Thứ tự căn cứ: yêu cầu mới đã chốt → spec v3 về nghiệp vụ → capability/API
thực tế → CSS/component hiện tại về giá trị → DESIGN.md giải thích. Nếu mâu
thuẫn, ghi rõ lệch và sửa trong task phù hợp, không ngầm thay đổi production.
Mỗi lần thay phong cách/component cập nhật đúng mục; handoff giữ bằng chứng
test/browser và giới hạn ở log riêng, không biến DESIGN.md thành nhật ký deploy.
