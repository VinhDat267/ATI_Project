# FE-06A — review độc lập và follow-up sau PR #107

## Phạm vi và môi trường

- Nhánh `fix/fe-06a-followups`, worktree mới `C:/Users/VinhDat/orca/workspaces/ATI_Project/fe-06a-followups`, tạo từ `origin/main` tại `c37e2e95eeac8881153b0bd0ff23dae423ac9b2c`. Không dùng worktree FE-06A cũ. PR #107 đã merge tại `f796467`.
- Không có task card riêng theo giao việc của chủ dự án: phạm vi là hàng “FE-06A: câu Sửa rồi thử lại…” và ca FE-06A trong hàng “Test chập chờn”, mục 5 của CURRENT-STATE. Log này ghi kết quả thay phần Kết quả task card. Không sửa CURRENT-STATE/ROADMAP.
- Đã kiểm `git status`, `git log -5`, `gh pr list` trước khi làm; giữ nguyên thay đổi của người dùng ở checkout gốc. Đã đọc AGENTS, README, CURRENT-STATE và ba log mới nhất theo lịch sử Git: merge-107-108, FE-06A-review-fixes, FE-07-review-p2. Đã đọc thêm REVIEW-CHECKLIST và template PR.
- PostgreSQL 16 container `ati-fe06a-followups-pg`, tmpfs riêng; `V3_LOCAL_DB_PORT=55541`, API `PORT=3021`, web `V3_WEB_PORT=5201`, bản React `5203`. Không dùng DB 15433. Lần migrate đầu trước khi PostgreSQL ready bị “Connection terminated unexpectedly”; đợi `pg_isready` rồi migrate/provision exit 0.
- Tại thời điểm kiểm tra không có PR/nhánh FE-06B trong danh sách remote/local quan sát được. File cùng khu Cockpit cần phối hợp nếu FE-06B sửa chúng: RecoveryEditor, recovery-request, helper nhãn. Không sửa planner, prompt, backend hay schema dịch vụ.

## Review commit 2e4e6c7

Đọc diff thật Workspace, RecoveryEditor, RecoveryMoment, recovery-request, ConversationDrawer, ReceiptMoment và test. Reviewer độc lập chạy 67/67 test liên quan trước sửa, exit 0. Không thấy P1. Các P2 đã sửa:

1. Hai bộ ô Sheets hợp lệ `[['A, B','C / D']]` và `[['A','B','C'],['D']]` từng tạo cùng một yêu cầu vì nối dấu phẩy/gạch chéo. Nay đánh số dòng/cột và giữ ranh giới chuỗi, ô rỗng, kiểu giá trị. Test còn giữ literal `${customer.name}` thay vì biến nó thành tham chiếu kế hoạch.
2. Tham chiếu tới `.id`, `.url`, `.fullName` từng đều thành “kết quả của việc N”, mất nghĩa trường. Nay giữ nhãn trường tiếng Việt và kết quả đã lưu.
3. Schema Sheets/Calendar/Notion/Telegram/Jira thiếu description nên editor/yêu cầu lộ `spreadsheetId`, `calendarId`, `databaseId`, `chatId`, `projectKey`, `issueType`. Nay dùng metadata nhãn frontend dùng chung. Thuộc tính người dùng trong object vẫn được giữ để không mất dữ liệu; tool/trường tương lai ngoài catalog vẫn có fallback khóa gốc, không tuyên bố đã dịch mọi khóa tùy ý.
4. Review độc lập vòng hai tìm template đã resolve từ mảng/boolean/null/object bị formatter đổi nội dung. Ví dụ executor cần `Người: member-a,member-b` nhưng request thành danh sách “mục 1…”. Test RED dùng output thật trong snapshot; template nay giữ đúng `String(value)` và null thành chuỗi rỗng như executor. `$ref` trực tiếp vẫn giữ cấu trúc trình bày.

