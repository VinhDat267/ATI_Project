# FE-03 · Plan và kết quả dễ đọc, kết nối SSE bền hơn, tiếng Việt nhất quán, hỗ trợ trình đọc màn hình

**Trạng thái:** chờ · **Nhánh gợi ý:** `feat/fe-03-readable-plan-and-results` · **Phụ thuộc:** FE-02 đã merge (dùng cấu trúc file mới) · **Nên xong trước:** buổi thử W4-03

## Vì sao quan trọng

W4-03 đo "tỉ lệ plan dùng được" với người dùng thật. Nếu plan chỉ hiện ID mờ nghĩa (`listId: 64f2a…`), người tham gia không kiểm được plan có đúng ý không, nên phép đo sẽ phản ánh giao diện thay vì chất lượng planner.

## Vấn đề (đã xác nhận khi chạy sandbox, trừ mục 3 là phân tích code)

1. **Plan preview chỉ hiện ID.**
   - `PlanStepItem` in thẳng giá trị tham số (`listId: list_frontend_todo`, `memberId: member_minh_dev`; khi chạy thật là ID dài).
   - Planner đã có tên các tài nguyên trong bộ nhớ grounding (kết quả search có `name`/`title`).
   - Không có dấu hiệu bước nào **ghi** ra service, bước nào chỉ **đọc**; không hiện mức rủi ro (đặc tả §5.6).
2. **Kết quả thực thi là JSON thô.**
   - `ExecutionProgress` hiện `JSON.stringify(output)`, ví dụ `{"id":"card_…","url":"https://trello.com/c/…"}`; link không bấm được.
   - Sau khi chạy xong không có câu tóm tắt.
   - Plan đã duyệt biến mất khỏi khung chat.
3. **SSE chết im lặng khi access token hết hạn.**
   - `fetchEventSource` mặc định đóng kết nối khi tab bị ẩn và mở lại khi tab hiện, **với header cũ**. Ẩn tab quá 15 phút rồi quay lại thì nhận 401, `onopen` hủy luôn kết nối, không refresh token, không báo gì. Tiến trình thực thi ngừng cập nhật.
   - Đây là kết luận từ đọc `use-sse.ts`, chưa tái hiện được vì cần chờ 15 phút; agent phải tái hiện bằng test (đồng hồ giả hoặc access token TTL ngắn).
4. **Chuỗi tiếng Anh trong giao diện tiếng Việt.**
   - Planner trả câu hỏi làm rõ "I could not find Frontend. Please provide another board name." (`packages/planner/src/planner.ts:179`, thấy trên màn hình).
   - Các câu cố định khác ở `planner.ts:150` và `:308`, câu hỏi trong `gatherRules` của registry, thông báo lỗi API cũng là tiếng Anh.
5. **Ô nhập chat chỉ một dòng** (`<input type="text">`) và vẫn gửi được khi đang chờ plan, nên dễ gửi trùng.
6. **Trình đọc màn hình:**
   - không có landmark (`main`, `nav`/`aside`);
   - khung chat không có `role="log"`/`aria-live`, nên tin mới và plan mới không được đọc;
   - nút "✕" đóng sidebar không có nhãn;
   - hai thẻ `h1`.

   Form đăng nhập đạt (nhãn gắn đúng `for`, có `autocomplete`), giữ nguyên.
