# Hoàn thiện luồng hiện có của Planora

Ngày 04/11/2026 · Trạng thái: kế hoạch triển khai, chưa thực thi.

## 1. Mục tiêu, baseline và phạm vi

Đưa sáu luồng đại diện từ “có tool và demo” thành quy trình người dùng có thể thiết lập, kiểm tra, chạy và dùng lại. Hoàn thành các lỗi F1/F2/F3, cải thiện readiness F4 và chạy nghiệm thu thật. Không mở rộng số dịch vụ.

Baseline lập kế hoạch: `0b62372c4bdf4597fde0b560ada70cabec3ea393`, checkout hiện tại `feat/rebrand-planora`. Báo cáo audit nằm ở commit local `fb3858300a16d1c37660aaf94951ea87fc27ae13`, đường dẫn `docs/audits/2026-11-04-user-value/REPORT.md`; audit dùng source e71ac54a. Đối chiếu hiện tại thấy logic Playbook và validator liên quan chưa được khắc phục. Không mang số liệu audit cũ sang chứng nhận source mới.

Đặc tả này bổ sung quyết định triển khai cho yêu cầu mới của chủ dự án, tuân thủ đặc tả v3 29/09/2026 và module ownership; không thay thế quyền lực của chúng. Người dùng đã chọn **Playbook lưu trong trình duyệt, tách theo tài khoản/workspace**. Sáu vai trò tiếp tục được mô phỏng; không yêu cầu tuyển sáu người thật để chạy đợt kỹ thuật.

Sáu luồng ưu tiên:

| ID | Kết quả cần đạt |
|---|---|
| OFF-02 | Calendar/Meet + Docs trong folder đã chọn + Gmail gửi link cho người nhận được nhập rõ |
| OFF-03 | Sheets → báo cáo trạng thái/số liệu có đối chiếu → Slack |
| PM-01 | Trello card có người/hạn theo yêu cầu → Slack kèm link |
| PM-03 | Jira → báo cáo tiến độ theo lịch → Slack, nói rõ duyệt từng lượt |
| DEV-02 | GitHub PR đang mở → báo cáo có nguồn → Slack |
| DEV-04 | GitHub issue tồn đọng theo tuổi → lịch gửi Slack theo chế độ hiện được hỗ trợ |

12 công việc và 36 câu audit cũ là bộ kiểm tra hồi quy; sáu luồng còn lại phải trả kết quả đúng khả năng hoặc hỏi/từ chối có hướng xử lý. Đợt này không tự nhận đã triển khai mọi biến thể của 12 nhu cầu.

Không làm: connector mới; đồng bộ Playbook lên máy chủ; engine trigger/nhánh/vòng lặp tổng quát; tự cấp quyền/chia sẻ Drive; đồng bộ hai chiều Jira/Trello/GitHub; đổi thương hiệu lần nữa. Lịch 11/11 trong FINISH-PLAN là bối cảnh, không phải cam kết hoàn tất cả cải tiến trước ngày đó. Sửa lỗi và cải thiện trải nghiệm có gate riêng.

## 2. Báo cáo có nguồn và nội dung duyệt được

### 2.1. Cách xử lý F1

Không dùng việc thêm warning/prompt làm biện pháp duy nhất. Bốn dạng báo cáo được hỗ trợ trong đợt này là `github_prs`, `github_issue_aging`, `jira_progress`, và `sheet_summary`. Nội dung thực tế gồm item/title/link/count/status/group/sum phải được dựng bằng renderer xác định từ kết quả đọc hợp lệ. LLM chọn nguồn, bộ lọc hoặc các ID cần nhấn mạnh trong dữ liệu; không tự cung cấp dữ kiện mới trong phần gửi.

Luồng chuẩn: nhận yêu cầu báo cáo → xác định nguồn/phạm vi và hỏi phần còn thiếu → đọc qua adapter của đúng actor/workspace → lưu observation có hash → dựng report artifact → bind artifact vào các trường nội dung gửi của plan → validate → persist + preview → duyệt hash → kiểm lại quyền/kết nối → thực thi đúng nội dung đã duyệt.

