# Slack cá nhân và trợ lý công việc trong ATI

**Ngày:** 28/10/2026 · **Task:** [OAUTH-04](../../handoff/tasks/OAUTH-04-slack-personal.md)
**Trạng thái:** BẢN THIẾT KẾ CHỜ CHỦ DỰ ÁN DUYỆT; chưa cho phép triển khai.
**Nền đối chiếu:** `origin/main b437f985d479d3a9d413ddd3fb2361eceedf6d5e`.

## 1. Mục đích và các lựa chọn đã thống nhất

ATI trở thành trợ lý nhận việc và xử lý công việc từ Slack. Người dùng vừa có thể chủ động yêu cầu ATI thao tác Slack, vừa nhận đề xuất từ tin nhắn mới; xem, sửa và duyệt trong ATI. Các thao tác Slack dùng danh nghĩa người đã cấp quyền.

Các quyết định của chủ dự án qua trao đổi:

1. OAuth bằng tài khoản Slack của người dùng; thao tác dưới danh nghĩa người đó.
2. Hỗ trợ Free và Pro; hướng tới toàn bộ khả năng API phù hợp với hai gói và quyền thực tế của người kết nối.
3. Bao phủ mọi kênh công khai, kênh riêng, DM và nhóm DM mà người kết nối được quyền truy cập; không yêu cầu chọn một danh sách kênh cho phép.
4. Một tài khoản ATI kết nối đồng thời nhiều workspace Slack.
5. Theo dõi tin mới để gợi ý xử lý công việc, vẫn duyệt trước khi ghi.
6. Có đủ ba chế độ: luật, AI đánh giá tin mới, kết hợp luật và AI; chọn đúng một chế độ cho từng workspace.
7. Cấu hình thuộc từng người dùng ATI trong từng workspace, không áp chung cho mọi thành viên.
8. Nhận và duyệt đề xuất **trong ATI**.
9. Chỉ tạo đề xuất việc liên quan đến người kết nối hoặc thread họ chủ động theo dõi; không gom mọi việc chung trong kênh thành việc của họ.

Các ví dụ định hướng đã được đón nhận: giao việc → thẻ Trello và bản nháp phản hồi Slack; báo lỗi → Jira; câu hỏi → tìm ngữ cảnh và soạn câu trả lời có nguồn; báo tiến độ → Sheets; bản tổng hợp công việc riêng theo ngày. Đây là các luồng nghiệm thu, không phải giới hạn của danh mục Slack.

Những quyết định do người viết đề xuất, chưa phải lựa chọn trực tiếp của chủ dự án, đều ghi “**Đề xuất**” bên dưới. Duyệt tài liệu này bao gồm duyệt các mặc định đó; có thể sửa chúng trước khi lập kế hoạch.

## 2. Phạm vi “full khả năng”

