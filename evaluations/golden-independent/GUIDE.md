# W4-01 · Hướng dẫn viết câu hỏi đánh giá

Hướng dẫn cho thành viên viết bộ câu đánh giá độc lập. Không cần đọc code. Đọc hết một lượt trước khi viết.

## 1. Bộ câu này để làm gì

ATI nhận một câu chat ("Tạo card… rồi báo kênh…") và trả về **một** trong ba kiểu:
- **kế hoạch:** danh sách các bước ghi lên dịch vụ (tạo card, gửi tin, tạo issue…). Người dùng duyệt rồi mới chạy;
- **câu hỏi lại:** khi thiếu thông tin mà AI không tự tìm được;
- **từ chối:** khi không làm được hoặc không được phép làm.

Bộ câu cũ do chính người chỉnh prompt của AI viết, nên điểm cao chưa nói được AI xử lý câu lạ tốt đến đâu. Bộ này do người khác viết. Với mỗi câu, bạn ghi kết quả đúng phải trông thế nào (gọi là **label**). Máy chấm so kết quả của AI với label. Không có kế hoạch nào được chạy thật.

Cần ít nhất **30 câu** của cả nhóm, chia năm nhóm (mục 3), mỗi nhóm ít nhất 4 câu. Mỗi người khoảng 6–8 câu, mỗi nhóm 1–2 câu. Cả bộ cần ít nhất 5 câu tiếng Việt và 5 câu tiếng Anh; nên viết khoảng một phần ba bằng tiếng Anh.

## 2. Quy tắc

Không được:
- **xem prompt của AI** (thư mục `prompts/` và `packages/planner/`);
- **xem bộ câu cũ** (`evaluations/golden-v2/cases*.json`). Công cụ kiểm tra từ chối câu trùng bộ cũ;
- **chạy AI với câu của mình** trước khi nộp, kể cả qua app;
- **chép ví dụ** trong hướng dẫn này (mục 7). Công cụ kiểm tra từ chối câu trùng ví dụ;
- **ghi họ tên** ở bất kỳ đâu. Trường `author` ghi mã nhóm trưởng cấp cho bạn, ví dụ `member-2`;
- **dùng tài nguyên thật** của nhóm (board "To Do", kênh `ati-test`…). Chỉ dùng workspace giả lập ở mục 4;
- **viết label để làm khó AI.** Label ghi điều mà một kế hoạch đúng bắt buộc phải có. Câu hiểu được theo nhiều cách đúng thì ghi đủ các cách (mục 6, `anyOf`).

Sau khi nộp, nhóm trưởng gộp các file và commit **trước khi chạy AI**. Từ lúc đó không ai sửa câu hay label nữa. Nếu sau khi chạy mới thấy label sai, chỉ được sửa trong một commit riêng có ghi lý do, và kết quả cũ vẫn giữ trong báo cáo.

## 3. Năm nhóm câu

| `category` | Nghĩa | AI phải trả |
|---|---|---|
| `single_step` | một việc ghi trên một dịch vụ | kế hoạch đúng **một** bước |
| `multi_step` | từ hai việc ghi trở lên, cùng **một** dịch vụ | kế hoạch, ít nhất một cách đúng có từ hai bước |
| `cross_service` | việc ghi trên **ít nhất hai** dịch vụ | kế hoạch có bước trên ít nhất hai dịch vụ |
| `clarification` | thiếu thông tin AI không tự tìm được: không nói kênh nào, tên người trùng nhau, giờ mơ hồ… | câu hỏi lại |
| `refusal` | việc không có tool làm được (xoá board, xoá repo, gửi email…), hoặc không nên làm | từ chối |

Nhóm thêm, không bắt buộc:

| `category` | Nghĩa | AI phải trả |
|---|---|---|
| `read_only` | chỉ hỏi để xem, không ghi gì ("Xem card trong list Doing") | câu hỏi lại. Theo quy tắc chốt 05/10, ATI hỏi người dùng muốn ghi gì thay vì trả lời |

Một số điều nên biết:
- Kế hoạch chỉ gồm bước **ghi**. AI tự tra cứu tên → ID trước khi lập kế hoạch; việc tra cứu không ghi vào label.
- Câu chat ghi **tên** ("board Frontend", "kênh frontend"); label ghi **ID** lấy từ mục 4.
- Câu có đủ thông tin trong workspace thì AI phải lập kế hoạch, không hỏi lại. Ví dụ "gán Minh" trên board Frontend là đủ, vì board này chỉ có một Minh. Còn "gán Minh" trên board Marketing thì thiếu, vì ở đó có Minh Anh và Minh Châu.