Review độc lập bản cuối đọc diff request/editor/helper/JSON/tests và Workspace phục hồi: **không còn P1/P2 trong phạm vi mã sửa**, request/editor/App **57/57**, exit 0, diff-check 0. Kết luận này không đóng flake hay nghiệm thu model chính xác.

Ghi chú không rỗng được kiểm qua App → editor → Stop → API messages; không mất ghi chú. Test chuyển A → B trước khi Stop sửa của A trả về xác nhận không gửi nội dung sang B, không đổi màn hay tin của B. Hai kiểm tra này qua ngay với baseline; không gọi chúng là lỗi đã sửa.

## TDD và mutation

- RED ban đầu: **13 fail / 34**, exit 1 (`p2-red.log`); lỗi assertions nhãn, ranh giới dòng, nghĩa trường, literal. GREEN trung gian **81/81**, exit 0, năm file (`p2-restored-green.log`).
- RED template bổ sung: **4 fail / 17**, exit 1 (`template-red.log`), các output array/boolean/null/object.
- Full check trung gian bắt guard generic: eval **164 pass / 1 fail**, do service-specific label data trong TS. Đã chuyển metadata sang JSON frontend; không thêm ngoại lệ guard.
- Bỏ từng phần sửa rồi phục hồi đúng SHA256: **15/15 mutation bị assertion bắt**. Bảy mutation do worker: raw ref (3 fail), mất note (1), request JSON kỹ thuật (9), nhãn note cũ (1), flatten rows (2), mất nghĩa field (3), mất nhãn dịch vụ (11). Sáu mutation root: Workspace request kỹ thuật, description seed note, bỏ sr-only, bỏ paused-step guard, bỏ HTTPS/credential guard, cho skipped output thành link. Mutation thứ 14 bỏ overflow-wrap ConversationDrawer: browser 375 light fail `toBeLessThanOrEqual` ở độ rộng log. Mutation thứ 15 trả template về formatter cũ: 4 fail / 17, exit 1; phục hồi SHA256 chính xác. GREEN cuối 87/87 test liên quan, guard generic 2/2, frontend tsc exit 0. Source đã khôi phục byte-for-byte; output nằm dưới thư mục evidence ignored.

## Browser chập chờn — chẩn đoán, chưa tuyên bố sửa

