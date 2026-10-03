# Planora · Giao diện B được chọn

Ngày triển khai: 02/10/2026; cập nhật điều hướng và quản lý hội thoại ngày03/10/2026. Phạm vi giao diện v3 trong `apps/chat-web`; UI-02 bổ sung API và migration lưu trữ/xóa mềm để thao tác có tác dụng thật. Chủ dự án đã chọn bộ preview B nền ấm. Tài liệu này mô tả giao diện đã triển khai; đặc tả v3 vẫn là nguồn chuẩn về nghiệp vụ. Hai tài liệu DESIGN cũ ở gốc và `System Design/` không mô tả bộ B này.

## Bảy giao diện

| Giao diện | URL trong ứng dụng | Nội dung và nguồn dữ liệu |
| --- | --- | --- |
| Giới thiệu | `/` hoặc `/?view=landing` | Trang công khai kể cả đã đăng nhập; header Đăng nhập/Mở workspace tùy phiên. Hero có nhãn “Ví dụ quy trình”, ba bước có nhãn chung “VÍ DỤ: MỘT YÊU CẦU, BA BƯỚC”; CTA đến đăng nhập/workspace |
| Đăng nhập | `/?view=login` | Email/mật khẩu do người dùng nhập, hiện/ẩn mật khẩu, lỗi và trạng thái gửi; API login/me/refresh hiện có. Đã đăng nhập thì dùng workspace |
| Đăng ký | `/?view=signup` | Email/mật khẩu, xác nhận mật khẩu, gửi email xác minh; chưa tạo phiên khi đăng ký |
| Xác minh email | `/?view=verify-email&token=<token>` | Token một lần 24 giờ; xóa token khỏi URL, thông báo chờ duyệt; không tự đăng nhập |
| Workspace | `/?view=workspace&c=<id>` | Chat, làm rõ yêu cầu, khảo sát, kế hoạch chờ duyệt, tiến trình, kết quả và phục hồi trong cùng một màn hình; dữ liệu từ API/SSE/snapshot đã lưu |
| Dịch vụ | `/?view=services&c=<id>` | Cùng sidebar/header với workspace; danh mục, phạm vi và nhãn trường từ API; cấu hình và kiểm tra là hai thao tác riêng |
| Cài đặt tài khoản | `/?view=settings&c=<id>&section=account` | Thông tin phiên/getMe thật, dịch vụ/đăng xuất; section `archived` và `deleted` dùng API danh sách và khôi phục đã có |

Điều hướng dùng History API và tham số query; không thêm thư viện router. `c` giữ hội thoại khi đi sang dịch vụ/cài đặt. Bản nháp giữ riêng theo hội thoại trong phiên React, không lưu nội dung vào localStorage, xóa khi mất phiên/đăng xuất. Back/Forward và mở trực tiếp URL khôi phục hội thoại. Cập nhật URL ngay lúc chọn để phản hồi chậm không phục hồi lựa chọn cũ. Tải hội thoại có guard theo lượt chọn và revision kế hoạch.

Luồng công khai: Giới thiệu → Đăng nhập → Workspace. Workspace, Dịch vụ và Cài đặt cần phiên; mở URL protected khi chưa đăng nhập dùng replaceState chuyển login, giữ `c`, `section` và `next` (chỉ chấp nhận workspace/services/settings). Đăng nhập xong quay đúng đích. Root không tự chuyển người đã đăng nhập vào workspace; CTA Mở workspace cho phép vào lại. Sidebar dành cho làm việc: brand về workspace, Hội thoại/Dịch vụ, tài khoản mở Cài đặt và Đăng xuất; bỏ Về giới thiệu. Hội thoại mới/xóa/lưu trữ hội thoại hiện tại bỏ `c` cũ; thao tác hội thoại khác giữ lựa chọn hiện tại. Xóa tại Cài đặt giữ view/section hiện tại; rời Cài đặt bỏ query `section`.

## Bản sắc và hệ thống thị giác

| Token | Giá trị | Cách dùng |
| --- | --- | --- |
| Canvas | `#f8f4eb` | Nền kem ấm |
| Paper | `#fffdf7` | Card, composer, hộp thoại |
| Sidebar | `#eee9dd` | Không gian điều hướng |
| Ink | `#2e382d` | Nội dung chính |
| Muted | `#656b5b` | Giải thích và metadata |
| Green | `#3c5741` | CTA, nhận diện Planora, thành công |
| Line | `#deded0` | Ranh giới nhẹ |
| Pending | `#f6e6cf` / `#85532b` | Trạng thái chờ duyệt |
| Error | `#f8e6df` / `#9a3f32` | Lỗi, có nhãn bằng chữ |
| Unknown | `#eee6f2` / `#654576` | Chưa rõ kết quả, tách khỏi lỗi |