## 4. Workspace giả lập

"Bây giờ" là **10:00 thứ Ba 29/09/2026, giờ Việt Nam (+07:00)**. Vậy "ngày mai" là thứ Tư 30/09, "thứ Sáu này" là 02/10, "thứ Hai tuần sau" là 05/10.

**Trello**

| Board | ID board | List (tên → ID) | Thành viên (tên → ID) |
|---|---|---|---|
| Frontend | `board_fe` | To Do → `list_fe_todo`, Doing → `list_fe_doing`, Done → `list_fe_done` | Minh → `member_minh`, Lan → `member_lan` |
| Backend | `board_be` | To Do → `list_be_todo`, Backlog → `list_be_backlog` | Huy → `member_huy` |
| Marketing | `board_mkt` | Ideas → `list_mkt_ideas` | Minh Anh → `member_minh_anh`, Minh Châu → `member_minh_chau` |

Chỉ có một card sẵn: "Lỗi đăng nhập Safari" → `card_fe_login` (board Frontend, list To Do). Muốn sửa card khác thì card đó phải được tạo ở một bước trước trong cùng kế hoạch (`refTo`, mục 6).

**Slack:** kênh frontend → `C_FE`, general → `C_GEN`, backend → `C_BE`, release → `C_RELEASE`.

**GitHub:** repo `acme/web` và `acme/api` (label ghi đúng `acme/web`). Mỗi repo có issue số `42`: `acme/api` #42 "Webhook retries drop events", `acme/web` #42 "Footer overlaps on small screens".

**Google Sheets**

| Bảng tính | ID | Tab và nội dung |
|---|---|---|
| Frontend | `spreadsheet_frontend_2026` | `Tasks` (cột Task, Status; có dòng "Fix footer", "To Do"), `History` (cột Event, Link) |
| Backend | `spreadsheet_backend_2026` | `Tasks` (cột Task, Status; có dòng "Retry webhook", "Doing") |

**Google Calendar:** lịch Team → `team@example.test` (có sự kiện "Standup" 30/09 09:00–09:30), lịch Release → `release@example.test`.

**Notion:** database Frontend → `11111111-1111-4111-8111-111111111111` (có page "Release notes" → `aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa`), database Backend → `22222222-2222-4222-8222-222222222222`.

**Telegram:** nhóm frontend → `-1001234567890`, nhóm release → `-1009876543210`.

**Jira:** project Frontend có key `FE`, project Backend có key `API`. Ticket có sẵn: `FE-42` "Footer overlaps on small screens", `API-42` "Webhook retries drop events".

Không có Gmail. Câu nhờ gửi email là câu từ chối.

## 5. Các tool ghi

`*` là tham số bắt buộc. Tham số in đậm nhận ID từ mục 4.

| Tool | Làm gì | Tham số |
|---|---|---|
| `trello.create_card` | tạo card | **`listId`***, `title`*, `desc`, `due` (hạn), **`idMembers`** (danh sách thành viên) |
| `trello.update_card` | sửa card, chuyển list, đóng card | **`cardId`***, `title`, `desc`, `due`, `closed`, **`idList`** |
| `trello.add_member` | gán người vào card | **`cardId`***, **`memberId`*** |
| `trello.add_checklist` | thêm checklist | **`cardId`***, `title`*, `items` (danh sách mục) |
| `slack.send_message` | gửi tin vào kênh | **`channel`***, `text`* |
| `github.create_issue` | tạo issue | **`repo`***, `title`*, `body`, `labels` |
| `github.add_label` | gắn nhãn cho issue | **`repo`***, **`issueNumber`***, `label`* |
| `sheets.append_rows` | thêm dòng vào tab | **`spreadsheetId`***, **`sheet`*** (tên tab), `rows`* (danh sách dòng) |
| `calendar.create_event` | tạo sự kiện | **`calendarId`***, `summary`*, `description`, `start`*, `end`*, `location` |
| `notion.create_page` | tạo page trong database | **`databaseId`***, `title`*, `content`, `properties` |
| `notion.append_text` | thêm đoạn văn vào page | **`pageId`***, `text`* |
| `telegram.send_message` | gửi tin vào nhóm | **`chatId`***, `text`* |
| `jira.create_issue` | tạo ticket | **`projectKey`***, `summary`*, `description`, `issueType` |
| `jira.add_comment` | bình luận vào ticket | **`issueKey`***, `body`* |

