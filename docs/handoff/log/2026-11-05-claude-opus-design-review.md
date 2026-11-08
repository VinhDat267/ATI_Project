# 2026-11-05 · Claude Opus (High) · Thẩm định Design Brief Planora (4 mẫu trải nghiệm)

**Kết luận tổng thể: CẦN SỬA ĐỔI LỚN (Needs Major Changes)**

Hướng UX được chấp thuận: bản sắc Planora, bốn trụ cột business-first, danh sách cấm, một composer và nguyên tắc không retry khi chưa rõ kết quả đều đúng. Cần sửa trước khi giao worker vì bản brief **chưa triển khai được như hiện tại**:

- Có 5 điểm P1 mô tả hành vi hoặc copy **khác contract thật**: xem trước nội dung khi chạy, đăng nhập bằng liên kết email, bộ lọc inbox, người gửi Slack và câu "dữ liệu vẫn an toàn".
- Một điểm P1 khác **đưa thẳng lỗi UX-F3 vào đặc tả**: vẫn có hai nút gửi cho cùng một lựa chọn.
- Brief **thiếu** trạng thái nguy hiểm nhất (chưa xác nhận được kết quả), vòng đời của đề xuất, giao diện mobile và các trạng thái lỗi/rỗng/đang tải. Spec 05/11 §3–§4 bắt buộc phải có các phần này.

Phần cần sửa nằm trong **tài liệu brief**, không phải làm lại hướng thiết kế. Dự kiến cần một vòng sửa brief, sau đó review lại theo danh sách ở mục 6.

---

## 1. Định danh, phạm vi và bằng chứng

- **Reviewer:** Claude Opus (High), thẩm định độc lập. Tôi không phải tác giả brief và không sửa tài liệu được thẩm định.
- **Orca:** worker `term_f36e1507-eba7-43fa-93f5-d8d894af0ea9`, task `task_ae84513c8311`, dispatch `ctx_e14255a8a2d0`.
- **Worktree:** `planora-control`, nhánh `longnguyen005/planora-control`, HEAD `1c5a8e00`. Ba tài liệu chính đang **untracked**, nên tôi review theo trạng thái working tree và ghi SHA-256 (16 ký tự đầu) để đối chiếu:

| Tài liệu | SHA-256 (16 ký tự đầu) |
| --- | --- |
| `docs/superpowers/specs/2026-11-05-planora-design-brief.md` | `4FF1D0B8505E7B5A` |
| `docs/superpowers/specs/2026-11-05-planora-business-first-ux.md` | `1B864CFB17AF774D` |
| `docs/handoff/tasks/PLANORA-UX-01-business-first-redesign.md` | `1FCE6AD08BE5BD7E` |
| `review-planora-pl-07-r2/docs/handoff/log/2026-11-05-argon-review-pl-07-r2.md` (worktree khác, HEAD `f4cd6f44`, untracked) | `039097AC28310EDE` |

