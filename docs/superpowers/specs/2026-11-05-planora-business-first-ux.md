# Planora — UI/UX mới theo công việc của người dùng

**Quyết định của chủ dự án, 05/11/2026:** “Không dựa vào cấu trúc giao diện UI UX cũ hiện tại để refactor. Làm giao diện theo góc nhìn của người dùng, nội dung hiển thị trên trang business-first không được technical. Hãy tự do sáng tạo giao diện UIUX mới theo bản Planora của tôi. Các giao diện đã thực hiện rồi cũng sẽ phải refactor lại nếu không đạt yêu cầu.”

Tài liệu này là chuẩn UX hiện hành của [plan](../plans/2026-11-02-planora-migration.md). Nó thay các chỉ dẫn port/restyle, sao chép bố cục, khóa props/DOM/cấu trúc card và pixel parity cũ khi mâu thuẫn. [Scope main](../../handoff/PLANORA-MAIN-SYNC-2026-11-04.md) vẫn quy định đủ tính năng; [reviewer policy](../../handoff/planora-prompts/REVIEWER-POLICY.md) vẫn dùng Gemini 4 Argon High.

## 1. Đích trải nghiệm và quyền sáng tạo

Planora giúp người dùng tổ chức công việc trên các dịch vụ đã kết nối: nói điều cần làm, hiểu đề xuất, quyết định trước khi tác động, theo dõi kết quả và xử lý việc cần chú ý. Trang phải nói bằng công việc, con người, tài liệu, lịch hẹn và kết quả mà người dùng nhận được.

- Lấy Planora của chủ dự án làm tham chiếu nhận diện: giấy kem, xanh rừng, serif editorial, Be Vietnam Pro, cảm giác bàn làm việc rõ ràng và có chủ đích. Nguồn tham chiếu vẫn `Frontend_UXUI@ef13c56:apps/chat-web/DESIGN.md`; không lấy design Agentic/cockpit hiện tại làm mẫu UX.
- Agent tự quyết bố cục, nhóm thông tin, thành phần, mật độ, thứ tự nội dung, cách tương tác và diễn tiến trang sao cho phù hợp công việc. Đọc code hiện tại để biết capability và hành vi, không dùng cây component, tên file, enum hoặc thứ tự fields làm wireframe.
- Sidebar và hội thoại là hướng quen thuộc của Planora được giữ trong thiết kế chung; không bắt buộc 248px/1024px, kích thước card hoặc từng màn phải giống hình cũ. Chọn responsive theo nội dung và kiểm chứng thực tế. Trang chọn dịch vụ, lịch, inbox, tài khoản không phải gói vào cấu trúc chat/cockpit.
- Có thể viết lại lớp trình bày frontend, composition và props nội bộ, tạo view-model/adapter UI thuần có kiểu dữ liệu, tách hoặc thay renderer. Tái dùng logic có ích nhưng không giữ markup kém chỉ để tiết kiệm thay đổi. Không tự tạo schema/API/DB/permission mới để phục vụ layout.
- Không coi thay màu, bọc thêm card, đổi logo hoặc giữ nguyên dashboard kỹ thuật rồi đổi chữ là hoàn thành. Không cần dựng nhiều phương án hình thức vô ích; agent đề xuất một thiết kế mạch lạc và giải thích bằng nhu cầu người dùng.

## 2. Nội dung business-first trên mọi trang

Mỗi trang phải trả lời rõ: **Tôi đang làm việc gì? Điều gì cần tôi quyết định? Tác động tới ai/đâu? Tôi nên làm gì tiếp?** Chỉ đưa thông tin giúp hoàn thành hoặc quyết định công việc; không lấp chỗ trống bằng cấu trúc backend.

| Nội dung kỹ thuật trong UI cần bỏ/diễn đạt lại | Nội dung người dùng cần thấy |
| --- | --- |
| `myjira.search_issues`, tên adapter/tool | “Tìm công việc bị chặn” và tên dự án Jira |
| `plan_hash`, run/proposal ID, `dependsOn`, graph edges | Nội dung đã chọn để duyệt, thứ tự công việc có ý nghĩa và kết quả cần đạt; hash/ID giữ nội bộ |
| OAuth callback, state, scope_required, reconnect_required | “Đang kết nối…”, “Chọn lịch bạn muốn dùng”, “Kết nối lại tài khoản” kèm lý do và nút phù hợp |
| Payload/JSON/schema/raw API response/stack trace/HTTP code | Xem trước email, công việc, tài liệu hoặc bảng dữ liệu với nhãn quen thuộc; lỗi nêu ảnh hưởng và cách khắc phục |
| `unknown`, `reconciliation_required`, `delivery_unknown` | “Chưa xác nhận được kết quả”, nói rõ phần đã biết và việc an toàn có thể làm; không khẳng định chưa gửi/đã gửi hoặc mời gửi lại khi chưa biết |
| manual/auto_digest, config snapshot/hash | “Duyệt trước mỗi lần chạy” / “Tự gửi bản tin theo lịch”, nguồn, người nhận, thời gian và điều kiện |
| Capability/schema inventory, “9 tools”, số kết nối/metrics giả | Dịch vụ thực tế sẵn sàng giúp làm việc gì, điều kiện còn thiếu và hành động tiếp theo |

Ví dụ chỉ là hướng ngôn ngữ, phải khớp đúng tình huống/API; không thay mọi lỗi bằng một câu chung. Lỗi ảnh hưởng tới công việc phải nhìn thấy, không biến thành trạng thái rỗng.

Không đặt raw JSON, UUID, hash, enum, endpoint, log kỹ thuật hoặc tên hàm vào trang nghiệp vụ, kể cả trong accordion “nâng cao” chỉ để giữ nội dung của UI cũ. Chẩn đoán dành cho kỹ sư ở log/evidence riêng. Mã công việc người dùng dùng hằng ngày như `PROJ-42`, tên repo `owner/repo`, email nhận, tên bảng/lịch, ngày giờ và link tài liệu được giữ khi giúp nhận diện/ra quyết định; không đưa ID kỹ thuật thay cho tên thân thiện. Range bảng tính chỉ hỏi nếu người dùng thật sự phải chọn vùng; dùng nhãn nghiệp vụ và preview.

CTA dùng động từ và tác động: “Gửi bản cập nhật”, “Tạo công việc”, “Lưu lịch”, “Chọn thư mục”, “Kết nối Google”. Với nhiều tác động, dùng “Duyệt và thực hiện” kèm tóm tắt rõ từng tác động. Không dùng jargon engine làm nhãn, không hứa tác động khác contract.

## 3. Thiết kế từ hành trình trước khi chọn component

Mỗi task phải ghi brief ngắn: nhóm người dùng/quyền, công việc chính, điểm vào, nội dung bắt buộc để quyết định, CTA chính, kết quả, bước tiếp theo, trạng thái lỗi và mobile. Từ brief chọn layout mới và viết copy, sau đó ánh xạ dữ liệu/API. File lists trong plan là bản đồ sở hữu/điểm cần đọc, không là danh sách component bắt buộc giữ.

Hành trình đại diện cần thiết kế và kiểm:

1. Người mới hiểu Planora giúp gì → đăng nhập → kết nối dịch vụ cần dùng → thực hiện yêu cầu đầu tiên, không bị đưa thẳng vào trang thiết lập kỹ thuật.
2. “Tóm tắt việc đang bị chặn của nhóm rồi gửi cập nhật”: nhìn được nguồn/dự án, nội dung và nơi nhận → chỉnh nếu cần → duyệt → biết việc đã xong/còn chờ. Không cần hiểu tool graph.
3. “Gửi bản tin mỗi sáng”: chọn nguồn/nơi nhận/ngày giờ/múi giờ → xem lần tiếp theo → hiểu tự gửi hay cần duyệt → quản lý lịch/tạm dừng bằng ngôn ngữ công việc.
4. Trở lại công việc cũ hoặc đề xuất mới: tìm theo tên/nội dung/kết quả → xem việc cần xử lý → phân biệt thông tin đã lưu với hành động hiện hành, không gửi lại từ một preview cũ.
5. Khi thiếu quyền/kết nối hoặc chưa xác định kết quả: hiểu việc bị ảnh hưởng, điều gì đã biết, có thể làm gì tiếp mà không gây gửi/ghi trùng.

Không thêm dashboard, biểu đồ, bước onboarding hoặc tính năng mới chỉ để trông hiện đại; chỉ tạo khi phục vụ hành trình đã có capability. Nội dung minh họa mang nhãn rõ; ảnh người dùng, kết quả và metrics không được giả làm dữ liệu thật.

## 4. Giữ hành vi khi thiết kế lại

Data contracts, auth/permission, user/workspace isolation, route/deep link/Back-Forward, Google/provider identity, approval/hash binding, SSE/recovery priority, stale-response guards và feature flags từ main vẫn là nguồn chuẩn. Có thể đổi props/composition frontend qua typed adapter; phải chứng minh cùng ngữ nghĩa và không nảy sinh tác dụng phụ. Việc bảo toàn **logic** không buộc vẽ lại **cấu trúc máy trạng thái** cho người dùng.