Không có tool xoá board, xoá repo, xoá bảng tính, xoá sự kiện, mời người vào lịch hay gửi email.

## 6. Cách viết label

### Một câu

```text
{
  "id": "m2-01",                 mã câu: chữ thường không dấu, số, gạch ngang; nên bắt đầu bằng mã của bạn
  "category": "cross_service",   một nhóm ở mục 3
  "language": "vi",              "vi" hoặc "en"
  "author": "member-2",          mã nhóm trưởng cấp, không ghi tên
  "services": ["trello", "slack"],  các dịch vụ câu chat nhắc tới
  "prompt": "…",                 câu chat, đúng như người dùng gõ
  "expect": { … }                kết quả đúng
}
```

Tên dịch vụ trong `services`: `trello`, `slack`, `github`, `sheets`, `calendar`, `notion`, `telegram`, `jira`. Câu hỏi lại hoặc từ chối cũng ghi `services`, ví dụ câu nhờ gửi email báo Slack thì ghi `["slack"]`.

### `expect`

- Câu hỏi lại hoặc `read_only`: `{ "kind": "clarification" }`.
- Từ chối: `{ "kind": "refusal" }`.
- Kế hoạch: `{ "kind": "plan", "steps": [ … ] }`. Mỗi bước là `{ "tool": "<tên tool>", "args": { "<tham số>": <điều kiện> } }`.
- Kế hoạch có nhiều cách đúng: thay `steps` bằng `"anyOf": [ [ …cách 1… ], [ …cách 2… ] ]`. Đạt khi khớp một cách.
- `"allowExtraTools": ["<tool ghi>"]`: tool ghi mà một kế hoạch đúng có thể thêm ngoài các bước đã ghi. Không ghi thì AI thêm bước ghi khác sẽ bị tính sai.

Máy chấm không quan tâm thứ tự các bước. Tham số không ghi điều kiện thì không được chấm. Mỗi bước cần ít nhất một điều kiện.

### Điều kiện cho một tham số

| Điều kiện | Đạt khi | Ví dụ |
|---|---|---|
| `equals` | giá trị đúng bằng. Dùng cho ID | `{ "equals": "C_FE" }` |
| `includesAny` | chữ chứa **ít nhất một** chuỗi trong danh sách, không phân biệt hoa thường | `{ "includesAny": ["homepage", "trang chủ"] }` |
| `includesAll` | chữ chứa **tất cả** các chuỗi | `{ "includesAll": ["đăng nhập", "safari"] }` |
| `startsWith`, `endsWith` | chữ bắt đầu hoặc kết thúc bằng | hạn Trello: `{ "startsWith": "2026-10-02" }` |
| `instantEquals` | cùng một thời điểm; ghi kèm `+07:00` | `{ "instantEquals": "2026-09-30T15:00:00+07:00" }` |
| `contains` | danh sách có phần tử này | `idMembers`: `{ "contains": "member_lan" }` |
| `minItems` | danh sách có ít nhất N phần tử | checklist ba mục: `{ "minItems": 3 }` |
| `refTo` | tham số lấy kết quả của một bước dùng tool đó, ví dụ link của issue vừa tạo | `{ "refTo": "github.create_issue" }` |
| `absent` | tham số không được có | `{ "absent": true }` |
| `anyOf` | đạt khi **một** trong các điều kiện con đạt | `{ "anyOf": [ { "equals": "card_fe_login" }, { "refTo": "trello.update_card" } ] }` |

Một điều kiện có nhiều khoá thì phải đạt tất cả, ví dụ `{ "minItems": 1, "includesAll": ["Fix footer"] }`.

Gợi ý:
- ID ghi bằng `equals`; chữ do người dùng đặt (tiêu đề, nội dung) ghi bằng `includesAny`/`includesAll` với vài từ chính, không ghi cả câu.
- Câu nhắc "kèm link", "kèm mã ticket" thì tham số nội dung dùng `refTo` tới bước tạo ra link đó.
- Giờ lịch dùng `instantEquals`. Hạn Trello dùng `startsWith` với ngày, vì giờ trong ngày không cố định.

## 7. Ví dụ hoàn chỉnh

Các ví dụ dưới đây đã qua công cụ kiểm tra. **Không nộp lại ví dụ.**

Một bước, tiếng Việt:

```json
{
  "id": "vd-1",
  "category": "single_step",
  "language": "vi",
  "author": "member-0",
  "services": ["sheets"],
  "prompt": "Thêm dòng 'Viết test cho trang thanh toán', 'Doing' vào tab Tasks của bảng tính Backend",
  "expect": {
    "kind": "plan",
    "steps": [
      { "tool": "sheets.append_rows", "args": {
        "spreadsheetId": { "equals": "spreadsheet_backend_2026" },
        "sheet": { "equals": "Tasks" },
        "rows": { "minItems": 1, "includesAll": ["thanh toán", "Doing"] }
      } }
    ]
  }
}
```

Nhiều bước, hai cách đúng (gán người ngay khi tạo card, hoặc tạo rồi gán):

```json
{
  "id": "vd-2",
  "category": "multi_step",
  "language": "vi",
  "author": "member-0",
  "services": ["trello"],
  "prompt": "Tạo card 'Chuẩn bị slide demo' trong list To Do của board Frontend, hạn thứ Sáu tuần này, giao cho Lan",
  "expect": {
    "kind": "plan",
    "anyOf": [
      [
        { "tool": "trello.create_card", "args": {
          "listId": { "equals": "list_fe_todo" },
          "title": { "includesAll": ["slide", "demo"] },
          "due": { "startsWith": "2026-10-02" },
          "idMembers": { "contains": "member_lan" }
        } }
      ],
      [
        { "tool": "trello.create_card", "args": {
          "listId": { "equals": "list_fe_todo" },
          "title": { "includesAll": ["slide", "demo"] },
          "due": { "startsWith": "2026-10-02" }
        } },
        { "tool": "trello.add_member", "args": {
          "cardId": { "refTo": "trello.create_card" },
          "memberId": { "equals": "member_lan" }
        } }
      ]
    ]
  }
}
```

Liên dịch vụ, tiếng Anh, bước sau dùng kết quả của bước trước:

```json
{
  "id": "vd-3",
  "category": "cross_service",
  "language": "en",
  "author": "member-0",
  "services": ["jira", "telegram"],
  "prompt": "Open a Jira ticket in the Frontend project for 'Checkout button hidden on iPad' and post the ticket link in the Telegram group frontend",
  "expect": {
    "kind": "plan",
    "steps": [
      { "tool": "jira.create_issue", "args": {
        "projectKey": { "equals": "FE" },
        "summary": { "includesAll": ["checkout", "ipad"] }
      } },
      { "tool": "telegram.send_message", "args": {
        "chatId": { "equals": "-1001234567890" },
        "text": { "refTo": "jira.create_issue" }
      } }
    ]
  }
}
```

Hỏi lại: không rõ lịch nào, giờ nào, báo ở đâu:

```json
{
  "id": "vd-4",
  "category": "clarification",
  "language": "vi",
  "author": "member-0",
  "services": ["calendar"],
  "prompt": "Đặt lịch họp với nhóm vào chiều thứ Năm rồi báo cho mọi người",
  "expect": { "kind": "clarification" }
}
```

Từ chối: không có tool xoá repo:

```json
{
  "id": "vd-5",
  "category": "refusal",
  "language": "en",
  "author": "member-0",
  "services": ["github"],
  "prompt": "Delete the GitHub repository acme/web and everything in it",
  "expect": { "kind": "refusal" }
}
```

## 8. Tự kiểm tra và nộp

1. Viết các câu của bạn vào một file JSON, là danh sách các câu: `[ { …câu 1… }, { …câu 2… } ]`. Đặt tên theo mã của bạn, ví dụ `member-2.json`.
2. Nếu đã cài repo (`npm ci`), chạy ở thư mục gốc của repo:

   ```bash
   node --import tsx evaluations/golden-independent/validate.ts member-2.json --partial
   ```

   Công cụ in số câu theo nhóm và từng lỗi kèm mã câu. Sửa hết lỗi rồi chạy lại cho tới khi thấy "Đúng định dạng." Công cụ chỉ kiểm định dạng, không cho biết AI có trả đúng hay không.
3. Gửi file cho nhóm trưởng. Nếu không chạy được lệnh trên, cứ gửi; nhóm trưởng sẽ chạy và gửi lại danh sách lỗi. Người hỗ trợ chỉ báo lỗi định dạng, không viết hay sửa câu thay bạn.
4. Nhóm trưởng gộp các file vào `evaluations/golden-independent/cases.json`, chạy lệnh trên không có `--partial` để kiểm cả bộ (đủ 30 câu, đủ nhóm, đủ hai ngôn ngữ), rồi commit trước khi chạy AI.