Các playbook báo cáo và yêu cầu tự do được nhận diện là đọc/tổng hợp/gửi PR, issue aging, Jira progress hoặc sheet summary đều đi qua pipeline này. Không cho một plan “báo cáo” thiếu binding rơi xuống nhánh gửi literal do model sinh. Nếu chưa phân biệt được yêu cầu báo cáo và tin nhắn do người dùng soạn, hỏi lại. Nội dung tin nhắn người dùng viết nguyên văn vẫn được phép gửi qua luồng thông thường; không coi đó là báo cáo đã xác minh.

Read dùng để dựng báo cáo được thực hiện **trước preview**. Với các luồng này không hứa preview nội dung hoàn chỉnh rồi đọc lại dữ liệu khác sau khi duyệt. Thay đổi bộ lọc, nguồn, người nhận, nội dung hoặc dữ liệu muốn làm mới phải tạo preview/hash mới. Snapshot chỉ hợp lệ trong thời hạn plan hiện có, không kéo dài thời hạn mặc định.

Snapshot không có kết quả khác với đọc lỗi. Đọc lỗi/401/timeout không được trở thành “0 PR”, số 0 hoặc bản tin rỗng hợp lệ. Nếu đọc bị giới hạn, renderer phải ghi “trong N mục đã đọc”, kèm giới hạn; không dùng tổng cục bộ làm tổng toàn hệ thống.

### 2.2. Contract và quyền sở hữu

Thêm contract dùng chung ở `packages/tool-schemas/src/report-evidence.ts`:

```ts
type ReportKind = 'github_prs' | 'github_issue_aging' | 'jira_progress' | 'sheet_summary';
interface ReportEvidence {
  artifactId: string;
  kind: ReportKind;
  stepId: string;
  argument: 'text' | 'body' | 'content';
  sourceTool: string;
  sourceLabel: string;
  readAt: string;
  itemCount: number;
  coverage: 'complete' | 'partial';
  contentHash: string;
}
```

`PlanResponse.reportEvidence?` và frontend DTO nhận metadata này từ server. Model/client không được tự cấp bằng chứng: backend chỉ chấp nhận binding khớp observation do adapter thực trả cho actor/workspace/connection hiện tại. Observation còn có source args, output hash và connection identity; giữ trong storage/memory đang được policy bảo vệ, không gửi payload nguồn hoặc credential ra metadata UI.

Trước persist, API đóng dấu binding với plan/actor/workspace/connection và hash nội dung thực tế ở argument tương ứng. Đưa metadata đã đóng dấu vào canonical plan hash. Trước dispatch kiểm binding, plan revision và connection snapshot. Nếu binding hoặc quyền bị mất, dừng và yêu cầu đọc/duyệt lại. Chặn approval của plan báo cáo cũ thiếu binding khi tính năng sửa F1 được triển khai; không làm hỏng plan thông báo thông thường.

Nội dung gửi cuối vẫn là string theo schema tool hiện có. Không thêm provider tool, không thêm cú pháp resolver `$report`, không thay `$ref/$template` cho workflow thường. Thay đổi là optional metadata cộng validation/persistence guard; dùng JSON/memory hiện có, không cần bảng DB mới. Nếu serializer/retention hiện tại không đủ bảo vệ binding, đây là lỗi phải giải quyết trong FLOW-01, không được bỏ validation để tránh migration.

Backend/planner dùng pure report renderers; tách các phần định dạng phù hợp từ digest hiện có, tránh import backend vào package planner. Với luồng digest trong phạm vi pilot, phần nhận xét AI cũng không được đưa facts mới không có nguồn; lựa chọn ID/nhóm có thể dùng model nhưng text và facts cuối do renderer tạo.

## 3. Playbook cục bộ đáng tin cậy

