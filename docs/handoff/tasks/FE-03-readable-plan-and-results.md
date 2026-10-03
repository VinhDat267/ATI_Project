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

- PR:
- Commit:
- Test đã chạy và kết quả:
- Điều chưa làm hoặc khác với task card:
