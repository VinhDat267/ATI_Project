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
