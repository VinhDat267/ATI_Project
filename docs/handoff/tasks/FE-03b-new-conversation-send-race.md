# FE-03b · Gửi tin ngay sau "Cuộc hội thoại mới" làm tin nhắn rơi vào hội thoại khác; test FE-03 lúc đạt lúc không

**Trạng thái:** chờ · **Nhánh gợi ý:** `fix/fe-03b-new-conversation-race` · **Phụ thuộc:** không · **Nên làm sớm:** test browser FE-03 làm CI của PR bất kỳ đỏ ngẫu nhiên (đã gặp ở #57, một PR chỉ sửa tài liệu)

Nguồn: CI của #57 (run `37185023839`, lần chạy 1) fail ở `apps/chat-web/tests/browser/fe-03-readable-workflows.spec.ts:61`. Claude Code tìm nguyên nhân và tái hiện ngày 04/10/2026.

## Hiện trạng

Trong `apps/chat-web/src/components/Workspace.tsx`:

1. Bấm "Cuộc hội thoại mới" → `handleNewConversation` gọi `createConversation()`. Chỉ khi request trả về mới `setConversationId(A)` và chuyển sang `/c/A`.
2. Nếu người dùng gửi tin trước lúc đó, `handleSendMessage` thấy route vẫn là `home`. Nó đánh dấu đang lập kế hoạch dưới khóa nháp (`__draft__`) rồi tự tạo hội thoại thứ hai B.
3. Khi A về: `reset({ preservePlanning: true })` rồi `setConversationId(A)`. `isPlanning` giờ tính theo A, nên bằng `false`.
4. Khi B về: `transferPlanning(null → B)` nhưng không chuyển trang, vì `conversationId` đã là A.

Kết quả: màn hình ở hội thoại A trống, không có dòng "Đang lập kế hoạch…", ô nhập mở lại. Tin nhắn và plan nằm ở B, chỉ thấy khi mở lịch sử. Hai response về theo thứ tự nào cũng cho cùng kết quả.

## Bằng chứng

- CI #57 lần 1:
  - dòng 60 đạt (nút Gửi bị khóa, vì ô nhập đã xóa sau khi gửi);
  - dòng 61 không thấy "Đang lập kế hoạch…" sau 10 giây.
- Tái hiện trên `main` `7964d35`, PostgreSQL tạm:
  - cách làm: giữ response của `POST /api/conversations` đầu tiên 1,5 giây, trong lúc đó gõ và Enter;
  - URL là `/c/<A>`, có 2 lần tạo hội thoại, không có dòng "Đang lập kế hoạch…";
  - trong database, B có 1 tin của người dùng và 1 tin của assistant; A trống.
- Không giữ response thì test gốc đạt 20/20 lần ở máy, vì tạo hội thoại ở máy gần như tức thì. CI chậm hơn nên lộ race.

## Yêu cầu

### 1. Sản phẩm

- Gửi tin trong lúc đang tạo hội thoại mới phải vào đúng hội thoại người dùng đang thấy, và chỉ tạo **một** hội thoại.
- Chọn một trong hai cách, ghi lý do trong PR:
  - (a) Workspace giữ promise tạo hội thoại đang chạy (ví dụ trong một `ref`). `handleSendMessage` chờ promise đó rồi dùng id của nó, không tự tạo thêm;
  - (b) khóa ô nhập và nút Gửi cho tới khi tạo xong, có trạng thái hiển thị; Enter lúc đó không làm gì.
- Không làm mất nội dung đã gõ.
- Nếu tạo hội thoại lỗi, giữ cách báo lỗi hiện có.
- Ghi nhận trong PR hành vi khi bấm "Cuộc hội thoại mới" hai lần liên tiếp. Không bắt buộc sửa nếu ngoài cách đã chọn.

### 2. Test

- **Browser test mới (RED trước khi sửa):**
  - giữ response tạo hội thoại đầu tiên bằng `page.route` có gate (không dùng `waitForTimeout` để đoán thời gian);
  - gõ và Enter trước khi nhả gate;
  - kiểm:
    - chỉ một `POST /api/conversations`;
    - URL là hội thoại chứa tin nhắn;
    - dòng "Đang lập kế hoạch…" hiện;
    - sau khi nhả, nút "Duyệt kế hoạch" hiện ở đúng hội thoại;
    - database: hội thoại đó có tin của người dùng, không có hội thoại trống thừa.
- **Test FE-03 Shift+Enter:** sau khi bấm "Cuộc hội thoại mới", chờ URL `/c/` rồi mới gõ. Test này kiểm Shift+Enter và việc khóa lần gửi thứ hai, không nên phụ thuộc thời gian mạng.
- **Unit test** cho store hoặc Workspace nếu cách sửa đổi logic `planningByConversation`.
- Tên test mới phải khớp một mục `grep` trong `scripts/test-v3-browser.mjs`. Hiện scenario `default` bắt `FE-03:` nhưng **không** bắt `FE-03b:`.

## Ngoài phạm vi

- Không đổi API `POST /api/conversations` hay schema database.

## Tiêu chí nghiệm thu

- [ ] Browser test mới fail trên `main` trước khi sửa (ghi output trong PR).
- [ ] `npm run check` exit 0; `npm run test:browser:v3` đạt hết (PostgreSQL tạm ở 55533, không dùng database dev ở 15433).
- [ ] Test FE-03 Shift+Enter và test mới chạy `--repeat-each=20`: đạt hết.
- [ ] CI xanh.

## Kết quả (agent thi công điền)

- PR: nhánh `fix/fe-03b-new-conversation-race` (Claude Code thi công theo yêu cầu của người dùng).
- Commit: `f4390ce` (test RED), `e1a43ef` (sửa).
- Cách sửa: chọn **(a)**. `Workspace` giữ promise của lần bấm "Cuộc hội thoại mới" đang chạy:
  - tin gửi trong lúc đó chờ promise này rồi vào đúng hội thoại mới, không tự tạo hội thoại thứ hai;
  - cả khi người dùng bấm từ một hội thoại cũ X: tin vào hội thoại mới, không vào X.

  Lý do: người dùng gửi được ngay, không phải bấm Enter lần hai như cách (b). Không thêm trạng thái giao diện, không đổi store hay API.
- Test đã chạy và kết quả (04/10/2026, PostgreSQL tạm ở 55533):
  - **RED trên `main` `a478537`:**
    - unit: 3/3 fail đúng lý do:
      - tin bị kẹt chờ hội thoại thứ hai (`expected [] to deeply equal [['c-new', …]]`);
      - tin rơi vào `c1`;
      - bấm hai lần tạo 2 hội thoại;
    - browser `FE-03b:`: fail ở `getByText('Đang lập kế hoạch…')`, giống lỗi trên CI của #57.
  - **GREEN:**
    - `planning-navigation.test.tsx` 18/18 (5 test mới; 2 test thêm sau cho ca bấm lần nữa sau khi lần đầu xong và ca tạo hội thoại lỗi);
    - browser `FE-03b:` và `FE-03: Shift Enter…` với `--repeat-each=20`: 40/40.
  - **Mutation trên bản sửa:** 5/5 bị bắt:
    - bỏ chặn bấm hai lần;
    - tin gửi bỏ qua promise đang chờ;
    - không ghi promise;
    - không xóa promise sau khi xong;
    - giữ route cũ khi đang tạo.
  - **`npm run check`:** exit 0. v3 1.068 = 47 schema + 328 adapters + 180 planner + 25 executor + 252 API + 236 web; eval 165.
  - **`npm run test:browser:v3`:** exit 0, 26/26 ca qua 10 scenario (default 15 ca, gồm test FE-03b mới).
- Điều chưa làm hoặc khác với task card:
  - Bấm "Cuộc hội thoại mới" hai lần liên tiếp giờ chỉ tạo **một** hội thoại (có test).
  - Gửi từ trang chủ (luồng tự tạo hội thoại), rồi bấm "Cuộc hội thoại mới" trước khi xong: không đổi. Lần bấm sau tạo hội thoại mới và màn hình chuyển sang đó; tin nằm ở hội thoại đã gửi, thấy trong lịch sử.
  - Tạo hội thoại lỗi khi đã gửi tin: giải phóng trạng thái lập kế hoạch, báo lỗi như cũ. Nội dung đã gõ không giữ lại, giống luồng tạo hội thoại lỗi hiện có.
  - Không đổi API hay schema database.

### Bản sửa sau review độc lập (Codex, 04/10/2026)

- Review độc lập trên `a478537..eaea94a` xác nhận hai P2: chọn hội thoại khác trong lúc New đang chờ vẫn gửi vào hội thoại mới; từ hội thoại cũ gửi trong lúc New đang chờ không hiện khóa bản nháp, Enter lần hai xóa nội dung chưa gửi. Hai probe lỗi trên bản mới nhưng đạt trên nguồn Workspace trước FE-03b.
- Bấm New chuyển ngay về bản nháp. Response tạo mới chỉ chọn hội thoại nếu người dùng vẫn ở bản nháp; gửi từ một hội thoại đã chọn luôn dùng ID của route đó. Trạng thái planning của bản nháp vì vậy khóa đúng ô nhập trước khi ID về.
- Review cũng tái hiện lỗi kế thừa: response tạo mới đến sau mất phiên/unmount khôi phục store và tiếp tục gửi. Guard theo vòng đời Workspace bỏ qua response và lần gửi đang chờ sau khi Workspace đóng, cùng các cập nhật UI từ response gửi tin đến muộn. Request tạo hội thoại đã đến server vẫn có thể tạo một hội thoại trống; guard không tuyên bố hủy tác vụ server đã nhận.
- Guard chỉ bỏ cập nhật UI đến muộn. Bản nháp chưa gửi được giải phóng ngay khi rời Workspace, theo đúng request ID; response cũ không xóa bản nháp mới. Request đã gửi giữ metadata để khôi phục từ lịch sử; POST thất bại đã biết giải phóng record riêng dù trang đã đóng.
- Khi tạo mới thất bại, khôi phục các trường hiển thị của hội thoại cũ nếu người dùng vẫn ở bản nháp; giữ planning owner và revision hiện tại, không hồi sinh request đã thất bại hoặc ghi đè hội thoại vừa chọn.
- New dùng một mục lịch sử: thay route bản nháp tạm bằng route hội thoại mới, để Back một lần về hội thoại trước. Canonical browser đã bắt hồi quy này trước sửa; test HTTP native + history thật RED **1 fail / 27 skipped**, GREEN sau thay `navigate(..., true)`.
- RED HTTP thật + React: hai regression mới **2 fail / 18 pass**; trước guard vòng đời **2 fail / 20 pass** (`c-new` khôi phục thay vì null); ca rời Workspace cùng phiên **2 fail / 22 pass** và POST thất bại đến muộn **1 fail**. GREEN cuối: planning **28/28**; ba file planning/app-safety/app-routing **45/45**, exit 0. Test public Back/Forward chờ DOM sau history thật thay vì sleep 20 ms.
- Rereview độc lập: **44/44** focused + **13/13** probe HTTP trên bản giữ hội thoại khi tạo lỗi; delta history đạt thêm **2/2** probe nghiệm thu (New đang gửi: Back c1/Forward c-new; gửi từ home: Back home/Forward c-auto). Không còn P1/P2 được xác nhận. Canonical root cuối: `npm run check` **1.084 v3** = 47 schema + 328 adapters + 180 planner + 25 executor + 258 API + 246 web, **165 offline eval**, typecheck/build/credential scan/launcher/guards đạt, exit 0. Browser **26/26**, 10 scenario; FE-03b/Shift Enter `--repeat-each=20` **40/40**, exit 0, PostgreSQL tạm riêng ở 55533. CI đúng head chờ trước merge. Không đổi API, schema, planner hoặc gọi service/model thật.
- Minor P3 còn mở, có probe riêng: c2 → c1 → New lỗi → Back đi qua trang nháp vì nhánh lỗi push route khôi phục; hội thoại/nội dung và planning owner vẫn được giữ. Không coi probe này là nghiệm thu Back cho nhánh lỗi.