- **Đối chiếu khả năng thật trên baseline `origin/main@cb069061`** bằng `git grep` / `git show` (chỉ đọc):
  - `apps/chat-web/src/routes.ts:46`: route `inbox` đã có. `components/layout/MainNav.tsx:14-17, 93-102` đã có `NavTab 'inbox'` và badge.
  - `components/slack/SlackProposalInbox.tsx:23-31, 131-140`: có các bộ lọc `action_needed` / `awaiting_approval` / `resolved`, và các trạng thái `pending, needs_info, awaiting_approval, approved, rejected, stale, completed`.
  - `SlackProposalCard.tsx:104-105, 188, 232-240, 286-295`: chỉ cho thao tác khi đề xuất actionable và chưa stale/redacted. Có xung đột 409. Duyệt gắn với `planId` + `planHash`. Từ chối có kiểm `revision` (`services/slack-assistant.ts:185-188`).
  - `pages/AuthAction/AuthActionPage.tsx:6`: có **13** chế độ xác thực (`verify-expired`, `verify-used`, `blocked-pending`, `blocked-locked`, `blocked-attempts`, `email-not-verified`, `google-*`…). `AuthGate.tsx:163` dùng các luồng `signup / verify-email / resend-verification / forgot-password / reset-password / google-callback`. **Không có đăng nhập bằng liên kết email (magic link).**
  - `packages/executor/src/resolver.ts`: `$ref` và `${step_n.output…}` **được resolve khi chạy**. Spec v3 §3.2 bước 6–7: duyệt gắn hash SHA-256, TTL 30 phút. Khi lỗi giữa chừng: tạm dừng, cho chọn retry/fix/skip/stop. Spec v3 dòng 528–529: hành động rủi ro cao (gửi email) cần xác nhận riêng cho từng bước.
  - `components/layout/WorkspaceSwitcher` và `services/workspace-storage` đã có. `Workspace.tsx:114` có logic không gian không phải cá nhân, gắn với `myjira`.
  - `packages/tool-schemas/src/telegram.ts:19`: Telegram gửi **văn bản thuần**, không dùng `parse_mode`.
- **Tương phản bảng màu:** tính bằng công thức WCAG 2.x (relative luminance) qua `node -e`, exit code 0. Kết quả ở mục 3.4.
- **NOT_RUN:** chưa có mockup hoặc prototype để mở trên trình duyệt (brief chỉ có chữ), nên không chạy browser, chụp ảnh hay đo layout. Không chạy unit/E2E vì đây là review tài liệu thiết kế, chưa có head mã nguồn mới. Không gọi provider hay LLM.

---

## 2. Góc 1: Tính thực chất business-first

### 2.1. Brief giải quyết công việc thật hay chỉ là lớp trang trí?

**Phần lớn là thực chất.** Brief chuyển trọng tâm từ "cấu trúc máy" sang "quyết định của người dùng" ở các điểm:

- Thẻ kế hoạch trả lời được *làm gì, lấy từ đâu, gửi cho ai, nội dung ra sao*.
- CTA dùng động từ mô tả tác động.
- Phục hồi lỗi nêu *việc đã xong, việc chưa rõ, việc an toàn có thể làm tiếp*.

Brief khớp bốn câu hỏi bắt buộc ở spec 05/11 §2 và trực tiếp nhắm vào UX-F1/F2/F3.

Tuy vậy, hai hành trình trong spec §3 **chưa được thiết kế**, chỉ được nhắc tới:

- **Hành trình 1** (người mới → đăng nhập → *kết nối dịch vụ* → *yêu cầu đầu tiên*): Mẫu 1 dừng ở CTA đăng nhập. Chưa có màn đầu tiên sau đăng nhập, chưa có kết nối ngay từ chat khi bị từ chối, và chưa nói rõ draft sau khi kết nối không tự gửi.
- **Hành trình 3** (bản tin định kỳ: tự gửi hay cần duyệt, lần chạy tiếp theo, tạm dừng): chỉ có một mục sidebar "Nhật ký & Lịch chạy".

Nếu không thiết kế, worker PL-11/12 sẽ không có mẫu và dễ quay về form schema cũ.

### 2.2. Đã loại hết rác kỹ thuật chưa?

- **Tốt:** danh sách cấm rõ ràng và cấm cả accordion "Chi tiết kỹ thuật" (trụ cột 2, Mẫu 4). Brief giữ đúng các định danh có ích cho người dùng như `PROJ-42`, `owner/repo`, email, tên bảng tính. Copy ví dụ tự nhiên, không lẫn tên tool.
- **Còn sót hoặc dễ tái phát:**
  - Brief chưa có **quy tắc ánh xạ** từ tool/trạng thái sang nhãn công việc (ví dụ bảng `trạng thái server → nhãn → CTA được phép`). Chỉ có danh sách cấm thì worker phải tự đặt nhãn, và đây chính là nguồn gốc của nhãn "Chưa lập kế hoạch" ở UX-F2.
  - Chưa có hướng dẫn cho trường hợp **không ánh xạ được**: tool mới, tham số lạ. Không có fallback thì worker thường quay lại dùng JSON (xem D1).
  - Tên thương hiệu cũ "ATI" (`PlanningErrors.tsx`, `ChatComposer` "ATI chỉ đọc và ghi…") và ngôi xưng của trợ lý ("Tôi" hay "Planora") chưa được chốt thành quy tắc giọng văn.

