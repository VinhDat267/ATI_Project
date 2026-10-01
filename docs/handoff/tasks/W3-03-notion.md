# W3-03 · Notion

**Trạng thái:** chờ · **Nhánh gợi ý:** `feat/w3-03-notion` · **Phụ thuộc:** W3-00 đã merge · **Làm song song với:** W3-01, W3-02, W3-04, W3-05

Đọc trước: [yêu cầu chung cho task thêm service](W3-service-common.md). Card này chỉ ghi phần riêng của Notion.

## Lưu ý về phiên bản API

Notion đã đổi mô hình dữ liệu ở các phiên bản API gần đây (database tách thành "data source", endpoint query và `parent` của page thay đổi). **Đọc tài liệu hiện hành trước khi code**, chọn một giá trị header `Notion-Version` cụ thể, ghi cố định trong adapter và ghi lại trong log. Task card dùng chữ "database" theo nghĩa người dùng thấy trên giao diện; agent ánh xạ sang đúng đối tượng API của phiên bản đã chọn và ghi rõ trong PR.

## Xác thực

- Internal integration token (người dùng tạo integration trong Notion, rồi "Connect" database thử nghiệm với integration đó; xem W3-07).
- `credentialFields`: `token` (`password`). Header `Authorization: Bearer …`, `Notion-Version: <đã chọn>`.

## Thiết kế service

- `id: 'notion'`, `name: 'Notion'`, `scopeKey: 'databases'`, `scopeLabel: 'Database ID'`, `scopePattern`: UUID 32 ký tự hex, có hoặc không có gạch nối. `normalizeAllowedScope` chuẩn hóa về một dạng duy nhất (chữ thường, có gạch nối) để so sánh allowlist không bị lệch.
- `intentKeywords`: `notion`. `fallbackIntentKeywords`: `ghi chú`, `wiki`, `tài liệu`.
- **Không** dùng `trang`, `page`, `database`, `note`: quá chung, trùng với Sheets ("trang tính") và nội dung tin nhắn.
- `checkConnection`: lấy thông tin database đầu tiên trong allowlist.
- Rate limit: trung bình khoảng 3 request/giây cho mỗi integration; tôn trọng `Retry-After`.

| Tool | Loại | Input | Output |
|---|---|---|---|
| `notion.search_databases` | read, `discovers: 'database'`, `listable` | `query` (có thể rỗng), `limit` ≤ 10 | `{ id, title, url }` của database trong allowlist |
| `notion.query_database` | read, `discovers: 'page'` | `databaseId` (`x-resource: 'database'`), `query` (lọc theo tiêu đề, tùy chọn), `limit` ≤ 20 | `{ pages: [{ id, title, url, properties }] }`; `properties` làm phẳng thành chuỗi |
| `notion.create_page` | write, `riskLevel: 'medium'` | `databaseId`, `title` (≤ 200), `content` (tùy chọn, văn bản thuần ≤ 4000, tách thành đoạn ≤ 2000 ký tự/khối), `properties` (tùy chọn: tên thuộc tính → chuỗi) | `{ id, url }` |
| `notion.append_text` | write, `riskLevel: 'medium'` | `pageId` (`x-resource: 'page'`), `text` (≤ 2000) | `{ pageId, blockIds, url }` |

- `create_page.properties` chỉ hỗ trợ các kiểu `rich_text`, `select`, `date`, `url`, `number`. Adapter đọc schema của database rồi chuyển đổi; thuộc tính không tồn tại hoặc kiểu khác → `VALIDATION` trước lệnh ghi.
- `append_text`: adapter đọc page trước, lấy database cha, **kiểm cha nằm trong allowlist** rồi mới ghi. Page không thuộc database nào trong allowlist → `AUTH_ERROR`, không ghi.
- Văn bản đưa vào dạng `rich_text` thuần, không diễn giải markdown.
- Không có tool xóa/lưu trữ page, sửa thuộc tính page đã có, hay đổi quyền chia sẻ.

## Ca định tuyến dễ nhầm (thêm vào test)

- "Ghi một dòng vào trang tính ATI Test Tracker" → Sheets, không có Notion.
- "Tạo page trong Notion ghi biên bản họp rồi báo Slack" → Notion + Slack.
- "Gửi tài liệu hướng dẫn lên kênh ati-test" khi Notion **chưa cấu hình** → Slack, không bị từ chối (Slack khớp nên `fallbackIntentKeywords` của Notion không được dùng).

## Sandbox

Kịch bản `notion_slack`: tạo page trong database → báo Slack kèm `url` của page.

## Tiêu chí riêng (ngoài tiêu chí chung)

- [ ] Test header `Notion-Version` có trong mọi request và bằng giá trị đã chọn.
- [ ] Test chuẩn hóa ID (có/không gạch nối, chữ hoa/thường) cho cả allowlist và tham số tool.
- [ ] Test `append_text` từ chối page có cha ngoài allowlist, số lệnh ghi = 0.
- [ ] Test `create_page` từ chối thuộc tính không tồn tại hoặc kiểu không hỗ trợ trước khi ghi; tách `content` dài thành nhiều khối đúng giới hạn.

## Kết quả (agent thi công điền)

- PR:
- Commit:
- Tài liệu API đã đọc (đường dẫn, ngày, `Notion-Version` đã chọn):
- Test đã chạy và kết quả:
- Điều chưa làm hoặc khác với task card:
