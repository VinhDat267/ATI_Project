# ATI · Giao diện B được chọn

Ngày triển khai: 02/10/2026. Phạm vi: frontend v3 trong `apps/chat-web`. Chủ dự án đã chọn bộ preview B nền ấm. Tài liệu này mô tả giao diện đã triển khai; đặc tả v3 vẫn là nguồn chuẩn về nghiệp vụ. Hai tài liệu DESIGN cũ ở gốc và `System Design/` không mô tả bộ B này.

## Bốn giao diện

| Giao diện | URL trong ứng dụng | Nội dung và nguồn dữ liệu |
| --- | --- | --- |
| Giới thiệu | `/?view=landing` | Nội dung sản phẩm; mẫu ba bước có nhãn “VÍ DỤ MINH HỌA”; CTA đến đăng nhập/workspace |
| Đăng nhập | `/?view=login` | Email/mật khẩu do người dùng nhập, hiện/ẩn mật khẩu, lỗi và trạng thái gửi; API login/me/refresh hiện có. Đã đăng nhập thì dùng workspace |
| Workspace | `/?view=workspace&c=<id>` | Chat, làm rõ yêu cầu, khảo sát, kế hoạch chờ duyệt, tiến trình, kết quả và phục hồi trong cùng một màn hình; dữ liệu từ API/SSE/snapshot đã lưu |
| Dịch vụ | `/?view=services&c=<id>` | Cùng sidebar/header với workspace; danh mục, phạm vi và nhãn trường từ API; cấu hình và kiểm tra là hai thao tác riêng |

Điều hướng dùng History API và tham số query; không thêm thư viện router. `c` giữ hội thoại khi đi sang dịch vụ. Back/Forward và mở trực tiếp URL khôi phục hội thoại. Cập nhật URL ngay lúc chọn để phản hồi chậm không phục hồi lựa chọn cũ. Tải hội thoại có guard theo lượt chọn và revision kế hoạch.

## Bản sắc và hệ thống thị giác

| Token | Giá trị | Cách dùng |
| --- | --- | --- |
| Canvas | `#f8f4eb` | Nền kem ấm |
| Paper | `#fffdf7` | Card, composer, hộp thoại |
| Sidebar | `#eee9dd` | Không gian điều hướng |
| Ink | `#2e382d` | Nội dung chính |
| Muted | `#656b5b` | Giải thích và metadata |
| Green | `#3c5741` | CTA, nhận diện ATI, thành công |
| Line | `#deded0` | Ranh giới nhẹ |
| Pending | `#f6e6cf` / `#85532b` | Trạng thái chờ duyệt |
| Error | `#f8e6df` / `#9a3f32` | Lỗi, có nhãn bằng chữ |
| Unknown | `#eee6f2` / `#654576` | Chưa rõ kết quả, tách khỏi lỗi |

Be Vietnam Pro 400/500/600 tự host trong `public/fonts` (kèm OFL), không dùng CDN. Times New Roman/Georgia cho tiêu đề và số bước; font sans cho nội dung/nút; Consolas cho mã và JSON. Nhịp spacing 8/12/16/24/32/48px, sidebar desktop 248px, nội dung chat tối đa 1120px. Surface bo 16–24px, CTA bo pill, shadow nhẹ. Logo là chữ a và các nút nối, sử dụng cùng một hình trong avatar/fav icon.

### Logo dịch vụ (03/10/2026)

`ServiceLogo` trong `Brand.tsx` là nguồn hiển thị chung cho assets tự host; `Icon` chuyển tên dịch vụ sang component này, còn icon điều hướng/trạng thái/thao tác vẫn dùng Lucide. GitHub/Trello/Slack dùng cùng mark chính thức ở card dịch vụ, hero, marquee, bước kế hoạch và gợi ý workspace/đăng nhập hiện có. Giữ tỷ lệ bằng object-fit:contain, màu gốc, không xoay/phóng logo khi hover card; img decorative khi đã có tên bằng chữ. Kích thước theo ngữ cảnh: card32px, hero22px, kế hoạch23px, mặc định20px; không đổi bố cục các bước/nút.

Google Sheets, Google Calendar, Notion, Telegram và Jira có asset tương ứng trong chip roadmap. Logo chỉ nhận diện dịch vụ; nhãn Roadmap và nội dung chưa thể cấu hình vẫn giữ nguyên, không tạo trạng thái tích hợp mới. Tên không có trong danh mục asset dùng icon grid dự phòng. Nguồn chính thức và tên file gốc ghi ở `public/logos/README.md`; không tải logo từ CDN trong lúc dùng ứng dụng.

