# FE-06 · Cockpit: lỗi, chưa rõ kết quả, khôi phục; màn từ chối và hỏi lại; lỗi chung

**Trạng thái:** giao được (FE-05b xong #100, #103) · **Nhánh gợi ý:** `feat/fe-06-cockpit-recovery-a`, `feat/fe-06-cockpit-responses-b` · **Phụ thuộc:** FE-05b đã merge (khoảnh khắc 7–9 dựng trên khung mới); UI-API-01 phần 1 cho nút "Kết nối <dịch vụ>" · **Mốc:** 20/10/2026
**Đặc tả:** mục 1.1, 5, 6, 9 · **Bản mẫu:** `app-stage.html` khoảnh khắc 7–9, `responses.html` (4 tình huống), `errors.html`

**Tách 2 PR (08/10/2026, như FE-05b):**
- **(a)** mục 1–4, 8 và 10: khoảnh khắc 7–9 (`AppStagePage.tsx` dòng 2153–2404), kết thúc không thành công, bỏ `PartialFailureModal`/`ReconciliationNotice`, các P3 chuyển từ review #103;
- **(b)** mục 5–7: màn từ chối, hỏi lại mở rộng (`ResponsesPage.tsx`), lỗi chung (`ErrorsPage.tsx`). Mục 6 "yêu cầu chỉ để xem" hiển thị theo W3-10 (#102) nếu đã merge.

## Vì sao quan trọng

Điểm khác biệt của ATI là xử lý trung thực khi có sự cố: không chạy lại lệnh ghi chưa rõ kết quả, khôi phục sau khi máy chủ khởi động lại, từ chối rõ ràng khi thiếu dịch vụ. Hiện các tình huống này nằm trong `PartialFailureModal` và `ReconciliationNotice` với chữ kỹ thuật ("UNKNOWN", tên tool).

## Việc cần làm

**Cách làm (đổi 07/10/2026, đặc tả mục 1.2):** chép `AppStage/AppStagePage.tsx` (khoảnh khắc 7–9), `Responses/ResponsesPage.tsx` (4 tình huống, dựng trong cockpit), `Errors/ErrorsPage.tsx` (trạng thái lỗi chung, dựng ở đúng chỗ trong cockpit và toàn app) từ `docs/design/prototypes/react/src/pages/` sang app sau khi FE-04b đã merge; giữ nguyên markup, class, cỡ chữ và màu của bản mẫu; bỏ JS demo, nối store/API; giữ các bảo đảm hành vi đang có. Ảnh "giống bản mẫu" so với trang tương ứng của bản React (`npm run dev` trong `docs/design/prototypes/react/`). Các mục dưới đây là phần dữ liệu và hành vi phải đúng.

1. **Khoảnh khắc 7 · Lỗi đã biết:** chuyện gì đã xảy ra, ảnh hưởng hiện tại, việc cần làm. Nút theo `recoveryActions`: Thử lại, Sửa rồi thử lại (giữ chức năng sửa tham số của `PartialFailureModal`, nhưng trình bày bằng trường có nhãn thay vì JSON thô khi có schema), Bỏ qua, Dừng (có xác nhận).
2. **Khoảnh khắc 8 · Chưa rõ kết quả:**
   - nói rõ hệ thống không chắc lệnh đã tới dịch vụ hay chưa;
   - link "Kiểm tra trên <dịch vụ>" nếu biết đích;
   - chỉ hai lựa chọn: "Đã thấy kết quả → Bỏ qua bước này và làm tiếp", "Dừng kế hoạch";
   - không có nút chạy lại; câu hướng dẫn "Nếu chưa có: dừng kế hoạch rồi gửi lại yêu cầu".
3. **Khoảnh khắc 9 · Khôi phục sau khi máy chủ khởi động lại:** danh sách việc đã xong (có link), chưa làm; nút "Làm tiếp các việc còn lại" khi có `continue`, "Dừng". Thay `ReconciliationNotice`.
4. **Kết thúc không thành công** (`stopped`, `rejected`, `failed`): tóm tắt việc đã làm/chưa làm và "Nhờ việc khác" (bố cục như khoảnh khắc 6).
5. **Màn từ chối** (`responses.html` 1–2):
   - dịch vụ chưa kết nối: dùng `unavailableServices` từ UI-API-01; trạng thái từng dịch vụ trong yêu cầu; quản trị viên có nút "Kết nối <dịch vụ>" tới `/settings#<id>` (nhiều dịch vụ thì tới `/settings`); thành viên chỉ có câu "Chỉ quản trị viên kết nối được dịch vụ mới…";
   - việc chưa làm được: lý do và gợi ý của planner; nút "Sửa yêu cầu" đưa câu cũ vào ô nhập;
   - câu "Chưa có gì được ghi lên công cụ nào." trên mọi màn từ chối/hỏi lại.
6. **Màn hỏi lại mở rộng** (`responses.html` 3–4): yêu cầu chỉ để xem (khi W3-10 đã merge; trước đó vẫn hiển thị đúng nếu planner trả clarification), không thấy nơi cần ghi (kèm dòng phụ khác nhau cho quản trị viên/thành viên).
7. **Lỗi chung** (`errors.html`):
   - mất mạng: dải trên cùng, "Thử lại"; không hứa tự đồng bộ;
   - hết phiên: đưa về đăng nhập với câu "Phiên đăng nhập đã hết hạn"; không hứa lưu bản nháp;
   - lập kế hoạch lâu (quá 15 s): hiển thị tiến trình tra cứu thật từ `gatherState`; "Thôi chờ, giữ lại câu yêu cầu" kèm câu "Nếu kế hoạch đến sau, nó vẫn nằm trong hội thoại và chưa chạy cho tới khi bạn duyệt";
   - lỗi máy chủ: câu của hệ thống "Không thể lập kế hoạch lúc này. Hãy thử lại."; không mã lỗi tự đặt.
8. Bỏ `PartialFailureModal` và `ReconciliationNotice` khi đã có thay thế; giữ nguyên lời gọi API khôi phục.
9. *(Chuyển sang [FE-05b](FE-05b-cockpit-visual-parity.md) mục 9–11 ngày 06/10/2026, vì FE-05b dựng lại vùng cuộn, thanh trên và ngăn hội thoại: hai P3 vị trí cuộn và focus khi đổi khoảnh khắc, định dạng thời lượng, thu gọn phần đầu trang ở 375px, dòng tóm tắt trong ngăn hội thoại.)*
10. **P3 chuyển từ review #103 (08/10/2026)**, làm trong PR (a):
    - khoảnh khắc 4 (`PlanMoment.tsx`) luôn ghi "Các thao tác này ghi thật vào công cụ của nhóm…", kể cả ở sandbox; đổi câu theo `runtimeMode` để không mâu thuẫn với dải thử nghiệm;
    - "Đã xong N việc trên M công cụ" (`ReceiptMoment.tsx`): M chỉ đếm dịch vụ của bước đã thành công; thêm test có bước bị bỏ qua;
    - test cho thẻ biên nhận của bước `skipped` có output: không link, không tiêu đề lấy từ output (`outcomeURL`, `resultTitle`);
    - test đóng ô "Sửa qua Chat" khi `activePlan.id` hoặc hội thoại đổi;
    - ngăn hội thoại trong phiên đang chạy: có dòng tóm tắt "Kế hoạch … sẵn sàng" mà không cần tải lại (SSE `plan`/`plan_preview` hiện không thêm tin vào store). Chỉ thêm tin hiển thị, không đổi cách lưu ở backend.

## Tiêu chí nghiệm thu

- [ ] Test: bước `unknown` không có hành động chạy lại ở bất kỳ đâu trên giao diện; chỉ "Bỏ qua" và "Dừng".
- [ ] Test: nút khôi phục hiện đúng theo `recoveryActions` của snapshot (thiếu `continue` thì không có "Làm tiếp").
- [ ] Test: từ chối có `unavailableServices` → quản trị viên thấy link `/settings#<id>`, thành viên không thấy; không có `unavailableServices` (dữ liệu cũ) → vẫn hiển thị lý do văn bản.
- [ ] Test phản hồi muộn: lệnh khôi phục của plan A trả về sau khi người dùng đã sang hội thoại B → không đổi màn của B.
- [ ] Các test W2-04, W2-05, `partial-failure-modal`, `execution-progress` được chuyển sang component mới, không mất ca.
- [ ] Browser: sandbox có kịch bản bước `unknown` và `reconciliation_required` (thêm vào harness nếu chưa có) chạy đúng; không cuộn ngang ở 375px.
- [ ] **Giống bản mẫu** (đặc tả mục 1, 1.1, 1.2 bản 07/10; chép trang của bản React rồi nối dữ liệu thật): ảnh app đặt cạnh ảnh bản React ở 1440×900 và 375×812, sáng và tối, cho `app-stage.html` khoảnh khắc 7–9, `responses.html` (4 tình huống) và `errors.html`. Màn kết thúc không thành công so với khoảnh khắc 6. Danh sách ảnh và SHA256 ghi trong log; ảnh không commit. Mọi khác biệt còn lại nằm trong đặc tả 1.1 hoặc ghi ở phần "Kết quả" kèm lý do.
- [ ] `npm run check` và `npm run test:browser:v3` exit 0.

## Ngoài phạm vi

Thay đổi hành vi planner (W3-10), thay đổi chính sách khôi phục của executor.

## Kết quả

Phần A đã triển khai trên `feat/fe-06-cockpit-recovery-a`, base `eb48f0b`. Chờ CI đúng head và reviewer repository nghiệm thu; chưa merge. Chỉ mục 1–4, 8, 10; phần B (5–7) chưa làm.

- Khoảnh khắc 7–9 dùng cấu trúc/class từ React AppStage; dữ liệu, lỗi, thời lượng, link và hành động lấy từ snapshot. Unknown không có retry/edit/continue kể cả snapshot trả actions sai. Dừng có xác nhận, Escape/hủy không gửi lệnh.
- Form sửa có trường nhãn theo schema, kiểm JSON/kiểu trước xác nhận, giữ tham số/đầu ra thành công đã lưu và resolve `$ref`/`$template`. API retry không nhận args: xác nhận dừng kế hoạch cũ → đọc snapshot stopped → gửi yêu cầu sửa mới, chờ duyệt mới; stop lỗi/conflict không gửi yêu cầu sửa. Không đổi API/policy executor.
- Stopped/rejected/failed có biên nhận việc đã làm/chưa hoàn thành và Nhờ việc khác, giữ unknown làm bằng chứng. Snapshot terminal đã retired không chiếm lại màn planning/clarification mới. Phản hồi recovery muộn, rời/quay lại hội thoại, đổi plan và SSE stopped trước HTTP đều có test.
- Đã bỏ PartialFailureModal/ReconciliationNotice, chuyển đủ 11 ca modal cũ sang incident/editor và giữ các ca W2-04/W2-05/reconciliation/safety. Frontend từ 475 lên 510 test.
- Cả 5 P3 #103: copy runtime trung thực; M chỉ đếm succeeded; skipped có output không link/title giả; đóng Sửa qua Chat khi owner đổi; SSE plan/plan_preview thêm tin hiển thị có dedup, không đổi lưu backend.
- `npm run check`: exit 0; v3 1.467 test + eval 165; `npm run test:browser:v3`: exit 0, 69/69 test qua 11 scenarios. Review agent độc lập 142/142 test liên quan, không còn P1/P2 phát hiện; chưa thay nghiệm thu reviewer repository.
- 32 ảnh app/React ở 1440×900 và 375×812, light/dark, và SHA256: [log FE-06A](../log/2026-10-08-codex-fe-06a-cockpit-recovery.md). Ảnh không commit, trang so sánh tại worktree `node_modules/.cache/fe06a/screenshots/comparison.html`.
- Khác mẫu có chủ đích: copy/nhãn dịch vụ tổng quát theo dữ liệu; moment7 liệt kê mỗi việc thành công thay gộp hai việc demo; thêm link thật và chi tiết đối chiếu thu gọn; nút sửa/xác nhận theo task; moment8 dùng nguyên lựa chọn/cảnh báo FE-06 nên nút dài hơn demo; restart hiển thị thời lượng đã lưu; terminal dùng bố cục6 với trạng thái đúng và connector chỉ khi có reference thật. Demo pill không đưa vào app. Các lớp khung, typography, màu, card và buttons lấy từ mẫu; các thay đổi min-width/wrap giữ không cuộn ngang ở 375px.
- Durable GET có thể trả execution reconciliation_required cho plan partial+unknown dù chưa restart; UI hiển thị8 khi plan vẫn partial, chỉ9 khi plan đã reconciliation_required. Unknown trong9 vẫn không Continue. Đây là nối dữ liệu thật, không sửa backend.
- NOT_RUN: provider live, nghiệm thu screen reader, phần B responses/errors, reviewer repository và nghiệm thu sản phẩm.
- **Sửa sau review độc lập (08/10, Claude Code, theo yêu cầu người dùng):** đóng 2 P2 và 4 P3 của [bình luận review](https://github.com/VinhDat267/ATI_Project/pull/107#issuecomment-6058605141). "Sửa rồi thử lại" gửi câu tiếng Việt theo nhãn schema, không còn mã bước/JSON; ô ghi chú để trống mặc định; tin dài xuống dòng trong ngăn hội thoại; test link của bước bị bỏ qua kiểm đúng nhãn "Xem tin". Chi tiết và bằng chứng: [log sửa](../log/2026-10-08-claude-code-FE-06A-review-fixes.md). Phần sửa do reviewer tự làm nên chưa có review độc lập.

### Phần B · bàn giao 09/10/2026

Đã triển khai mục 5–7 trên `feat/fe-06-cockpit-responses-b`, base `e269743`; code head `85d9bbe228f547125d04d754e402184288fa6669`. Phần B có bằng chứng local và review agent độc lập đạt; CI đúng head PR và reviewer repository là các gate bàn giao tiếp theo, chưa merge. Trạng thái “phần B chưa làm” trong ghi nhận phần A ở trên là lịch sử bàn giao 08/10.

- Refusal/clarification dùng markup/class React Responses, metadata planner và service API; giữ dữ liệu cũ, trạng thái dịch vụ thật, link `/settings#<id>` hoặc `/settings` theo quyền, Sửa yêu cầu điền/focus câu gốc, không tự gửi. Mọi màn từ chối/hỏi lại có câu chưa ghi lên công cụ. Nhiều đích có chỉ báo Đã chọn và xác nhận lựa chọn thật.
- Khi mở lại hội thoại, response mới giữ quyền hiển thị dù snapshot completed cũ về trước hoặc sau history. Snapshot vẫn lưu làm bằng chứng; unknown/failed vẫn ưu tiên xử lý. Guard revision và owner giữ phản hồi SSE/new request mới hơn.
- Mất mạng có dải trên cùng và retry health/SSE chỉ đọc, có AbortSignal thật, không gửi lại lệnh ghi. Mất phiên về đăng nhập với câu hết hạn, không hứa giữ bản nháp. Planning quá 15 giây hiển thị gatherState thật; Thôi chờ giữ câu gốc và khóa pending; plan muộn vẫn chờ duyệt. Lỗi planning dùng câu hệ thống chung, retry chỉ câu gốc.
- TDD có RED trước sửa; regression review RED 4 fail/14 pass, bổ sung thứ tự snapshot-first RED 3 fail/20 pass; GREEN focused 75/75. `npm run check` exit 0: v3 1.558 test (frontend 593), eval 165, typecheck/build/security/launcher/helper đạt. `npm run test:browser:v3` exit 0: 78/78 qua 11 scenarios. Giữ mọi ca FE-05, chỉ đổi assertion copy lỗi planning trong cockpit; raw error vẫn nằm trong nhật ký hội thoại.
- Review agent độc lập phát hiện rồi xác minh đóng 1 P2 history hydration và 1 P3 selection tại `85d9bbe`, chạy lại 75/75, hai source probes và `git diff --check`. Đây chưa thay nghiệm thu reviewer repository.
- 64 ảnh app/React, 32 cặp: 4 responses + offline/session/slow/server × 1440×900 hoặc 375×812 × light/dark. SHA256 và khác biệt: [log FE-06B](../log/2026-10-09-codex-fe-06b-responses-and-errors.md). Ảnh không commit; comparison HTML ở worktree `node_modules/.cache/fe06b/screenshots/comparison.html`.
- Khác mẫu có chủ đích: dùng header/sandbox thật, bỏ controls demo; option API chỉ có chuỗi nên icon trung tính, dữ liệu không bịa; lựa chọn/xác nhận/Đã chọn giữ hành vi hiện hữu; footer Responses có nút cam và textarea chung. Không dựng accordion khả năng Trello từ dữ liệu demo; không có lời hứa tự đồng bộ/lưu nháp/an toàn tuyệt đối, tiến trình giả hay mã lỗi tự đặt. Expiry đi tới login thật. Thêm wrap/min-width cho 375px; CSS Responses/Errors bằng mẫu sau chuẩn hóa EOL.
- W3-10 #102 vẫn mở khi kiểm tra 09/10: chỉ trình bày clarification planner đã trả, không đổi policy read-only/backend/executor. NOT_RUN: model/provider live, hết hạn JWT theo thời gian thực trong production, screen reader, reviewer repository và nghiệm thu sản phẩm. Phần A không thuộc PR B.
- CI đầu tại `c57b10e` có 60 pass/1 fail trong default: fixture cuộn FE-02 gán scrollTop trước khi native scroll event được xử lý, planner có thể append tin trong khoảng đó. FE-06B đủ 5/5 pass. Sửa fixture bằng phát sự kiện scroll trong cùng callback gán vị trí, giữ nguyên ngưỡng gần đáy, assertion 80 và ca gửi khi đang đọc phía trên. Browser focused sau sửa 10/10, typecheck exit 0; reviewer đánh giá đồng bộ fixture hợp lệ. Code sản phẩm và 64 ảnh/SHA không thay đổi; CI head mới phải kiểm lại.

### P3 thứ nhất của #116 · bổ sung test 09/10/2026

- Thêm một regression test: SSE `plan_preview` đến trong lúc tải history; history kết thúc bằng refusal cũ vẫn được nạp nhưng không xóa kế hoạch mới hoặc đổi trạng thái `preview`. Code sản phẩm giữ nguyên.
- Bỏ riêng điều kiện `hydrateResponse`: test mới fail với `activePlan === null` (exit 1); khôi phục nguyên byte: file 24/24, frontend 594/594, eval 165/165 và typecheck exit 0.
- Bằng chứng, base và phạm vi kiểm tra: [log test chốt history](../log/2026-10-09-codex-fe-06b-history-hydration-guard-test.md). Chờ CI đúng head và reviewer repository; chưa merge.