7. **Nhỏ:**
   - giờ hiện "06:24 AM" (định dạng theo locale trình duyệt) lẫn với "Hôm qua";
   - `h-screen` trên điện thoại bị thanh trình duyệt che, nên dùng `h-dvh`;
   - chức năng "Sửa qua Chat" điền sẵn ô nhập bằng ba cơ chế chồng nhau (DOM trong `PlanPreview`, DOM trong `App`, hai `CustomEvent`). Giữ lại **một** cơ chế.
   - Còn lại sau FE-01 (review PR #27): tiêu đề mẫu "Tổng hợp Phát hành Sprint & Báo cáo Kỹ thuật" không khớp nội dung (issue → card → Slack); chấm xanh nhấp nháy ở thanh dịch vụ luôn hiện kể cả khi 0 dịch vụ được cấu hình; dòng "Chưa xác định được chế độ chạy" hiện thoáng trong lúc đang tải `runtimeMode`.

## Việc cần làm

1. **Tên tài nguyên trong plan:**
   - backend gửi kèm `resourceLabels` khi phát `plan_preview` và lưu cùng metadata của plan: map `giá trị → tên` lấy từ bộ nhớ grounding, chỉ cho các tham số có `x-resource`;
   - frontend hiện "Danh sách **Cần làm** (board Frontend)" và ID nhỏ bên cạnh;
   - mỗi bước có nhãn "Đọc" / "Ghi" và mức rủi ro.
2. **Kết quả:**
   - hiển thị theo trường: tên, link bấm được (chỉ `http`/`https`, mở tab mới với `rel="noopener noreferrer"`), thời gian;
   - JSON đầy đủ để trong phần "Chi tiết" thu gọn;
   - câu tóm tắt sau khi xong;
   - plan đã duyệt vẫn xem được (thu gọn) trong hội thoại.
3. **SSE:**
   - `onopen` nhận 401 thì gọi `apiClient.refreshToken()` rồi kết nối lại một lần; vẫn lỗi thì đưa về đăng nhập;
   - dùng `openWhenHidden: true`, hoặc lấy token mới mỗi lần mở lại;
   - mất kết nối quá 5 giây thì hiện dải "Mất kết nối, đang thử lại…".
4. **Tiếng Việt:** mọi chuỗi cố định mà người dùng nhìn thấy (planner, registry, API) chuyển sang tiếng Việt, hoặc có mã lỗi để frontend dịch. Có test quét các chuỗi `question`/`reason`/`error` cố định. Câu do model sinh ra không thuộc task này (đo ở W4).
5. **Ô nhập:** `textarea` tự giãn tối đa 6 dòng; Enter gửi, Shift+Enter xuống dòng; khóa nút gửi khi đang chờ plan, có trạng thái "Đang lập kế hoạch…".
6. **Truy cập:** thêm landmark; khung chat `role="log" aria-live="polite"`; nhãn cho nút chỉ có biểu tượng; một `h1` mỗi màn hình.

## Tiêu chí nghiệm thu

- [ ] Test backend: `plan_preview` và metadata plan có `resourceLabels` đúng cho tham số `x-resource`, không có nhãn cho tham số thường.
- [ ] Test frontend:
  - plan hiện tên kèm ID, nhãn Đọc/Ghi;
  - kết quả có link bấm được;
  - link `javascript:` hay scheme khác không được render thành link.
- [ ] Test SSE: `onopen` 401 → refresh → kết nối lại thành công; refresh lỗi → về đăng nhập; mất kết nối thì hiện dải thông báo. Dùng access token TTL ngắn hoặc đồng hồ giả, không chờ 15 phút thật.
- [ ] Test không còn chuỗi tiếng Anh cố định trong các câu hỏi, câu từ chối và lỗi trả cho người dùng.
- [ ] Browser E2E:
  - plan preview có tên tài nguyên;
  - sau khi chạy, link kết quả bấm được;
  - Shift+Enter xuống dòng;
  - không gửi được tin thứ hai khi đang chờ plan.
- [ ] `npm run check` exit 0; `npm run test:browser:v3` đạt hết.

## Kết quả (agent thi công điền)

- Review P2 nhãn trùng scope: bỏ chọn entity đầu tiên theo issueNumber; lọc parent repo từ argument `x-resource` thực tế khi lookup giữ scope, còn nhiều entity thì giữ ID. RED3 ca (b/repo#42 nhận Issue A, scope chưa rõ vẫn có nhãn) → GREEN resource-labels6/6; không đổi payload/hash/migration.
- Review P2 kết quả đọc: hiển thị collection theo output schema đã đăng ký (Trello/GitHub array, Jira issues, Notion pages, Calendar events), tên/title, link HTTP/HTTPS an toàn và giờ vi-VN; giữ JSON đầy đủ trong Chi tiết. RED6 ca collection → GREEN readable-workflow13/13 gồm unsafe URL; không đổi kết quả thực thi.
- Review P2 planning: giữ requestId/messageId theo hội thoại qua navigation reset, chuyển draft lock sang ID mới khi tạo async; xác thực mất thì xóa toàn bộ. Terminal SSE/HTTP chỉ xử lý đúng request, phản hồi cũ không mở khóa/lập lại lock của lần gửi mới. History mở khóa chỉ khi replyToMessageId trỏ đúng user message đã nhận; plan/clarification/refusal/error đều lưu metadata terminal để phục hồi khi hoàn tất trong lúc stream đã đóng. RED3 native HTTP navigation/creation/late-failure + RED thiếu persistence error → GREEN navigation/correlation13/13, related navigation/store/history/SSE59/59; sau chỉnh cuối store/SSE/workflow51/51, API15/15, typecheck/diff check exit0. SQL integration đã thêm assertion correlation, chưa chạy lại riêng: root canonical gate sẽ xác minh. Không đổi executable plan/text/hash hay thêm migration.
- PR: root sẽ tạo sau khi ghép AUTH-02/AUTH-03 và review độc lập; chưa push/merge.
- Commit code: `60d8219`, `56af477`, `75c0e17`, `c3e4ae7`, `029d0f5` trên `vinhdat/feat-fe-03-readable-workflows`; base `3212181`.
- Đã làm: metadata `resourceLabels` lấy từ grounding thực sự và chỉ tham số `x-resource`, có parent board khi đã tra cứu; migration `0006_fe03_resource_labels.sql` lưu riêng ngoài plan JSON/text/hash. Preview/SSE, history message và execution snapshot phục hồi cùng nhãn. ID chưa biết hoặc tên xung đột giữ ID thô; hiển thị Đọc/Ghi và rủi ro từ catalog.
- Kết quả theo trường có link HTTP/HTTPS an toàn, thời gian, JSON đầy đủ trong Chi tiết, tóm tắt số bước succeeded/skipped và plan đã duyệt thu gọn. Text stream kết thúc được giữ thành message có timestamp.
- SSE: mở khi tab ẩn; mỗi kết nối đọc token mới; HTTP 401 refresh một lần, giữ giới hạn qua render lại AuthGate. Lỗi xác thực chắc chắn xóa phiên; lỗi mạng/503 giữ token. Sau 5 giây mất kết nối hiện thông báo, mở lại thành công thì xóa thông báo.
- Tiếng Việt: câu cố định planner/registry, lỗi API dịch ở biên phản hồi giữ status/code; không sửa chuỗi do model sinh ra. Textarea Enter/Shift+Enter, chặn gửi trùng khi planning, một cơ chế prefill; landmark/log, một h1, nhãn nút icon, h-dvh, giờ sidebar vi-VN 24h, sửa tiêu đề blueprint và chỉ báo dịch vụ/runtime ban đầu.
- TDD thật: RED 7 ca nhãn/result/textarea; RED 4 HTTP SSE 401; RED 7 câu tiếng Việt; RED xung đột/prototype ID; RED AuthGate subscriber 2 refresh thay vì 1; RED giờ sidebar 06:24 PM thay vì 18:24. Sau sửa các ca tương ứng GREEN.
- Sửa hồi quy browser ở `029d0f5`: stream 403 do ownership không xóa phiên hợp lệ; native HTTP test RED token thành null rồi GREEN giữ token, không refresh/retry stream bị từ chối. Refresh endpoint 401/403 và stream 401 vẫn xử lý xác thực chắc chắn. Ca Shift+Enter dùng Trello rồi Slack ở dòng mới; AIPlanner thật chứng minh yêu cầu Trello-only trước đó không khớp canned sandbox plan có Slack nên bị validator từ chối, không nới routing/validation để che lỗi.
- Test đã chạy và kết quả (exit 0): `npm run test -w @wap/chat-web -- --maxWorkers=2` **196/196** trước test giờ sidebar cuối; `npm run test -w @wap/chat-api -- --maxWorkers=2` **210/210**; `npm run test -w @wap/planner` **180/180**; sau sửa giờ/selector, `npm run test -w @wap/chat-web -- tests/services/conversation-time.test.ts tests/components/sidebar-history.test.tsx tests/sse-auth-reconnect.test.tsx` **10/10**; `npm run typecheck:v3`; `git diff --check`.
- Bằng chứng PostgreSQL: planner thật với provider offline + lookup fixtures → SSE → SQL metadata → repository mới/HTTP reload pending và completed, hash/text giữ nguyên, migration chạy lại không mất nhãn. DB tmpfs riêng `ati-fe03-labels-20261004`, ID `8161a052698cb1d91fc8b7ec2eb99e2722ddf97b2d7962b8e10869262978b12e`, cổng động `51855`; đã xóa đúng container và xác minh không còn. Không dùng DB người dùng `15433` hay canonical `55533`.
- Canonical của root trên `c3e4ae7`: `npm run check` exit0, **987 v3 + 165 evaluation**. Browser default **11 đạt/2 lỗi**: FE-02 mở hội thoại khác bị SSE403 xóa phiên; FE-03 busy gửi yêu cầu Trello-only không khớp fixture hai dịch vụ. Cả hai nguyên nhân đã sửa ở `029d0f5`; focused sau sửa: native SSE **6/6**, AIPlanner multiline **1/1**, typecheck/diff check exit0. Root chạy lại browser trên head mới; còn chờ toàn bộ browser/reviewer/CI, chưa tuyên bố task nghiệm thu hoàn tất. Có 2 ca `FE-03:` đã đăng ký canonical selector.
- Giới hạn: các suite chạy đồng thời dưới tải CPU đã có 1 lỗi Back/Forward chờ 20 ms và 2 timeout child process cũ; chạy serial với 2 worker đạt lại, không sửa implementation để che lỗi. Browser tên dùng grounding fixture sandbox được nêu rõ trong test; test backend chứng minh planner/lookup thật trong phạm vi offline. Model/golden/live service **NOT_RUN**; cần golden mới khi được cấp quyền vì wording planner/registry đã đổi. Không dùng `.env` riêng, provider, service thật hoặc cloud DB; không sửa v2/CURRENT-STATE/ROADMAP hay thiết kế thị giác.