Be Vietnam Pro 400/500/600 tự host trong `public/fonts` (kèm OFL), không dùng CDN. Times New Roman/Georgia cho tiêu đề và số bước; font sans cho nội dung/nút; Consolas cho mã và JSON. Nhịp spacing 8/12/16/24/32/48px, sidebar desktop 248px, nội dung chat tối đa 1120px. Surface bo 16–24px, CTA bo pill, shadow nhẹ. Logo là monogram P kết hợp nét định hướng, sử dụng cùng một hình trong avatar/fav icon.

### Logo dịch vụ (03/10/2026)

`ServiceLogo` trong `Brand.tsx` là nguồn hiển thị chung cho assets tự host; `Icon` chuyển tên dịch vụ sang component này, còn icon điều hướng/trạng thái/thao tác vẫn dùng Lucide. GitHub/Trello/Slack dùng cùng mark chính thức ở card dịch vụ, hero, marquee, bước kế hoạch và gợi ý workspace/đăng nhập hiện có. Giữ tỷ lệ bằng object-fit:contain, màu gốc, không xoay/phóng logo khi hover card; img decorative khi đã có tên bằng chữ. Kích thước theo ngữ cảnh: card32px, hero22px, kế hoạch23px, mặc định20px; không đổi bố cục các bước/nút.

Google Sheets, Google Calendar, Notion, Telegram và Jira có asset tương ứng trong chip roadmap. Logo chỉ nhận diện dịch vụ; nhãn “Dự kiến” và nội dung “chưa khả dụng” phân biệt với các dịch vụ đang hoạt động, không tạo trạng thái tích hợp mới. Tên không có trong danh mục asset dùng icon grid dự phòng. Nguồn chính thức và tên file gốc ghi ở `public/logos/README.md`; không tải logo từ CDN trong lúc dùng ứng dụng.

## Workspace và component

Landing: khu tích hợp có heading “Các dịch vụ đã có tích hợp” căn giữa, đứng yên; ba mark GitHub/Trello/Slack phía dưới chạy marquee ngang sang trái theo yêu cầu bổ sung. SVG chính thức giữ màu/hình dạng, lưu cục bộ ở `public/logos` kèm README nguồn; tên là text native Planora, img decorative. Bốn nhóm giống nhau trên track max-content, dịch−25% trong18s linear infinite (một nhóm mỗi vòng), không đo kích thước bằng JS. Nhóm đầu có list accessible, ba bản sao aria-hidden. Viewport marquee tối đa720px, overflow hidden và mask mờ6% hai đầu; không tràn trang. Desktop mark32px/tên22px/gap64px; mobile giữ hàng ngang tên18px/gap40px. Hover con trỏ chính xác tạm dừng, rời ra tiếp tục từ phase hiện tại. Theo yêu cầu mới nhất, không có nút tạm dừng hoặc state/timer điều khiển marquee. Reduced-motion bỏ animation/mask/bản sao, chỉ hiện ba dịch vụ tĩnh căn giữa và wrap khi cần (mobile mark trên tên16px). Không dùng badge trạng thái kết nối hoặc thêm dịch vụ roadmap vào hàng này.

- `Workspace`: shell, lịch sử, tài khoản, header; desktop hai cột. Dưới 1024px sidebar thành drawer; đóng bằng backdrop/Escape, khóa nội dung phía sau bằng inert và trả focus về nút menu. Tiêu đề mobile giới hạn hai dòng.
- Sidebar: Hội thoại mới → điều hướng Hội thoại/Dịch vụ → tìm kiếm → Gần đây → lịch sử → tài khoản/Đăng xuất. Gần đây là heading nhỏ, không còn bộ ba tab. Tìm trên danh sách active đã tải (tối đa50), không phân biệt hoa thường/dấu tiếng Việt (kể cả đ), không đổi hội thoại hay draft. Nút xóa/Escape xóa query và giữ focus; Escape lần tiếp đóng drawer. Lưu trữ/Đã xóa nằm trong Cài đặt; tài khoản cuối sidebar là nút có icon cài đặt, mở trang thật. Chưa có phân trang hoặc tìm toàn bộ lịch sử trên server (FE-02).
- Lịch sử dùng timestamp API (`updatedAt`, `updated_at`, `created_at`), mới nhất trước, nhóm Hôm nay/Hôm qua/Trước đây; thiếu ngày hợp lệ vào Khác, không tạo ngày giả. API list lấy tối đa60 ký tự tin nhắn user đầu tiên làm title; chưa có tin nhắn thì fallback ID, không ghi title vào DB hay hỗ trợ rename. Dòng có icon, title đầy đủ qua accessible name/tooltip, giờ vi-VN24h, viền xanh và chấm ở hội thoại hiện tại. Nút Làm mới chỉ gọi GET lịch sử, khóa khi tải; lỗi giữ cache/query và cho thử lại. Menu ⋯ trong workspace có Lưu trữ/Xóa dạng dropdown nổi, không tăng chiều cao dòng hoặc cuộn list khi mở. Chưa có đổi tên/ghim. Drawer trap gồm search và history buttons; hộp xác nhận portal ra body, Escape đóng hộp thoại trước và giữ drawer.

Dropdown cập nhật03/10: paper212px, radius14px, padding6px, row42px (mobile44px), icon16px nét1.7, font sans12px/500; separator mảnh trước Xóa màu đất, hover/focus nền xanh hoặc đất nhạt. Shadow mềm, entrance opacity + translate4px + scale0.98 trong160ms ease-out; reduced-motion tắt. Dùng native popover manual/top layer để tránh clipping của list và transform drawer (tham khảo [MDN Popover](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Global_attributes/popover)); không thêm dependency. useLayoutEffect đặt vị trí theo trigger, canh mép phải/gap8px, clamp12px trong viewport, đổi lên trên khi không đủ chiều cao. Mở bằng click/ArrowDown/Up, focus thao tác đầu, mũi tên/Home/End đổi focus; Tab dùng thứ tự native, blur ngoài menu/trigger đóng. Escape chỉ đóng dropdown và trả focus ⋯; click ngoài, cuộn hoặc resize đóng. Listener được tháo khi menu đóng/unmount. Khi chọn Xóa, đóng popover và focus trigger trước mở Modal để xác nhận nằm trên cùng và trả focus đúng.
- `ChatContainer`: một textarea dùng chung, Enter gửi, Shift+Enter xuống dòng, không gửi khi IME đang ghép chữ. Chặn gửi trong khi chuẩn bị/thực thi; gợi ý và “Sửa qua chat” chỉ điền draft. Feed cuộn riêng, chỉ tự cuộn khi người dùng đang gần cuối. `role=log` và live region thông báo nội dung mới.
- `MessageItem`: tin người dùng có đường màu đất, tin Planora dùng avatar nhận diện; thời gian lấy từ dữ liệu đã lưu, không tạo thời gian giả cho dữ liệu thiếu timestamp.
- `PlanPreview`/`PlanStepItem`: ba card màu nền nhẹ, số bước lớn, tool, đọc/ghi, mô tả, tài nguyên, payload và phụ thuộc. Desktop rộng dùng ba cột; tablet/mobile chuyển thành chuỗi dọc. Chưa có backend resourceLabels nên giữ ID đúng dữ liệu và ghi rõ “(ID)”; không suy đoán tên tài nguyên. Tool chưa biết được ghi “Chưa phân loại”.
- `PlanActions`: thanh duyệt cố định phía trên composer; CTA “Duyệt và thực thi”, “Sửa qua chat”, “Hủy”. Không có ID kế hoạch thì khóa duyệt; đang gửi duyệt thì khóa ba thao tác. Lỗi hủy giữ kế hoạch để người dùng xem và thử lại.
- `GatherProgress`/`ClarificationCard`: hiện tiến trình khảo sát và câu hỏi thực từ SSE. Câu hỏi/lỗi kết thúc trạng thái gather đang chạy để không khóa composer vô thời hạn. Nội dung planner chưa được dịch tại frontend.
- `ExecutionProgress`: timeline theo trạng thái đã lưu, nhãn text và icon; thời lượng chỉ khi API cung cấp. Link kết quả chỉ chấp nhận HTTP/HTTPS, `noopener noreferrer`; JSON thu gọn. Kế hoạch đã duyệt nằm trong accordion.
- `ReconciliationNotice`/`PartialFailureModal`: giữ quyền và bằng chứng snapshot; UNKNOWN không có Retry. Escape/đóng không gọi Stop. Dừng cần xác nhận riêng; chống thao tác lặp khi API đang xử lý. Hộp thoại có quản lý focus.
- `ServicesView`: được tải bằng `React.lazy`/Suspense, skeleton cho chunk và request; Error Boundary có tải lại khi chunk lỗi. Danh sách có lỗi/thử lại/trống. Modal cấu hình có trường theo schema API, Allowed Scope, phản hồi lưu thực; không điền sẵn hoặc lưu khóa trong localStorage.
- `AccountSettingsView`: lazy JS/CSS riêng, Suspense dùng fallback có styling tĩnh và cùng Error Boundary. Layout nội dung tối đa1040px, nav220px + gap42px + nội dung; dưới700px nav thành hàng ba nút, card tên/email xếp dọc. Paper20px, heading serif40/33px và sans cho metadata, không thêm shadow lớn. Tên/email chỉ đọc từ User phiên/getMe; không có Save/đổi mật khẩu/role/avatar upload giả. Môi trường cấu hình đặt nhỏ trong card tài khoản. Quản lý dịch vụ chuyển route hiện có; đăng xuất xóa phiên trình duyệt hiện tại. Section account/archived/deleted được whitelist, lưu query theo thao tác và nghe popstate; listener được tháo khi unmount. Danh sách dùng lại SidebarHistory/API/actions, có search/loading/error/retry/empty, chỉ cập nhật sau success. Mục Đã xóa khóa mở nội dung và có Khôi phục. Giữ title đã lấy từ tin nhắn khi response restore không có title, không tạo tên giả. Reduced-motion bỏ entrance200ms/translate4px.