## Workspace và component

Landing: khu tích hợp có heading “Các dịch vụ đã có tích hợp” căn giữa, đứng yên; ba mark GitHub/Trello/Slack phía dưới chạy marquee ngang sang trái theo yêu cầu bổ sung. SVG chính thức giữ màu/hình dạng, lưu cục bộ ở `public/logos` kèm README nguồn; tên là text native ATI, img decorative. Bốn nhóm giống nhau trên track max-content, dịch−25% trong18s linear infinite (một nhóm mỗi vòng), không đo kích thước bằng JS. Nhóm đầu có list accessible, ba bản sao aria-hidden. Viewport marquee tối đa720px, overflow hidden và mask mờ6% hai đầu; không tràn trang. Desktop mark32px/tên22px/gap64px; mobile giữ hàng ngang tên18px/gap40px. Hover con trỏ chính xác tạm dừng, rời ra tiếp tục từ phase hiện tại. Theo yêu cầu mới nhất, không có nút tạm dừng hoặc state/timer điều khiển marquee. Reduced-motion bỏ animation/mask/bản sao, chỉ hiện ba dịch vụ tĩnh căn giữa và wrap khi cần (mobile mark trên tên16px). Không dùng badge trạng thái kết nối hoặc thêm dịch vụ roadmap vào hàng này.

- `Workspace`: shell, lịch sử, tài khoản, header; desktop hai cột. Dưới 1024px sidebar thành drawer; đóng bằng backdrop/Escape, khóa nội dung phía sau bằng inert và trả focus về nút menu. Tiêu đề mobile giới hạn hai dòng.
- `ChatContainer`: một textarea dùng chung, Enter gửi, Shift+Enter xuống dòng, không gửi khi IME đang ghép chữ. Chặn gửi trong khi chuẩn bị/thực thi; gợi ý và “Sửa qua chat” chỉ điền draft. Feed cuộn riêng, chỉ tự cuộn khi người dùng đang gần cuối. `role=log` và live region thông báo nội dung mới.
- `MessageItem`: tin người dùng có đường màu đất, tin ATI dùng avatar nhận diện; thời gian lấy từ dữ liệu đã lưu, không tạo thời gian giả cho dữ liệu thiếu timestamp.
- `PlanPreview`/`PlanStepItem`: ba card màu nền nhẹ, số bước lớn, tool, đọc/ghi, mô tả, tài nguyên, payload và phụ thuộc. Desktop rộng dùng ba cột; tablet/mobile chuyển thành chuỗi dọc. Chưa có backend resourceLabels nên giữ ID đúng dữ liệu và ghi rõ “(ID)”; không suy đoán tên tài nguyên. Tool chưa biết được ghi “Chưa phân loại”.
- `PlanActions`: thanh duyệt cố định phía trên composer; CTA “Duyệt và thực thi”, “Sửa qua chat”, “Hủy”. Không có ID kế hoạch thì khóa duyệt; đang gửi duyệt thì khóa ba thao tác. Lỗi hủy giữ kế hoạch để người dùng xem và thử lại.
- `GatherProgress`/`ClarificationCard`: hiện tiến trình khảo sát và câu hỏi thực từ SSE. Câu hỏi/lỗi kết thúc trạng thái gather đang chạy để không khóa composer vô thời hạn. Nội dung planner chưa được dịch tại frontend.
- `ExecutionProgress`: timeline theo trạng thái đã lưu, nhãn text và icon; thời lượng chỉ khi API cung cấp. Link kết quả chỉ chấp nhận HTTP/HTTPS, `noopener noreferrer`; JSON thu gọn. Kế hoạch đã duyệt nằm trong accordion.
- `ReconciliationNotice`/`PartialFailureModal`: giữ quyền và bằng chứng snapshot; UNKNOWN không có Retry. Escape/đóng không gọi Stop. Dừng cần xác nhận riêng; chống thao tác lặp khi API đang xử lý. Hộp thoại có quản lý focus.
- `ServicesView`: được tải bằng `React.lazy`/Suspense, skeleton cho chunk và request; Error Boundary có tải lại khi chunk lỗi. Danh sách có lỗi/thử lại/trống. Modal cấu hình có trường theo schema API, Allowed Scope, phản hồi lưu thực; không điền sẵn hoặc lưu khóa trong localStorage.

## Trạng thái và giới hạn