---

## 3. Góc 2: Khả thi và bảo toàn nghiệp vụ

### 3.1. Các ràng buộc cốt lõi

| Ràng buộc | Đánh giá | Ghi chú |
| --- | --- | --- |
| Auth | **Chưa đúng contract** | Mẫu 1 viết *"đã gửi liên kết đăng nhập an toàn"* và có nút *"Mở ứng dụng thư"*. Hệ thống không có magic link, chỉ có xác thực email và đặt lại mật khẩu. Web cũng không mở được hộp thư (`mailto:` chỉ mở cửa sổ soạn thư). Brief mới phủ 1/13 chế độ xác thực (D4). |
| Tách biệt workspace | **Chưa thể hiện** | Brief có workspace switcher nhưng không quy định: (a) khi đổi không gian thì hội thoại, inbox, badge và request đang chạy được làm mới hoặc hủy thế nào; (b) thẻ kế hoạch có cho biết đang tác động trong *không gian / tài khoản kết nối / Jira site–project* nào. Thông tin này cần cho quyết định duyệt, và MAIN-SYNC §3 bắt giữ site/project/issue key (D9). |
| Gắn kế hoạch bằng hash | **Không bị phá, nhưng thiếu vòng đời** | Bỏ hash khỏi UI không ảnh hưởng vì việc gắn hash nằm ở server (mẫu `SlackProposalCard.tsx:232-240`). Brief thiếu các trạng thái: đề xuất bị thay sau khi "Sửa lại bằng chat", hết hạn duyệt (TTL 30 phút), xung đột 409, chống bấm hai lần, và xác nhận riêng từng bước cho email (D5). |
| SSE / tiến trình | **Thiếu** | Tiêu đề Mẫu 4 có "theo dõi tiến trình" nhưng nội dung không mô tả: trạng thái từng bước khi chạy, mất SSE rồi nối lại, ưu tiên khôi phục, biên nhận có liên kết thật. Brief cũng chưa cấm % tiến độ giả (D5). |
| Unknown / phục hồi | **Rủi ro cao** | Brief nói "không retry liều lĩnh" nhưng **không thiết kế** trạng thái chưa xác nhận được kết quả. Ví dụ phục hồi duy nhất lại là lỗi OAuth, một lỗi đã biết, và đặt "Thử gửi lại" ngang hàng với "Kết nối lại Slack" (D2). |

### 3.2. Bỏ JSON dump và engine graph có làm giảm quyền kiểm soát không?

**Không, nếu làm đúng cách.** JSON dump và đồ thị orbital chưa bao giờ là công cụ kiểm soát: chúng chỉ để đọc, không sửa được và người dùng không hiểu. Quyền kiểm soát thật gồm (a) xem trước đầy đủ các tham số có tác động ra bên ngoài, (b) sửa bằng chat, (c) hủy, (d) server kiểm hash.

Rủi ro thật là **mất thông tin khi chuyển sang dạng nghiệp vụ**. Nếu view-model chỉ hiện "kênh + nội dung" mà bỏ sót `thread_ts`, cc/bcc, người được giao, nhãn, hạn chót, tệp đính kèm, thì tác động bị ẩn và nguy hiểm hơn cả JSON. Cách khắc phục là quy tắc **phủ đủ tham số, mặc định chặn khi thiếu** (D1).

### 3.3. Xem trước nội dung và tham chiếu chạy lúc thực thi (vấn đề khả thi lớn nhất)

Mẫu 4 có hai mô tả:

1. *"Đọc dữ liệu · Google Sheets… Tóm tắt: **Đã đọc được 8 nhiệm vụ**"* hiển thị trước khi duyệt.
2. *"Bản xem trước… đầy đủ nội dung"* của tin Slack.

Theo spec v3 §3.2 và `resolver.ts`, bước đọc **nằm trong kế hoạch** chỉ chạy **sau khi duyệt**. Nội dung tin Slack phụ thuộc vào `${step_1.output…}` chỉ có giá trị khi chạy. Chỉ dữ liệu thu ở pha gather/clarify trước khi lập kế hoạch mới có thể hiện trước khi duyệt. Nếu worker làm đúng như brief, họ sẽ phải **dựng kết quả đọc và nội dung tin nhắn giả**, trái spec 05/11 §4 ("không dựng progress %, success… giả").

### 3.4. Tương phản bảng màu (đã tính)

| Cặp màu | Tỷ lệ | Nhận xét |
| --- | --- | --- |
| Chữ chính `#2e382d` / canvas `#f8f4eb` | 11.12:1 | Đạt, nhưng brief ghi "≥ 12:1". Chỉ đúng trên paper (12.00:1). |
| Chữ phụ `#656b5b` / paper · canvas · sidebar | 5.42 · 5.02 · **4.55**:1 | Brief ghi "≥ 5.4:1", thực tế chỉ đúng trên paper. Trên sidebar chỉ vừa sát ngưỡng AA, chỉ cần thêm opacity là trượt. |
| Chữ trắng / primary `#3c5741` | 7.98:1 | Đạt. |
| **Chữ trắng / primary dark `#8fb68e`** | **2.27:1** | **Không đạt.** Brief không định nghĩa màu chữ trên primary ở dark mode. Đây chính là lỗi 2.27:1 của PL-07 F2 vòng 1. Dùng `#171c18` thì đạt 7.61:1. |
| Viền `#deded0` / paper · canvas; viền dark `#394638` | 1.24–1.73:1 | Dùng làm đường phân cách trang trí thì được. **Không đạt** WCAG 1.4.11 (≥ 3:1) nếu dùng làm viền ô nhập, thẻ radio hoặc chỉ báo focus. |

Brief cũng chưa có token ngữ nghĩa cho lỗi, cảnh báo, thành công và "chưa xác nhận". Tham chiếu `Frontend_UXUI@ef13c56:apps/chat-web/DESIGN.md` đã có Error `#f8e6df` / `#9a3f32` để kế thừa.

---

## 4. Góc 3: Bố cục, tương tác và trải nghiệm

### 4.1. Đánh giá từng mẫu

**Mẫu 1: Landing và đăng nhập.**
- Tiêu đề và hai kịch bản mẫu nói đúng giá trị công việc.
- Thiếu nhãn "Ví dụ" một lần cho mỗi nhóm minh họa (spec §3, DESIGN tham chiếu).
- Thiếu luồng đăng ký, xác thực email, các trạng thái bị khóa hoặc chờ duyệt, và lỗi Google.
- Copy magic link sai contract (D4).
- Font serif "Times New Roman / Georgia / Garamond" hiển thị không đồng nhất trên Android/iOS. Nên tự host một serif có subset tiếng Việt, giống cách làm với Be Vietnam Pro.

**Mẫu 2: Điều hướng và inbox.**
- Hierarchy sidebar hợp lý: không gian → việc cần xử lý → hội thoại → lịch.
- **Lệch contract inbox:**
  - Bộ lọc "Lịch tự động" không có trong inbox và PL-12 cấm dựng inbox thứ hai.
  - Thiếu tách "Cần xử lý" (pending + needs_info) với "Chờ duyệt kế hoạch".
  - Thiếu chọn kết nối khi có nhiều workspace Slack, phần bản tin, trạng thái stale/đã thu hồi nội dung, và xung đột revision.
  - "Bỏ qua" thực chất là **từ chối vĩnh viễn** (`rejectProposal`), không phải ẩn tạm.
  - Đề xuất `needs_info` cần CTA "Trả lời thêm", không phải "Duyệt".
- Brief chưa nói badge đếm những trạng thái nào và có lọc theo workspace hay không.
- Sidebar thiếu các route Hướng dẫn, Quyền riêng tư, Tài khoản, Cài đặt và Quản trị người dùng (chỉ admin) trong 25 route.
- Danh sách dịch vụ thiếu Gmail và cần lấy trạng thái thật từ API (đã kết nối / cần kết nối lại / chưa kết nối), không dùng danh sách tĩnh.
- Icon emoji (✦📥💬📋) hiển thị khác nhau giữa các hệ điều hành và bị screen reader đọc tên emoji. Nên dùng SVG `aria-hidden`.

**Mẫu 3: Hội thoại và làm rõ thông tin.**
- Câu hỏi làm rõ đã đặt trong ngữ cảnh, lựa chọn có ghi chú giúp ra quyết định, và quy định không tự gửi khớp F1 đã đóng.
- **Còn mâu thuẫn chưa giải:** chọn một lựa chọn thì điền sẵn vào composer, và thẻ lại có nút "Xác nhận và tiếp tục". Như vậy vẫn có **hai nút gửi** (nút trên thẻ và nút Gửi của composer), đúng nửa sau của UX-F3 (D3).
- Chưa quy định khi người dùng sửa văn bản trong composer khác với lựa chọn đang chọn thì gửi theo giá trị nào.

**Mẫu 4: Duyệt tác động và phục hồi.**
- Chuỗi thẻ công việc thay cho đồ thị orbital và CTA mô tả tác động đều tốt.
- Thiếu: phân biệt rõ dữ liệu đã đọc với dữ liệu sẽ đọc, giá trị chạy lúc thực thi (mục 3.3), trạng thái sau khi duyệt, biên nhận, unknown, bỏ qua bước, sửa rồi thử lại (RecoveryEditor dạng nghiệp vụ, phần sửa của UX-F1), và việc đóng dialog/Escape không ngầm Dừng.
- Bản xem trước có emoji, đậm, nghiêng phải **đúng định dạng nơi nhận**: Slack dùng mrkdwn, Telegram chỉ nhận văn bản thuần, nên không hiển thị định dạng mà tin thật không có.
- Ký tự "✓" trong nhãn nút bị đọc lên bằng screen reader. Nên tách thành icon `aria-hidden`.
- "Người gửi: Nam Nguyễn (Tài khoản của bạn)" chỉ đúng với kết nối Slack cá nhân (`myslack`). Nếu gửi bằng bot thì khẳng định sai. Nhãn này phải lấy từ danh tính kết nối thật.

### 4.2. Cơ chế xử lý ba vấn đề đã biết

| Vấn đề | Brief đã có | Đánh giá |
| --- | --- | --- |
| Composer đè nút hành động (UX-F3) | "Neo với `padding-bottom` an toàn" | **Chưa đủ.** Chỉ đặt padding cố định sẽ hỏng khi composer cao lên nhiều dòng, khi bàn phím mobile mở hoặc khi có banner offline. Cần quy định cơ chế layout và tiêu chí đo (D3). |
| Lặp bong bóng tin nhắn (UX-F2) | "Mỗi câu chỉ xuất hiện một lần" | **Mới là nguyên tắc.** Chưa quy định thành phần nào chịu trách nhiệm render từng phần, chưa xử lý chuyển tiếp từ tin đang stream sang tin đã lưu, chưa có tiêu chí kiểm (D10). |
| Thiếu route `/inbox` | Đưa mục `/inbox` và badge vào sidebar | **Đúng hướng.** Thực ra route đã có trên `main@cb069061`. PL-02 thiếu vì tách nhánh trước khi sync, nên đây là việc **đồng bộ nhánh**, không phải tạo route mới. Nội dung trang phải khớp contract (D4). |