- Khóa mới: `planora_playbooks_v2:<userId>:<workspaceKey>`; workspaceKey là `personal` hoặc ID workspace ATI ổn định từ context hiện tại. Workspace Jira chuyên biệt phải có context phân biệt tương ứng, không dùng tên hiển thị làm khóa.
- Đổi account/workspace phải dọn state đã load và load namespace mới. Save/delete callbacks kiểm lại namespace hiện tại để không ghi vào scope vừa rời. Logout không xóa dữ liệu riêng của người trước nhưng không được tiếp tục hiển thị chúng.
- Key v1 toàn cục không có owner nên **không tự gán cho người đầu tiên đăng nhập**. Sao lưu nguyên giá trị sang key quarantine cục bộ, không tự hiển thị/import nội dung. Chỉ xóa key cũ khi sao lưu thành công; nếu hết dung lượng giữ nguyên v1 nhưng không đọc vào UI. Ghi hướng khôi phục riêng trong runbook; không làm mất dữ liệu để đạt test isolation.
- Giữ tối đa 12 mẫu mỗi namespace như hiện tại nhưng chặn lưu mẫu thứ 13 kèm hướng xóa mẫu cũ, không lặng lẽ bỏ mẫu cuối.
- Tách `templateText`, `variableValues` và rendered draft. Template editor là nguồn lưu duy nhất; ô biến chỉ thay giá trị khi gửi. Sửa văn bản trong template phải cập nhật templateText, giữ nguyên token và cập nhật draft. Cho xem trước nội dung đã điền bên cạnh editor; không dò ngược giá trị đã điền để tái tạo token.
- Khi chọn mẫu, nhập/sửa template qua cùng composer có trạng thái “Mẫu” và “Nội dung sẽ gửi”; khi không có biến giữ một ô nhập bình thường. Nút Lưu lưu template hiện tại; Gửi gửi rendered draft. Reset mẫu gốc là hành động rõ, không tự xảy ra khi đổi biến hoặc lưu.
- Đổi tên/xóa biến cập nhật danh sách input; biến chưa điền ngăn Gửi và chỉ đúng ô còn thiếu. Save template vẫn được phép chứa biến chưa điền.
- Storage hỏng/quota/deny phải báo chưa lưu và giữ draft; không hiển thị toast thành công sai. Tên/nội dung/biến không đi vào log analytics.

## 4. Thiết lập theo công việc, preview và lịch chạy

Màn bắt đầu ưu tiên sáu công việc trên, mỗi card nêu đầu ra và dịch vụ cần có. Mẫu chín dịch vụ chuyển xuống phần nâng cao. Readiness phải kiểm tất cả tool/quyền/phạm vi cần cho luồng theo runtime catalog và trạng thái user, không chỉ đếm logo hoặc hai kết nối bất kỳ.

Trạng thái hành động: sẵn sàng; cần kết nối; cần chọn tài nguyên; cần cấp lại quyền; cần quản trị cấu hình. Card thiếu điều kiện đưa người dùng đến đúng chỗ rồi quay lại yêu cầu đang soạn. Calendar/Docs/Drive phải tìm được bằng tên người dùng quen dù backend đang gắn dưới mycalendar/mysheets.

Mặc định board/list/repo/channel/project/calendar/folder/spreadsheet được người dùng chọn chủ động, lưu local theo namespace user/workspace. Không lưu token hoặc mặc định email người nhận. Thứ tự dùng: yêu cầu hiện tại rõ ràng > lựa chọn trên form lần này > mặc định đã xác nhận > hỏi lại. Mặc định không được mở rộng quyền hoặc ghi đè một đích người dùng vừa chỉ rõ.

Thêm optional `workflowContext` vào request chat, với `templateId` là một trong sáu ID ở mục 1 và `resourceDefaults` chỉ có các nhóm: trello {boardId, listId}; github {repo}; slack {channelId}; myjira {siteId, projectKey}; mycalendar {calendarId}; mysheets {spreadsheetId?, sheetName?, folderId?}. Không nhận field tùy ý hoặc email nhận. Các nhóm là optional; nếu có nhóm thì ID bắt buộc như cấu trúc trên, riêng mysheets có thể chỉ chọn folder cho job Docs. Shared DTO đặt ở tool-schemas; API kiểm allowlist/membership, loại defaults hết quyền và hỏi lại trước khi lập plan. Actor/workspace lấy từ phiên/context server, không từ field này. UI luôn hiển thị defaults đang dùng; chỉ ghi nhớ sau thao tác “Đặt làm mặc định”.

Không nói “chỉ kết nối Slack” khi đó chỉ là tập tool router chọn cho lượt hiện tại. Nêu thiếu thông tin nào hoặc luồng nào chưa sẵn sàng. Hỏi tập trung một lượt những trường thật sự thiếu; không hỏi lại dữ kiện hợp lệ đã có.

Preview/receipt phải nêu tài khoản nguồn, dữ liệu đọc lúc nào và có bị giới hạn không, đích ghi/gửi, người/hạn, nội dung cuối và kết quả từng bước. Chi tiết reference kỹ thuật để trong phần mở rộng; giữ link kết quả để đối chiếu.

