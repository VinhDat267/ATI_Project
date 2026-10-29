# 28/10/2026 · Review thiết kế Slack cá nhân

**Yêu cầu:** chủ dự án yêu cầu review lại bản thiết kế, chưa yêu cầu sửa hoặc triển khai.
**Tài liệu:** [thiết kế Slack cá nhân](../../superpowers/specs/2026-10-28-slack-personal-oauth-design.md).
**Head đã đọc:** `4bc42c7d832c550b16ecac5aa5e800fe5a4fc938`, nhánh `docs/slack-oauth-design`; nền mã `b437f985`.
**Kết luận:** **CHƯA ĐẠT để chốt thiết kế triển khai**. Một P1 và ba P2 dưới đây là khoảng trống/điểm cần sửa của thiết kế; không phải lỗi được tái hiện trong feature đã triển khai.

## F1 · P1 · Thiếu điều kiện cho phép xử lý dữ liệu của workspace ngoài tổ chức

**Vị trí:** thiết kế dòng 80 (phân phối ngoài Marketplace), 88 (user OAuth), 124 (AI đọc tin), 178 (gửi dữ liệu tới model).

Thiết kế cho phép người dùng bật AI sau OAuth và đề cập privacy, nhưng chưa định nghĩa căn cứ cho quyền xử lý/lưu dữ liệu của tổ chức cài app và điều kiện không dùng dữ liệu để huấn luyện LLM. Slack yêu cầu ủy quyền rõ từ tổ chức khi app phục vụ bên ngoài, đồng thời cấm dùng dữ liệu huấn luyện LLM. [API Terms, Data Usage by Third Parties](https://slack.com/terms-of-service/api), [Developer Policy, Use of Data](https://docs.slack.dev/developer-policy/).

**Tình huống:** thành viên thông thường của workspace tổ chức khác cấp user scopes, bật AI cho mọi tin hợp lệ; các tin được đưa ra provider model dù chưa xác định tổ chức đã đồng ý cách sử dụng/lưu trữ đó. Quyền đọc qua API và việc thêm mô tả privacy chưa chứng minh đã đủ điều kiện này.

**Cần sửa:** nêu rõ phạm vi pilot nội bộ hoặc điều kiện chấp thuận xử lý dữ liệu theo tổ chức trước khi bật các đường đưa nguồn vào model; xác định yêu cầu đối với provider về huấn luyện/lưu trữ và trường hợp không đáp ứng thì chưa cho bật. Nếu dự định thương mại hóa, phải rà lại lựa chọn ngoài Marketplace theo điều khoản phân phối, không mặc định lựa chọn này dùng được cho mọi hình thức phát hành.

**Bằng chứng cần thêm trong kế hoạch:** ca thiếu/chưa còn chấp thuận thì không gửi nội dung nguồn tới model; cấu hình provider phù hợp được xác nhận. Review này không kết luận inference bên ngoài tự thân bị cấm.

## F2 · P2 · Chưa chốt ràng buộc workspace của lượt đọc trước khi tạo plan

**Vị trí:** thiết kế dòng 72 và 154. Dòng 72 nêu khóa cache/credential/job/plan/audit; dòng 154 cụ thể hóa binding từng step ghi. Chưa có contract tương ứng cho gather/search và các kết quả được đưa vào working memory.

**Mã nền xác nhận:** `packages/planner/src/planner.ts:45-50,333-340`: request tra cứu có actor `{userId}`, rồi kết quả được ghi vào `__observed`. `apps/chat-api/src/server.ts:227-232`: lấy adapter theo service + userId + phase. `apps/chat-api/src/services/adapter-factory.ts:13-17` chưa có lựa chọn connection cho lượt planning.

**Tình huống:** cùng người ATI có workspace A/B, đều có kênh cùng tên; model tra cứu rồi lập một plan qua cả hai. Map connection ở plan sau tra cứu chưa xác định token nào dùng để đọc và chưa giữ được nguồn workspace của từng kết quả. Người triển khai phải tự chọn giữa chọn mặc định/fanout/hỏi lại; không được dùng token mặc định hoặc trộn kết quả mất nguồn.

**Cần sửa:** contract read mang connection ID + phiên bản danh tính đã được server xác nhận; kết quả/memory có workspace và nguồn. Quy định khi nào được fanout có nhãn và khi nào phải hỏi lại. Grounding/resolve của step phải khớp kết nối đã đọc, không chỉ khớp ID/tên tài nguyên.

**Bằng chứng cần thêm:** hai workspace có tài nguyên trùng tên; tra cứu liên workspace, đổi kết nối giữa lookup và bind, và tham chiếu tài nguyên từ workspace A vào step B phải được xử lý đúng. Đây là yêu cầu thiết kế cho interface nhiều workspace, không phải yêu cầu giữ nguyên interface hiện tại.

## F3 · P2 · Vòng đời dữ liệu chưa định nghĩa cho bản sao trong hội thoại và working memory

**Vị trí:** thiết kế dòng 158, 176–178. Tài liệu yêu cầu xóa nguồn khi disconnect/edit/delete nhưng cho artifact đã duyệt tuân theo retention hội thoại; chưa định nghĩa ranh giới các bản sao và cách chúng mất hiệu lực.

**Mã nền xác nhận:** `apps/chat-api/src/services/chat-service.ts:500-528` tải lịch sử, plan JSON, câu trả lời trước và snapshot working memory, đưa lại vào planner rồi lưu snapshot mới. Xóa receipt/đoạn trích proposal không tự xóa các bản sao này.

**Tình huống:** nguồn Slack đã được tra cứu và xuất hiện trong câu trả lời/plan chưa duyệt/memory; sau đó người dùng ngắt kết nối hoặc tin nguồn bị xóa. Nếu chỉ xử lý bảng mới của feature, lần mở hoặc nhắn tiếp trong hội thoại cũ vẫn có thể khôi phục nội dung nguồn vào UI/model.

**Cần sửa:** xác định metadata nguồn cho các bản sao qua hội thoại, plan và memory; cách xóa hoặc che chúng và kiểm lại quyền trước khi tái dùng. Nêu rõ phần nào của artifact đã duyệt được giữ như kết quả nghiệp vụ, phần nào vẫn là bản sao nguồn phải xóa; không để hai quy tắc retention mâu thuẫn.

**Bằng chứng cần thêm:** tạo lookup/answer/plan/memory rồi disconnect hoặc xóa nguồn; mở lại và nhắn tiếp không khôi phục bản sao bị thu hồi. Bao gồm plan chỉ ghi Trello/Jira và không có step Slack, cùng hai người có quyền nhìn cùng một event để việc xóa của một người không phá dữ liệu hợp lệ của người kia.

## F4 · P2 · Tắt automation bằng cách chặn endpoint có thể làm mất subscription

**Vị trí:** thiết kế dòng 180: tắt cờ phải chặn endpoint và worker liên quan.

Slack có thể tạm ngừng event subscriptions khi hơn 95% lần gửi lỗi trong 60 phút, với ngoại lệ lưu lượng thấp. Vì thế giữ Slack app đã cài nhưng trả lỗi webhook khi tắt cờ/rollback có thể làm subscription ngừng; bật cờ lại chưa chứng minh event stream đã hoạt động trở lại. [Events API, Failure limits](https://docs.slack.dev/apis/events-api/#failure-limits).

Nếu chỉ `MYSLACK_AUTOMATION_ENABLED` tắt nhưng kết nối cá nhân vẫn dùng thủ công, vòng đời token/uninstall cũng cần một đường nhận xử lý. Tắt đề xuất không nên vô tình làm mất khả năng xử lý lifecycle.

**Cần sửa:** tách ingress đã xác thực và lifecycle khỏi việc tạo proposal. Khi automation tắt, ACK sự kiện hợp lệ với hành vi bỏ qua rõ ràng, không lưu nội dung/tạo job phân tích mới; xử lý lifecycle cần thiết. Nếu chọn tắt cả ingress, phải xác định cách dừng/khôi phục subscription và hiển thị tình trạng chưa hoạt động sau bật lại.

**Bằng chứng cần thêm:** bật → tắt → bật trong lúc Slack vẫn gửi event; không tạo proposal khi tắt, lifecycle được áp dụng và trạng thái nhận sự kiện sau bật lại được xác nhận.

## Kiểm tra thực tế và giới hạn

- Đọc toàn bộ thiết kế/task/log, handoff hiện hành và các đường mã nêu trên ở đúng head.
- Đối chiếu trực tiếp tài liệu Slack chính thức về token/OAuth, Events API, authorizations, rotation, rate limits, API Terms và Developer Policy.
- `git show --format= --check 4bc42c7d`: **PASS**, exit 0. Kết quả này chỉ kiểm whitespace, không chứng nhận tính đúng của thiết kế.
- Feature chưa triển khai: test sản phẩm/browser/PG/model và OAuth/provider live **NOT_RUN**.
- Không chỉnh thiết kế, task card, CURRENT-STATE hay ROADMAP; không commit/push/merge hoặc thay đổi cấu hình. Chỉ thêm log review này; giữ nguyên các file có sẵn của người dùng/phiên khác.

Builder check trước đó kiểm tra câu hỏi cần trả lời để lập kế hoạch; kết quả đó không thay thế lượt đối chiếu kỹ thuật/provider hiện tại. Cần sửa bốn điểm trên rồi review lại trước khi chốt thiết kế.