---

## 5. Góc 4: Khuyến nghị cụ thể

### 5.1. Điểm xuất sắc cần phát huy

1. Danh sách cấm có đủ cả accordion "nâng cao", nên chặn được kiểu "giấu JSON vào chỗ khác".
2. Phân biệt rõ ID kỹ thuật cần bỏ với định danh có ích cho người dùng cần giữ (`PROJ-42`, `owner/repo`, email).
3. CTA mô tả đúng tác động, cùng ba hành động "Sửa lại bằng chat / Hủy kế hoạch / Duyệt", khớp v3 `[Duyệt] [Sửa] [Hủy]`.
4. Ghi rõ không tự gửi khi chọn lựa chọn, không retry khi chưa xác nhận kết quả, và yêu cầu tương phản cho nút Dừng. Các bất biến an toàn đã được Argon kiểm này được giữ lại.
5. Bản sắc thị giác nhất quán (giấy kem, xanh rừng, editorial) và có token dark cho từng vai trò.

### 5.2. Các điểm phải sửa trước khi giao worker

**P1: chặn việc giao worker**

- **D1. Xem trước trung thực và phủ đủ tham số.**
  - (a) Tách hai loại dữ liệu trên thẻ: *"Đã đọc lúc 16:05"* chỉ dành cho dữ liệu từ gather. *"Sẽ đọc khi bạn duyệt"* dành cho bước đọc trong kế hoạch.
  - (b) Trong bản xem trước, phần nội dung phụ thuộc bước trước hiển thị bằng placeholder có nhãn, ví dụ *"‹danh sách nhiệm vụ đọc ở bước 1›"*, với kiểu chữ khác. Không dựng giá trị giả.
  - (c) Quy tắc phủ đủ tham số: mỗi tham số ghi có ảnh hưởng ra bên ngoài phải được view-model riêng theo tool hiển thị bằng nhãn nghiệp vụ. Tham số không ánh xạ được thì hiện ở dạng trường có nhãn chung (không phải JSON) hoặc chặn duyệt. Kèm test fixture cho mỗi write tool trong catalog: mỗi property của schema phải được hiển thị hoặc được đánh dấu rõ là nội bộ.
- **D2. Thiết kế trạng thái "chưa xác nhận được kết quả" thành mẫu riêng.**
  - Copy mẫu: *"Chưa xác nhận được Slack đã nhận tin hay chưa. Bước 1 đã xong. Để tránh gửi trùng, Planora sẽ không tự gửi lại."*
  - Chỉ đưa những hành động contract cho phép: không có Thử lại / Sửa / Tiếp tục. Được phép Dừng, và mở nơi nhận để tự kiểm tra nếu có liên kết an toàn.
  - Với lỗi OAuth: **Kết nối lại trước**. Nút "Thử gửi lại" chỉ bật khi server xác nhận bước đó *thất bại* (không phải unknown) và kết nối đã khôi phục. Sau khi kết nối lại không tự retry.
  - Bỏ câu khẳng định tuyệt đối *"dữ liệu vừa đọc vẫn được giữ nguyên an toàn"*. Kết quả đọc có thể hết hạn hoặc bị thu hồi (MAIN-SYNC PL-07), nên chỉ hiện câu này khi server xác nhận.
  - Bổ sung "Bỏ qua bước" và "Sửa rồi thử lại" theo contract. Editor sửa bằng trường nghiệp vụ: chọn kênh theo tên, mảng dạng chip. Không dùng textarea JSON hay nhãn "ID kênh".