Lịch hiển thị riêng “Mỗi lượt cần bạn duyệt” và “Tự gửi theo phạm vi đã xác nhận”. Không nâng workflow plan tổng quát thành auto mode. Hiển thị timezone, lần chạy tiếp, trạng thái pause và lượt cần xử lý. Đổi tài khoản nguồn/đích hoặc phạm vi làm mất hiệu lực xác nhận cũ. Lỗi delivery unknown giữ needs_attention, không replay; lỗi chắc chắn chưa gửi mới dùng retry hiện có. Giữ lock ordering đang có, kiểm trên PostgreSQL thật.

## 5. Chính xác dữ liệu và nghiệm thu

- Mở rộng fixture đủ Workspace/PR/due/status và pagination với cùng schema adapter; fixture thiếu thao tác phải làm test fail rõ, không sinh fallback giả.
- OAuth mySheets đang hoạt động phải cho phép catalog các thao tác Docs/Drive được scope drive.file hiện có cấp quyền, kể cả chưa chọn spreadsheet. Sheets read/write vẫn bắt buộc spreadsheet đã chọn. Không yêu cầu tạo/chọn một bảng tính không liên quan chỉ để dùng Docs, không mở scope sang toàn bộ Drive.
- Sheets dùng raw numeric value/locale metadata khi có; chuỗi không xác định locale không đoán bừa. Hiển thị số ô không tính được; giữ nhóm theo khóa đầy đủ, chỉ cắt khi hiển thị. Dataset có đáp án cho số thập phân VN/US, số âm, currency, ô rỗng/sai và hai khóa dài cùng prefix.
- GitHub/Jira thu đủ trang trong giới hạn tool đã hỗ trợ; nếu chưa đủ, ghi partial và số mục đã đọc. Định nghĩa tuổi issue theo timestamp nguồn và clock/timezone cố định trong test; không gọi issue mở là issue quá hạn nếu chỉ biết tuổi.
- OFF-02 dùng mycalendar.schedule_meet với lời mời được duyệt; tạo Docs vào folder thử đã có quyền chia sẻ. Không thêm share tool. Nghiệm thu phải mở link bằng tài khoản nhận thử; nếu chưa kiểm quyền thì UI nói chưa xác minh, không khẳng định khách đã mở được.
- PM-01 phải có card thực, member và due đúng nếu người dùng yêu cầu. Tin nhắn “nhờ Minh làm” không thay việc đã giao.
- Sáu luồng × ba lần liên tiếp bằng model/runtime catalog/user thật và provider thử. Mỗi lượt đối chiếu UI, DB và nguồn/đích provider. Có thêm ca reload/hủy/sửa, revoke, pause/resume, source thay đổi, timeout sau dispatch và không replay.
- Chạy sáu persona mô phỏng: Lan hành chính OFF-01/02, Hạnh vận hành số liệu OFF-03/04, Minh PM PM-01/03, An trực ca PM-02/04, Quân dev mới DEV-01/02, Dũng tech lead DEV-03/04. Mỗi vai trò dùng session/browser context riêng, có thể dùng lại test identity nhưng phải ghi rõ, không nhận là sáu người/tài khoản độc lập. Dùng WorkingMemory/context thật của ChatService; không thay bằng probe khởi tạo memory mới. Không gọi kết quả mô phỏng là usability study của người thật.
- Đo setup, clarification, latency từng pha, lượt sửa, kết quả đúng, chi phí đầy đủ và phần còn phải làm tay. Thời gian agent/browser là thời gian vận hành mô phỏng; manual human time, ROI con người, SUS và retention vẫn chưa xác lập nếu không có người tham gia.

Hoàn tất kỹ thuật khi F1/F2/F3 không còn tái hiện; sáu luồng đạt 18 lượt live, bộ 36 câu không bị regression theo nhãn đúng/hỏi/từ chối; lỗi không xác định không ghi trùng; full check và CI đúng SHA xanh. Nếu tài khoản thử 401, task sửa code có thể đóng với bằng chứng offline nhưng gate live liên quan vẫn OPEN/NOT_RUN; không đóng toàn bộ pilot chỉ vì CI xanh.