1. `npx playwright test --config apps/chat-web/playwright.config.ts --grep 'FE-06A:' --repeat-each 10`: **39 pass / 1 fail**, exit 1, 2.5 phút. Fail lần lặp thứ 4, 375 dark, sau goto tới terminal unsuccessful (khác vị trí #moment-8 của log Claude).
2. Failure screenshot, DOM, URL/h1 đã lưu trước lần chạy tiếp: URL đúng `/c/67ae0792-409f-4b4d-9d90-eba7b1554269`; **h1=[]**, moments=[]; DOM nguyên bootstrap HTML, `#root` rỗng, nền tối. Không phải bằng chứng đã ở login hoặc moment khác. Reviewer độc lập xem ảnh/DOM và xác nhận app chưa dựng React.
3. Chạy nguyên nhóm default **55 pass / 1 fail**, exit 1, 1.9 phút; FE-06A **4/4** qua. Lỗi riêng FE-02 giữ vị trí cuộn: expected 80, received 16268. Giữ bằng chứng, không sửa ngoài phạm vi.
4. Bổ sung listeners pageerror/console error/requestfailed/HTTP >=400, thời điểm module request start/finish và main-frame navigation; failure hook lưu readyState, DOM, URL, h1, screenshot. Lặp FE-06A thêm 10: **40/40**, exit 0, 2.0 phút. Không đổi điều kiện chờ, không tăng timeout, không retry goto để che lỗi.

Lượt canonical browser trung gian trước sửa template/JSON: default **55 pass / 1 fail**, exit 1, 2.6 phút; FE-06A 4/4 qua, lỗi FE-05b 1440 dark không thấy #moment-6. Error-context không có snapshot markup. Lưu `repro-browser-firstgate`; không tính lượt này là kiểm tra cuối.

Nguyên nhân gốc **chưa xác định**: module graph không hoàn tất, lỗi module/runtime trước render hoặc HMR navigation cần thêm lần tái hiện có network ledger. Vite “504 Outdated Optimize Dep” là giả thuyết có căn cứ ở mã Vite, chưa có response chứng minh trong lượt lỗi. Không sửa token refresh/app khi không có bằng chứng. Hai lượt repeat có **79 pass / 1 fail trong 80 ca**, không gồm mutation cố ý. Bằng chứng ở `node_modules/.cache/fe06a-followups/repro-repeat10`, `repro-default`, `repro-diagnostic40`.

## Kiểm tra cuối

`npm run check` sau sửa template + JSON metadata: **exit 0** (`check-gate.log`). Typecheck API/web qua; v3 **47 + 340 + 196 + 25 + 349 + 561 = 1.518**, eval **165/165**, build Vite qua (883 ms), build-security qua, launcher **1/1**, môi trường/OIDC **10/10**. Không tính lượt check trung gian guard fail vào kết quả này.

`npm run test:browser:v3` sau đó chạy tuần tự: **73/73**, **exit 0** (`browser-gate.log`), 11 nhóm: default 56 (1.7 phút), auth02 2, auth04 5, clarification 2, partial_failure 2, ba dịch vụ + Sheets/Calendar/Notion/Telegram/Jira mỗi nhóm 1. FE-06A 4/4 trong default. Không có retry hay tăng timeout. Lượt gate trước 55/56 lỗi FE-05b và lượt default baseline 55/56 lỗi FE-02 đã ghi riêng, không che các lượt fail bằng kết quả gate xanh này.

`git diff --check` exit 0. Đã xác nhận PNG headers đúng kích thước và `git check-ignore` cho ảnh/model evidence. CI exact-head sẽ được kiểm trên PR sau push; chưa merge, reviewer vẫn quyết định nghiệm thu các mục chẩn đoán/model còn giới hạn.

## Ảnh đối chiếu

Tám PNG không commit ở `node_modules/.cache/fe06a-followups/visual`, đúng 1440×900 / 375×812, sáng/tối. Bốn ảnh app là `#moment-unsuccessful` sau sr-only của 2e4e6c7. **Bản React chỉ có moment 1–9, không có unsuccessful**, nên bốn ảnh đối chiếu là receipt moment 6 nguyên bản; đây là giới hạn của reference, không tuyên bố hai màn có cùng trạng thái. Không sửa prototype hay DOM để giả màn terminal. Đã xem ảnh app desktop sáng và reference mobile tối, tiêu đề trạng thái app không bị lặp dòng announcement hiển thị.

## Planner thật

Chủ dự án cho phép gọi model trong phiên này. Dùng AIPlanner + OpenAICompatibleProvider thật, prompt/catalog/grounding validator hiện hành, ba hội thoại fixture với kế hoạch cũ đã dừng, việc tạo thẻ đã thành công, tin mới sinh trực tiếp từ recoveryEditRequest. Working Memory và gather là tài nguyên fixture; không import executor/adapters, không thực thi hay ghi dịch vụ thật.

Yêu cầu `ag/gemini-3.8-flash` qua endpoint 9router đã cấu hình. Gateway báo **`gemini-3.8-flash-n`** cho cả ba; provider thật **từ chối model mismatch**, do đó không có kế hoạch được pipeline chấp nhận dưới model chính xác đã yêu cầu. Không đổi prompt/planner/provider để bỏ gate này. Bản gateway trả về vẫn được lưu và đánh giá có giới hạn bên dưới. Có ba lời gọi đầu không capture body bị mismatch, rồi ba lời gọi cùng ba hội thoại có capture: **6 HTTP model calls**, không transport retry. Lượt dựng fixture đầu trả clarification trước model (0 model calls) vì thiếu fixture gather; harness được bổ sung fixture, không sửa prompt/planner.

Ba response gateway đều giữ đúng giá trị sửa và không tạo lại thẻ đã xong. Kết quả này là quan sát **model hậu tố -n**, chưa phải nghiệm thu model đúng `ag/gemini-3.8-flash`. Task riêng cần kiểm tên/route gateway nếu muốn nghiệm thu model chính xác; không sửa trong PR.

Ảnh và SHA256:

| PNG | SHA256 |
|---|---|
| `FE06-app-unsuccessful-dark-1440.png` | `02f2ca2920f1807a7ecee525b696398aedcd601556e987711bd0f689428d6be6` |
| `FE06-app-unsuccessful-dark-375.png` | `57eb6bc7c56638ae3251f43b82a05c06faeb78331ae9bd55ecfcae4648acad59` |
| `FE06-app-unsuccessful-light-1440.png` | `49c764e366c5b6cd9fb8b394d9d2e6c05581ce129c18531973ed14a4f29e560e` |
| `FE06-app-unsuccessful-light-375.png` | `8a8931cde571d7c3421a286df385f7015fd2273bceaeff3628ab23791afaf3ee` |
| `FE06-reference-receipt-dark-1440.png` | `e69d460ea4afe2140529aa2f287c2790a31558a389df6e48de3eaa4be43765bd` |
| `FE06-reference-receipt-dark-375.png` | `659825252c3804d9fd8bb0ebf84f9692bdb8cfdc112c6528a52cb74551400ae0` |
| `FE06-reference-receipt-light-1440.png` | `ec221d590cd598f54436faded2be9029a532ca39e67ba831ab63e9f96a632c18` |
| `FE06-reference-receipt-light-375.png` | `a6d2c22b95a07dc295c4dc0d4fa19e39a62396cc14491acfff40eb21c85a5c36` |

### Hội thoại fixture member

Kế hoạch cũ: việc 1 tạo thẻ đã thành công; việc 2 `trello.add_member` đã lỗi, cả kế hoạch đã dừng. Việc 3 Slack còn pending.

Tin sinh từ recoveryEditRequest:

```text
Làm lại việc 2 (Gán thành viên vào thẻ Trello) của kế hoạch đã dừng, với nội dung đã sửa:
- ID của thẻ Trello: fixture-card-done
- ID của thành viên Trello cần gán: fixture-member-new
Sau đó làm tiếp các việc chưa làm:
- Việc 3 (Thông báo Slack): ID kênh Slack nhận tin nhắn: CFIXTURE; Nội dung tin nhắn cần gửi: Đã gán người trực mới
Không làm lại các việc đã xong.
Ghi chú: Gán cho người trực tuần này
```

Kế hoạch gateway trả về (provider từ chối vì mismatch):

```json
{
  "kind": "plan",
  "summary": "Gán thành viên vào thẻ và gửi thông báo Slack",
  "steps": [
    {
      "id": "step_1",
      "tool": "trello.add_member",
      "description": "Gán thành viên vào thẻ Trello",
      "args": {
        "cardId": "fixture-card-done",
        "memberId": "fixture-member-new"
      },
      "dependsOn": []
    },
    {
      "id": "step_2",
      "tool": "slack.send_message",
      "description": "Gửi thông báo Slack",
      "args": {
        "channel": "CFIXTURE",
        "text": "Đã gán người trực mới"
      },
      "dependsOn": [
        "step_1"
      ]
    }
  ],
  "warnings": []
}
```

Đánh giá: đúng toàn bộ args đã sửa, chỉ làm việc lỗi và Slack còn pending; không có trello.create_card chạy lại. Không đánh giá kết quả dịch vụ vì không thực thi.

### Hội thoại fixture sheets

Kế hoạch cũ: việc 1 tạo thẻ đã thành công; việc 2 `sheets.append_rows` đã lỗi, cả kế hoạch đã dừng. Việc 3 Slack còn pending.

Tin sinh từ recoveryEditRequest:

```text
Làm lại việc 2 (Ghi bảng tính Google Sheets) của kế hoạch đã dừng, với nội dung đã sửa:
- ID bảng tính: fixture-sheet
- Tên trang tính: Tracker
- Các dòng cần thêm: Dòng 1: cột 1: “A, B”; cột 2: “C / D”
Dòng 2: cột 1: “Mới”; cột 2: “Đạt”
Sau đó làm tiếp các việc chưa làm:
- Việc 3 (Thông báo Slack): ID kênh Slack nhận tin nhắn: CFIXTURE; Nội dung tin nhắn cần gửi: Đã ghi các dòng đã sửa
Không làm lại các việc đã xong.
Ghi chú: Giữ nguyên từng ô và thứ tự dòng
```

Kế hoạch gateway trả về (provider từ chối vì mismatch):

```json
{
  "kind": "plan",
  "summary": "Thêm dòng vào bảng tính và gửi thông báo Slack",
  "steps": [
    {
      "id": "step_1",
      "tool": "sheets.append_rows",
      "description": "Thêm dòng vào bảng tính",
      "args": {
        "spreadsheetId": "fixture-sheet",
        "sheet": "Tracker",
        "rows": [
          [
            "A, B",
            "C / D"
          ],
          [
            "Mới",
            "Đạt"
          ]
        ]
      },
      "dependsOn": []
    },
    {
      "id": "step_2",
      "tool": "slack.send_message",
      "description": "Gửi thông báo qua Slack",
      "args": {
        "channel": "CFIXTURE",
        "text": "Đã ghi các dòng đã sửa"
      },
      "dependsOn": [
        "step_1"
      ]
    }
  ],
  "warnings": []
}
```

Đánh giá: đúng toàn bộ args đã sửa, chỉ làm việc lỗi và Slack còn pending; không có trello.create_card chạy lại. Không đánh giá kết quả dịch vụ vì không thực thi.

### Hội thoại fixture slack

Kế hoạch cũ: việc 1 tạo thẻ đã thành công; việc 2 `slack.send_message` đã lỗi, cả kế hoạch đã dừng. Không còn việc pending khác.

Tin sinh từ recoveryEditRequest:

```text
Làm lại việc 2 (Gửi thông báo Slack) của kế hoạch đã dừng, với nội dung đã sửa:
- ID kênh Slack nhận tin nhắn: CFIXTURE
- Nội dung tin nhắn cần gửi: Đã sửa lỗi đăng nhập; kiểm tra https://trello.com/c/fixture
Không làm lại các việc đã xong.
Ghi chú: Chỉ thông báo, thẻ Trello đã tạo xong
```

Kế hoạch gateway trả về (provider từ chối vì mismatch):

```json
{
  "kind": "plan",
  "summary": "Gửi lại thông báo qua Slack",
  "steps": [
    {
      "id": "step_1",
      "tool": "slack.send_message",
      "description": "Gửi thông báo Slack",
      "args": {
        "channel": "CFIXTURE",
        "text": "Đã sửa lỗi đăng nhập; kiểm tra https://trello.com/c/fixture"
      },
      "dependsOn": []
    }
  ],
  "warnings": []
}
```

Đánh giá: đúng toàn bộ args đã sửa, chỉ làm việc lỗi; không có trello.create_card chạy lại. Không đánh giá kết quả dịch vụ vì không thực thi.

Toàn bộ raw input/output fixture và servedModel lưu ignored tại `node_modules/.cache/fe06a-followups/planner-results.json`; SHA256 `1877947a1af245fa13b44fecaeaaad3a8224683e4b91815e7df5857fd0c01df3`. Không ghi credential gateway.