“Đã cấu hình” chỉ nghĩa API báo có cấu hình. “Kiểm tra thành công” chỉ sau kết quả `/test` trong phiên này; latency chỉ khi API trả về. Không coi lưu cấu hình là đã xác minh kết nối. Máy chủ thực thi quyền quản trị cấu hình; frontend không dựng role picker giả.

Nhãn runtime frontend lấy từ `RUNTIME_MODE` khi chạy/build. API health hiện chưa trả runtime mode nên nhãn sandbox yêu cầu xác nhận API cùng chế độ, không tuyên bố xác minh backend. Khi chưa biết mode, có hướng dẫn kiểm tra trước khi duyệt ghi. Sandbox trả kế hoạch/kết quả mẫu phải được nhận diện là minh họa.

Đã có UI nối API: đăng nhập, chat, làm rõ, duyệt/hủy, tiến trình/kết quả, snapshot/history, recovery và cấu hình/kiểm tra GitHub/Trello/Slack. Roadmap: đăng ký, quên mật khẩu, Google login, quản lý tài khoản; Google Sheets/Calendar, Notion, Telegram, Jira. Chưa bổ sung resourceLabels, pagination, dịch planner, backend role API hoặc runtime health. Không coi UI-01 là hoàn tất FE-01/02/03.

## Kiểm chứng

### Motion (03/10/2026)

Motion được tách trong `src/motion.css`, không cài thư viện. Token: phản hồi nút 160ms, drawer/dialog 320ms, vào trang 520ms; easing `cubic-bezier(0.22, 1, 0.36, 1)`. Dịch chuyển ngắn 12px, không animate kích thước feed/composer hoặc từng token SSE. Card dịch vụ và bước kế hoạch xuất hiện lần lượt, khoảng cách 70–80ms. CTA hover/nhấn chỉ chuyển động khi có con trỏ chính xác; nút disabled không có hiệu ứng bấm.

Landing có hero/illustration xuất hiện theo nhịp, ba bước minh họa lần lượt. Phần dưới dùng scroll story và reveal bằng IntersectionObserver theo mục bên dưới, thay các animation-timeline cũ để không chồng transform. Ngoài hero float và marquee được chủ dự án yêu cầu, không thêm chuyển động trang trí lặp. Chỉ trạng thái `running` thật có halo/spinner; `succeeded` thật có check ngắn. Modal vẫn giữ focus trap/đóng ngay, drawer giữ inert, không trì hoãn API hoặc thao tác duyệt để chờ animation. `prefers-reduced-motion: reduce` tắt toàn bộ animation/transition/smooth scroll, nội dung và nhãn loading vẫn đọc được.

### Scroll story và tương tác landing (03/10/2026)

Giữ bố cục/nền/type của B, hero 3D và marquee18s. `use-landing-story` và `landing-story.css` chỉ áp dụng landing; không thư viện mới. How-it-works giữ ba cột desktop và chuyển dọc mobile≤760px. Đường kẻ phía trên dùng fill xanh muted và token6px, không glow. Scroll rAF tính progress từ vị trí section; các bước lần lượt active/passed/waiting, chỉ cập nhật data-stage khi đổi bước. Desktop token qua nửa tuyến kích hoạt02, gần cuối kích hoạt03; giới hạn range theo độ dài trang để03 vẫn đạt trước footer. Mobile tính tuyến theo khoảng cách thực giữa bước01 và03. Không pin, không kéo dài trang bằng spacer, không chặn wheel/touch scroll.

Các mô tả luôn hiện và accessible; bước chưa đến chỉ giảm nhấn nhẹ. Fragment không nền/card: câu yêu cầu, ba dòng kế hoạch, ba dòng kết quả; cả nhóm có nhãn QUY TRÌNH MINH HỌA, không đọc API hoặc giả kết quả thật. Transitions380–400ms, dịch fragment tối đa6px. Hai dòng serif dùng mask và reveal750ms, stagger90ms khi vào viewport một lần; supporting copy/eyebrow lệch độ sâu≤10px desktop, mobile0px. Không animate từng chữ.

Badge Roadmap thành nút44px, aria-expanded/controls, mở/đóng nội dung inline; Enter/Space/click và Escape dùng được. Connector vẽ400ms trước tên350ms (delay220/300ms), panel mở dịch6px trong350ms. Hai nhóm: Đã tích hợp GitHub/Trello/Slack; Đang lên kế hoạch năm dịch vụ còn lại, ghi chưa cấu hình được và chưa có ngày phát hành. Không tự chia NEXT/LATER hoặc thời hạn. Mở panel thêm chiều cao theo thao tác có chủ đích; không modal hoặc auto-open khi hover/focus.