## Trạng thái và giới hạn

### Đăng nhập, đăng ký và nhận diện Planora (UI-05, 03/10/2026)

Tên sản phẩm, wordmark, monogram, favicon, title trang và nhãn trợ lý là Planora. Footer không hiển thị tín chỉ môn ATI theo yêu cầu UI-06; tên kỹ thuật của repo, class CSS và tài liệu lịch sử được giữ. Monogram P và nét chéo định hướng dùng chung trong Brand/avatar/hero/favicon, SVG native, không CDN.

Composition auth `.ati-login`: max1360px, tỷ lệ1.2/0.8, form420px, gap52–100px; nền giấy xanh kem, serif46–50px/italic. `LoginStory` nay là minh họa các lớp giấy và biểu tượng P, heading “Điều lớn lao, từ một khởi đầu nhỏ.”. Bỏ ba tab/quy trình lặp với homepage, không status hay API giả. UI-06 thêm motion CSS 6s ease-in-out: cụm giấy dịch lên tối đa6px, biểu tượng P có độ nổi thêm3px và nghiêng2°, bóng và chữ đứng yên. Các wrapper SVG tách transform animation khỏi tọa độ SVG gốc; không state/timer/listener mới. Reduced-motion tắt cả hai animation. SVG trang trí aria-hidden. Mobile≤760px form trước, editorial sau; font input16px, target≥44px, màn320px không tràn.

Form đăng nhập giữ required/autocomplete/icon/focus ring/hiện mật khẩu/Caps Lock/aria-busy và guard pending. “Tạo tài khoản” dẫn tới signup thật nếu `/api/auth/config` cho phép; lỗi chưa xác minh cho gửi lại email thật. Không tạo Google/quên mật khẩu khi backend chưa hỗ trợ.

Signup lazy riêng: tên≤100, email≤254, mật khẩu12–128 và nhập lại; min/max/required + validation server, lỗi có role alert. Chỉ success202 mới chuyển sang kiểm tra email, xóa mật khẩu khỏi React state. Không lưu mật khẩu, token xác minh hay draft vào localStorage. Login↔signup giữ next/c/section đã whitelist. VerifyEmail lazy riêng, token bỏ khỏi URL trong layout effect, promise ref tránh gọi hai lần ở StrictMode.

Backend PostgreSQL: migration0004/0005 chạy lặp; user cũ active/verified, user mới pending/unverified/member. Mật khẩu PBKDF2 hiện có. Token email/refresh32bytes ngẫu nhiên, DB lưu SHA256. Verify một lần24h không tự active; quản trị duyệt chỉ pending đã verified qua UPDATE có điều kiện. Sidebar Settings có Duyệt tài khoản chỉ cho admin, danh sách20/page + search/loading/error/retry, xác nhận quyền dùng dịch vụ chung trước khi duyệt; API là nguồn quyết định, chỉ cập nhật sau success.

AccessJWT15phút có session ID; middleware đối chiếu phiên, active/verified trong DB. Refresh opaque7ngày xoay atomically, grace30giây cho token liền trước, lịch sử token phát hiện replay và thu hồi phiên. Logout thu hồi phiên server; logout-all API có nhưng UI hiện chỉ đăng xuất thiết bị này. CLI provision tạo admin active/verified và thu hồi phiên cũ khi đổi mật khẩu. SERVICE_ADMIN_USER_IDS vẫn tương thích.