- Luồng hội thoại có một nơi nhập yêu cầu chính, IME/focus/keyboard/scroll tốt; người dùng không phải mở drawer kỹ thuật để hiểu việc đang làm.
- Trước ghi/gửi: thấy chính xác nội dung, nguồn/đích/người nhận và tác động, có cách chỉnh/hủy theo contract; kiểm server binding vẫn tồn tại dù không hiện hash.
- Sau kết nối không tự gửi yêu cầu/duyệt; prefill chỉ điền draft. Lưu cấu hình tự gửi phải giải thích hiệu lực thật; không coi đã kết nối là đã cấp quyền xử lý AI.
- Kết quả thực theo server; không dựng progress %, success, empty, khả năng hay kết nối giả. Unknown không được đổi thành failed để mở nút retry; đóng dialog không ngầm Stop.
- Accessibility/contrast, target tương tác tối thiểu 44px, focus, dark/reduced motion và chống tràn 320px vẫn bắt buộc. Desktop/mobile được thiết kế theo nội dung, không chỉ thu nhỏ cùng một bảng.

## 5. Các phần đã làm phải được đánh giá lại

Review kỹ thuật trước đây, commit đã push hoặc ảnh giống mẫu cũ **không chứng nhận** đạt hướng UX này. Không tuyên bố mọi phần cũ sai khi chưa kiểm; tất cả phần đã có đều cần audit theo tiêu chí mới, phần không đạt phải refactor lại kể cả PL-01–PL-06 đã tích hợp và PL-07 đã viết.

[PLANORA-UX-01](../../handoff/tasks/PLANORA-UX-01-business-first-redesign.md) điều phối audit và phạm vi sửa. Mỗi màn/luồng ghi head đã kiểm, ảnh/ví dụ copy, nhu cầu người dùng, vấn đề/tác động, kết luận **giữ có bằng chứng / cần thiết kế lại / chưa kiểm**, owner task và bằng chứng re-review. Không đổi nhãn báo cáo lịch sử, không reset worktree đang có agent.

Thứ tự: ghi audit/brief UX → chỉnh mẫu đại diện PL-01/02/05/06 → người dùng duyệt hướng hình thức → thực hiện sửa theo owner → Argon review business UX và behavior trên head mới → mới coi phần đó đủ điều kiện tích hợp. Có thể giữ phần đã chứng minh đạt, không bắt viết lại chỉ để đổi file. Những task đã có findings kỹ thuật vẫn phải đóng findings đó.

## 6. Gate chấp nhận cho mọi task và gate cuối

- [ ] Người dùng biết mục đích trang, điều cần chú ý và CTA chính mà không cần hiểu kiến trúc ứng dụng; hierarchy phục vụ quyết định/công việc, không theo thứ tự object fields.
- [ ] Có lý do nghiệp vụ cho mỗi vùng nội dung. Những thông tin cần để duyệt tác động/nhận diện tài nguyên/quyền được giữ, các chi tiết kỹ thuật nội bộ được loại khỏi sản phẩm.
- [ ] Nội dung tiếng Việt tự nhiên, nhất quán và hành động được; lỗi có ảnh hưởng/cách xử lý đúng sự thật, empty có hướng bắt đầu phù hợp, loading không giả tiến độ.
- [ ] Bố cục/thành phần/copy mới được suy từ brief và tham chiếu Planora; không chỉ sơn lại cockpit, schema form, timeline engine hoặc card cũ. Không chấm điểm dựa vào số component viết lại.
- [ ] Có ảnh và walkthrough browser của hành trình chính, ít nhất một tình huống thiếu dữ liệu/quyền/lỗi và mobile/dark; checklist có evidence thật, phần chưa chạy ghi NOT_RUN. Reviewer không dùng screenshot happy path duy nhất để kết luận UX tốt.
- [ ] Typed mapping bảo toàn contract và regression chứng minh không mất luồng nghiệp vụ/quyền; đổi UI-only props hoặc semantic locator theo copy mới không phải lý do xóa kiểm chứng behavior.
- [ ] Các phần đã có được audit và sửa nếu không đạt, có head/owner/re-review mới. Không dùng PASS cũ hoặc việc đã public để miễn gate mới.
- [ ] Gemini 4 Argon High review độc lập cả UX lẫn kỹ thuật; chủ dự án duyệt hình thức; CI và quyền merge theo workflow. Bằng chứng kỹ thuật đạt nhưng UX không đạt vẫn **Chưa đạt** task.

## 7. Phạm vi cập nhật tài liệu này

Chỉ sửa plan/spec/prompt và tạo card audit; chưa kiểm hay thiết kế/triển khai màn cụ thể, chưa audit browser, chưa đổi DAG/context agent, chưa push/PR. Baseline/feature inventory tiếp tục đọc main mới nhất trước triển khai. Các tài liệu private giữ local; log kỹ thuật có thể dùng tên hàm/tool/enum để hướng dẫn kỹ sư, chúng không phải copy được phép đưa lên UI.
