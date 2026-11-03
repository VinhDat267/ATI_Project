# Planora migration — Thiết kế và bảng đối chiếu giao diện

Ngày: 02/11/2026 (Asia/Saigon). Trạng thái: **dự thảo để chủ dự án duyệt; chưa thi công**.

## 1. Yêu cầu và căn cứ

Chủ dự án muốn chuyển **toàn bộ giao diện hiện tại** sang Planora cũ và đã chọn rõ: **“Khôi phục cả bố cục Planora cũ”**. Khôi phục sidebar, hội thoại trung tâm, nền kem/xanh rừng và nhận diện Planora. Các chức năng đã có trên main tiếp tục sử dụng được.

Mốc khảo sát:
- Nền chức năng: `origin/main` tại `1977ec7dc9735e058b64440f965e214b0751fbf8`, gồm JIRA-09A (#258).
- Mẫu hình thức và bố cục: `Frontend_UXUI` tại `ef13c5695ce2da030ff613422b4f8d6e1d7e72c3`.
- Tài liệu đúng màu Planora: `Frontend_UXUI:apps/chat-web/DESIGN.md`. Bản chuẩn hóa `codex/docs/planora-design:DESIGN.md` tại `6b324aa` là tham khảo bổ sung còn draft.
- `Frontend_UXUI:DESIGN.md` vẫn là Airtable/Warm Workshop cũ; `System Design/` là tài liệu thị giác lịch sử khác. **Không dùng hai nguồn đó làm chuẩn Planora và không khôi phục thư mục legacy.**
- PR #262 chỉ là bản nháp công bố nhánh cũ. Chưa xử lý conflict và không chứng nhận tương thích với main.
- Khảo sát này đọc mã nguồn, route, tài liệu và test inventory; **chưa chạy ứng dụng, kiểm thử hay xác nhận ảnh so sánh trực quan**.

Chỉ lựa chọn bố cục cũ là quyết định đã được người dùng xác nhận. Kiến trúc chuyển đổi, dark palette, trình tự task và các bố trí mới dưới đây là **đề xuất kỹ thuật**.

## 2. Phương án

| Phương án | Đánh đổi | Đề xuất |
| --- | --- | --- |
| Merge nguyên nhánh Frontend_UXUI / PR #262 | Mang theo API/auth/migration cũ; 3 commit riêng nhưng chậm 864 commit tại lúc khảo sát; nhiều conflict và thiếu UI cho chức năng mới | Không dùng làm cách chuyển đổi |
| Giữ bố cục hiện tại, đổi màu/font | Ít thay đổi nhưng giữ cockpit/top tabs, không đạt yêu cầu phục hồi cả bố cục | Người dùng đã chọn hướng khác |
| Bắt đầu từ main, chuyển phần trình bày Planora và bù các giao diện thiếu | Cần thiết kế bổ sung và nghiệm thu từng luồng, nhưng giữ được toàn bộ chức năng mới | **Chọn làm đề xuất triển khai** |

Không thay database, API, quyền hạn, provider adapter, prompt/catalog hay giá trị feature flag để thực hiện đổi giao diện. Trường hợp phát hiện thiếu contract thật phải tách task backend, thỏa thuận interface trước; không tự thêm endpoint trong task frontend.

## 3. Ranh giới hệ thống

`App/AuthGate/routes` hiện tại → `Workspace + hooks/apiClient/chat-store` hiện tại → **Planora shell + các view/card trình bày**.

Giữ `Workspace.tsx` làm chủ điều phối hội thoại; `use-sse`, `use-conversation-history`, `use-execution-recovery`, `workspace-storage` và API client tiếp tục làm nguồn dữ liệu. Tách giao diện của Cockpit thành các card hội thoại phù hợp Planora; không chép store/API client/App từ nhánh cũ.

Dữ liệu và permission đến từ API hiện tại. Connected, progress, result, thời gian và nguồn dữ liệu không được tự giả định từ việc có logo. Nội dung ghi hoặc tự động gửi phải giữ đúng chế độ và xác nhận hiện hành của main.

Các PR chưa merge như #256, #259, #260, #261 không được tính là chức năng đã có của mốc này. Trước khi thi công và mỗi lần rebase, kiểm lại diff UI mới merge; Slack cá nhân/Inbox/mode chỉ thêm vào inventory khi thật sự có trong baseline.

## 4. Bố cục đề xuất

### 4.1. Khung đã đăng nhập

Desktop từ 1024px: sidebar 248px theo Planora cũ; nội dung làm việc bên phải, header gọn. Sidebar:
1. Logo Planora, bộ chọn Không gian cá nhân / tổ chức.
2. Hội thoại mới.
3. Hội thoại; Nhật ký (lịch + lượt chạy); Kết nối dịch vụ; Cẩm nang; Người dùng khi có quyền.
4. Tìm kiếm và hội thoại gần đây của không gian hiện tại.
5. Tài khoản, Chính sách an toàn, sáng/tối, đăng xuất.

Dưới 1024px: sidebar thành drawer; mở/đóng, Escape, focus trap/restore, khóa cuộn nền và đóng sau điều hướng. Bộ chọn workspace luôn truy cập được trên mobile, không chỉ ẩn theo breakpoint.

Một main landmark, một h1 cho trang, một global navigation. Các view hiện tự chứa MainNav/main sẽ bỏ lớp wrapper trùng khi chuyển sang shell chung. Loading/error/404 trong vùng đăng nhập vẫn nằm trong khung thích hợp.

### 4.2. Hội thoại làm trung tâm

Giữ sidebar hiển thị, feed gồm yêu cầu của người dùng và phản hồi Planora. Một composer duy nhất ở đáy vùng làm việc. Các trạng thái lập kế hoạch, hỏi lại, duyệt, thực thi, biên nhận, trả lời, lịch và phục hồi trở thành card trong feed; không cần mở drawer mới đọc được hội thoại.

Chủ quyền nội dung:
- Tin đã lưu là bản ghi hội thoại. Card thao tác hiện hành gắn đúng plan/proposal/run ID và chỉ có một bản có thể tương tác.
- Không append lại một preview từ SSE trùng hay từ GET cũ sau khi đã xử lý.
- `selectMoment` vẫn quyết định ưu tiên trạng thái, đặc biệt unknown/reconciliation trước các tin mới.
- Composer nhập tiếng Việt/IME, Enter gửi, Shift+Enter xuống dòng; không tự gửi sau OAuth, không tự duyệt, không nhân đôi ô nhập.
- Cuộn tự động chỉ khi đang gần cuối; khi đang đọc cũ thì thông báo có nội dung mới. Lưu phục hồi hội thoại/draft theo hành vi main, không dùng localStorage chứa nội dung nhạy cảm.
- Chuyển workspace phải reset dữ liệu phụ thuộc workspace như main; không để response/SSE trễ của không gian A ghi lên B.
- Hủy/quay lại/đóng drawer là thao tác trình bày; không ngầm trở thành Stop hay Retry.

### 4.3. Route

Giữ nguyên 22 route entries của main, URL path, anchor dịch vụ, deep link `/c/:id`, Back/Forward và các legacy token link main hiện đã chấp nhận. Không khôi phục query router `?view=...` của App cũ.

Tại `/`, giữ cách AuthGate hiện phân biệt landing khi chưa đăng nhập và workspace khi đã đăng nhập. Header công khai và shell có thể khác, nhưng cùng nhận diện Planora. Các callback giữ chính xác pathname và xử lý code/state một lần.

## 5. Design system

### 5.1. Nền sáng theo bản cũ

| Vai trò | Giá trị |
| --- | --- |
| canvas | #f8f4eb |
| paper | #fffdf7 |
| sidebar | #eee9dd |
| text | #2e382d |
| muted | #656b5b |
| divider | #deded0 |
| primary | #3c5741 |
| primary-hover | #2f4633 |
| primary-soft | #e4e9d8 |
| pending background/text | #f6e6cf / #85532b |
| error background/text | #f8e6df / #9a3f32 |
| unknown background/text | #eee6f2 / #654576 |

Be Vietnam Pro 400/500/600 tự host; heading Times New Roman/Georgia; code dùng font mono. Body cơ sở 14px, nhịp spacing 4/8/12/16/24/32/48/64; nội dung hội thoại tối đa 1120px, public 1280px. Sao chép đúng assets của Planora, giữ logo dịch vụ chính thức và giấy phép font. Không thêm thư viện UI hay đổi framework cho migration.

Màu nhận diện dịch vụ trong logo là ngoại lệ; các nút/trạng thái dùng semantic token, không mỗi dịch vụ một màu CTA. Giữ success, pending, error và unknown phân biệt bằng nhãn/icon.

### 5.2. Nền tối — phải thiết kế bổ sung

CSS Planora cũ không có theme tối; main đang có chọn theme, theo hệ điều hành và đồng bộ tab. Giữ tính năng đó. Đề xuất ban đầu: canvas #171c18, paper #202820, sidebar #151b16, text #f5f1e7, muted #b5bcae, divider #394638, primary #8fb68e, on-primary #132014. Đây là palette mới cần đo contrast và duyệt ảnh; không tuyên bố là bản tối lịch sử.

Giữ key `ati-theme` và sự kiện `ati:theme` để không mất lựa chọn người dùng. Nhãn sản phẩm nhìn thấy đổi sang Planora; không đổi API identifier, URL, OAuth mode, workspace ID hay invite-code format vì tên ATI nằm trong đó.

### 5.3. CSS và component

Tạo `src/planora/styles/{tokens,base,components,shell}.css`; tên semantic `--planora-*` và class `planora-*`. Component chung: Brand, Button, Field, StatusBadge, Dialog, Shell, Sidebar, PublicHeader, AuthFrame, ConnectionCallbackFrame, ChatWorkspace, WorkflowSteps.

Trong giai đoạn chuyển từng nhóm, adapter ngữ cảnh ánh xạ các CSS token hiện có sang Planora; không dựa vào global replace mã hex. Khi mọi trang chuyển xong, bỏ runtime import prototype/style injection không còn dùng; giữ docs/design/prototypes làm tư liệu lịch sử.

Dialog có thể reuse hành vi focus của CockpitDialog; không dựng lại primitive modal chỉ để đổi màu. Chỉ trích các component mới khi có ít nhất hai nơi sử dụng hoặc là ranh giới shell/renderer rõ ràng.

## 6. Inventory — trang và nhóm trang

“Thiếu” trong bảng là **thiếu bản thiết kế/triển khai Planora**, không có nghĩa main thiếu chức năng.

| Nhóm / route hiện tại | Planora cũ | Việc cần làm |
| --- | --- | --- |
| Landing `/` khi chưa đăng nhập | Có, đủ nhận diện/hero/motion | Port markup/assets; nội dung dịch vụ và CTA theo capability hiện tại; thay orbital Make bằng minh họa Planora |
| Login `/login` | Có email/password | Bổ sung Google có điều kiện, vào cá nhân/tổ chức, lỗi/session/return target theo main |
| Signup `/signup` | Có | Bổ sung luồng tạo/tham gia tổ chức hiện tại và các flag/signup policy |
| Verify `/verify-email` | Có một phần | Đủ success/expired/used/unverified, gửi lại, cooldown và các trường hợp error |
| Resend `/resend-verification` | Chưa có route riêng | Thiết kế form và feedback theo AuthAction hiện tại |
| Forgot/reset `/forgot-password`, `/reset-password` | Chưa có | Hai form, trạng thái gửi/xong/link không hợp lệ; giữ rule mật khẩu từ code hiện tại |
| Google login callback `/auth/google/callback` | Chưa có | Pending/ready/error, pending approval, redirect an toàn |
| Workspace `/`, `/c/:id` | Có shell/chat/duyệt/chạy | Giữ hình thức cũ, nối toàn bộ 13 trạng thái selectMoment và trạng thái phụ hiện tại |
| Kết nối `/settings` | Có config chung kiểu cũ | Thiết kế lại cho kết nối cá nhân, phạm vi tài nguyên, quyền admin và workspace hiện tại |
| 7 callback kết nối `/connections/…/callback` | Chưa có | Gmail, Calendar, Sheets, Trello, GitHub, Jira, Telegram; từng provider có luồng khác nhau |
| Tài khoản `/account` | Chỉ thông tin cơ bản/đăng xuất | Chỉnh hồ sơ, đổi mật khẩu, liên kết/bỏ Google, các phiên và thu hồi phiên |
| Nhật ký `/history` | Chỉ sidebar/history và archive trong settings | Trang đầy đủ: tìm/lọc/phân trang theo main, lịch, lượt chạy, kết quả và mở hội thoại |
| Quản trị `/admin/users` | Chỉ trạng thái chờ duyệt bản thân | Trang thành viên, yêu cầu đang chờ, vai trò, khoá/mở, mã mời theo quyền main |
| Cẩm nang `/guide` | Chưa có | Trang công khai/đã đăng nhập, nội dung theo dịch vụ/cờ hiện tại |
| Chính sách `/privacy` | Chưa có | Trang công khai/đã đăng nhập, giữ thông tin thật về dữ liệu/provider/Gmail |
| 404 / hội thoại không tồn tại hoặc không được truy cập | Chưa có trang chuyên biệt | Thiết kế trang lỗi Planora; giữ phân quyền và redirect main |

Không gộp “22 route entries”, “7 view cũ” và số modal thành một số màn duy nhất; chúng là các cách đếm khác nhau.

## 7. Inventory — phần giao diện mới trong các trang

| Phần giao diện | Hiện trạng cần bảo toàn | Cách thể hiện Planora |
| --- | --- | --- |
| Workspace switcher + tạo/tham gia tổ chức | Có trên main; active/pending/disabled; giữ trang khi đổi | Đặt gần đầu sidebar; modal giấy/CTA xanh, badge vai trò/chờ duyệt |
| Admin theo workspace | Quyền admin tổ chức khác quyền admin cá nhân | Nav và trang thay theo workspace; không kiểm chỉ user.role |
| Gmail cá nhân | OAuth riêng, gửi từ/nguồn người nhận/preview | Connection card và preview thư cùng tokens |
| Calendar cá nhân | Chọn lịch/quyền; đích Slack/Telegram và digest nếu API cho phép | List/chọn lịch, config delivery, bản xác nhận rõ nguồn và đích |
| Sheets cá nhân | Google Picker, danh sách đã chọn, quyền chỉ xem/ghi | Khung trước/sau Picker; không skin UI do Google sở hữu; grid preview giữ nguyên giá trị |
| Trello | OAuth cá nhân + admin chọn workspace/bảng + membership | Hai cấp cá nhân/phạm vi nhóm và các notice scope_required |
| GitHub | OAuth và chọn repository, mode/digest hiện có | Card danh tính, scope picker, danh sách repo và đích gửi |
| Telegram | Pairing/deep link/polling, nhóm/chat; đang chờ/hết hạn | Card hướng dẫn và trạng thái kết nối; chọn tên chat |
| Jira JIRA-09A | OAuth, workspace tạo/tham gia, site/project, request/approval quản trị | Các panel/state nền Jira hiện có; không tuyên bố JIRA-08 execution/đầy đủ đã triển khai |
| Slack/Notion và dịch vụ chung | Dùng form/schema có trong baseline | Giữ form theo quyền; không dựng nút OAuth cá nhân nếu API chưa có |
| Lịch chạy | Đề xuất create/update/pause/resume/cancel; lần chạy/múi giờ | Card xác nhận trong chat và nhóm lịch ở Nhật ký |
| Auto-digest | Chế độ khác manual, approval snapshot, kết quả gửi/needs_attention | Phân biệt rõ xác nhận cấu hình tự gửi với duyệt từng lần; giữ lifecycle main |
| Answer / refusal / clarification | Chỉ đọc, thiếu kết nối/phạm vi, hỏi chọn tài nguyên | Card hội thoại có nguồn/CTA thật; chưa được hỗ trợ thì nói rõ |
| Preview và biên nhận | Gmail/Sheets và identity/resource binding của từng provider | Step card đọc/ghi, payload, dependency và links; bỏ hình orbital nhưng giữ data-flow |
| Failure / unknown / restart | Retry/Skip/Stop/Continue theo recoveryActions thực | Card phục hồi rõ hậu quả; unknown không có Retry, đóng dialog không Stop |
| Mất mạng/chờ lâu/hết phiên | Không giả tiến độ, không mất request, không gửi trùng | Banner/inline state Planora trong shell/feed |
| Sáng/tối và reduced motion | Có ở main; bản cũ chỉ sáng | Thiết kế đủ cả hai; motion tắt theo hệ thống |

## 8. Tiêu chí nghiệm thu

1. Các phần đã có mẫu (landing, auth căn bản, sidebar, chat, step card) được đối chiếu ảnh với Planora cũ ở 1440×900 và 375×812; khác biệt vì chức năng mới phải có chú thích.
2. Màn mới theo cùng tokens/component, có ảnh sáng/tối ở 1440, 1024, 768, 375; không tràn viewport ở 320. Bảng/payload được cuộn trong vùng của nó.
3. Bao phủ đủ 22 route entries + 404, 13 trạng thái selectMoment và các trạng thái phụ; không route nào rơi về kiểu cam/Agentic ở runtime sau cutover.
4. Không mất tính năng từ main; không đổi HTTP contract, hash binding, feature flags, nguồn truth hay business-state priority.
5. Đổi workspace trong Settings/History/admin, tạo/join tổ chức, mở lại hội thoại cũ, SSE muộn, OAuth đổi phiên, double click và reload có regression test.
6. Mọi provider bật/tắt, scope thiếu, quyền thiếu, error và callback dùng UI thực; không đặt CTA giả.
7. Không sửa behavior test để hợp thức hóa mất chức năng. Các test pixel/prototype màu cam cũ phải được thay reference có chủ đích theo yêu cầu mới, giữ các assertion nghiệp vụ.
8. Typecheck, web test, full check và bộ browser qua PostgreSQL riêng đạt; CI xanh đúng head và reviewer độc lập trước merge.
9. Không triển khai, merge #262, gọi ghi provider thật, bật flag hay thay DB runtime trong quá trình chỉ đổi giao diện.
10. Mọi lựa chọn về dark palette/bố cục màn mới phải được duyệt bằng một đợt ảnh trước khi làm hàng loạt.

## 9. Điều kiện trước thi công và các điểm để builder quyết

Cần chủ dự án duyệt bản đề xuất này và kế hoạch đi kèm trước khi sửa product code. Chưa yêu cầu người dùng chọn thư viện/framework vì sử dụng stack hiện có. Builder được quyết cách chia helper/CSS bên trong task; không được đổi contract, nav scope, route, trạng thái hay bỏ màn đã kiểm kê.

Task mở màn sẽ chụp baseline và khóa mốc main mới nhất. Nếu có PR chức năng mới vừa merge, cập nhật inventory và task tương ứng trước khi tiếp tục. Chưa ước lượng ngày hoàn tất cố định khi chưa có baseline browser và danh sách merge trong thời gian thi công.