Login5lần sai/(IP,email)/15phút, signup10/IP/giờ, resend3/email/giờ; Retry-After429. Giới hạn in-memory theo tiến trình, chưa chia sẻ giữa replica hoặc restart. Sandbox/CI ghi email_outbox; live dùng nodemailer SMTP TLS với SMTP_HOST/PORT/USER/PASSWORD, MAIL_FROM, APP_BASE_URL HTTPS; thiếu cấu hình live dừng. SMTP chưa kiểm với tài khoản/email thật. Signup không khả dụng khi storage in-memory; có thể đóng bằng AUTH_SIGNUP_ENABLED=false mà verification/resend vẫn dùng được.

Chưa gồm Google login, reset/change password tự phục vụ, edit profile, admin disable/enable/role hoặc audit database đầy đủ; không coi UI-05 hoàn thành toàn bộ AUTH-01→06. Preview sandbox dùng schema riêng, không cấp credential dịch vụ thật.

### Dịch vụ công khai và footer

Navbar Dịch vụ dẫn tới `#services`, tách khỏi logo marquee `#ecosystem`. Direct fragment từ footer được khôi phục sau React mount. Thứ tự landing UI-06: hero → logo marquee → Cách hoạt động và roadmap → thông tin Dịch vụ → CTA → footer. PublicServices max1184px, lề48px desktop/20px mobile; grid3cột rồi1cột≤760px. Mỗi dịch vụ có logo chính thức tự host, mô tả khớp tool catalog và vignette có nhãn VÍ DỤ. Không báo connected hay kết quả thực thi thật. CTA dẫn tới trang quản lý dịch vụ, cần login khi chưa có phiên; không gọi provider. Google Sheets/Calendar/Notion/Telegram/Jira vẫn roadmap riêng.

PublicFooter dùng chung landing/login/signup/verify: chữ ký Planora, hai dòng serif và navigation Cách hoạt động/Dịch vụ/Workspace đều có đích thật, tagline và link đầu trang; bỏ credit môn ATI theo UI-06. Desktop3cột, mobile1cột; không thêm số liệu/social/legal link giả. Hover mũi tên nhỏ180ms, reduced-motion tắt. Hero360°, float, độ dày và marquee hiện có được giữ.

“Đã cấu hình” chỉ nghĩa API báo có cấu hình. “Kiểm tra thành công” chỉ sau kết quả `/test` trong phiên này; latency chỉ khi API trả về. Không coi lưu cấu hình là đã xác minh kết nối. Máy chủ thực thi quyền quản trị cấu hình; frontend không dựng role picker giả.

Nhãn runtime frontend lấy từ `RUNTIME_MODE` khi chạy/build. Theo yêu cầu03/10, `RuntimeNotice` không hiện banner thường trực với live hoặc sandbox; mode chưa biết vẫn nhắc kiểm tra cấu hình. Nhãn môi trường chuyển vào Cài đặt tài khoản. API health chưa trả runtime mode nên nhãn cấu hình không tuyên bố xác minh backend; không tự đổi cấu hình để giả live. Dữ liệu ví dụ vẫn có nhãn. Không đổi cơ chế duyệt, permission hoặc trạng thái execution.

### Nội dung sản phẩm (03/10/2026)

Ưu tiên ngắn, tự nhiên và hướng đến thao tác người dùng; không đặt giải thích triển khai/test trong UI. Login chỉ giữ form và nội dung sản phẩm, không quảng bá các tính năng tài khoản chưa hỗ trợ. Sidebar bỏ dòng “Quản lý tài khoản · Roadmap” không có thao tác tương ứng. Gợi ý workspace dùng “Chọn một gợi ý hoặc viết điều bạn muốn làm.”; vẫn chỉ prefill draft, không gửi tự động. Dịch vụ hướng dẫn kiểm tra kết nối sau khi lưu, thông tin dùng chung/quyền quản trị nằm trong modal; không giải thích API/server/localStorage trong sản phẩm. Scope bỏ thuật ngữ Allowed Scope trên nhãn nhưng giữ đúng giới hạn đọc/ghi. Các trạng thái Đã cấu hình/Chưa cấu hình/Kiểm tra thành công vẫn lấy từ API và thao tác kiểm tra, không biến thành Đã kết nối mặc định.

Landing bỏ chữ “demo” trong tài nguyên ví dụ (frontend/web-app), bỏ nhãn Minh họa lặp ở từng preview, giữ nhãn ví dụ một lần theo từng nhóm và tên truy cập “Ví dụ về …”. Chat mẫu nêu cả GitHub/Trello/Slack để khớp hành động ba bước. “Hoàn tất quy trình mẫu” đổi thành “Công việc đã được kết nối”. Roadmap gọi “Dự kiến”, mô tả ngắn “Các kết nối dự kiến chưa khả dụng”, không đặt thời hạn hay tự tuyên bố đang phát triển. HTTP gateway fallback502/503/504 được userError đổi thành “Tạm thời không thể kết nối đến máy chủ.”; lỗi nghiệp vụ cụ thể vẫn giữ nguyên và trạng thái lỗi không thay đổi, không thêm retry cho ghi chưa rõ.

Đã có UI nối API: đăng ký, xác minh email, quản trị duyệt tài khoản, phiên PostgreSQL/refresh/logout, đăng nhập, chat, làm rõ, duyệt/hủy, tiến trình/kết quả, snapshot/history, Cài đặt thông tin tài khoản/phiên, danh sách lưu trữ/xóa mềm/khôi phục, recovery và cấu hình/kiểm tra GitHub/Trello/Slack. Roadmap: quên/đổi mật khẩu, chỉnh sửa hồ sơ, Google login; Google Sheets/Calendar, Notion, Telegram, Jira. Chưa bổ sung resourceLabels, pagination, đổi tên/ghim, dịch planner, quản trị khóa/đổi vai trò tài khoản hoặc runtime health. Không coi UI-01/UI-02/UI-03 là hoàn tất FE-01/02/03.

### Lưu trữ, xóa và khôi phục (UI-02)

`GET /api/conversations?filter=active|archived|deleted` mặc định active; mỗi danh sách tối đa50. `POST /:id/archive`, `DELETE /:id` (204) và `POST /:id/restore` đều xác thực và kiểm tra owner. Migration `db/v3/0003_conversation_visibility.sql` thêm `archived_at`/`deleted_at` riêng với workflow status; áp dụng trước khi chạy API mới.

Lưu trữ ẩn khỏi Gần đây nhưng URL hội thoại còn cho mở và đọc. Banner Khôi phục ở workspace, composer readonly, không hiển thị xử lý giả và không cho gửi/duyệt khi còn lưu trữ. API cũng chặn gửi/duyệt409. Khôi phục đưa về Gần đây; phản hồi chậm của hội thoại trước không mở khóa hội thoại mới. Xóa có xác nhận và xóa mềm; copy nói rõ nội dung được giữ lại, không dẫn tới mục chưa có trong UI. Get/message/plan/SSE mới không mở hội thoại đã xóa. Tin nhắn, plan, output và trạng thái thực thi giữ nguyên.

Workspace chỉ render danh sách active. UI-03 dùng API archive/deleted/restore và cùng history component để hiển thị, tìm và khôi phục hai danh sách trong Cài đặt. Không thay dữ liệu hội thoại cũ khi chuyển các danh sách khỏi sidebar. Hồ sơ tài khoản vẫn chỉ đọc, chưa có API chỉnh sửa/đổi mật khẩu.

API từ chối lưu trữ/xóa khi có plan chưa kết thúc (pending chưa hết hạn, approved, executing, partial, reconciliation_required), yêu cầu hủy kế hoạch hoặc xử lý quy trình trước. Transaction khóa conversation rồi plans; cùng parent lock với tạo plan, không Stop ngầm hoặc bỏ mất kết quả chưa rõ. UI khóa thao tác khi đang streaming hội thoại hiện tại; server là nguồn quyết định cuối. Thao tác chỉ cập nhật list sau success; pending chống bấm trùng, lỗi giữ dòng/cache/query và cho thử lại.

## Kiểm chứng

### Motion (03/10/2026)

Motion được tách trong `src/motion.css`, không cài thư viện. Token: phản hồi nút 160ms, drawer/dialog 320ms, vào trang 520ms; easing `cubic-bezier(0.22, 1, 0.36, 1)`. Dịch chuyển ngắn 12px, không animate kích thước feed/composer hoặc từng token SSE. Card dịch vụ và bước kế hoạch xuất hiện lần lượt, khoảng cách 70–80ms. CTA hover/nhấn chỉ chuyển động khi có con trỏ chính xác; nút disabled không có hiệu ứng bấm.

Landing có hero/illustration xuất hiện theo nhịp, ba bước minh họa lần lượt. Phần dưới dùng scroll story và reveal bằng IntersectionObserver theo mục bên dưới, thay các animation-timeline cũ để không chồng transform. Ngoài hero float, marquee và minh họa giấy auth được chủ dự án yêu cầu, không thêm chuyển động trang trí lặp. Chỉ trạng thái `running` thật có halo/spinner; `succeeded` thật có check ngắn. Modal vẫn giữ focus trap/đóng ngay, drawer giữ inert, không trì hoãn API hoặc thao tác duyệt để chờ animation. `prefers-reduced-motion: reduce` tắt toàn bộ animation/transition/smooth scroll, nội dung và nhãn loading vẫn đọc được.