CTA cuối giữ panel xanh nhạt. Desktop fine pointer và width>760px: lớp ánh sáng giấy rất nhẹ dịch±8px; nút magnetic dịch tối đa±3px theo hai trục, mũi tên hover4px. Không chặn pointer/click hoặc làm nút đuổi con trỏ. Press của các nút landing scale0.985/160ms; text nav có underline200ms. Không thêm cursor motion vào text/cards/numbers. Mobile không có light/magnetic/parallax. Hero pointer logic không sửa.

Reduced-motion hoặc không có IntersectionObserver: toàn bộ story/text hiển thị tĩnh, không token/reveal/parallax; reduced-motion tắt cả float/marquee/inertia/light/magnetic, roadmap vẫn mở bằng nút. CSS default là readable; data-landing-motion chỉ bật enhancement khi observer có sẵn. Hook nghe scroll passive, chỉ lấy mẫu khi section gần viewport, gộp mỗi frame; không setState theo scroll/pointermove, không loop rAF idle. Cleanup observers/listeners/frames và media-query handlers khi unmount. Roadmap chỉ dùng state khi người dùng toggle.

### Hero vật lý 3D (yêu cầu bổ sung 03/10/2026)

Góc khi mở landing: desktop X=6°, Y=−12° để lộ cạnh nhẹ và tương tự ảnh chủ dự án chọn; viewport≤760px X=0°, Y=0° để đọc dễ hơn. Hook đặt góc một lần trước first paint bằng useLayoutEffect. Góc được dùng làm điểm bắt đầu cho drag/keyboard; rerender và float resume không đặt lại. Reload hoặc mount mới khởi tạo lại theo viewport lúc mở, resize trong phiên giữ góc đã chọn.

Độ dày bổ sung: 14px desktop, 10px ở breakpoint≤760px. Giữ mặt trước ở mặt phẳng Z=0, mặt sau lùi theo độ dày; 14 lớp đặc bo góc xen giữa tạo cạnh xanh kem liên tục khi xoay. Các lớp trang trí absolute, aria-hidden và pointer-events:none, không tham gia layout/focus. Front/back và cạnh dùng cùng góc nghiêng Z để các mép khớp nhau. Không thêm ảnh, canvas hoặc thư viện 3D.

Riêng hero được chủ dự án yêu cầu float liên tục ±6px (từ 0 lên −6px rồi về 0), thay entrance xoay cũ. Nhịp cập nhật từ5s xuống4s theo yêu cầu tăng tốc nhẹ; hai mặt thêm bóng mềm `0 6px 16px #2e382d08, 0 22px 42px -16px #2e382d24`. Giữ mặt trước `.hero-visual` nguyên nội dung/kích thước, thêm cấu trúc `hero-perspective → hero-float → hero-rotator → hero-front / hero-back`. Perspective1200px; mặt sau nền xanh kem, chữ ATI và “Ý tưởng → Kế hoạch → Hành động”, cùng GitHub/Trello/Slack. Hai mặt backface hidden, mặt khuất inert/aria-hidden.

Hook `use-hero-motion` dùng refs và rAF, không setState khi pointermove. Ngưỡng5px; Y tăng0.35°/px không giới hạn; X giảm0.15°/px, giới hạn±12°. Chỉ capture pointer và tắt selection khi kéo thật. Touch dùng `pan-y pinch-zoom`, nhường gesture dọc cho cuộn; click thường vẫn truyền đến con, click ngay sau kéo bị chặn. Float được pause bằng play-state nên giữ đúng phase, resume sau400ms và giữ góc. Inertia ngang tối đa0.08°/ms, friction85ms, dừng theo thời gian thực≤240ms; grab mới hủy ngay. Reduced-motion tắt float qua CSS và inertia qua matchMedia, vẫn kéo được. Phím trái/phải khi focus rotator xoay15°, không lấy phím của controls con. Unmount hủy frames/timers/listener. Đây là ngoại lệ có chủ đích cho quy tắc không lặp animation trang trí của bản motion trước.

Các kiểm thử frontend bao gồm input đa dòng/IME, gửi trùng, thiếu plan ID, link an toàn, đóng lỗi không Stop, xác nhận dừng, dịch vụ/API lỗi và Back cùng workspace. Bộ check chuẩn kiểm tra frontend, backend và packages. Browser QA chạy local sandbox, desktop 1440×900 và mobile 390×844; không lưu credential dịch vụ hoặc gọi thao tác ghi thật. Bằng chứng và số lượng kiểm thử cuối nằm trong task UI-01 và handoff log tương ứng.