Phạm vi đích là mọi phương thức public, chưa bị loại bỏ, mà Slack cho phép gọi bằng user token trên Free/Pro với vai trò hiện có của người dùng. Không cam kết mọi tính năng giao diện Slack đều có API. User token chịu các giới hạn quyền của chính thành viên đó. [Token types](https://docs.slack.dev/authentication/tokens/)

Free/Pro có giới hạn khác nhau; ví dụ Free giới hạn lịch sử truy cập và số ứng dụng, trong khi khả năng Canvas/Lists cũng khác Pro. ATI phải hiển thị hạn chế thực tế, không biến “không có trên gói này” thành lỗi kết nối chung. [Slack plans and features](https://slack.com/help/articles/115003205446-Slack-plans-and-features)

Trước khi code tool, tạo một **bảng kiểm kê từng phương thức**, chốt ngày tra cứu. Mỗi dòng có: phương thức, token được hỗ trợ, user scope, gói/vai trò, thao tác đọc/ghi, mức rủi ro, công cụ ATI tương ứng, cách xác minh, trạng thái và lý do nếu không áp dụng. Duyệt toàn bộ [danh mục phương thức Slack](https://docs.slack.dev/reference/methods/), không chỉ các nhóm dưới đây.

| Nhóm kiểm kê | Hành vi cần xét |
|---|---|
| Hội thoại và tin nhắn | Tìm/liệt kê kênh, lịch sử, thread, gửi/sửa/xóa/lên lịch tin, quản lý kênh và thành viên |
| Tìm kiếm, người dùng, workspace | Tìm tin/file, hồ sơ và trạng thái cá nhân, thông tin team, nhóm người dùng, DND |
| Nội dung và tổ chức | File, reactions, pins, bookmarks, reminders, stars, Canvas, Lists |
| Nhóm khác trong danh mục | Calls, workflows, ứng dụng và mọi nhóm phát hiện khi kiểm kê; xét từng method thay vì mặc định hỗ trợ |

Chỉ đưa vào catalog công cụ có schema cụ thể, ràng buộc tài nguyên và chính sách ghi tương ứng. Không cung cấp công cụ gọi tùy ý `method + args`. Phương thức chỉ dành cho bot/app hoặc yêu cầu Enterprise/vai trò không có thì ghi rõ điều kiện, không giả lập thành công. Một số admin API yêu cầu cài ở tổ chức Enterprise và quyền quản trị tổ chức. [Ví dụ admin.apps:read](https://docs.slack.dev/reference/scopes/admin.apps.read/)

Phạm vi cho phép phát hành từng đợt, nhưng các dòng hợp lệ chưa làm vẫn là backlog mở. Hai công cụ hiện hữu hoặc một demo gửi tin không đủ để đóng mục tiêu “full”. Các phương thức tương đương có thể dùng chung một tool khi builder chứng minh schema và phép kiểm tra quyền bao phủ đầy đủ từng trường hợp.

## 3. Hiện trạng ATI và phương án đã chọn

Ở nền đối chiếu, `slack.*` dùng cấu hình chung/`botToken`, có `search_channels` và `send_message`, cùng giới hạn kênh của connector cũ. Các dịch vụ cá nhân Google đã có OAuth, binding trong plan và hiển thị người/tài nguyên trước thực thi. Chúng chưa giải quyết Slack nhiều workspace, Events API hay hộp đề xuất.

Repo hiện lưu credential chung theo dịch vụ/người dùng, có đường ghi thay toàn bộ các dòng cùng khóa đó; cache adapter chung theo dịch vụ. Không dùng nguyên đường ghi/cache này để chứa nhiều workspace cá nhân.

Ba cách đã thảo luận:

| Cách | Lợi ích | Đánh đổi |
|---|---|---|
| Chỉ luật | Dễ giải thích, ít chi phí phân loại | Bỏ sót cách nói mới, cần quản lý luật |
| AI đánh giá mọi tin hợp lệ | Hiểu nhiều ngữ cảnh | Tốn chi phí và có thể tạo nhiều đề xuất yếu |
| Luật lọc rồi AI đánh giá | Kiểm soát chi phí, hiểu ngữ cảnh ở các tin ứng viên | Luật lọc vẫn có thể bỏ sót |

**Lựa chọn của chủ dự án:** tích hợp cả ba, chọn riêng cho mỗi workspace. Không chọn duy nhất một phương pháp cho toàn sản phẩm. **Đề xuất:** mặc định chế độ kết hợp, cho xem giải thích vì sao tin được chọn/bỏ qua và đổi chế độ bất cứ lúc nào.

## 4. Cấu trúc kết nối và xác thực

### 4.1. Danh tính và nhiều workspace

**Đề xuất:** thêm dịch vụ cá nhân `myslack.*`, giữ `slack.*` hiện tại. Khi người dùng nói “Slack của tôi”, chỉ xét kết nối cá nhân; thiếu thì yêu cầu kết nối, không rơi về token chung. Yêu cầu mơ hồ giữa nhiều workspace phải hỏi lại trước khi ghi.

Tạo repository/bảng kết nối Slack riêng. Mỗi kết nối có ID nội bộ, chủ ATI, Slack app ID, workspace ID/tên, Slack user ID/nhãn, scope thực nhận, token mã hóa, trạng thái, phiên bản danh tính và thông tin refresh. Khóa một kết nối đang hoạt động trên `(ATI user, Slack app, workspace)`. Các workspace cùng tên vẫn phân biệt bằng ID.

**Đề xuất:** một danh tính `(app, workspace, Slack user)` chỉ gắn một tài khoản ATI tại một thời điểm; chuyển tài khoản phải ngắt kết nối cũ. Nhiều người khác nhau cùng một workspace được kết nối độc lập. Không cho một người ghi đè token/cấu hình của người khác.

Cache adapter, truy vấn credential, job, plan và audit đều phải có chủ ATI + connection ID + phiên bản danh tính. Refresh token không đổi phiên bản danh tính; ngắt/kết nối lại hay thay người cấp quyền làm tăng phiên bản. Plan cũ không được chạy bằng token của lần kết nối mới.

### 4.2. OAuth Slack

**Đề xuất:** dùng một Slack app riêng cho tích hợp cá nhân, OAuth web server với client secret và HTTPS callback; state ngẫu nhiên, hết hạn, dùng một lần, ràng buộc người dùng/phiên ATI. Không trộn với “Sign in with Slack”. Khai báo quyền người dùng bằng `user_scope`; lấy danh tính thực từ `team.id`, `authed_user.id` và token trong callback, đối chiếu bằng `auth.test`. Workspace truyền lúc bắt đầu chỉ là gợi ý. [Installing with OAuth](https://docs.slack.dev/authentication/installing-with-oauth/)

Không sao chép mặc định PKCE của Google. Việc bật PKCE ở Slack làm thay đổi loại client và có hệ quả vận hành; thiết kế này chọn confidential web client, không tự bật PKCE. [Slack PKCE](https://docs.slack.dev/authentication/using-pkce/)

**Đề xuất mô hình phân phối:** một app cho người dùng ATI cài bằng OAuth ở nhiều workspace, phân phối ngoài Marketplace. Chuẩn bị cấu hình distribution, URL privacy và yêu cầu phê duyệt của từng workspace trong phần setup; chưa làm hồ sơ phát hành Marketplace. Không giả định đây là app nội bộ được miễn các hạn chế history/replies; inventory/probe phải xác minh quota cho đúng cách phân phối đã chọn. Nếu cần Marketplace hoặc app tách riêng từng tổ chức thì phải duyệt thay đổi đó trước khi lập kế hoạch tương ứng.

Trạng thái callback lưu một lần bằng giao dịch/CAS thật; callback lặp, hai lần connect chạy đua, phiên hết hạn, hủy cấp quyền và tài khoản sai đều có kết quả xác định. Thiếu scope thì hiển thị tính năng chưa được cấp, yêu cầu cấp bổ sung có chủ đích. Không mở rộng quyền âm thầm.

**Đề xuất:** ứng dụng mới bật token rotation sau khi triển khai refresh đúng; cài đặt app là bước vận hành riêng, chưa thực hiện khi viết thiết kế. Hỗ trợ trạng thái token không xoay trong sandbox/migration. Refresh tuần tự theo connection bằng khóa PostgreSQL giữa nhiều process; ghi access/refresh mới nguyên tử, không dùng lại refresh token cũ sau kết quả không xác định. Trường hợp không thể khôi phục cần kết nối lại. Slack mô tả access token xoay hết hạn sau 12 giờ và refresh token sử dụng một lần. [Token rotation](https://docs.slack.dev/authentication/using-token-rotation/)

### 4.3. Scope và tài nguyên

Các quyền được xin từ bảng kiểm kê; không có wildcard “full Slack”. **Đề xuất:** chia gói quyền chức năng, xin gói đọc hội thoại/tìm kiếm và gói thao tác ban đầu khi kết nối; bổ sung gói khác khi bật nhóm chức năng tương ứng. Chủ dự án đã chọn quyền truy cập rộng về tài nguyên; điều này không thay thế sự đồng ý OAuth của Slack.

Không có allowlist kênh ở connector cá nhân. Vẫn kiểm tra quyền native khi đọc và trước khi ghi; loại tài nguyên khỏi catalog khả dụng khi mất quyền. Có thể dùng điều kiện luật chọn tín hiệu quan tâm; đó là cấu hình xử lý, không phải cơ chế cấp quyền.

## 5. Nhận tin mới và phân phối đúng người

**Đề xuất:** dùng Events API qua HTTP công khai của backend, không cần máy người dùng luôn mở. Đăng ký sự kiện user cho `message.channels`, `message.groups`, `message.im`, `message.mpim` cùng các sự kiện vòng đời cần thiết; scope và quyền của user quyết định những gì Slack gửi. [Events API](https://docs.slack.dev/apis/events-api/)

Kiểm chữ ký trên raw body, kiểm timestamp chống phát lại trước khi nhận. Endpoint chỉ xác thực và ghi receipt/job bền vững, ACK trong 3 giây; không gọi LLM ở request này. Unique key receipt theo app + `event_id`; retry HTTP không tạo lại công việc. Nếu DB không lưu được thì trả lỗi để Slack retry. URL verification là nhánh riêng không tạo proposal.

Một event có thể nhìn thấy bởi nhiều installation. Không coi người gửi tin là chủ ATI, không chỉ dùng phần tử đầu của `authorizations`. Với event có `event_context`, lấy toàn bộ authorizations, phân trang, rồi map đúng app/workspace/Slack user sang kết nối đang hoạt động. Cần **app-level token với `authorizations:read`**, chỉ phục vụ phân phối event; mọi thao tác nghiệp vụ vẫn dùng user token. [apps.event.authorizations.list](https://docs.slack.dev/reference/methods/apps.event.authorizations.list/)

Không xác định được người được nhìn thấy event thì giữ receipt để retry/needs_attention; không phát rộng cho mọi user trong workspace. Với event không có context, chỉ nhận các loại có thể chứng minh quyền bằng đường xử lý đã định nghĩa và kiểm tra qua user token; loại chưa xác định thì cách ly. Fanout tạo job duy nhất theo receipt + connection + phiên bản danh tính.

Worker luôn kiểm lại kết nối, phiên bản cấu hình và quyền nguồn. Mỗi người có proposal riêng từ cùng một tin; không hiển thị nội dung DM riêng của người A cho người B. Slack Connect dùng danh tính workspace cài app và conversation ID thực; không suy luận quyền từ tên kênh/nguồn tổ chức.

Tự động xử lý bắt đầu từ khi bật cho workspace; không quét toàn bộ lịch sử cũ. Lịch sử dùng khi người dùng yêu cầu hoặc lấy ngữ cảnh có giới hạn. Events API có retry nhưng không phải cam kết giao tin tuyệt đối; gián đoạn dài phải hiện khoảng trống và cho người dùng yêu cầu truy hồi có giới hạn, không âm thầm chạy bù các hành động ghi.

## 6. Chính sách ba chế độ

Một cấu hình cho `(ATI user, connection)`: enabled/pause, mode, configVersion, luật, gói hành động đích, tài nguyên đích mặc định nếu có, timezone, ngân sách và cấu hình bản tổng hợp. Không chỉnh được cấu hình của thành viên khác.

**Ranh giới liên quan đã được chủ dự án chốt sau builder check:** chỉ đề xuất việc liên quan đến người kết nối hoặc thread họ chọn theo dõi. Quyền xem mọi hội thoại không có nghĩa là nhận mọi công việc của người khác. Mode AI vẫn đánh giá mọi tin hợp lệ, nhưng tin không liên quan trả `no_action`; cả ba mode đều chịu ranh giới này. Yêu cầu thủ công trong hội thoại ATI có thể chỉ rõ việc khác để người dùng xem xét.

**Đề xuất cách nhận biết:** mention/giao việc rõ cho Slack user đó; yêu cầu trực tiếp trong DM; việc người đó tự nhận; hoặc thread đã theo dõi trong ATI. Chỉ `@here`/`@channel`, một báo lỗi chung hoặc nhắc tên trùng nhau chưa đủ để tự gán việc. AI dùng ngữ cảnh để xác định người nhận và mức liên quan; không rõ thì hỏi, không tự tạo việc. Mode luật dùng điều kiện có thể chứng minh bằng ID/DM/thread và intent đã cấu hình. Thêm/bỏ theo dõi là thao tác trong ATI theo connection + channel + thread root, có hiệu lực với tin mới, không thay trạng thái thread ở Slack và không tự quét lịch sử.

Mọi mode dùng chung điều kiện hợp lệ: kết nối/quyền còn hiệu lực; không phải retry, echo của ATI, sự kiện hệ thống hoặc loại không hỗ trợ; nguồn không bị xóa; đã đến mốc bắt đầu xử lý. Tin tự do người dùng gõ bằng chính tài khoản của họ vẫn hợp lệ.

| Mode | Đầu vào bộ quyết định | Kết quả |
|---|---|---|
| Luật | Luật do người dùng bật/sửa: tác giả, loại hội thoại, mention, từ khóa, dấu hiệu giao việc/thời hạn | Không khớp → không đề xuất; khớp → intent/template và nguồn giải thích |
| AI | Mọi tin mới hợp lệ, kể cả khi không có từ khóa | `no_action`, cần hỏi, hoặc một/vài ý định với nguồn và lý do |
| Kết hợp | Luật chọn ứng viên trước, AI đọc ngữ cảnh có giới hạn | Như mode AI, đồng thời ghi lý do qua bộ lọc |

Mode luật không có lời hứa “zero AI”: phân loại bằng luật, nhưng planner của ATI vẫn có thể dùng model để tạo workflow từ intent. AI không có quyền tự thực thi. Tin Slack và nội dung nguồn là dữ liệu không đáng tin; câu trong tin không được đổi system instruction, actor hay cơ chế duyệt.

**Đề xuất mặc định:** gom tin cùng thread trong 30 giây; context tối đa 20 tin/20.000 ký tự; tối đa một job AI đang chạy cho mỗi kết nối. Ghi rõ khi context bị cắt, không tuyên bố đã đọc cả thread. Có giới hạn lời gọi/model token và độ dài hàng đợi do builder chọn, cấu hình được, công khai trong Settings; đếm cả phân loại, lập plan, retry. Bật chế độ chủ động phải có mức ngân sách hữu hạn. Hết ngân sách thì giữ việc chờ và hiện trạng thái tạm dừng, không biến tin chưa đánh giá thành `no_action`.

**Đề xuất:** giữ job chờ tối đa 24 giờ; quá hạn chuyển needs_attention và cho người dùng yêu cầu đánh giá lại, không tự ghi. Giới hạn nhận payload/hàng đợi phải có metric và trạng thái backlog_full nếu không thể giữ thêm; không ACK như đã lưu thành công khi chưa lưu. Thông số dung lượng cụ thể là việc builder quyết định và đo tải, không đổi nghĩa mode AI là “mọi tin hợp lệ được đánh giá hoặc báo chưa xử lý”.

Đổi mode/config chỉ tác động job chưa bắt đầu; job đang chạy phải kiểm phiên bản trước khi công bố kết quả, khác phiên bản thì hủy kết quả và đánh giá lại theo cấu hình mới. Tin đã có quyết định không được replay tự động. Proposal chưa duyệt mang phiên bản cũ phải được đánh giá/lập plan lại trước khi duyệt; lịch sử giữ nguyên.

## 7. Đề xuất, bản tổng hợp và thao tác trong ATI

Thêm hộp đề xuất trong ATI, chia theo workspace, luôn có tên workspace và người Slack đang đại diện. Từ đề xuất có thể mở hội thoại ATI để hỏi, sửa và duyệt qua cơ chế plan hiện có; không thêm luồng duyệt trong Slack.

Một đề xuất chứa: nguồn/deep link và đoạn trích có quyền truy cập, lý do phát hiện, việc định làm, dịch vụ/tài nguyên đích, danh tính thực thi, trạng thái, các thông tin còn thiếu. Danh sách thể hiện chờ xem, cần bổ sung, sẵn sàng, đang chạy, xong, từ chối, hết hạn và cần đánh giá lại. Màu sắc/thành phần tiếp tục theo giao diện ATI đang có; vị trí pixel và component cụ thể dành cho builder.

Các luồng phải mô tả được bằng ví dụ thực:

- “@mình chuẩn bị báo cáo thứ Sáu” → đề xuất thẻ Trello, deadline có timezone, bản nháp trả lời trong đúng thread. Chưa biết board/list hoặc ngày không rõ thì hỏi trong ATI.
- Báo lỗi có triệu chứng → đề xuất Jira với nguồn; tìm issue hiện có trước khi đề nghị tạo mới.
- Câu hỏi → đọc nguồn người dùng được quyền xem, soạn nháp có link; không đủ chứng cứ thì hỏi hoặc thể hiện chưa biết.
- Báo tiến độ → đề xuất cập nhật dòng/bảng Sheets phù hợp, hiển thị đúng tài khoản và phạm vi bảng đã cấp.
- Bản tổng hợp ngày → tổng hợp việc/deadline/câu hỏi còn mở của riêng người đó trong workspace; chỉ xuất hiện trong ATI.

**Đề xuất:** bản tổng hợp là tùy chọn mỗi workspace, mặc định tắt; nếu bật thì mặc định 09:00 theo timezone ATI và cho đổi. Dùng cơ chế job bền vững có múi giờ và chống tạo lặp; tích hợp loại job đọc/tạo đề xuất vào hạ tầng scheduling, không biến nó thành một lần duyệt cho mọi hành động tương lai. Khi `SCHEDULES_ENABLED` tắt, chức năng theo ngày hiển thị chưa khả dụng; nhận sự kiện và hộp đề xuất vẫn chạy độc lập. Builder phải định nghĩa job này trong kế hoạch, không giả định scheduler hiện đã hỗ trợ.

**Đề xuất nguồn trạng thái cho bản tổng hợp:** lấy các proposal do ATI đã phát hiện, không tự tìm mọi công việc của người dùng trong các hệ thống ngoài. “Chưa xử lý” nghĩa là proposal còn chờ/thiếu thông tin, hoặc câu hỏi chưa được người dùng xác nhận đã xử lý. Workflow đã chạy xong chỉ chứng minh hành động đã thực hiện, không chứng minh task Trello/Jira đã hoàn thành. Việc đã tạo có deadline có thể xuất hiện ở phần theo dõi với trạng thái “chưa kiểm tra bên ngoài”; chỉ gọi “còn mở/đã xong” khi có lần đọc trạng thái qua connector được phép hoặc người dùng xác nhận, kèm thời điểm/nguồn. Không làm đồng bộ trạng thái liên tục trong thiết kế này; đọc lại theo yêu cầu hoặc lượt tổng hợp nếu có tool đọc phù hợp. Không suy ra hoàn thành chỉ vì Slack im lặng hoặc có một reaction.

Nếu dịch vụ đích chưa cấu hình hoặc chưa được cấp quyền, đề xuất ở trạng thái cần bổ sung; không dùng nhầm tài khoản khác hay tự chọn board/bảng. Các connector chung hiện hữu chỉ dùng khi người dùng đã được phép sử dụng và plan hiển thị đúng đích; mục tiêu này không tự thêm OAuth cho Jira/Trello.

Gom nhiều tin cùng ý định/thread thành một proposal đang chờ, lưu danh sách nguồn và revision. Tin mới thay nội dung đề xuất làm thay revision và vô hiệu plan cũ; không sửa lặng lẽ plan đang được duyệt/chạy. Sau khi đã hoàn tất, chỉ một yêu cầu mới có bằng chứng mới tạo proposal mới, có link tới công việc trước đó. Builder xác định khóa intent theo action + đích và kiểm thử tình huống này, không chỉ so sánh chuỗi văn bản.

## 8. Plan, thực thi và chống lặp

Mỗi bước `myslack.*` được server gắn connection ID + workspace ID + Slack user ID + phiên bản danh tính trong plan metadata; có thể có nhiều workspace trong cùng plan. **Đề xuất:** `PlanConnections.myslack` là map theo connection ID, còn từng step chỉ tham chiếu khóa đã được server xác nhận. Không chọn một token Slack toàn cục cho cả plan.

Preview hiển thị nguồn, danh tính, workspace/channel hoặc người nhận, nội dung và đích ngoài Slack. Sửa nội dung, actor, đích hoặc nguồn quan trọng → lập plan mới, hash mới và duyệt lại. Read có thể chạy để lập plan; mọi write phải được duyệt theo v3, gồm xác nhận riêng cho hành động rủi ro cao. Nội dung riêng tư được đưa sang nơi khác phải nhìn thấy trong preview.

Ngay trước dispatch, kiểm chủ ATI, kết nối/phiên bản, quyền tài nguyên, scope và hash đã duyệt. Việc mất quyền hoặc nguồn quan trọng bị sửa/xóa khiến proposal cần đánh giá lại; không chạy bản suy luận cũ. Snapshot và quyền được kiểm lại khi mở đề xuất; audit không phải đường xem lại nội dung đã mất quyền.

Không có transaction phân tán với Slack. Lưu outbox/attempt trước gửi; sau khi gửi nhưng không biết kết quả thì `UNKNOWN`, đọc đối chiếu nếu được, không tự retry write. Các tool cần flow nhiều call (upload file, tạo nội dung rồi chia sẻ...) phải có trạng thái từng call và phép khôi phục riêng, không gộp thành một retry mù.

Tin ATI gửi bằng user token có thể quay lại thành event. Chống vòng lặp bằng ledger workspace/channel/message timestamp và mã operation; nếu dùng metadata/`client_msg_id` phải có probe chứng minh đúng với user token và event thực. Metadata chỉ chứa ID không nhạy cảm, vì ứng dụng khác có thể đọc. [Message metadata](https://docs.slack.dev/messaging/message-metadata/)

Nếu event về trước receipt của write hoặc write đang `UNKNOWN`, giữ ứng viên echo trong trạng thái chờ đối chiếu, không để nó tạo chuỗi proposal mới. Không lọc mọi tin có tác giả là người kết nối, vì sẽ làm mất tin người dùng tự gửi. Giai đoạn probe phải chứng minh cơ chế liên kết echo; chưa chứng minh được thì chưa bật nhận tin chủ động trong live.

Rate limit quản lý theo app/workspace/method và `Retry-After`; phân trang, timeout hữu hạn, hủy bằng AbortSignal thật. Không coi nhiều user token là nhiều quota độc lập, không dựa vào một hằng số tốc độ cho mọi cách phân phối ứng dụng. [Rate limits](https://docs.slack.dev/apis/web-api/rate-limits/)

## 9. Ngắt kết nối, dữ liệu và vận hành

Ngắt trong ATI trước hết ghi trạng thái revoked và tăng phiên bản trong DB, hủy job/plan chưa dispatch, chặn refresh và truy cập nguồn. Write đã dispatch vẫn có thể đã xảy ra; giữ receipt/UNKNOWN trung thực, không hứa thu hồi được hành động đã gửi.

Sau đó revoke token từ backend và ghi kết quả. Phải phân biệt “đã ngắt ở ATI”, “đã revoke token nào” và “grant/app installation ở Slack còn hay không”. Với rotation, `auth.revoke` chỉ revoke token cụ thể; không đủ để kết luận installation và events đã bị gỡ. Không dùng `apps.uninstall` cho thao tác ngắt một người vì có thể ảnh hưởng cả workspace. [Revoke API](https://docs.slack.dev/reference/methods/auth.revoke/), [rotation and revocation](https://docs.slack.dev/authentication/using-token-rotation/)

Xóa token local sau khi hoàn tất hoặc kết thúc retry revoke hữu hạn; nếu revoke từ xa thất bại, hiển thị kết quả và cách người dùng quản lý quyền trong Slack. Receipt sự kiện còn tới sau ngắt bị loại ở bước map kết nối. Kết nối lại không tự khôi phục proposal/approval cũ.

**Đề xuất:** nội dung receipt/context phục vụ xử lý giữ tối đa 7 ngày; proposal đang chờ hết hạn sau 7 ngày; đoạn trích của proposal giữ tối đa 30 ngày rồi chỉ còn nhãn/link và kết quả đã rút gọn. Không lưu file đính kèm nguyên bản để lập chỉ mục toàn workspace. Các artifact công việc đã được người dùng duyệt tạo là dữ liệu đầu ra riêng, tuân theo chính sách lưu trữ hội thoại ATI; không hứa xóa các bản sao đã gửi sang Jira/Sheets.

Ngắt kết nối xóa nội dung nguồn đã lưu và token, giữ audit tối thiểu không chứa nội dung/token để chống replay và truy vết thao tác. Sửa/xóa tin nguồn cập nhật hoặc ẩn đoạn trích, làm stale proposal liên quan; log vận hành không chứa body, DM, token hay refresh token. Chỉ metadata an toàn xuất hiện trong SSE, UI và model context tối thiểu cần thiết. Trang privacy và mô tả OAuth phải nêu việc gửi dữ liệu cho model của ATI.

**Đề xuất:** `MYSLACK_ENABLED=off` và `MYSLACK_AUTOMATION_ENABLED=off` mặc định; cờ thứ hai phụ thuộc cờ thứ nhất. Tắt cờ phải chặn cả endpoint và worker liên quan. Catalog/router/prompt của đường cũ khi cờ tắt giữ baseline, connector Slack chung không đổi. Không thay cờ OAUTH-02/03 hay đánh dấu chúng đã nghiệm thu.

Metric cần có: event nhận/retry/không map được, backlog/độ trễ/gap, AI calls và token theo workspace/người, proposal theo mode, lỗi quyền/refresh, write UNKNOWN, echo cách ly và lỗi revoke. Không đưa nội dung tin vào nhãn metric.

## 10. Tiêu chuẩn bằng chứng và nghiệm thu

| Nhóm | Bằng chứng bắt buộc trước khi đóng phần tương ứng |
|---|---|
| Kiểm kê khả năng | Mọi public method được xét; mỗi dòng có quyết định và nguồn; tool hợp lệ chưa làm vẫn mở; phiên bản/gói/role có thể truy vết |
| OAuth và nhiều workspace | HTTP provider fixture có auth/token/refresh; callback lặp, đổi phiên, connect chạy đua; hai workspace và hai ATI user cùng workspace không ghi đè nhau |
| Concurrency | PostgreSQL thật cho callback, refresh, receipt/fanout dedup, claim job, đổi config/disconnect đua worker và approve đua revision |
| Event và quyền | Chữ ký/raw body/replay; authorizations nhiều trang; thiếu context; message author khác owner; private/DM/Slack Connect; retry/đảo thứ tự/edit/delete/lifecycle |
| Ba mode | Cùng bộ tin có ground truth cho luật/AI/kết hợp; no_action và cần hỏi; đổi mode; ngân sách; backlog; tin người dùng tự gửi |
| Duyệt và thực thi | Không write trước duyệt; hash/binding nhiều workspace; quyền thay đổi; UNKNOWN và upload nhiều bước; echo trước/sau write receipt |
| Bảo vệ dữ liệu | Không token/body trong log/SSE; user khác không đọc được proposal; mất quyền, disconnect, retention và xóa nguồn có hiệu lực |
| UI | Settings nhiều workspace, chọn mode từng workspace, trạng thái thiếu quyền/budget/revoke; hộp đề xuất → sửa → duyệt → receipt; 1440/375, sáng/tối |
| Tương thích | Cờ tắt giữ baseline catalog/router/prompt và hành vi Slack chung; bộ test v3 thích hợp và CI đúng head |

Fake Slack phải là HTTP server có state và fixtures phân quyền theo token/workspace; không mock boolean để giả vờ kiểm tra transaction. Timeout/hủy phải quan sát AbortSignal thực. Có mutation bắt lỗi bỏ kiểm chủ, bỏ generation, bỏ dedup, bỏ version CAS, bỏ chặn write trước duyệt và bỏ echo guard.

Evaluation: chốt và commit fixture/label trước lần gọi model đầu, gồm tiếng Việt, paraphrase, deadline mơ hồ, hội thoại không có việc, tin lặp, prompt injection, câu hỏi thiếu nguồn và nguồn riêng tư. Chạy ba lượt độc lập cho mỗi mode. **Đề xuất ngưỡng:** precision đề xuất hữu ích ≥90%, recall intent phải đề xuất ≥85%; chặn mọi ca write không duyệt và mọi ca lộ chéo người dùng. Báo riêng số mẫu, loại lỗi, chi phí, timeout và kết quả luật/AI/kết hợp; không đổi label để làm đẹp kết quả. Các ngưỡng thống kê là tiêu chí đề xuất để phê duyệt thiết kế, không phải số liệu đã đạt.

Nghiệm thu provider thật cần workspace Free và Pro, hai người trong cùng workspace, tài nguyên kiểm thử có quyền rõ ràng. Đọc lại ở Slack chứng minh đúng tác giả, workspace, thread và nội dung; thử token rotation/revoke thực và kết quả hiển thị. Mỗi method/tool được công bố hỗ trợ phải có contract test phù hợp và bằng chứng provider thực hoặc ghi rõ **chưa nghiệm thu live**. Không đổi nhãn đó thành “full” vì các tool khác đã chạy được.

Trước live phải có probe cho: danh tính user-token, mức bao phủ sự kiện user của bốn loại hội thoại, authorizations fanout, cơ chế nhận biết echo, và các ràng buộc Free/Pro của inventory. Nếu Slack không cấp hoặc không cung cấp một khả năng quan trọng, ghi blocker và trình thay đổi phạm vi cho chủ dự án; không âm thầm thay bằng bot hay polling không tương đương. Mọi ghi/xóa thật theo plan được chủ dự án duyệt và readback, không suy ra quyền gửi tin từ việc brainstorm.

## 11. Chia đợt triển khai và ranh giới tiến độ

Đây là nhiều đợt thay đổi liên quan nhau, không phải mở rộng một adapter. Sau khi duyệt thiết kế mới lập kế hoạch chi tiết, ước lượng và task card riêng cho từng phần:

1. Kiểm kê API/quyền/gói; probe có phạm vi được duyệt để chốt các rủi ro provider.
2. OAuth user, repository nhiều workspace, refresh/disconnect và Settings.
3. Catalog/schema/binding và tool Slack theo từng nhóm; đầy đủ review quyền/approval cho mỗi nhóm.
4. HTTP events, phân phối theo quyền, queue, chống lặp và vòng đời nguồn.
5. Ba mode cùng cấu hình, ngân sách, giải thích và đánh giá.
6. Hộp đề xuất trong ATI, các workflow liên dịch vụ và bản tổng hợp.
7. Evaluation, nghiệm thu từng nhóm/provider và quyết định bật cờ.

Chốt interface ở `packages/tool-schemas` trước tích hợp các module. Ownership theo [team workflow](../../team-workflow.md): schema/catalog và planner/evaluation, backend/DB/executor/adapter, frontend có phần việc riêng; mỗi PR có task, log và kiểm tra độc lập. Kế hoạch sau duyệt phải tuân đúng vai trò của nhóm thực hiện.

Hướng Slack mới thay thế việc “chưa làm OAuth Slack” trong backlog cũ về phạm vi tương lai; nó không tự hoàn thành công việc OAUTH-02/03 còn mở, không tự lùi mốc freeze 04/11 và không cam kết toàn bộ Slack hoàn thành trước mốc đó. Mốc giao hàng chỉ chốt sau lập kế hoạch và cân đối ưu tiên.

## 12. Giao cho builder và điều kiện đóng

Builder tự quyết định tên route/bảng, cấu trúc queue và module trong stack hiện tại, component UI, dung lượng/budget mặc định có đo tải, dạng schema tool chi tiết và cách nhóm method tương đương. Phải ghi các quyết định đó vào plan, không cần hỏi lại những lựa chọn kỹ thuật nhỏ.

Không giao builder quyền thay: actor user-token, Free/Pro, nhiều workspace, phạm vi mọi hội thoại có quyền, đủ ba mode cấu hình riêng, đề xuất/duyệt trong ATI, hoặc write phải duyệt. Một hạn chế provider làm thay các điều này phải báo lại.

**Đóng bản thiết kế** khi chủ dự án duyệt tài liệu sau builder check. **Đóng feature** chỉ khi tất cả phần hợp lệ của inventory và các luồng đã thống nhất có bằng chứng, mọi hạn chế được ghi trung thực, CI/review đạt và nghiệm thu live hoàn tất. Thiết kế được commit, test xanh hay một giai đoạn đã merge đều không tự thỏa điều kiện đóng feature.

**Trạng thái kiểm chứng ở lần viết này:** chỉ khảo sát code/docs và tài liệu Slack chính thức. Chưa tạo app, chưa xin scope, chưa gọi OAuth/live Slack, chưa triển khai, chưa chạy model/evaluation hay test sản phẩm cho feature này.