### Scroll story và tương tác landing (03/10/2026)

Giữ bố cục/nền/type của B, hero 3D và marquee18s. `use-landing-story` và `landing-story.css` chỉ áp dụng landing; không thư viện mới. How-it-works giữ ba cột desktop và chuyển dọc mobile≤760px. Đường kẻ phía trên dùng fill xanh muted và token6px, không glow. Scroll rAF tính progress từ vị trí section; các bước lần lượt active/passed/waiting, chỉ cập nhật data-stage khi đổi bước. Desktop token qua nửa tuyến kích hoạt02, gần cuối kích hoạt03; giới hạn range theo độ dài trang để03 vẫn đạt trước footer. Mobile tính tuyến theo khoảng cách thực giữa bước01 và03. Không pin, không kéo dài trang bằng spacer, không chặn wheel/touch scroll.

Các mô tả accessible; bước chưa đến chỉ giảm nhấn nhẹ sau khi card vào viewport. Fragment là giao diện nhỏ:01 có tác giả Bạn, bubble lời nhắn và biểu tượng gửi tĩnh;02 có ba hàng logo GitHub/Trello/Slack, hành động/nơi nhận và dải Chờ bạn duyệt;03 có cùng nơi nhận, kết quả và dấu check, dải Công việc đã được kết nối. Mỗi preview có role group và tên truy cập “Ví dụ về …”; một nhãn chung VÍ DỤ: MỘT YÊU CẦU, BA BƯỚC, không lặp Minh họa trong mỗi card. Preview không có button/input/link giả hoặc handler/API, không tự thực thi hay báo trạng thái hệ thống thật. Dùng Icon Lucide và ServiceLogo hiện có, SVG local, alt rỗng cho logo trang trí. Khung radius12px, nền #fffef9, min-height248px, icon14px, logo18px; tên hành động11px, nơi nhận9px; text dài wrap, không cắt thông tin. Preview01 dùng flex để footer nằm dưới, các preview thẳng hàng ở desktop. Transitions380–400ms, dịch fragment tối đa6px. Hai dòng serif dùng mask và reveal750ms, stagger90ms khi vào viewport một lần; supporting copy/eyebrow lệch độ sâu≤10px desktop, mobile0px. Không animate từng chữ.

Theo yêu cầu làm nổi bật ba bước: mỗi bước có bề mặt paper, viền #dedfd1, radius18px, padding25/24/23px; số serif34px. Bước active nền #f0f3e7 và viền #aab99a. Desktop fine pointer có hover nhấc6px/280ms, viền #8fa181, nền #fffef9 và bóng mềm; nội dung của bước được hover hiện đầy đủ. Transform chỉ dịch card, không đổi kích thước hoặc vị trí đường tiến trình. Grid cách rail20px; heading dành tối thiểu2.2em và fragment đẩy xuống đáy để nội dung thẳng hàng. Mobile≤760px: radius16px, padding22/19/20px, gap20px, rail bên trái card18px, bắt đầu43px theo tâm số bước. Không hover lift ở mobile hoặc reduced-motion; vẫn đọc đủ nội dung, không thêm state/listener hay vòng animation.

Scroll reveal: tích hợp, từng card01/02/03, roadmap và CTA được quan sát độc lập bằng IntersectionObserver hiện có (threshold0.12). Chỉ khi phần tử vào vùng nhìn mới data-revealed=true rồi unobserve; xuất hiện một lần, không ẩn lại khi cuộn ngược. Opacity0→1 và translate14px→0 trong650ms; ba card desktop stagger0/75/150ms, mobile không delay. Dùng thuộc tính translate riêng, không ghi đè transform hover; layout/khoảng cách rail giữ nguyên. Nội dung luôn có trong DOM, không aria-hidden; focus-within hiện ngay cho các section có control. Không setState theo scroll hoặc thêm observer/rAF. Khi reduced-motion hoặc thiếu IntersectionObserver, data-landing-motion không bật, toàn bộ nội dung hiển thị tĩnh. Hero vẫn dùng entrance/float/drag riêng, không áp reveal lần hai.

Nút Dự kiến có min-height44px, aria-expanded/controls, mở/đóng nội dung inline; Enter/Space/click và Escape dùng được. Connector vẽ400ms trước tên350ms (delay220/300ms), panel mở dịch6px trong350ms. Hai nhóm: Đã tích hợp GitHub/Trello/Slack; Đang lên kế hoạch năm dịch vụ còn lại, ghi chưa khả dụng. Không tự chia NEXT/LATER hoặc thời hạn. Mở panel thêm chiều cao theo thao tác có chủ đích; không modal hoặc auto-open khi hover/focus.