- **D3. Một nút gửi cho mỗi thời điểm, cùng cơ chế layout cho composer.**
  - Chốt **một** trong hai cách:
    - (i) Khi có câu hỏi làm rõ đang chờ, nút chính của composer đổi nhãn thành "Xác nhận và tiếp tục" và thẻ chỉ chứa các lựa chọn.
    - (ii) Thẻ giữ nút xác nhận, còn nút Gửi của composer bị tắt kèm gợi ý.
  - Quy định văn bản trong composer là nội dung được gửi. Nếu người dùng sửa khác lựa chọn thì bỏ chọn radio.
  - Layout: composer nằm trong luồng của cột (grid hoặc flex, vùng feed `min-height: 0; overflow: auto`), không đè bằng `fixed/absolute`. Dùng `scroll-padding-bottom` theo chiều cao đo bằng ResizeObserver; mobile dùng `100dvh`, `env(safe-area-inset-bottom)` và `visualViewport` khi bàn phím mở. Khi có thẻ hành động mới thì cuộn để hàng nút hiện ra.
  - Tiêu chí kiểm: Playwright khẳng định khung của mọi nút trên thẻ không giao với khung composer ở 320/375/768/1024/1440 × sáng/tối, kể cả khi composer cao 4 dòng và có banner offline.
- **D4. Sửa copy và hành vi lệch contract.**
  - Mẫu 1: thay magic link bằng copy đúng cho xác thực email và đặt lại mật khẩu, bỏ "Mở ứng dụng thư". Thêm bảng 13 chế độ → tiêu đề, câu giải thích, CTA. Đồng hồ gửi lại lấy `deadline` từ server.
  - Mẫu 2: bộ lọc "Cần xử lý / Chờ duyệt kế hoạch / Đã xử lý"; bỏ "Lịch tự động"; thêm chọn kết nối và phần bản tin. Đổi "Bỏ qua" thành "Từ chối đề xuất" kèm giải thích là vĩnh viễn. `needs_info` dùng CTA "Trả lời thêm". Stale/thu hồi chỉ còn thông tin, không cho thao tác. Xung đột 409 thì tải lại thẻ. Mở đề xuất không tự duyệt. Định nghĩa badge = số lấy từ server theo trạng thái đã chốt và theo workspace.
  - Mẫu 4: người gửi lấy từ danh tính kết nối thật; định dạng xem trước theo nơi nhận.
- **D5. Vòng đời đề xuất và tiến trình.**
  - Sau "Sửa lại bằng chat", thẻ cũ chuyển sang *"Đã thay bằng đề xuất mới"* và bị khóa, để không thể duyệt từ bản xem trước cũ (hành trình 4).
  - Hết TTL: *"Đề xuất đã hết hạn duyệt"*, CTA "Lập lại đề xuất".
  - 409 / hash lệch: làm mới thẻ, không duyệt ngầm.
  - Nút Duyệt chống bấm hai lần.
  - Email: xác nhận riêng cho từng bước.
  - Nhãn CTA theo số bước ghi: 1 bước thì dùng động từ cụ thể; từ 2 bước thì "Duyệt và thực hiện N việc" kèm tóm tắt.
  - Khi chạy: mỗi thẻ bước chuyển Chờ → Đang làm → Xong / Cần chú ý / Chưa xác nhận theo sự kiện server, không có %. Mất SSE thì báo *"Đang kết nối lại để cập nhật"*, không coi là lỗi.
  - Biên nhận có liên kết thật (issue key, permalink).

**P2: cần có trước khi chủ dự án duyệt hình thức**

