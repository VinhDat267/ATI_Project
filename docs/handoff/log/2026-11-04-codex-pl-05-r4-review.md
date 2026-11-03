# 2026-11-04 · Codex · PL-05 re-review vòng 4

- **Phạm vi:** LOCAL_ONLY; reviewer độc lập, không sửa production code hay test của worker, không đăng GitHub, không merge/deploy.
- **Base:** `b9230b8b592237275866e027c1744362ef4c6eda`.
- **Head:** `5bf4b501a64124a6bab0f6161fa480083a08bb9f`; đã đối chiếu với nhánh local `longnguyen005/feat-planora-pl-05`, không đổi trong phiên.
- Đã đọc actual diff base/head và delta từ `128fab1da4178ce28cebdbcc1d974f5dc39d4ab6`, task card, checklist, spec/plan và handoff.

## Kết luận

**Chưa đạt: còn R5 (P2) về regression test R4.** R3 và R4 đã sửa đúng hành vi runtime ở các trường hợp đã chạy; không tìm thêm lỗi production trong phạm vi re-review này. Cần sửa test R5 và chạy lại trước khi đóng PL-05; CI đúng head chưa được xác minh.

## R5 · P2 · Regression R4 chọn nhầm nút nên PASS khi lỗi che nút vẫn tồn tại

- **Vị trí:** `apps/chat-web/tests/browser/planora-chat.spec.ts:275`.
- Selector kết hợp `#btn-tech-toggle`, text `Chi tiết kỹ thuật` và `Duyệt kế hoạch`, rồi gọi `.first()`. Trên mobile, thứ tự DOM khiến locator chọn `#btn-approve-plan`, không phải nút Chi tiết kỹ thuật ở cuối active card.
- **Bằng chứng RED/GREEN thực:** giữ nguyên file spec tại head, dùng Vite transform tạm ngoài repo để phục vụ đúng `shell.css` và `PlanoraConversationFeed.tsx` từ `128fab1d`. R3 fail đúng hành vi cuộn (`scrollTop=0`, cần `>300`), nhưng test R4 nguyên bản vẫn PASS.
- Probe riêng trên layout cũ xác nhận selector đó trả `btn-approve-plan`; nút Chi tiết kỹ thuật có đáy **662px**, footer bắt đầu **610px**, và hit-test tâm nút trả `TEXTAREA`. Lỗi R4 vì vậy vẫn hiện diện trong bản mutation dù test báo PASS. Wheel thêm còn đẩy document tới **218px**; kiểm `scrollTop===0` trước thao tác wheel không chứng minh document không có vùng cuộn phụ.
- **Cách sửa đã kiểm chứng:** dùng `page.locator('#btn-tech-toggle')` chính xác, giữ assertion vị trí và hit-test; nên thêm wheel/kiểm kích thước scroll document để khóa riêng phần scrollbar phụ. Chỉ sửa selector trong bản test tạm ngoài repo đã làm R4 fail trên layout cũ (`662 < 610` thất bại), và PASS trên head hiện tại. Toàn bộ bản spec tạm đã sửa selector: **16/16 PASS**, exit **0** trên head; bản mutation cũ **11 PASS / 5 FAIL**, exit **1** (4 R3 + 1 R4).
- Không áp dụng sửa này vào file của worker; coordinator chuyển finding cho tác giả.

## Kiểm chứng thực tế

Môi trường: sandbox mới hoàn toàn, PostgreSQL **18** cục bộ riêng tại port **55635**, DB `ati_v3`, API **30635**, web **42635**; không dùng DB/server runtime hay provider thật. Máy này có PostgreSQL 18; chưa chạy lại trên PostgreSQL 16.

