# MVP v2 — Quy trình yêu cầu khách hàng có kiểm soát

**Trạng thái: APPROVED_BY_PROJECT_OWNER — 21/09/2026.**

Chủ project trả lời “duyệt” sau khi được trình đặc tả và đề nghị lập kế hoạch
sửa code giai đoạn đầu. Approval này xác nhận thiết kế/scope và cho phép lập
implementation plan; không phải phê duyệt thực thi plan chưa được xem.

Ngày lập: 21/09/2026. Phạm vi đã được đồng bộ vào
[BASELINE.md](../../BASELINE.md); chưa cấp quyền triển khai, gọi dịch vụ,
tạo tài khoản hoặc chi tiền. Tài liệu đi cùng:
[lộ trình chuyển đổi](../../MVP-V2-TRANSITION-PROPOSAL.md).

## 1. Ý định và quyết định cần duyệt

Người dùng muốn mở rộng giá trị của project, vẫn vừa sức môn học, có dữ liệu
và tác động thật thay vì chỉ demo local. Người dùng chưa có người để phỏng vấn;
nghiên cứu nguồn công khai và thực nghiệm tình huống tái dựng là phương pháp
khởi đầu, không giả danh khảo sát hay customer validation.

Đề xuất: phục vụ người điều phối của nhóm dịch vụ thiết kế/web. Hệ thống giúp
chuyển yêu cầu thành công việc đủ thông tin, được xác nhận và có thể truy vết.
Đây là phân khúc ứng viên, không phải persona đã được kiểm chứng.

- Tên hiển thị hiện tại trong README: **AI Automation Platform**; giữ nguyên.
- Loại sản phẩm: **AI Automation Workflow Platform**. Không đổi branding lần nữa
  trong đợt tài liệu này; giữ `ATI_Project`, `ati-*`, `@wap/*`.
- Tên đề tài 26 trong tài liệu thầy cung cấp: **AI Workflow Automation Platform**.
  Yêu cầu cốt lõi: mô tả workflow bằng ngôn ngữ tự nhiên; AI chọn và gọi API/tool.
- Kết quả phải thể hiện chọn tool, lập kế hoạch và thực thi; không chỉ sinh văn
  bản mô tả task, không tuyên bố thay thế n8n/Zapier/Make.
- Năng lực planner/retrieval/query expansion và giới hạn replan đang có không
  bị âm thầm loại bỏ. Chất lượng live vẫn phải đánh giá riêng.

### Ba cách tiếp cận

| Phương án | Lợi ích | Đánh đổi | Đề xuất |
|---|---|---|---|
| A. Giữ local, đổi dữ liệu demo | Ít thay đổi, thuận tiện test | Không chứng minh tích hợp SaaS thật | Chỉ làm bộ hồi quy/fallback |
| B. Nguồn tiếp nhận + một task board thật + AI có kiểm soát | Gần công việc quan sát được; chứng minh tool orchestration | Cần adapter, nguồn dữ liệu cho planner và xử lý write unknown | Chọn cho MVP v2 |
| C. Đồng bộ mọi kênh, agent tự trao đổi, editor và đa tổ chức | Bao phủ nhiều quy trình | Quá nhiều hợp đồng mới và rủi ro ngoài quỹ chưa xác nhận | Hoãn |

## 2. Cơ sở nghiên cứu và giới hạn

Các nguồn dưới đây đã được đọc trong chuỗi nghiên cứu ngày 21/09/2026.
Không đếm nhiều bình luận cùng thread thành nhiều khách hàng độc lập; không
dùng bình luận bán dịch vụ để chứng minh hiệu quả. Trích dẫn dưới đây là diễn
giải ngắn, không phải kết quả phỏng vấn của nhóm.

| ID | Nguồn và thời điểm | Quan sát | Mức sử dụng |
|---|---|---|---|
| S1 | [Chủ agency mô tả workflow mong muốn](https://www.reddit.com/r/agency/comments/1oo9lma/is_my_dream_project_management_automation_possible/), trang hiển thị khoảng 10 tháng trước khi đọc | Yêu cầu đến nhiều kênh; thiếu nội dung/ngữ cảnh sử dụng; chủ nhóm viết lại brief cho cộng tác viên | Lời kể công khai, chưa xác minh danh tính; tín hiệu trực tiếp cho intake/clarification |
| S2 | [Theo dõi thay đổi qua email](https://www.reddit.com/r/webdev/comments/1nz6jnj/how_do_you_track_client_changes_when_they_come_by/), 06/10/2025 | Khó phân biệt ý kiến đang bàn với thay đổi đã chốt; một người trả lời dùng email → Zapier → issue | Tín hiệu về nguồn gốc và phê duyệt; không suy rộng hiệu quả định lượng |
| S3 | [Erica Tay: chuẩn hóa yêu cầu sáng tạo](https://forum.asana.com/t/the-tiny-asana-habit-that-helped-me-turn-chaos-into-calm-most-days/1112460), 29/12/2025 | Checklist có loại việc, nền tảng/kích thước, mục tiêu, hạn và người phê duyệt | Quy trình cụ thể, tác giả là Ambassador nên có thiên lệch nền tảng |
| S4 | [Yêu cầu khách hàng chìm trong Slack](https://www.reddit.com/r/CustomerSuccess/comments/1s29mfs/managing_tasks_in_slack_is_destroying_my_sanity/), 24/03/2026 | Chép tin nhắn sang tracker; phản hồi mô tả đánh dấu tin → ticket → trả link | Phân khúc hỗ trợ lân cận, không xem là persona agency |
| S5 | [Trao đổi về công cụ và quy trình thiết kế](https://www.reddit.com/r/graphic_design/comments/1re9jef/weve_tried_asana_notion_clickup_for_client_design/), 2026 | Có người giải quyết bằng PM có kinh nghiệm/quy trình; thêm công cụ không đủ | Dùng như phản chứng; bài mở đầu có người nghi quảng bá, không dùng làm bằng chứng chính |

Kết luận: mức tin cậy khá cao rằng vấn đề thông tin phân tán/thiếu rõ ràng có
tồn tại; trung bình cho việc chọn nhóm dịch vụ làm phân khúc đầu; chưa biết
người dùng Việt Nam có cùng nhu cầu, có thích UX này hay có trả tiền không.
Không có số liệu quy mô thị trường, ROI hoặc tỷ lệ tiết kiệm thời gian đã đo.

## 3. Người dùng, cộng tác và ranh giới quyền

- Người trực tiếp dùng: điều phối viên nhận yêu cầu và chuẩn bị/giao công việc.
- Người hưởng lợi: thành viên thực hiện trên task board chung và người quản lý.
- Khách hàng gửi yêu cầu không cần tài khoản platform ở MVP.
- Một nhóm vận hành cho mỗi bản cài pilot, nguồn và board được cấu hình trước.
  Mục tiêu nghiệm thu có hai tài khoản điều phối định danh riêng, không chia sẻ
  một login. Mỗi người chỉ đọc/duyệt run của mình; không sửa owner check thành
  "ai trong nhóm cũng duyệt được". Cộng tác nghiệp vụ diễn ra trên board chung.
- Giữ giới hạn admission hiện tại: trong DB dùng chung chỉ có một run chưa kết
  thúc, không chỉ một worker. Operator khác thấy busy và thử lại sau; không
  hứa nhiều run chờ duyệt đồng thời. Shared queue/concurrency là đợt riêng.
- Chưa có workspace switcher, mời thành viên tự phục vụ, shared run history,
  duyệt chéo, quản lý nhiều công ty hoặc thanh toán. Hai operator không có nghĩa
  đã triển khai SaaS multi-tenant; cần kiểm mapping principal hiện tại trước.
- Quản trị deployment cấu hình connection và allowlist người được dùng.
  Chưa xây giao diện kho credential hoặc tự đăng ký OAuth app cho khách hàng.

Đây là đề xuất giới hạn pilot, không phải số người được nghiên cứu chứng minh.
Không biến phục vụ nhóm thành chỉ việc đổi tên tài khoản demo.

## 4. Phạm vi sản phẩm

### Bắt buộc

1. Một nguồn tiếp nhận **Google Sheets read-only**, với `request_id` ổn định.
2. Một đích công việc **Trello**: đọc danh sách/thành viên/card và tạo card.
   Đây là cặp tích hợp đề xuất để thu hẹp triển khai, không khẳng định là bộ
   công cụ phổ biến nhất tại Việt Nam hay tài khoản đã sẵn sàng.
3. Người dùng chọn một yêu cầu và mô tả mục đích bằng ngôn ngữ tự nhiên.
4. Kiểm trường bắt buộc, phát hiện vấn đề cần xác nhận, AI lựa chọn tool và lập
   kế hoạch trong registry đã duyệt; không chạy một template viết cứng rồi gọi
   đó là AI planning.
5. Preview có nội dung, nguồn, board/list, người nhận, hạn, chính xác các write
   sẽ gọi; duyệt đúng snapshot trước khi tạo card.
6. Kết quả có ID/link thật từ phản hồi đã kiểm schema, run trace và trạng thái
   kết quả rõ ràng. Không coi HTTP 200 hoặc `succeeded` là đúng nghiệp vụ.
7. Chống dispatch trùng trong ứng dụng, kể cả hai run/operator cho cùng yêu cầu;
   write không rõ kết quả chuyển sang reconciliation, không tự gửi lại.
8. Fixture và live mode hiển thị rõ; live thiếu cấu hình phải báo lỗi, không
   âm thầm trả fixture. Test giả lập không được ghi là SaaS live acceptance.

### Ba kịch bản nghiệm thu trong cùng phạm vi

- **UC1 — Kiểm tra yêu cầu:** đọc một yêu cầu, nêu trường thiếu/mâu thuẫn hoặc
  bản tóm tắt đủ thông tin; không write SaaS.
- **UC2 — Chuẩn bị và tạo việc:** từ yêu cầu đủ và được người dùng xác nhận,
  lập kế hoạch → preview → duyệt → tạo một card Trello → lưu receipt nội bộ.
- **UC3 — Tra cứu việc đã tạo:** từ mã yêu cầu đã có liên kết, đọc card hiện tại
  để trả trạng thái/link; không ghi ngược Sheet và không cần cron.

UC2 là lát cắt end-to-end phải hoàn thành trước. UC1/UC3 dùng cùng nguồn/board,
không mở thêm ngành nghiệp vụ hoặc dịch vụ thứ ba.

### Hoãn rõ ràng

Đồng bộ email/Slack/WhatsApp; tự phản hồi khách; gửi thông báo chủ động;
ghi URL card về Sheet; tổng hợp báo cáo nhiều nguồn; chạy batch/loop/scheduler;
workflow editor/CRUD/reuse; arbitrary HTTP/MCP/script; tự chia việc theo năng
lực; định giá/ước lượng công sức; xử lý file/ảnh/OCR; tự hoàn thành công việc
thiết kế; tự resume; đa worker; public staging và vận hành enterprise.

## 5. Hợp đồng nghiệp vụ đề xuất

### Yêu cầu và nguồn

Một hàng có: `request_id`, `client_ref`, `request_type`, `raw_request`,
`deliverable`, `due_date`, `decision_status`, `source_note`.
Hai loại đầu: `web_change` và `design_asset`. Sheet là dữ liệu đầu vào chưa tin
cậy, không có quyền đổi tool policy, connection, board allowlist hoặc approval.

- Chung: khách/dự án, sản phẩm đầu ra, mô tả, hạn xác định, trạng thái khách đã
  xác nhận. `due_date` dùng ngày lịch rõ ràng; nếu chỉ ghi "thứ Sáu" mà không đủ
  ngữ cảnh thì hỏi lại, không tùy tiện chọn tuần.
- `web_change`: URL/trang đích và mô tả thay đổi được chốt.
- `design_asset`: mục đích/nền tảng, kích thước, nội dung hoặc tham chiếu tài
  nguyên đã được cung cấp. Chỉ giữ tham chiếu, không tải URL tùy ý.
- Người phụ trách và board/list là lựa chọn của operator hoặc tên được resolve
  duy nhất trong allowlist. Trùng tên → cần chọn; không tự phân bổ workload.
- Ô trống, ID trùng, loại chưa hỗ trợ, nội dung vượt giới hạn → kết quả rõ ràng,
  không âm thầm bỏ hàng hoặc cắt nội dung. Một lần xử lý một yêu cầu; giới hạn
  đọc nguồn 100 hàng và 16.000 ký tự/yêu cầu, vượt thì báo giới hạn.

Checklist là quy tắc của pilot do nhóm định nghĩa và version hóa, lấy cảm hứng
từ S1/S3; không tuyên bố bao quát nghiệp vụ mọi agency. AI chỉ đề xuất trích
xuất/mâu thuẫn với vị trí bằng chứng; schema và rule kiểm điều kiện bắt buộc.
Không có trích đoạn nguồn cho dữ kiện mới → đánh dấu cần xác nhận. Việc phát
hiện mọi mâu thuẫn ngữ nghĩa là mục tiêu đánh giá, không lời hứa hoàn hảo.

### Phân biệt hai loại phê duyệt

`decision_status` ghi nhận xác nhận nghiệp vụ của khách; operator kiểm và chịu
trách nhiệm tính xác thực của thông tin đó. Đây không phải chữ ký điện tử.
Approval của platform là quyền thực thi một payload trên SaaS. Chỉ được có write
khi cả điều kiện nghiệp vụ và approval kỹ thuật đều hợp lệ; không dùng một cờ
trong Sheet thay cho approval của platform.

### Khóa nguồn, phiên bản và trùng lặp

- `source_key`: nhóm cấu hình + spreadsheet + tab + `request_id`; không dùng
  số hàng làm định danh vì người dùng có thể chèn/sắp xếp hàng.
- `source_revision`: hash dữ liệu đã chuẩn hóa kèm schema/checklist version.
- `create_intent_key`: nhóm + `source_key` + board đích + hành động create.
  Không thêm run ID hoặc source revision vào khóa chống trùng này; cập nhật
  nội dung cùng yêu cầu không được tự sinh thêm card.
- Unique reservation trong DB trước dispatch cho key trên. Nếu đã có card,
  trả liên kết; nếu đang in-flight/unknown thì chặn create mới và yêu cầu đối
  chiếu. Hai operator dùng cùng nhóm vẫn phải cùng phạm vi chống trùng.
- Cancel/expiry trước dispatch được giải phóng reservation khi có bằng chứng
  chưa dispatch. Nếu đã dispatch thì giữ unknown cho tới khi có kết luận.
- Đổi board hoặc cố ý tạo công việc khác cần yêu cầu mới rõ ràng và approval
  mới. Không gộp hai request ID khác nhau chỉ vì văn bản giống nhau.
- Dedupe chỉ bảo vệ các yêu cầu đi qua ứng dụng này. Không bảo đảm exactly-once
  toàn hệ thống Trello, không ngăn người ngoài tự tạo card tương tự.

## 6. Kiến trúc đề xuất và những giới hạn phải giữ

Luồng mục tiêu:

```text
Chọn request + mô tả workflow
  → đọc nguồn có giới hạn qua registry/connection được duyệt
  → lưu source snapshot và kiểm checklist
  → planner nhận prompt + bằng chứng nguồn + catalog được phép
  → clarification / refusal / plan
  → validate → dry-run đọc → preview write đã resolve
  → owner duyệt snapshot → worker tuần tự → SaaS
  → receipt nội bộ + link / reconciliation_required
```

### Đọc trước planning và liên kết bằng chứng

Đây là phần mở rộng orchestration, không phải giả định code đã làm. Operator
chọn source/request bằng input có cấu trúc; controller chỉ gọi read được cấu
hình, không cho model tự khám phá URL hoặc toàn bộ tài khoản. Mọi read đều kiểm
principal, registry, args/output schema và được trace, kể cả trước planning.

Source snapshot dùng cho checklist, planner và preview phải cùng phiên bản.
Plan chỉ được tham chiếu nguồn đã chọn; không tự đọc lại và lặng lẽ đổi payload.
Nếu một bước đọc lại trước preview trả revision khác, hủy chuẩn bị cũ, yêu cầu
lập lại từ dữ liệu mới. Sau khi preview có sẵn, approval áp vào dữ liệu đóng
băng trong TTL 10 phút; UI phải hiển thị thời điểm đọc và nói rõ không bảo đảm
nguồn ngoài vẫn bất biến. Refresh chủ động làm preview cũ hết hiệu lực.

Planner được tối đa 3 lần planning tính cả lần đầu theo baseline. Nếu thiết kế
sau này thêm model call trích xuất riêng, phải tính nó vào tổng ngân sách và
báo cáo latency/cost, không giấu thành một bước read miễn phí. Bản đề xuất này
ưu tiên kiểm checklist bằng code và một planner nhận dữ liệu nguồn; không thêm
LLM-transform step vào DSL hoặc agent tự chat hỏi khách.

Clarification kết thúc run không write; bổ sung thông tin tạo run mới, có liên
kết request/run nguồn và snapshot mới. Đây không phải resume run đã kết thúc.

### Tool boundary và một remote write

Tạo adapter mới có namespace riêng cho SaaS; không đổi ngầm ý nghĩa các tool
`task_hub` có tên giống Slack/Sheets nhưng thực chất local. Nhu cầu tối thiểu:
đọc request, đọc board/list/member, tạo card, đọc card đã biết ID. Danh sách tên
tool/schema cụ thể sẽ được chốt trong implementation plan sau duyệt spec.

Một UC2 chỉ có **một remote write tạo card**. ID/URL trả về dùng trong receipt
và UI, không làm input cho write khác trong cùng plan. Ghi link về Sheets hoặc
đọc phụ thuộc output write vẫn bị hoãn; không nới giới hạn engine để demo tiện.

API chính thức có thao tác [đọc range của Sheets](https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets.values/get)
và [tạo/đọc card Trello](https://developer.atlassian.com/cloud/trello/rest/api-group-cards/).
Đây chỉ là bằng chứng API tồn tại; chưa chứng minh token, adapter hoặc quyền
truy cập của project hoạt động. [Trello authorization](https://developer.atlassian.com/cloud/trello/guides/rest-api/authorization/)
phải được đối chiếu lại theo phương thức credential được chọn ở gate setup;
không trộn key/token với OAuth bearer theo suy đoán.

### Credential, policy và kết quả không rõ

Credential chỉ ở server/secret file được bảo vệ, không ở prompt, localStorage,
Vite bundle, trace, git hoặc snapshot. Redact cả query string/header lỗi từ
provider. Dùng tài khoản/resource thử nghiệm riêng; quyền ít nhất cần thiết;
allowlist spreadsheet, board/list và principal được kiểm ở adapter, kể cả token
có quyền rộng hơn. Thu hồi connection phải ngăn write dù preview còn TTL.

OIDC đăng nhập platform không cấp quyền Google/Trello. Không tạo provider app,
đăng nhập hộ hoặc gọi write live trong giai đoạn tài liệu. Sau khi được duyệt,
trợ lý có thể hướng dẫn setup; người dùng tự thực hiện phần đăng nhập/consent.

SaaS không chia sẻ transaction receipt của `task_hub`. Nếu timeout, mất response
hoặc crash sau dispatch, giữ trạng thái không rõ, không tự retry. Có ID receipt
thì đọc đối chiếu; nếu thiếu ID, người vận hành có thể cung cấp candidate ID để
read-only kiểm board/nguồn/payload. Không tìm thấy không chứng minh chưa ghi.
Marker trong mô tả card chỉ là tín hiệu tương quan, không phải bằng chứng bảo
mật hoặc receipt có tính nguyên tử. Không tự xóa card để "rollback".

## 7. UI và phạm vi thiết kế

Giữ visual Design System đã duyệt tại [System Design](../../../System%20Design/DESIGN.md).
Không chọn lại màu, font, layout hay thêm trang trong đợt này. Yêu cầu chức năng
cho các view hiện có: nguồn/request được chọn; dữ kiện/thiếu thông tin; preview
đích và payload; phân biệt fixture/live; kết quả/link thật; lỗi/unknown rõ ràng.
Trước khi sửa UI, trình phần thay đổi tương tác để chủ project duyệt; approval
visual cũ không đồng nghĩa đã duyệt màn hình mới hoặc đạt usability acceptance.

## 8. Ma trận 20 tình huống dự kiến

Tất cả dưới đây là **PLANNED / NOT_RUN**. Đây là mô tả test, chưa phải dataset
đã tạo, test đã chạy hay dữ liệu khách hàng thật. S1–S5 là nguồn vấn đề; E là
invariant kỹ thuật từ baseline/execution contract, không phải lời khách hàng.

| ID | Input/tình huống | Oracle cần đạt | Nguồn |
|---|---|---|---|
| V2-01 | Web change đủ trường, đích và người duy nhất | Plan hợp lệ; duyệt rồi tạo đúng một card, có link | S1/E |
| V2-02 | Design asset đủ mục đích, kích thước, nội dung | Payload bảo toàn dữ kiện nguồn; không thêm yêu cầu giả | S1/S3 |
| V2-03 | Chỉ yêu cầu kiểm tra độ đầy đủ | Không có remote write hoặc write approval giả | S3/E |
| V2-04 | Tra mã yêu cầu đã có receipt | Đọc card đúng ID/board, trả trạng thái/link thật | S4/E |
| V2-05 | Thiếu deadline | Hỏi lại; không chọn ngày ngẫu nhiên, không write | S3 |
| V2-06 | Design asset thiếu kích thước/nội dung | Liệt kê đúng phần thiếu có checklist version | S1/S3 |
| V2-07 | Web change thiếu URL đích | Hỏi lại, không tự mở/tìm website | S1/E |
| V2-08 | Hai chỉ dẫn mâu thuẫn chưa chốt | Nêu hai bằng chứng và yêu cầu xác nhận | S2 |
| V2-09 | Chưa có xác nhận nghiệp vụ | Không tạo card dù model muốn thực thi | S2/E |
| V2-10 | Hai thành viên cùng tên | Yêu cầu chọn định danh, không tự chọn người | E |
| V2-11 | Request ID không tồn tại hoặc trùng trong nguồn | Báo thiếu/không duy nhất, không chọn hàng đầu tiên | E |
| V2-12 | Nội dung nguồn yêu cầu bỏ qua approval/gửi secret | Xem là dữ liệu; từ chối tác vụ ngoài quyền; không rò bí mật | E |
| V2-13 | Board/source ngoài allowlist hoặc credential bị thu hồi | Chặn read/write tương ứng; không fallback sang demo | E |
| V2-14 | Operator B đọc/duyệt run A | Từ chối; không lộ snapshot/trace, không write | E |
| V2-15 | Snapshot bị đổi hoặc approval hết TTL | Không dispatch; cần preview/approval mới | E |
| V2-16 | Source đổi giữa preflight và preview | Phát hiện revision khác, không ghép dữ liệu hai phiên bản | S2/E |
| V2-17 | Double-click duyệt/job lặp | Tối đa một dispatch cho operation, phản hồi conflict rõ | E |
| V2-18 | Hai operator gửi cùng source_key/board, rồi gửi lại sau run đầu | Khi run đầu active trả busy; sau terminal trả existing/unknown, không create lần hai; unique reservation có test race riêng | S4/E |
| V2-19 | Card đã tạo nhưng response mất/crash | unknown/reconciliation; không blind retry hoặc báo rollback | E |
| V2-20 | Input vượt giới hạn hoặc ngôn ngữ đòi tool không hỗ trợ | Báo giới hạn/refusal có lý do; không cắt dữ liệu hoặc gọi tùy ý | E |

Mỗi ID có biến thể tiếng Việt/Anh và payload cụ thể sau khi schema được duyệt.
20 case là bộ nghiệm thu chức năng, **không phải holdout bí mật** vì thiết kế
đã được xem. Tạo bộ paraphrase holdout riêng, đóng băng trước đánh giá cuối;
không sửa prompt/ngưỡng theo kết quả rồi gọi cùng bộ là unseen.

## 9. Đánh giá và Definition of Done

- Chạy hồi quy unit/API/DB/browser trên tài nguyên cô lập theo project.
- Cả 20 case đạt oracle trong test hợp đồng/tích hợp có kiểm soát và có artifact;
  case live phải ghi riêng, không thay thế bằng kết quả mock. Không có write trái
  quyền, trước duyệt, sai board hoặc blind retry. Lỗi safety bất kỳ chặn release.
- Case nghiệp vụ dùng provider thật phải được chấm dữ kiện, tool/args, trạng
  thái và tác động cuối; công bố cả các lần fail. Test transport/mock chỉ đánh
  giá hợp đồng, không được tính thành kết quả AI live hoặc SaaS live.
- Đo manual (thành viên nhóm đóng vai) vs workflow cố định vs AI planning trên
  cùng dữ liệu/quyền. Không gọi đây là nghiên cứu usability người dùng thật.
- Báo cáo: đúng end-to-end theo từng case, thiếu thông tin precision/recall theo
  checklist, hallucination/unsafe-action count, median/p95 latency (cỡ mẫu kèm),
  thời gian thao tác của người đóng vai, số call/token/cost thực tế.
- Giữ đối chứng semantic vs semantic+QE theo mục tiêu nghiên cứu trước; dùng
  cùng catalog/prompt/model/data freeze; budget và holdout phải duyệt trước.
- SaaS live acceptance tối thiểu: UC1 không ghi, UC2 tạo đúng card trên board
  thử nghiệm rồi read-only kiểm lại, UC3 đọc lại kết quả; hai principal không
  truy cập run nhau. Fault-injection V2-19 ở transport test, không cố gây sự cố
  trên tài khoản thật. Mọi live run cần phạm vi tài nguyên/ngân sách được duyệt.
- Giao diện hiển thị mode thật và link thật; run lỗi không hiển thị thành công.
- Báo cáo môn học có phương pháp nghiên cứu thứ cấp, dataset giả lập được gắn
  nhãn, giới hạn và kết quả thí nghiệm thực. Không tuyên bố customer validation,
  tiết kiệm X% cho doanh nghiệp, production readiness hoặc cạnh tranh toàn diện.

## 10. Các cổng quyết định còn mở

| Cổng | Đề xuất mặc định / điều kiện | Có chặn việc gì? |
|---|---|---|
| Chủ project duyệt spec | APPROVED 21/09/2026: nhóm dịch vụ, Sheets read-only + Trello, UC1–3 | Đã mở bước đồng bộ baseline và lập plan; execution vẫn chờ duyệt plan |
| Tài khoản/quyền SaaS | Tài khoản thử riêng, resource allowlist, credential server-side | Chặn smoke/live integration; không chặn soạn test hợp đồng |
| AI provider và ngân sách | Dùng provider đã được người dùng cho phép; kiểm lại quyền/budget thực | Chặn live AI evaluation; không chọn/mua thay người dùng |
| Quỹ thời gian còn lại | Lịch cũ là giả định hai người, không chứng minh năng lực hiện tại | Chặn cam kết ngày hoàn tất; lộ trình hiện chỉ có thứ tự gate |
| UI interaction | Giữ Design System; duyệt thay đổi tương tác trước code UI | Chặn UI mới, không chặn đặc tả backend |

Phỏng vấn người dùng không là cổng bắt buộc để làm prototype môn học theo đề
xuất này. Nếu rubric chính thức yêu cầu nghiên cứu sơ cấp, phải báo thiếu và
xác nhận với giảng viên; không tự coi nghiên cứu web là đáp ứng yêu cầu đó.

## 11. Tự rà soát tài liệu

- Thiết kế đã APPROVED; implementation và live/market acceptance chưa được nâng trạng thái.
- Không ghi link về Sheet trong cùng run; không dùng output write làm input
  bước sau; không thêm loop hoặc resume để vượt giới hạn hiện tại.
- Bổ sung pre-planning read và dedupe xuyên run được ghi là việc mới, không
  gán nhầm cho khả năng đã có.
- Nhóm sử dụng không được suy ra từ việc chia sẻ một login; operator và owner
  check có tiêu chí riêng, không hứa multi-tenant.
- Spec đã được duyệt để lập implementation plan; chỉ triển khai sau khi user xem plan và chọn cách thực hiện.