- **D6.** Mỗi mẫu bổ sung khối brief theo spec §3: người dùng/quyền, điểm vào, nội dung bắt buộc, CTA, kết quả, bước tiếp theo, **lỗi / rỗng / đang tải**, **mobile** (sidebar thành drawer, inbox danh sách → chi tiết, thẻ kế hoạch xếp chồng), focus/bàn phím, vùng chạm 44px, reduced motion, không tràn ở 320px.
- **D7.** Thiết kế hành trình 1 (màn đầu tiên sau đăng nhập, gợi ý theo dịch vụ đã kết nối, kết nối ngay từ chat rồi quay lại draft) và hành trình 3 (lịch). Nếu chưa làm thì hoãn rõ ràng, ghi owner PL-11/12 và tiêu chí nghiệm thu. Phân biệt "Duyệt trước mỗi lần chạy" với "Tự gửi theo lịch", có lần chạy tiếp theo, lý do tạm dừng, chưa xác nhận đã gửi và cần chú ý.
- **D8.** Token: màu chữ trên primary dark `#171c18`; viền ô nhập, radio và focus ≥ 3:1; token lỗi/cảnh báo/thành công/chưa xác nhận kế thừa từ DESIGN tham chiếu; sửa các con số tương phản đang ghi sai.
- **D9.** Thẻ kế hoạch và inbox hiện không gian, tài khoản kết nối, Jira site/project. Quy định hành vi khi đổi workspace: hủy request cũ, làm mới danh sách, không lộ dữ liệu cũ. Sidebar giữ đủ các route còn lại; danh sách dịch vụ lấy từ API, có Gmail.
- **D10.** Quy tắc khử trùng lặp: feed chịu trách nhiệm render mọi tin nhắn đã lưu, còn thẻ hiện hành chỉ render phần quyết định (lựa chọn, kế hoạch, phục hồi), không nhắc lại yêu cầu hay câu hỏi. Tin đang stream và tin đã lưu khử trùng theo message ID. Test: mỗi chuỗi yêu cầu hoặc câu hỏi chỉ xuất hiện đúng 1 lần trong DOM ở các trạng thái answer, refusal, clarification, expanded.
- **D11.** Brief hiện chỉ có chữ. Spec §5 yêu cầu chủ dự án duyệt hướng hình thức, nên cần mockup hoặc prototype tĩnh cho 4 mẫu (desktop + mobile, sáng + tối, ít nhất một trạng thái lỗi). Nhãn dữ liệu minh họa phải rõ ràng.

**P3: tinh chỉnh**

- Dùng SVG thay emoji trong sidebar.
- Tự host serif có tiếng Việt.
- Tách "✓" khỏi nhãn nút.
- Gắn nhãn "Ví dụ" cho kịch bản trên landing.
- Chốt ngôi xưng của trợ lý.
- Link tới log Argon trong `PLANORA-UX-01` đang trỏ đường dẫn tuyệt đối sang worktree `review-planora-pl-07-r2`, nơi file này vẫn untracked. Nên đưa log vào nhánh điều phối để tài liệu không phụ thuộc máy cục bộ.

---

## 6. Kết luận và điều kiện để chuyển thành "Approved"

| Góc thẩm định | Kết luận |
| --- | --- |
| 1. Business-first | **Đạt về hướng**, chưa đủ phạm vi (thiếu hành trình 1 và 3, thiếu quy tắc ánh xạ nhãn). |
| 2. Khả thi và bảo toàn nghiệp vụ | **Chưa đạt** (D1, D2, D4, D5). |
| 3. Bố cục và tương tác | **Chưa đạt** (D3, D6, D10; thiếu mobile và các trạng thái lỗi/rỗng/đang tải). |
| 4. Tổng thể | **CẦN SỬA ĐỔI LỚN (Needs Major Changes)**. Giữ hướng thiết kế, sửa tài liệu brief. |

Đủ điều kiện re-review khi bản brief đã sửa: (1) đóng D1–D5 bằng copy/mẫu khớp contract đã trích ở mục 1; (2) có D6–D11 hoặc ghi rõ phần hoãn kèm owner; (3) mỗi mẫu có tiêu chí nghiệm thu đo được (giao nhau composer/nút, số lần xuất hiện chuỗi, tương phản, phủ đủ tham số). Sau đó mới giao PL-01/02/05/06 triển khai. Argon High vẫn review UX và hành vi trên head mã nguồn mới theo REVIEWER-POLICY.

**STATUS: DESIGN_REVIEW: NEEDS MAJOR CHANGES. Hướng thiết kế được chấp thuận; brief phải sửa 5 điểm P1 trước khi giao worker.**