| Lệnh / kiểm tra | Kết quả |
| --- | --- |
| `npm run typecheck:v3` | PASS, exit 0 |
| `npm test -w @wap/chat-web` | 100 file / 1115 test PASS, exit 0 |
| `npm run build:v3` | PASS, exit 0 |
| `node scripts/test-v3-web-build-security.mjs` | PASS, exit 0 |
| `node scripts/test-v3-browser.mjs planora-chat.spec.ts fe-02-routing-history.spec.ts fe-03b-new-conversation-race.spec.ts fe-05-cockpit.spec.ts` | 24 PASS / 1 FAIL, exit 1; PL-05 16/16 PASS, FE-03b 1/1 PASS, FE-05 4/4 PASS, FE-02 3/4 PASS |
| `node %TEMP%/pl05-r4-review/probe.mjs` | 45 kiểm tra browser PASS, exit 0 |
| `node %TEMP%/pl05-r4-review/states.mjs` | Đúng 1 composer ở cả 13 moment; hit-test 1024px đúng textarea; đổi moment giữ scrollTop 500, exit 0 |
| `node %TEMP%/pl05-r4-review/targeted.mjs` và `resize.mjs` | Mobile 375px: Notion ở settings click được sau wheel; footer 202px; ba nút Approve/Edit/Technical đều nhận pointer; document scrollTop giữ 0 sau wheel; composer giãn vẫn tự giữ feed gap 0, exit 0 |
| Mutation với spec gốc: `node node_modules/playwright/cli.js test --config %TEMP%/pl05-r4-review/red.playwright.config.mjs planora-chat.spec.ts --grep 'R3.*375x812 light\|R4'` | R3 FAIL đúng hành vi, R4 PASS sai ý nghĩa; 1 PASS / 1 FAIL, exit 1 |
| Spec tạm sửa locator, config `sensitivity-42637.config.mjs` / `sensitivity-42635.config.mjs` | Layout cũ: 11 PASS / 5 FAIL, exit 1; head: 16 PASS, exit 0 |

45 probe gồm bounded feed, append/stream tự theo đáy, giữ vị trí đọc cũ và moment transition, multiline spacing ở **1440/1024/768/375/320 × light/dark**; cuộn bình thường trên `/settings`, `/history`, `/account`, `/guide` ở **1440/375/320 × light/dark**; một composer/một nút gửi khi đổi preview → inline → drawer → quay lại dock.

Đã xem ảnh chat dài tại 1440 và 375 ở cả light/dark, settings mobile sau wheel, và ảnh multiline trước/sau mutation. R3/R4 hiện tại: technical button bottom **532px**, footer top **610px**, hit-test đúng nút, document scrollTop **0**. Các card/orbital/màu legacy chưa chuyển hết thuộc PL-06/07, không mở rộng scope tại vòng này.

## Lỗi FE-02 có từ baseline, không quy cho PL-05

`fe-02-routing-history.spec.ts:60` dùng region tên `Danh sách hội thoại` rồi tìm title; sidebar và drawer đều có title nên locator resolve hai phần tử. Chạy lại nguyên test `history cursor` trong worktree baseline `review-planora-pl-04-r2` đúng SHA `b9230b8b` cũng **FAIL cùng strict-mode violation**, exit 1. Coordinator cần giao scope locator theo dialog cho owner shell/history trước khi yêu cầu bộ browser đầy đủ xanh; không xóa assertion pagination/search/rename.

## Bằng chứng và giới hạn

- Artifact/log cục bộ: `C:/Users/Admin/AppData/Local/Temp/pl05-r4-review/`.
- Log chính: `browser.log`, `baseline-history.log`, `probe.log`, `states.log`, `targeted.log`, `resize.log`, `red.log`, `r4-corrected-red.log`, `r4-corrected-green.log`.
- Ảnh/số liệu: `artifacts/` (head), `artifacts-red/` (layout cũ), `artifacts/probe.json`, `artifacts/states.json`, `artifacts/targeted.json`.
- Lượt bootstrap đầu va port web của ứng dụng khác đã được bỏ và đổi sang port trống; không tính lỗi môi trường đó là RED.
- Console có cảnh báo ResizeObserver loop khi resize; các kiểm tra hình học/pointer/scroll nói trên vẫn đạt. Không dùng cảnh báo này làm finding chưa chứng minh tác động.
- **NOT_RUN:** full backend/eval `npm run check`, full browser mọi scenario, PostgreSQL 16, provider/OAuth/model live, CI/PR remote đúng head. Không claim các mục này PASS.
- Không sửa `CURRENT-STATE.md`, `ROADMAP.md` hay task card của worker; chỉ thêm log review này.