CTA cuối giữ panel xanh nhạt. Desktop fine pointer và width>760px: lớp ánh sáng giấy rất nhẹ dịch±8px; nút magnetic dịch tối đa±3px theo hai trục, mũi tên hover4px. Không chặn pointer/click hoặc làm nút đuổi con trỏ. Press của các nút landing scale0.985/160ms; text nav có underline200ms. Không thêm cursor-following vào text/cards/numbers; card chỉ có hover lift theo yêu cầu trên. Mobile không có light/magnetic/parallax. Hero pointer logic không sửa.

Reduced-motion hoặc không có IntersectionObserver: toàn bộ story/text hiển thị tĩnh, không token/reveal/parallax; reduced-motion tắt cả float/marquee/inertia/light/magnetic, roadmap vẫn mở bằng nút. CSS default là readable; data-landing-motion chỉ bật enhancement khi observer có sẵn. Hook nghe scroll passive, chỉ lấy mẫu khi section gần viewport, gộp mỗi frame; không setState theo scroll/pointermove, không loop rAF idle. Cleanup observers/listeners/frames và media-query handlers khi unmount. Roadmap chỉ dùng state khi người dùng toggle.

### Hero vật lý 3D (yêu cầu bổ sung 03/10/2026)

Góc khi mở landing: desktop X=6°, Y=−12° để lộ cạnh nhẹ và tương tự ảnh chủ dự án chọn; viewport≤760px X=0°, Y=0° để đọc dễ hơn. Hook đặt góc một lần trước first paint bằng useLayoutEffect. Góc được dùng làm điểm bắt đầu cho drag/keyboard; rerender và float resume không đặt lại. Reload hoặc mount mới khởi tạo lại theo viewport lúc mở, resize trong phiên giữ góc đã chọn.

Độ dày bổ sung: 14px desktop, 10px ở breakpoint≤760px. Giữ mặt trước ở mặt phẳng Z=0, mặt sau lùi theo độ dày; 14 lớp đặc bo góc xen giữa tạo cạnh xanh kem liên tục khi xoay. Các lớp trang trí absolute, aria-hidden và pointer-events:none, không tham gia layout/focus. Front/back và cạnh dùng cùng góc nghiêng Z để các mép khớp nhau. Không thêm ảnh, canvas hoặc thư viện 3D.

Riêng hero được chủ dự án yêu cầu float liên tục ±6px (từ 0 lên −6px rồi về 0), thay entrance xoay cũ. Nhịp cập nhật từ5s xuống4s theo yêu cầu tăng tốc nhẹ; hai mặt thêm bóng mềm `0 6px 16px #2e382d08, 0 22px 42px -16px #2e382d24`. Giữ mặt trước `.hero-visual` nguyên nội dung/kích thước, thêm cấu trúc `hero-perspective → hero-float → hero-rotator → hero-front / hero-back`. Perspective1200px; mặt sau nền xanh kem, chữ Planora và “Ý tưởng → Kế hoạch → Hành động”, cùng GitHub/Trello/Slack. Hai mặt backface hidden, mặt khuất inert/aria-hidden.

Hook `use-hero-motion` dùng refs và rAF, không setState khi pointermove. Ngưỡng5px; Y tăng0.35°/px không giới hạn; X giảm0.15°/px, giới hạn±12°. Chỉ capture pointer và tắt selection khi kéo thật. Touch dùng `pan-y pinch-zoom`, nhường gesture dọc cho cuộn; click thường vẫn truyền đến con, click ngay sau kéo bị chặn. Float được pause bằng play-state nên giữ đúng phase, resume sau400ms và giữ góc. Inertia ngang tối đa0.08°/ms, friction85ms, dừng theo thời gian thực≤240ms; grab mới hủy ngay. Reduced-motion tắt float qua CSS và inertia qua matchMedia, vẫn kéo được. Phím trái/phải khi focus rotator xoay15°, không lấy phím của controls con. Unmount hủy frames/timers/listener. Đây là ngoại lệ có chủ đích cho quy tắc không lặp animation trang trí của bản motion trước.

Các kiểm thử frontend bao gồm input đa dòng/IME, gửi trùng, thiếu plan ID, link an toàn, đóng lỗi không Stop, xác nhận dừng, dịch vụ/API lỗi và Back cùng workspace. Bộ check chuẩn kiểm tra frontend, backend và packages. Browser QA chạy local sandbox, desktop 1440×900 và mobile 390×844; không lưu credential dịch vụ hoặc gọi thao tác ghi thật. Bằng chứng và số lượng kiểm thử cuối nằm trong task UI-01 và handoff log tương ứng.
