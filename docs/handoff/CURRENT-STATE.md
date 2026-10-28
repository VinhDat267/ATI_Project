# Trạng thái hiện tại

**Cập nhật lần cuối:** 27/10/2026 (Asia/Saigon), sau merge [#176](https://github.com/VinhDat267/ATI_Project/pull/176) (`f616d01`) và [#177](https://github.com/VinhDat267/ATI_Project/pull/177) (`ae07723`). **#176: mã OAUTH-02 vào `main`**, Google Calendar "của riêng bạn" (`mycalendar`), sau cờ `MYCALENDAR_ENABLED` (**vẫn tắt**). Chưa đo bằng model thật, chưa nghiệm thu với Google thật. **#177** ghi #171, #174, #175 vào bàn giao; một reviewer khác sửa 1 P2 (câu "chưa có PR" của OAUTH-02 sai) và 2 P3.
- **Thiết kế** (đặc tả viết lại ngày 27/10 sau phiên brainstorm với nhóm trưởng, mục 7 "Chốt 27/10/2026 (OAUTH-02)"):
  - người dùng chọn những lịch ATI được dùng ngay trên màn callback; trước khi chọn, kết nối ở trạng thái `scope_required` và planner chưa có tool `mycalendar.*`;
  - 3 tool `mycalendar.list_calendars`, `list_events`, `create_event`, ngoài `ALL_TOOLS`; `calendarId` phải thuộc các lịch đã chọn; `create_event` luôn `sendUpdates=none`, không mời ai;
  - client OAuth ở **Google Cloud project riêng**. [Google](https://developers.google.com/identity/protocols/oauth2/web-server#tokenrevoke) thu hồi token cho mọi client trong cùng project, nên thiết kế bản 26/10 (client thứ hai trong project Gmail) là sai. Live chặn cùng project, cùng client.
- **Mã:** migration 0012; route `/api/connections/mycalendar` (start, callback, calendars, scope, DELETE) chép từ route Gmail; `PersonalCalendarAdapter`; `connections.mycalendar` (`credentialId`, `email`, `allowedCalendars`) gắn trước khi băm. Lúc thực thi phải đúng kết nối lúc xem trước, và các lịch lúc xem trước phải còn được chọn. Màn callback chọn lịch, `/settings#mycalendar`, màn từ chối, màn duyệt và biên nhận hiện tên lịch và tài khoản.
- **Review:**
  - một lượt review trước PR tại `c774af3` có 6 lỗi (F1–F6), sửa ở `2be4696`;
  - review độc lập tại `a379dd5` **Đạt sau khi sửa nhỏ**, 3 P3; 13/14 đột biến bị bắt;
  - theo yêu cầu nhóm trưởng, reviewer gộp `main` vào nhánh (`5363d06`) rồi sửa 3 P3 (`4ab61e1`);
  - một reviewer khác kiểm lại tại `e9f1dc3`: **Đạt sau khi sửa nhỏ**, 1 P3 ở chú thích (sandbox không tự chặn URL Google thật). Sửa ở `7f37f21`, chỉ đổi chú thích.
- **Merge:** nhóm trưởng cho merge tối 27/10, trước buổi quyết 29/10. Điều kiện "cờ Gmail đã bật" của OAUTH-02 chưa đạt, nhưng cờ tắt nên hệ thống không đổi. Việc **đưa OAUTH-02 vào phạm vi bảo vệ** vẫn quyết ngày 29/10. Cây merge bằng cây head cộng đúng 4 file tài liệu của #177.

Việc tiếp theo:
- GMAIL-04 (nhóm trưởng): nghiệm thu Google thật, rồi PR bật cờ trước 28/10;
- OAUTH-02 nếu đưa vào phạm vi bảo vệ: nhóm trưởng tạo Google Cloud project riêng cho Calendar, khai báo `MYCALENDAR_OAUTH_PROJECT_ID` và `GMAIL_OAUTH_PROJECT_ID`; đo `EVAL_SET=mycalendar` ×3; nghiệm thu P-LIVE; PR bật cờ trước 04/11;
- SCHED-04: bộ đo merge ngày 30/10 (trước 31/10 theo task card); đo 01/11; nghiệm thu thật 03/11; PR bật cờ trước 04/11;
- W4-03: chạy `report.ts` khi có phiếu; REPORT-01 bắt đầu từ 27/10.

[Log merge](log/2026-10-27-reviewer-merge-176.md).

**Cập nhật trước đó:** 27/10/2026 (Asia/Saigon), sau merge [#171](https://github.com/VinhDat267/ATI_Project/pull/171) (`f4ff636`): **SCHED-03 xong**, giao diện lịch chạy, sau cờ `SCHEDULES_ENABLED` (vẫn tắt mặc định). Cùng đợt: [#174](https://github.com/VinhDat267/ATI_Project/pull/174) (`88791d9`) ghi #172 và #173; [#175](https://github.com/VinhDat267/ATI_Project/pull/175) (`2888a9f`) ghi việc nhóm trưởng xác nhận assertion cũ của OAUTH-01.
- **SCHED-03** (`longnguyen005` thi công), khi cờ bật:
  - khoảnh khắc `schedule` trong cockpit: xác nhận, sửa, bỏ qua đề xuất; xem trạng thái lịch, tạm dừng, chạy tiếp, hủy, chạy lượt này ngay;
  - tin `schedule_run` hiện là `Lịch "<tên>" tự gửi lúc …`, không như người dùng tự gõ; lượt quá hạn hoặc lỗi có nút "Lập lại kế hoạch";
  - trang Nhật ký có mục "Lịch chạy"; tab Nhật ký và menu avatar có số lượt chờ duyệt.

  Cờ tắt thì giao diện không đổi và không gọi API lịch.
- **Review độc lập:**
  - lần 1 tại `490c6ae` **Đạt sau khi sửa nhỏ**, 3 P3: tin trạng thái lịch qua SSE thành bong bóng "ATI" rỗng; lần tải lại sau 409 giữ tin `working_memory` rỗng; thiếu test cho cách ngăn hội thoại hiện tin `schedule_run`. Long sửa ở `a661344`;
  - kiểm lại tại `91642f4` **Đạt**: 12/13 đột biến gốc bị bắt; R11 lọt là đột biến tương đương, vì nút đã `disabled` khi đang gửi.
- **Gộp `main`:** nhánh tách từ `c760aa3`, nên xung đột với #172 ở `Cockpit.tsx` và `scripts/test-v3-browser.mjs`. Theo yêu cầu nhóm trưởng, reviewer gộp `main` vào nhánh ở `ec2df5a` (merge, không rebase). Cây `ec2df5a` bằng cây bản gộp thử đã chạy check và browser.
- **Merge:** nhóm trưởng cho merge ngày 27/10, trước hạn 01/11. Cây merge bằng cây head.

Việc tiếp theo:
- GMAIL-04 (nhóm trưởng): nghiệm thu Google thật, rồi PR bật cờ trước 28/10;
- SCHED-04: bộ đo ý định, label commit trước mọi lời gọi model, merge ngày 30/10 (trước 31/10 theo task card); đo 01/11; nghiệm thu thật 03/11; PR bật cờ trước 04/11;
- W4-03: chạy `report.ts` khi có phiếu;
- OAUTH-02 đang review tại [#176](https://github.com/VinhDat267/ATI_Project/pull/176), mở ngày 27/10, nhánh `feat/oauth-02-personal-calendar`, worktree `ATI_Project-oauth02`; chưa merge. Mốc quyết định đưa OAUTH-02 và LAT-01 vào phạm vi bảo vệ vẫn là 29/10 theo FINISH-PLAN;
- REPORT-01 bắt đầu từ 27/10.

[Log merge](log/2026-10-27-reviewer-merge-171.md).

Trước đó, 26/10/2026 (Asia/Saigon), sau merge [#172](https://github.com/VinhDat267/ATI_Project/pull/172) (`13430d9`) và [#173](https://github.com/VinhDat267/ATI_Project/pull/173) (`907a2f0`). **#173**, chỉ tài liệu: [kế hoạch hoàn thành](FINISH-PLAN.md) tới 11/11, task card tuần 5–6 (DEMO-01, REPORT-01, SLIDES-01, VIDEO-01, REHEARSAL-01, LAT-01), đặc tả và task card OAUTH-02, và câu lệnh dán sẵn trong `PROMPTS.md` cho lúc không còn reviewer cũ. **#172: OAUTH-01 xong**, sau cờ `GMAIL_ENABLED` (vẫn tắt mặc định). Ở màn từ chối vì Gmail chưa kết nối, người dùng bấm "Kết nối Gmail", cấp quyền ở Google, quay về **đúng hội thoại đó**, rồi bấm "Gửi lại yêu cầu". Hệ thống không tự gửi lại; kế hoạch mới vẫn phải duyệt như thường.
- **Mã:**
  - migration 0011: cột `oauth_states.return_to`, chỉ cho state `connect_gmail`, chỉ dạng `/c/<uuid>` chữ thường;
  - `POST /api/connections/gmail/start` nhận `returnTo` tuỳ chọn, chỉ là hội thoại của chính người gọi; sai thì `400 RETURN_TO_INVALID` và không tạo state. Callback chỉ trả `returnTo` khi thành công, và lấy từ đúng state vừa dùng;
  - web: `RefusalMoment` bắt đầu kết nối với `returnTo` của hội thoại, đọc lại `GET /api/services` mỗi khi có màn từ chối mới, và hiện "Gửi lại yêu cầu" khi mọi dịch vụ còn thiếu đã dùng được. Trang callback kiểm lại mẫu `/c/<uuid>`; sai thì về `/settings#gmail` như cũ;
  - cờ tắt thì màn từ chối như bản trước.
- **Review độc lập** (log ở worktree của người review, không commit):
  - lần 1 tại `2c57d35` **chưa đạt**: P2, luồng mới vẫn bật khi `GMAIL_ENABLED=off`; P3, ràng buộc DB thiếu phần `mode = 'connect_gmail'`. Sửa ở `e04b5d8`, cùng lỗi OID chập chờn của `gmail-migration.test.ts`;
  - lần 2 tại `da32e65` **chưa đạt**: P2, ở 375 px nút "Gửi lại yêu cầu" nhận focus bằng Tab nhưng bị ô soạn tin cố định che. Sửa ở `7152540`: ba trang của cockpit (`app-stage`, `responses`, `errors`) chừa chỗ dưới `body` và đặt `scroll-padding-bottom` theo chiều cao ô soạn tin;
  - lần 3 tại `fc287ec` **Đạt**.
- **Merge:** reviewer thi công #172 và lập #173 theo yêu cầu nhóm trưởng; nhóm trưởng cho merge cả hai tối 26/10. Cây merge của #172 bằng cây head đã review; diff của merge #173 bằng diff của PR. #173 chưa có review độc lập.
- **Nhóm trưởng đã xác nhận (26/10):** PR sửa một assertion cũ của `gmail-migration.test.ts`, từ "đúng 2 ràng buộc có chữ `mode`" sang "đúng tập tên ba ràng buộc". Mục đích là để ràng buộc mới giữ đúng đặc tả 4.1. Review lần 2 thấy chỗ sửa phù hợp và không nới kiểm tra.

Việc tiếp theo:
- GMAIL-04 (nhóm trưởng): nghiệm thu Google thật, gồm cả luồng OAUTH-01 qua Google thật, rồi PR bật cờ trước 28/10;
- SCHED-03 #171 (`longnguyen005`): review độc lập lần 1 **Đạt sau khi sửa nhỏ**, còn 3 P3, chờ Long sửa rồi kiểm lại;
- ngày 29/10 nhóm trưởng quyết OAUTH-02 và LAT-01; mặc định bỏ cả hai ([FINISH-PLAN](FINISH-PLAN.md) mục 4);
- báo cáo cuối kỳ bắt đầu từ 27/10 (REPORT-01); thời lượng và hình thức buổi bảo vệ chờ nhóm trưởng điền ở SLIDES-01 và REHEARSAL-01;
- SCHED-04 sau SCHED-03; W4-03 chạy `report.ts` khi có phiếu.

[Log merge](log/2026-10-26-reviewer-merge-172-173.md).

Trước đó, 25/10/2026 (Asia/Saigon), sau merge [#166](https://github.com/VinhDat267/ATI_Project/pull/166) (`7bb752d`), [#169](https://github.com/VinhDat267/ATI_Project/pull/169) (`bd02c9d`), [#167](https://github.com/VinhDat267/ATI_Project/pull/167) (`95b1c46`) và [#168](https://github.com/VinhDat267/ATI_Project/pull/168) (`46b6a5b`). **Lịch chạy workflow phần 1–2 xong**: backend và planner, sau cờ `SCHEDULES_ENABLED` tắt mặc định. Cùng đợt có kế hoạch lịch chạy và kế hoạch OAuth.
- **#166**, kế hoạch lịch chạy, chỉ tài liệu: đặc tả, SCHED-common, SCHED-01 → 04. Mốc ngừng thêm tính năng dời sang 04/11 (mục 7 "Chốt 24–25/10").
- **#167, SCHED-01:**
  - migration 0010 (`schedules`, `schedule_runs`); tính giờ hẹn theo `APP_TIME_ZONE`;
  - bộ hẹn giờ nhịp 30 s: `SKIP LOCKED`, gộp lượt lỡ, tự tạm dừng sau 3 lượt quá hạn, lập kế hoạch tuần tự với hạn 180 s;
  - API `/api/schedules…`, đối soát lúc khởi động.

  Review độc lập lần 1 tại `3a9e4b1` **chưa đạt**, 2 P2: deadlock giữa xác nhận và nút tạm dừng; bật lại lịch đã xong vượt giới hạn 10 lịch. Sửa ở `2480261` (thứ tự khoá chung, kiểm giới hạn khi bật lại); review lại **Đạt**.
- **#168, SCHED-02:**
  - planner trả kiểu `schedule` khi cờ bật. Prompt khi cờ tắt, và ở lượt chạy, giống từng byte `main` trước đó;
  - `validateSchedule`; đề xuất lịch trong chat, với dịch vụ do router xác định;
  - lập kế hoạch cho lượt qua đúng đường chat; sandbox `schedule`.

  Review lần 1 tại `e390a5f` **chưa đạt** (3 P2, 1 P3); lần 2 tại `3c2c836` **chưa đạt** (1 P2: catalog rỗng); lần 3 tại `29fe222` **Đạt**. P3 prefetch ở câu tạo lịch đầu tiên được giữ làm giới hạn (mục 5).
- **#169**, kế hoạch OAuth, chỉ tài liệu: phạm vi hẹp, đặc tả và task card OAUTH-01 (mục 7 "Chốt 25/10/2026 (OAuth)").
- **Merge:**
  - reviewer thi công #167, #168 theo yêu cầu nhóm trưởng;
  - nhóm trưởng cho merge tối 25/10, sớm hơn mốc 26/10 ghi trong PR, vì toàn bộ nằm sau cờ tắt;
  - cây merge của #167 và #168 khác cây head đã review đúng bằng diff tài liệu của #169 (patch-id trùng).

Việc tiếp theo:
- SCHED-03 (giao diện, `longnguyen005`) trước 01/11. Xem đặc tả mục 6.4, 6.5, 6.7 và ghi chú trong task card về SSE `schedule_proposal` và tin `schedule_discarded`;
- OAUTH-01 (reviewer) trước 29/10; ngày 29/10 nhóm trưởng quyết OAUTH-02;
- SCHED-04 sau SCHED-03: bộ đo ý định, đo lại `core`/`services` khi bật cờ, nghiệm thu thật, PR bật cờ trước 04/11;
- GMAIL-04 (nhóm trưởng); W4-03: chạy `report.ts` khi có phiếu; quyết có làm task độ trễ không; task card tuần 5–6.

[Log merge](log/2026-10-25-reviewer-merge-166-169.md).

Trước đó, 24/10/2026 (Asia/Saigon), sau merge [#164](https://github.com/VinhDat267/ATI_Project/pull/164) (`1df2d35`): **W4-01 đo xong** trên 32 câu do bốn thành viên viết, mỗi người 8, mã `member-1` → `member-4`. Hai trong bốn người đã xem hoặc sửa prompt, nên bộ câu **không độc lập** như task card yêu cầu. Kết quả tách theo hai nhóm; repo không ghi mã nào thuộc nhóm nào.
- **Đăng ký:** label `2cdaf90` được commit trước lời gọi model đầu tiên. Không sửa label sau đó.
- **Kết quả** (yêu cầu `ag/gemini-3.8-flash`, phục vụ `gemini-3.8-flash-n`, hai cờ tắt, source `91cd5c1`):
  - `llm` ×3: **89/96**; tool 93,7%, tham số 100%; p50/p95 10,8/60,0 s; 74% dưới 15 s;
  - `regex` ×3: **37/96**. Bước tra tên bằng regex đọc sai cụm từ, và không có ID cho năm dịch vụ mới;
  - theo nhóm người viết (`llm`): nhóm đã xem prompt 47/48, nhóm chưa xem 42/48;
  - bộ 50 câu sau W3-10 (08/10, không cùng ngày): 150/150, p95 18,0 s.
- **Quá hạn:** một số câu làm model suy nghĩ 3.800–4.800 reasoning token (35–45 s), vượt deadline 30 s ở cả hai lần thử. Bốn lượt đầu dừng vì lỗi này và được giữ làm bằng chứng. Nhóm trưởng quyết định cách xử lý, và từ `91cd5c1` bộ chạy làm như sau:
  - câu quá hạn được chấm trượt, rồi chạy tiếp;
  - lỗi provider khác, hoặc 3 lần quá hạn liền nhau, vẫn làm dừng.
- **Câu trượt ở `llm`:** 4 lượt quá hạn, và `m4-07` ×3 (định tuyến từ khoá chỉ đưa Trello). Đều do planner; không thấy label sai.
- **Đo và review:**
  - reviewer đo trên máy nhóm trưởng tối 24/10, trong ba ngày thử W4-03; nhóm trưởng xác nhận tối đó không có lượt thử;
  - review độc lập lần 1 tại `15ac249` **chưa đạt**, 1 P2: câu không gọi model làm mất chuỗi quá hạn;
  - sửa ở `1e3db0b`; đếm lại theo log, số đo không đổi;
  - review lại **Đạt**; CI xanh đúng head;
  - nhóm trưởng cho merge ngày 24/10, sớm hơn mốc 26/10 ghi trong PR. PR không đổi mã sản phẩm.

Việc tiếp theo:
- W4-03: buổi thử kết thúc 25/10, sau đó chạy `report.ts`;
- GMAIL-04: nghiệm thu Google thật (phần 1–3), rồi PR bật cờ trước 28/10;
- nhóm trưởng quyết có làm task độ trễ không (thời gian suy nghĩ của model, deadline của app), trước mốc chốt tính năng 29/10;
- tuần cuối 05–11/11 (báo cáo, slide, video dự phòng, diễn tập) chưa có task card.

[Log merge](log/2026-10-24-reviewer-merge-164.md), [báo cáo đo](../ai-evidence/V3-GOLDEN-V2/2026-10-24-W4-01-REPORT.md).

Trước đó, 20/10/2026 (Asia/Saigon), sau merge [#161](https://github.com/VinhDat267/ATI_Project/pull/161) (`729577f`) và [#162](https://github.com/VinhDat267/ATI_Project/pull/162) (`6307962`): **FE-12 xong**. Mọi trang sau khi đăng nhập, kể cả cockpit, dùng một thanh điều hướng chung.
- **Thanh:**
  - logo bên trái;
  - 5 tab căn giữa: Không gian làm việc, Nhật ký, Kết nối dịch vụ, Cẩm nang, và Người dùng (chỉ admin thấy). Tab đang mở có `aria-current="page"` và gạch chân cam;
  - nút sáng/tối và avatar bên phải.
- **Theo độ rộng:** chữ đầy đủ từ 1280 px, rút gọn ở 900–1279 px. Dưới 900 px ẩn tab: trang con ghi tên trang cạnh logo, đi trang khác qua menu avatar (đủ 7 mục).
- **Cockpit:** "Lịch sử" và "Xem hội thoại" lên cụm phải. Câu "Yêu cầu hiện tại" rời thanh, thành dòng `Bạn nhờ: “…”` ngay trên tiêu đề, ở các khoảnh khắc 3–9, kết thúc không thành công và lập kế hoạch lâu. Không có dòng thứ hai dưới thanh.
- Cẩm nang và Chính sách an toàn dùng thanh mới khi đã đăng nhập; chưa đăng nhập vẫn dùng header cũ.
- **Hai PR:**
  - #161 lập kế hoạch, chỉ tài liệu;
  - #162 do reviewer thi công theo yêu cầu nhóm trưởng. Review độc lập lần 1 tại `71bb895` **chưa đạt**:
    - P2: câu yêu cầu liền ký tự làm màn đang thực thi rộng 2.568 px trên màn 375 px;
    - P3: trên cockpit của admin, tab lệch tâm 48 px ở 768 px.

    Sửa ở `ffc8952`; nhóm trưởng chốt hiện tab từ 900 px thay vì 768 px (mục 7). Review lại **Đạt**. CI xanh đúng head.

Việc tiếp theo:
- GMAIL-04: nghiệm thu Google thật qua giao diện (phần 1–3, nhóm trưởng thao tác), rồi PR bật cờ trước 28/10;
- W4-01 từ 22/10; W4-03 ngày 23–25/10 (cờ tắt) chạy trên giao diện đã có thanh FE-12;
- mốc chốt catalog 20/10: từ source đo W4-04 (`31166cb`) tới `6307962`, `packages/` và `prompts/` không đổi, nên không cần đo lại W4-04.

[Log merge](log/2026-10-20-reviewer-merge-161-162.md).

Trước đó, 18/10/2026 (Asia/Saigon), sau merge [#159](https://github.com/VinhDat267/ATI_Project/pull/159) (`778f22f`): **đo GMAIL-04, W4-02 và W4-04 bằng model thật xong** trên source `31166cb`: `gmail` ×3 59/60 (injection 9/9), `answers` ×3 27/30, kiểu trả lời bật `core` 50/50, `multiturn` ×3 36/36, W4-04 23/24 dưới 15 s. Hai câu trượt giữ điểm theo label: `gm04` lượt 3 do label, `an_ca01` do truy vấn `timeMax` (mục 5). Review lần 1 **chưa đạt** (1 P2 ở diễn giải `an_ca01`), review lại **Đạt**. [Log merge](log/2026-10-18-reviewer-merge-159.md), [báo cáo đo](../ai-evidence/V3-GOLDEN-V2/2026-10-18-GMAIL-04-W4-02-W4-04-REPORT.md). Trước đó cùng ngày, sau merge [#156](https://github.com/VinhDat267/ATI_Project/pull/156) (`f0e24f0`) và [#157](https://github.com/VinhDat267/ATI_Project/pull/157) (`efaafb2`): **#156 sửa test GMAIL-01 chập chờn** (thứ tự đọc trong PostgreSQL bằng `pg_blocking_pids`, không so lúc hai promise trả về) và **#157 bộ đo W4-02 xong** (`turns` dựng lịch sử như `chat-service`, 12 câu `cases-multiturn.json`, label đăng ký trước). Reviewer thi công theo yêu cầu nhóm trưởng. #156: review lần 1 **chưa đạt** (1 P2), review lại **Đạt**. #157: hai lần **chưa đạt** (P2 ở label, rồi ở scorer), review lại **Đạt**. CI xanh đúng head; không đổi mã sản phẩm. [Log merge](log/2026-10-18-reviewer-merge-156-157.md). Trước đó cùng ngày, sau merge [#154](https://github.com/VinhDat267/ATI_Project/pull/154) (`32d71fd`): **bộ đo của GMAIL-04 xong** (bước 2 và 3): `EVAL_SET=gmail` (20 câu, gồm 3 câu injection) và `EVAL_SET=answers` (10 câu) chạy với `ALL_TOOLS` + `GMAIL_TOOLS`, label đăng ký trước; scorer thêm luật người nhận cho mọi bước, `acceptKinds` và `found`; report ghi số ký tự prompt và độ trễ câu trả lời riêng. Reviewer thi công theo yêu cầu nhóm trưởng; review độc lập hai lần **chưa đạt** (P2 ở label), lần 3 **Đạt**; CI xanh đúng head `1ea3139`. [Log merge](log/2026-10-18-reviewer-merge-154.md). Trước đó cùng ngày, sau merge [#147](https://github.com/VinhDat267/ATI_Project/pull/147) (`6233637`): **GMAIL-03 xong**: giao diện Gmail riêng của từng người sau cờ `GMAIL_ENABLED` (nhóm "Của riêng bạn" ở `/settings`, callback một lần, "Gửi từ" và nguồn người nhận ở màn duyệt, trang công khai theo cờ). `longnguyen005` thi công, reviewer sửa theo review khi Long bận; review lần 1 có 1 P2 và 3 P3, hai lượt review lại, lượt cuối **Đạt**; CI xanh đúng head `5f3bb2f`. [Log merge](log/2026-10-18-reviewer-merge-147.md). Trước đó, 17/10/2026 (Asia/Saigon), sau merge [#149](https://github.com/VinhDat267/ATI_Project/pull/149) (`fb38a4d`), [#150](https://github.com/VinhDat267/ATI_Project/pull/150) (`98d880b`) và [#151](https://github.com/VinhDat267/ATI_Project/pull/151) (`ce59f4f`): **phần khung và công cụ của W4-03, W4-01, W4-04 xong**: giao thức và script báo cáo cho buổi thử, hướng dẫn và bộ kiểm cho bộ câu độc lập, chế độ đo latency 24 câu qua giao diện (luôn Hủy); các phép đo chưa chạy. Reviewer thi công theo yêu cầu nhóm trưởng; mỗi PR có review độc lập lần 1 **chưa đạt**, sửa một lượt, review lại **Đạt**; CI xanh đúng head. [Log merge](log/2026-10-17-reviewer-merge-149-150-151.md). Trước đó, 16/10/2026 (Asia/Saigon), sau merge [#146](https://github.com/VinhDat267/ATI_Project/pull/146) (`2960ab0`): **W3-11 xong**: năm service mới (Sheets, Calendar, Notion, Telegram, Jira) và một workflow Jira → Notion → Telegram → Slack chạy thật qua giao diện ở chế độ live với `ag/gemini-3.8-flash`, mỗi lệnh ghi chỉ chạy sau khi nhóm trưởng duyệt đúng mã băm; không phát hiện lỗi sản phẩm. Reviewer thi công theo yêu cầu nhóm trưởng; review độc lập lần 1 **chưa đạt** (1 P2 ở harness), review lại **Đạt**; CI xanh đúng head `be86948`. Cùng ngày, #145 (`87b31e3`) ghi #142 vào CURRENT-STATE và ROADMAP. [Log merge](log/2026-10-16-reviewer-merge-146.md). Trước đó cùng ngày, sau merge [#142](https://github.com/VinhDat267/ATI_Project/pull/142) (`96f9f09`): **ANS-01 xong**: kiểu phản hồi "trả lời" cho câu chỉ đọc, sau cờ `PLANNER_READ_ANSWERS` (tắt mặc định); `longnguyen005` thi công; review độc lập **Đạt** sau một lượt sửa thiếu test và rebase lên `main` có #143; CI xanh đúng head `1971cd0`. Cùng ngày, nhóm trưởng tạo Google Cloud project riêng cho Gmail (bước 1 của GMAIL-04). [Log merge](log/2026-10-16-reviewer-merge-142.md). Trước đó cùng ngày, sau merge [#143](https://github.com/VinhDat267/ATI_Project/pull/143) (`7c260c1`): **GMAIL-02 xong**: 10 tool Gmail (adapter HTTP thật và adapter giả cho sandbox), chặn người nhận bịa, nội dung thư không đi ra ngoài khối dữ liệu khi gửi cho model; sau cờ `GMAIL_ENABLED` (tắt mặc định). Nhóm trưởng thi công; review độc lập **Đạt** sau một lượt sửa P2 (thiếu test chống gửi trùng); CI xanh đúng head `57c4888`. [Log merge](log/2026-10-16-reviewer-merge-143.md). Trước đó, 14/10/2026 (Asia/Saigon), sau merge [#140](https://github.com/VinhDat267/ATI_Project/pull/140) (`8973a9e`): **GMAIL-01 xong**: phần backend của Gmail theo kết nối riêng của từng người, sau cờ `GMAIL_ENABLED` (tắt mặc định). Gồm migration 0009, route kết nối/ngắt kết nối, quản lý token, planner/executor theo người dùng, và kế hoạch gắn kết nối trước khi băm. Cờ tắt thì hệ thống không đổi: `ALL_TOOLS` 33 tool, `SERVICE_REGISTRY` 8 dịch vụ, routing 116 câu như cũ. Review độc lập lần 1 **chưa đạt** (3 P2); P2 số 1 và 2 đã sửa, review độc lập lại **Đạt**; P2 số 3 đã sửa, chỉ có kiểm RED/GREEN của bên thi công. CI xanh đúng head `2268d9f`. Chưa gọi Google thật; Gmail chưa vào planner cho tới GMAIL-02. Việc tiếp theo: nhóm trưởng làm [GMAIL-02](tasks/GMAIL-02-gmail-tools.md) (trước 21/10), W3-11, và tạo Google Cloud project cho Gmail (trước 21/10); `longnguyen005` làm ANS-01 rồi GMAIL-03 (API của GMAIL-01 đã có). [Log merge](log/2026-10-14-reviewer-merge-140.md). Trước đó cùng ngày, sau merge [#137](https://github.com/VinhDat267/ATI_Project/pull/137) (`ebc192d`): **W4-00b xong**. Validator từ chối tham chiếu bước viết thành chuỗi thường (`"Xem ${step_1.output.url}"` không bọc `$template`) và trả lỗi semantic để model sửa ở lượt thử lại. `longnguyen005` thi công; review độc lập **Đạt**, CI xanh đúng head `345b2c8`. Chưa đo với model thật; phép đo tham khảo với Luna do nhóm trưởng chạy, không phải gate. Trước đó cùng ngày, [#138](https://github.com/VinhDat267/ATI_Project/pull/138) (`6185b2c`) thêm đặc tả Gmail theo kết nối riêng và kiểu "trả lời" cùng 6 task card (mục 7 và ROADMAP). Việc tiếp theo: `longnguyen005` làm [ANS-01](tasks/ANS-01-read-answers.md); nhóm trưởng làm [GMAIL-01](tasks/GMAIL-01-personal-connection.md) (trước 18/10) và [W3-11](tasks/W3-11-new-services-through-frontend.md). [Log merge](log/2026-10-14-reviewer-merge-137.md). Trước đó, 13/10/2026 (Asia/Saigon), sau merge [#133](https://github.com/VinhDat267/ATI_Project/pull/133) (`6ee4109`): **W4-00 xong trong phạm vi task**, đường dự phòng thủ công `cx/gpt-6.1-sol` qua cùng 9router đã kiểm tới preview rồi Hủy; review độc lập Codex **Đạt**, CI xanh đúng head `2d80355`. Core **48/50 PARTIAL** do timeout/cancel; chưa có campaign core hoàn chỉnh hoặc gate latency core. Quota chưa rõ; chưa chạy ghi live bằng Codex, chưa nghiệm thu W3-11 và các phép đo tuần 4. Việc tiếp theo: [W3-11](tasks/W3-11-new-services-through-frontend.md) và chuẩn bị W4-01–04. [Log merge và giới hạn](log/2026-10-13-codex-W4-00-merge.md). Trước đó, 11/10/2026, sau merge [#129](https://github.com/VinhDat267/ATI_Project/pull/129) (`828c21a`): FE-11, dọn lỗi frontend (đăng nhập lại về đúng trang, ID sai định dạng trả 404, câu lỗi mạng/máy chủ đúng, `clarification.reason` có cấu trúc, các P3 còn mở) và sửa lỗi focus hộp đăng nhập có sẵn từ FE-08; `longnguyen005` thi công bằng Codex; review độc lập Claude Code **Đạt** sau một lượt sửa, CI xanh đúng head `daa023c`. **FE-11 xong** (phần D tuỳ chọn chưa làm). Commit của `longnguyen005` từ #129 trở đi gắn đúng tài khoản GitHub (trước đó email git sai). Trước đó, 10/10, #130 (`84a3461`) ghi #128; sau merge [#128](https://github.com/VinhDat267/ATI_Project/pull/128) (`e08e623`): FE-10, Cẩm nang, Chính sách an toàn, 404 và audit trợ năng tự động; `longnguyen005` thi công bằng Codex; review độc lập Claude Code **Đạt** sau một lượt sửa, CI xanh đúng head `88f12af`. **FE-10 xong trừ tiêu chí "Rà soát cuối"** (chụp lại FE-05b → FE-09 cạnh bản mẫu), ghi rõ là chưa làm; ba quyết định chờ người dùng (mục 5). Trước đó cùng ngày, #127 (`d319a32`) thêm task card FE-11 và giao `longnguyen005`; sau merge [#118](https://github.com/VinhDat267/ATI_Project/pull/118) (`d87c80e`): test giữ chốt `hydrateResponse`, đóng P3 thứ nhất của #116; review độc lập Claude Code **Đạt**, CI xanh đúng head tích hợp `24bea4f`. Cùng ngày: #124 (`8706eae`) giao FE-10 cho `longnguyen005` (Codex); #125 (`56e4c83`) ignore `docs/reports/` (báo cáo môn học) và `.github/agents`, `.github/hooks`; repo bật tự xoá nhánh khi merge, dọn 19 nhánh local/18 nhánh GitHub đã merge, giữ lịch sử chưa merge bằng tag `evidence/w3-10-control` (`7898aa7`), `archive/v2-pilot-fresh-holdout`, `archive/v2-pilot-uncommitted-wip`. Trước đó, 09/10/2026, sau merge [#120](https://github.com/VinhDat267/ATI_Project/pull/120) (`5c7bed4`, AUTH-07), [#121](https://github.com/VinhDat267/ATI_Project/pull/121) (`b4227de`, FE-08) và [#122](https://github.com/VinhDat267/ATI_Project/pull/122) (`c4f2170`, FE-09). **AUTH-07, FE-08 và FE-09 xong**, review độc lập đạt, CI xanh trên từng head tích hợp trước merge. Việc giao diện tiếp theo: FE-10. Trước đó:
- #119 (`129d9c0`): ghi #102 vào CURRENT-STATE và ROADMAP;
- #102 (`d40d735`): W3-10, yêu cầu chỉ đọc hỏi lại ngay, plan phải có bước ghi, đo từng lời gọi model và đo lại ba bộ golden. Mục tiêu p95 services dưới 15 s **chưa đạt** (20,1 s);
- #117 (`55b4a58`): ghi #116 vào CURRENT-STATE và ROADMAP;
- #116 (`572da6d`): FE-06 phần (b), màn từ chối, hỏi lại mở rộng và lỗi chung theo bản React. **FE-06 xong cả hai phần**;
- #115 (`e269743`): ghi kết quả chạy thử lập kế hoạch live sau #113;
- #114 (`ca7bc26`): ghi #113 vào CURRENT-STATE và ROADMAP;
- #113 (`6f65b0c`): planner chấp nhận tên `gemini-3.8-flash-n` mà 9router trả cho `ag/gemini-3.8-flash`, nên chế độ live lập kế hoạch được trở lại;
- #112 (`4afa2c2`): ghi #110, #111 vào CURRENT-STATE và ROADMAP;
- #111 (`06fdd09`): review độc lập và sửa phần sửa FE-06A của Claude Code;
- #110 (`c21afc0`): 5 P3 còn lại của FE-07. **FE-07 và FE-06 phần (a) xong cả phần dọn; FE-06 còn phần (b)**;
- #109 (`c37e2e9`): ghi #104 → #108 vào CURRENT-STATE và ROADMAP;
- #108 (`d5e7a9e`): FE-07, trang Kết nối dịch vụ theo bản React;
- #107 (`f796467`): FE-06 phần (a), khoảnh khắc 7–9 và màn kết thúc không thành công;
- #106 (`eb48f0b`): sửa ba test chập chờn và cổng DB mặc định của test `chat-api`;
- #105 (`564b6cb`): xoá thư mục `System Design/` thời v2;
- #104 (`34d1f53`): ghi #103 vào CURRENT-STATE và ROADMAP;
- #103 (`c7cf6e3`): FE-05b phần (b), cockpit khoảnh khắc 4–6, ô nhắn thêm, hai ngăn và hộp xem trước. **FE-05b xong**;
- #101 (`2f7b086`): ghi #98, #99, #100 vào CURRENT-STATE và ROADMAP;
- #100 (`8155c03`): FE-05b phần (a), thanh trên và khoảnh khắc 1–3;
- #98 (`7df8eac`): FE-04b, lớp nền của bản React trong app, trang 404 làm thử;
- #99 (`b41031d`): `DESIGN.md` ở gốc repo theo design system Agentic của 12 bản mẫu;
- #97 (`0cdb02a`): kế hoạch đưa thẳng bản React của bản mẫu vào app (đặc tả mục 1, 1.1, 1.2 viết lại, thêm FE-04b) và `docs/design/design-system.md`;
- PROTO-01 bước 4 #96 (`581addd`): cả 12 bản mẫu đã có bản React trong `docs/design/prototypes/react/`;
- PROTO-01 bước 1–3: #93 (`00e9c5f`), #94 (`852342c`), #95 (`458c5ad`);
- #92 (`18980ec`): bản mẫu là chuẩn hình thức, task card FE-05b;
- FE-05 #90 (`ee65cd0`): cockpit khoảnh khắc 1–6, ngăn hội thoại và ngăn lịch sử; review độc lập đạt, 2 lỗi P3 chuyển vào FE-05b;
- FE-04 #88 (`89d1999`) và UI-API-01 #86 (`210d3b6`): token/theme/shell và API cho giao diện mới;
- #84 (`ab0817e`) thêm kế hoạch giao diện mới (bản mẫu 12 trang, đặc tả, task card FE-04 → FE-10 và UI-API-01).

Agent cập nhật: reviewer (sau merge #176 và #177, 27/10). Lần trước: reviewer (sau merge #171, 27/10; sau merge #172 và #173, 26/10; sau merge #166, #169, #167, #168, 25/10; sau merge #164, 24/10; sau merge #161 và #162, 20/10; sau merge #159, 18/10; sau merge #156 và #157, 18/10; sau merge #154, 18/10; sau merge #147, 18/10; sau merge #149, #150, #151, 17/10; sau merge #146, 16/10; sau merge #142, 16/10; sau merge #143, 16/10; sau merge #140, 14/10; sau merge #138 và #137, 14/10); Codex, reviewer độc lập W4-00 (sau merge #133, 13/10); Claude Code (sau merge #129, 11/10; sau merge #128, 10/10).

> Đọc file này trước khi làm bất cứ việc gì. **Chỉ reviewer sửa file này**, sau khi merge một PR; agent thi công ghi kết quả vào task card và `log/`.
> `docs/PROJECT-REPORT.md` có số liệu cũ (ngày 29/09); khi hai file mâu thuẫn, tin file này và mã nguồn.

> **Trạng thái merge:** Tuần 2: W2-01 vào `main` qua PR #15 (thi công ở #16); W2-02 và W2-04 qua #18 (W2-04 ở #20); task card W2-05 qua #22; W2-05 qua #23 tại `1029e55`. W2-03 chưa làm. Không còn PR mở của tuần 2.
>
> **Kế hoạch tuần 3–4** vào `main` qua #25 tại `af82961`; #24 và #25 chỉ sửa tài liệu. Tiến độ bốn mảng:
> - **service mới:** W3-00b đã merge #71 và review độc lập đạt sau sửa P2; W3-09 đã merge và nghiệm thu chỉ đọc với Jira thật. Cả năm adapter mới đã merge, W3-06 đã đo model thật với fixtures, **W3-07 xong**: năm service mới và workflow 4 service đã chạy thật. **W3-10 xong #102** (policy chỉ đọc, đo từng lời gọi model, đo lại golden; services p95 20,1 s chưa đạt mục tiêu 15 s); **W3-11 xong #146** (năm service mới và workflow 4 service chạy thật qua giao diện ở chế độ live, 16/10); parity ff15 vẫn mở;
> - **tài khoản:** AUTH-01 → AUTH-07 và AUTH-02b đã merge; AUTH-07 #120 kiểm mật khẩu hiện tại khi gỡ Google, kiểm lại phiên/hash dưới khóa PostgreSQL. Gmail SMTP/Google thật đạt ở mốc AUTH-06, chưa nghiệm thu live lại trong AUTH-07;
> - **frontend:** FE-01 → FE-03, FE-03b, FE-04 và FE-05 đã merge; UI-API-01 đã merge. Giao diện Agentic có token/theme/shell và cockpit khoảnh khắc 1–6. Ngày 07/10 người dùng chốt **đưa thẳng bản React của bản mẫu vào app** ([PROTO-01](tasks/PROTO-01-prototypes-to-react.md), xong cả 4 bước #93 → #96): app theo Agentic đúng như 12 bản mẫu, bỏ các điều chỉnh riêng cho app của đặc tả (chữ tối thiểu 14px, nền `#F6F6F1`, token suy ra của FE-04). [FE-04b](tasks/FE-04b-prototype-foundation.md) (lớp nền) xong #98. [FE-05b](tasks/FE-05b-cockpit-visual-parity.md) xong: phần (a) #100 (thanh trên, dải thử nghiệm, khoảnh khắc 1–3, 2 P3 cuộn/focus), phần (b) #103 (khoảnh khắc 4–6, ô nhắn thêm, hai ngăn, hộp xem trước, thời lượng kiểu Việt). [FE-06](tasks/FE-06-cockpit-recovery-and-responses.md) xong: phần (a) #107 (khoảnh khắc 7–9, kết thúc không thành công, 5 P3 của #103), phần (b) #116 (từ chối, hỏi lại mở rộng, mất mạng, hết phiên, lập kế hoạch lâu, lỗi máy chủ). [FE-07](tasks/FE-07-service-connections-page.md) xong #108 (trang `/settings` theo bản React, thay `SettingsModal`). [FE-08](tasks/FE-08-landing-and-auth-screens.md) xong #121 (Landing và xác thực, gồm phản hồi pending/disabled/429 tại URL được bảo vệ). [FE-09](tasks/FE-09-account-users-history.md) xong #122 (Account, Users, History), dùng backend AUTH-07 #120. [FE-10](tasks/FE-10-guide-privacy-and-audit.md) xong #128 (Cẩm nang, Chính sách an toàn, 404, audit trợ năng tự động; chưa làm phần chụp lại FE-05b → FE-09 cạnh bản mẫu). [FE-11](tasks/FE-11-frontend-bugfixes.md) xong #129 (dọn lỗi frontend sau audit 10/10 và sửa focus hộp đăng nhập; phần D tuỳ chọn chưa làm);
> - **đánh giá:** W4-01 → W4-04.
>
> **FE-01 xong** qua #27 tại `9d262c6`; **W3-00 xong** qua #29 tại `c7a38c0`; **W3-01 xong** qua #30 tại `716f568`; **W3-02 xong** qua #31 tại `ab2c599`; **W3-03 xong** qua #32 tại `fca384d`; **W3-04 xong** qua #33 tại `4a4553b`; **W3-05 xong** qua #34 tại `dc80de4`; **W3-06 đo xong** qua #35 tại `a75ac35`, nhưng parity bộ cũ chưa đạt và nghiệm thu sản phẩm còn incomplete. `rf06` clarification đã được người dùng chốt trước commit/model call. **AUTH-01 xong** qua #41 tại `fbd993f`; **FE-02 xong** qua #42 tại `8b6c8e6`. AUTH-02/AUTH-03 và FE-03 đã merge; đăng ký email bật mặc định khi email được bật, live không SMTP tắt đăng ký email. AUTH-04 đã merge qua #66, AUTH-05 qua #68 và sửa sau review #73 tại `198fe6d`; W3-00b đã merge qua #71 tại `1200a3f`. W3-07 đã xong ngày 04/10 (xem đoạn dưới). Thứ tự và các mốc xem `ROADMAP.md`.
>
> **Audit độc lập W3** (Claude Code, #37 tại `4171298`): đạt có điều kiện. Chạy lại check 874 + 151, browser 14/14; mutation 19 lần chạy: 17 bị bắt, 1 lọt (Calendar 403), 1 không hợp lệ; probe HTTP + PostgreSQL không lộ bí mật, `siteUrl` Jira độc hại bị chặn. Lỗi trung bình: kết quả đọc không giới hạn kích thước. Task card **W3-08** nên xong trước W3-07 và các phép đo tuần 4.
>
> **W3-08 xong, review độc lập đạt:** bản đầu #39 tại `c5ce8a0`; hai P2 phát hiện sau merge đã sửa qua #45 tại `81225de` (code `d1bd367`, head `44873b0`). Ngân sách search bao gồm tool/args/error/metadata; hủy hoặc mất kết nối khi đọc body token Google trả NETWORK, JSON sai vẫn SERVER_ERROR. Check955+165 và browser20/20 đạt, CI đúng head xanh. Giới hạn áp dụng từng outcome, không phải toàn bộ lịch sử hội thoại; model/service thật chưa nghiệm thu lại.
>
> **AUTH-02, AUTH-03, FE-03 xong** qua #52 (`e578520`), #53 (`46cc6e6`), #54 (`9709a2d`); review của Claude Code: #53, #54 đạt; #52 đạt có điều kiện. P2 timing với SMTP chậm 800 ms (832 ms vs 6 ms) và yêu cầu SMTP khi khởi động live ở mốc #52 đã được sửa qua **AUTH-02b #61**; review độc lập ngày 04/10 đạt (xem dưới). Đăng ký bật mặc định khi email được bật; thiếu toàn bộ SMTP ở live thì server vẫn chạy và năm route email trả 503.
>
> **W3-07 xong** qua #48 (Telegram), #49 + #50 (Notion), #51 (workflow 4 service), #55 (Jira), #57 (Google Sheets, Calendar; merge `ff93cc9`). Mỗi lệnh ghi theo plan người dùng duyệt đúng hash, đọc lại bằng tool đọc; mỗi service có một ca lỗi xác thực thật. Chạy qua `evaluations/live-execution/run.ts`, **chưa** chạy qua frontend ở chế độ live. Ba lỗi sản phẩm chỉ lộ khi chạy thật: Notion host `app.notion.com` (đã sửa ở #49); Jira tìm chuỗi có dấu gạch ngang và token sai trả `NOT_FOUND` → **W3-09**. **FE-03b** (#58): test browser `FE-03: Shift Enter…` lúc đạt lúc không trên CI do race thật khi gửi tin ngay sau "Cuộc hội thoại mới"; #57 đỏ lần đầu vì lỗi này, chạy lại job thì xanh.
>
> **AUTH-02b review độc lập đạt:** #61 (`445d1b3`), 73/73 focused tests; native HTTP + PostgreSQL với sender chậm 800 ms có chênh lệch trung vị 1,38 ms (forgot) và 6,91 ms (resend). Sender reject/throw/treo không chặn phản hồi, không unhandled rejection; 31 cấu hình SMTP thiếu và 19 probe input/rate limit đạt. Live không SMTP khởi động, năm route email trả 503; SMTP thiếu một phần vẫn là lỗi cấu hình. Thư nền chưa bền qua process restart, chi phí DB hai nhánh chưa tương đương; SMTP thật chưa chạy trong review AUTH-02b; đã nghiệm thu ở AUTH-06 (xem dưới).
>
> **FE-03b review đạt sau sửa #64 (`965c8bc`):** review độc lập #60 bắt hai P2 (gửi sai hội thoại sau khi chọn c2; Enter lần hai xóa draft từ c1). New chuyển ngay về draft, gửi theo route đang chọn, response muộn không giành điều hướng; cleanup theo request ID khi rời Workspace, giữ metadata request đã gửi. Tạo mới lỗi giữ nội dung cũ và ownership hiện tại; tạo thành công thay mục history draft để Back về hội thoại trước. Native RED/GREEN, focused cuối45/45, independent13+2 probe, canonical browser26/26 và repeat40/40 đạt. Minor P3 history ở nhánh tạo lỗi còn mở (mục5).
>
> **W3-09 xong #63 (`f284b12`):** escape Lucene rồi JQL, tìm key bằng GET issue trong project allowlist trước text search; read404 gọi `/myself` tối đa một lần để phân biệt AUTH_ERROR, lệnh ghi không đổi. Review độc lập58/58 tests,29/29 native probes,6/6 base/head controls; CI xanh trên head mới `971c3b2` đã tích hợp #64. **Jira thật sau merge đạt, chỉ đọc:** `run.ts check` token giả exit1/AUTH_ERROR như kỳ vọng; query `W3-07` và key `ATIT-4` đều tìm thấy `ATIT-4`. Không gọi model hoặc ghi Jira.

> **AUTH-04 xong #66 (`5cc07ca`):** Google OIDC code + PKCE S256/state/nonce, kiểm ID token RS256/JWKS, state một lần trên PostgreSQL. Người mới verified/password NULL/pending; ghép đủ năm trường hợp, nhận lại email chưa xác minh thì xóa password và thu hồi phiên/token cũ. Link gắn phiên gốc; unlink cần password. Quota đăng ký chung email/Google 10/IP/giờ; Google signup theo cờ đăng ký độc lập với SMTP. Callback xóa query trước HTTP, phản hồi muộn không ghi đè phiên mới hoặc khôi phục logout. Review độc lập đạt, CI đúng head `b4029e9` xanh; tree merge bằng head đã kiểm. Check **1.188 v3 + 165 eval**, browser **27/27** qua 11 scenario, Google repeat **3/3**. Google/SMTP thật **NOT_RUN** tại mốc AUTH-04; đã nghiệm thu ở AUTH-06 (xem dưới); UI quản lý link/unlink thuộc AUTH-05.
>
> **AUTH-05 xong #68 (`dbc053f`), sửa sau review độc lập qua #73 (`198fe6d`):** trang `/account` và API `/api/account`; đổi mật khẩu thu hồi các phiên khác và link reset cũ, danh sách/thu hồi phiên, sửa hồ sơ, migration 0008 thêm `users.google_email`. Review bắt 2 P2 và 1 P3: link/unlink không phục hồi access token hết hạn, response lưu tên xóa draft mới, Google start đến muộn giành điều hướng. #73 dùng protected transport cho link/unlink, giữ draft và kiểm mount/user/session trước redirect; login/callback vẫn một lần, không retry mất kết nối/5xx. Native RED5fail/4pass → GREEN9/9, browser RED4fail → GREEN4/4; reviewer độc lập focused78/78, full frontend314/314, HTTP21/21 và negative controls đạt. Runner auth04 cấp cùng khóa JWT test cho API/worker nếu chưa đặt từ ngoài; review bổ sung guard2/2 và runner9/9 đạt. CI [37213086389](https://github.com/VinhDat267/ATI_Project/actions/runs/37213086389) SUCCESS trên head `4e469a1`, cây merge bằng head; check **1.245 v3 + 165 eval**, browser **32/32 qua 11 scenario**. Google account browser dùng OIDC giả; Google/SMTP thật đã nghiệm thu ở AUTH-06. Review delta không mở rộng bảo đảm hủy mutation backend đang chạy khi thu hồi phiên.

> **W3-00b xong #71 (`1200a3f`), review độc lập đạt sau sửa:** frontend lấy nhãn/tên/placeholder từ API, textarea multiline, câu từ chối nêu tên service chưa khả dụng; giữ chính sách routing. Review bắt P2 phản hồi lưu A xóa credentials B mới nhập; `ce690c0` chỉ xóa trường còn bằng snapshot đã gửi. RED HTTP native 2 fail/2 pass → GREEN 4/4, focused20/20; reviewer độc lập9/9 probe và negative control đạt. CI [37206491640](https://github.com/VinhDat267/ATI_Project/actions/runs/37206491640) SUCCESS trên head `e60e4b3`; cây merge bằng head đã kiểm. Check **1.236 v3 + 165 eval**, browser **28/28 qua 11 scenario**. Model/golden/service thật chưa đo lại; RED gốc thi công chỉ được tái dựng negative controls, RED mới P2 được quan sát trực tiếp trước sửa.

> **AUTH-06 xong #75 (`bfd824f`), 05/10:** Gmail thật xác minh → chờ duyệt → admin duyệt → thư duyệt/reset → reset và đăng nhập mật khẩu mới; người dùng xác nhận từ chối hai link đã dùng. Gmail UI kiểm ba tiêu đề/nội dung tiếng Việt và origin hai link `http://localhost:5174`, DB/API đối chiếu verified/pending/active/token consumed. Google mới → pending → approve200 → Google login vào Workspace; tài khoản mật khẩu gỡ/liên kết và Google login lại đạt. Gmail535/EAUTH vẫn signup200/thông báo chung; callback chưa đăng ký trả Google400/redirect_uri_mismatch trên trang provider, không gọi callback ATI. Review độc lập `3d414ff..ed7cafb` và delta `ed7cafb..df3b7e8` đạt; implementer/reviewer check1.245+165, [CI head df3b7e8](https://github.com/VinhDat267/ATI_Project/actions/runs/37222271347) SUCCESS, browser32/32 qua11scenario. Tree merge bằng head đã kiểm; bằng chứng riêng đã sao chép/đối chiếu SHA256, không commit. Password reset/login và one-use có bước do người dùng thực hiện; CI browser dùng OIDC giả, không thay bằng chứng provider thật. Không gọi model/ghi workflow dịch vụ; giữ các giới hạn gửi thư nền/timing/in-flight. Xem [log merge](log/2026-10-05-codex-AUTH-06-merge.md).

## 1. Sản phẩm

Đề tài môn ATI (thay khóa luận): **AI Workflow Automation Platform**. Người dùng mô tả công việc bằng một câu chat; AI chọn tool, lập plan nhiều bước, người dùng duyệt, hệ thống có adapter cho Trello, Slack, GitHub, Google Sheets, Google Calendar, Notion, Telegram và Jira. Năm service mới đã chạy thật có kiểm soát ở W3-07 (04/10) và qua giao diện ở chế độ live ở W3-11 (16/10). Mục tiêu: một câu chat thay 4–5 thao tác thủ công trên ít nhất hai hệ thống.

- Khởi động dự án 10/09/2026. Giữa kỳ nộp 30/09. Cuối kỳ (nộp + bảo vệ) dự kiến khoảng 11/11/2026.
- Báo cáo môn học chỉ lưu ở máy nhóm trưởng, không commit lên repo công khai.

## 2. Kiến trúc (v3)

| Thư mục | Vai trò |
|---|---|
| `apps/chat-web` | Frontend React 19, Vite, Tailwind, Zustand. Trang giới thiệu, đăng nhập, chat, plan preview, execution progress. Khi Gmail bật: nhóm "Của riêng bạn" ở `/settings`, callback `/connections/gmail/callback`, "Gửi từ" và nguồn người nhận ở màn duyệt; tool tra qua `services/tool-definitions.ts` (gồm `GMAIL_TOOLS`) |
| `apps/chat-api` | Backend Express 5: JWT, hội thoại, approval (hash SHA-256, hạn 30 phút), thực thi, SSE. Khi `SCHEDULES_ENABLED=on` và có PostgreSQL: lịch chạy (`services/schedules/`: bộ hẹn giờ, xác nhận đề xuất, trạng thái lượt suy ra từ kế hoạch), API `/api/schedules`, `ChatService` lưu đề xuất lịch và lập kế hoạch cho từng lượt (`planScheduledRun`) |
| `packages/planner` | Router (keyword rule), prefetch resource directory, model tự gọi search tool, validator 5 lớp (JSON, schema, semantic, an toàn, grounding). Khi Gmail bật: người nhận phải là chuỗi viết thẳng, có trong câu người dùng hoặc trong người tham gia của luồng đã tra; tiêu đề thư giữ ở `__labels`, không gửi cho model. Khi `PLANNER_READ_ANSWERS=on` (chế độ `llm`): câu chỉ đọc được tra cứu rồi trả `kind: "answer"`; chỉ nhận khi lượt đó có ít nhất một lần đọc thành công hoặc một danh mục prefetch thành công. Khi `schedules` bật: mục prompt `### Scheduled workflows` (không có ở lượt chạy theo lịch), kiểu `schedule` qua `validateSchedule`, `routeSchedule`; `nextOccurrence` dùng chung với bộ hẹn giờ |
| `packages/executor` | Resolve `$ref`/`$template`, chạy tuần tự, timeout qua AbortSignal, trạng thái `unknown` cho lệnh ghi không rõ kết quả; lỗi lệnh ghi có `details.requestSent === false` (chưa gửi request) là `failed` |
| `packages/tool-schemas` | Catalog 33 tool/8 service: Trello 9, Slack 2, GitHub 5, Sheets 4, Calendar 3, Notion 4, Telegram 2, Jira 4 (19 read, 14 write). `GMAIL_TOOLS` (10 tool) và `GMAIL_SERVICE` export riêng, ngoài catalog, chỉ dùng khi `GMAIL_ENABLED=on`. `MYCALENDAR_TOOLS` (3 tool) và `MYCALENDAR_SERVICE` cũng export riêng, chỉ dùng khi `MYCALENDAR_ENABLED=on` và người gọi đã chọn ít nhất một lịch |
| `packages/tool-adapters` | Adapter gọi API thật, allowed scope, rate limit, chuẩn hóa lỗi. Adapter Gmail (`src/gmail/`) dùng token của từng người, không có allowlist chung |
| `db/v3` | 13 bảng nghiệp vụ PostgreSQL, gồm phiên đăng nhập, lịch sử hash refresh token, auth token, outbox, oauth_states, `schedules` và `schedule_runs`; migrations 0001–0012 (0009: Gmail riêng của từng người; 0010: lịch chạy; 0011: `oauth_states.return_to` của OAUTH-01; 0012: `connect_mycalendar` và `service_credentials` cho `mycalendar` của OAUTH-02) |
| `evaluations/` | Golden set v2 (50 câu + 18 câu tự do + 44 câu services, cùng các bộ Gmail, trả lời, nhiều lượt), bộ W4-01 32 câu do thành viên viết (`golden-independent/`), công cụ chạy thật có kiểm soát (`live-execution/`, `live-app/`) |

Mã và tài liệu v1/v2 (`apps/api`, `apps/web`, `apps/mcp-task-hub`, `packages/dsl`, `packages/engine`, `packages/db`, `db/migrations` và báo cáo/bằng chứng đi kèm) đã xoá khỏi `main` ngày 05/10 qua #80. Ảnh chụp trước khi xoá là tag `archive/v2-final` (`badccb3`); đọc lại bằng `git show archive/v2-final:<đường dẫn>`.

## 3. Số liệu mới nhất

Sau #176 (merge 27/10/2026):
- **CI:** [CI #176](https://github.com/VinhDat267/ATI_Project/actions/runs/40538791965) SUCCESS đúng head `7f37f21`, gồm check và browser. CI `main` sau merge [SUCCESS](https://github.com/VinhDat267/ATI_Project/actions/runs/40541874778) đúng `f616d01`, cùng số.
- **Reviewer**, PostgreSQL 16 tmpfs riêng ở 56533, dựng lại sạch trước mỗi lượt; sandbox:
  - tại `a379dd5` (trước khi gộp `main`): check **2.341 v3 + 406 eval**, browser **134 pass/1 skip, 14 nhóm** (`mycalendar` 7);
  - bản gộp thử với `main` (cây bằng `5363d06`): check 2.384 + 406, browser 157/1;
  - tại `e9f1dc3` (sau khi sửa 3 P3): `npm run check` exit 0, 65 + 425 + 378 + 42 + **616** + **860** = **2.386 v3** + **406 eval**; browser exit 0 ngay lượt đầu, **157 pass/1 skip, 15 nhóm** (default 95, `gmail` 10, `mycalendar` 7, `schedule` 22).
- **Reviewer khác** kiểm lại tại `e9f1dc3`: 30/30 test liên quan, typecheck API, `git diff --check`; ca `$ref` bắt được M6; `sandbox/index.ts` trùng từng byte với `2888a9f`. `7f37f21` chỉ đổi chú thích và log.
- Cây merge `f616d01` bằng cây head `7f37f21` cộng đúng 4 file tài liệu của #177. Không gọi model hay Google thật.

Sau #171 (merge 27/10/2026):
- **CI:** [CI #171](https://github.com/VinhDat267/ATI_Project/actions/runs/40462770139) SUCCESS đúng head `ec2df5a` (đã gộp `main`), gồm check và browser. CI `main` sau merge [SUCCESS](https://github.com/VinhDat267/ATI_Project/actions/runs/40463609040) đúng `f4ff636`, cùng số.
- **Bản gộp thử của reviewer**, cây bằng cây `ec2df5a`; PostgreSQL 16 tạm riêng ở 56533, dựng lại sạch trước mỗi lượt:
  - `npm run check` exit 0: 63 + 408 + 359 + 42 + 554 + **835** web = **2.261 v3** + **394 eval**. Web thêm 43 test lịch chạy;
  - browser lượt 1 exit 1 ở nhóm `auth04`: ca chập chờn `AUTH-04: Google signup…` (mục 5). Chạy lại từ `auth04` trên DB mới thì exit 0. Gộp hai lượt: **149 pass/1 skip, 14 nhóm** (default 94, có ca `SCHED-03 off:`; `schedule` 22, `SCHEDULES_ENABLED=on`).
- **Bên thi công** tại `91642f4`: web 816/816; browser `schedule` 22/22, cờ tắt 1/1; 5/5 đột biến mới.
- Cây merge `f4ff636` bằng cây head `ec2df5a`. Các phép kiểm dùng planner sandbox; Google OIDC và Gmail dùng fixture HTTP. Bộ browser đầy đủ vẫn có ca FE-07 kiểm tra kết nối Notion thật bằng token giả (giới hạn mục 5). Nghiệm thu lịch chạy với model và dịch vụ thật thuộc SCHED-04, chưa chạy.

Sau #172 (merge 26/10/2026):
- **CI:** [CI #172](https://github.com/VinhDat267/ATI_Project/actions/runs/40326352126) SUCCESS đúng head `fc287ec`, gồm check và browser: **2.218 v3** (63 + 408 + 359 + 42 + **554** + **792** web) **+ 394 eval**; browser **126 pass/1 skip, 13 nhóm** (nhóm `gmail` từ 4 lên 10: 4 GMAIL-03 và 6 OAUTH-01). `chat-api` thêm 7 test, web thêm 19; eval không đổi. CI `main` sau #172 [SUCCESS](https://github.com/VinhDat267/ATI_Project/actions/runs/40357282987) đúng `13430d9`; sau #173 [SUCCESS](https://github.com/VinhDat267/ATI_Project/actions/runs/40358587698) đúng `907a2f0`, cùng số. #173 chỉ sửa tài liệu.
- **Bên thi công** (reviewer), PostgreSQL 16 tạm riêng ở 56533, sandbox, browser ở cổng riêng (API 3999, web 5199):
  - mỗi lượt sửa có RED trước;
  - lần cuối tại `fc287ec`: check 2.218 + 394, browser exit 0 ngay lượt đầu, 126/1;
  - đột biến 26/26 ở vitest, O19 ở browser, và 1 đột biến CSS của lần sửa 2.
- **Review độc lập lần 3** tại `fc287ec`:
  - probe Tab của lượt trước đạt 1/1; nhóm Gmail/OAuth 10/10;
  - màn trả lời, hai dạng hỏi lại mở rộng và lỗi lập kế hoạch đạt 16/16 tổ hợp ở 1440/375, sáng/tối, với ô soạn tin rỗng và nhiều dòng;
  - web 792/792; typecheck và build exit 0; 2/2 đột biến CSS bị bắt.

  Một lượt probe bổ sung gặp trang trống lúc tải; chạy lại thì đạt 4/4, có ghi trong báo cáo review.
- **Cây merge** `13430d9` bằng cây head `fc287ec`. Không gọi Google hay model thật.

Sau #166 → #169 (merge 25/10/2026):
- **CI trên PR:**
  - [CI #167](https://github.com/VinhDat267/ATI_Project/actions/runs/40179724562) SUCCESS đúng head `2480261`;
  - [CI #168](https://github.com/VinhDat267/ATI_Project/actions/runs/40195801762) SUCCESS đúng head `29fe222`;
  - [CI #169](https://github.com/VinhDat267/ATI_Project/actions/runs/40191700027) SUCCESS đúng head `8d57d43`.

  Mỗi run gồm check và browser. Sau #168: **2.192 v3** (63 + 408 + **359** + 42 + **547** + 773 web) **+ 394 eval**; browser **120 pass/1 skip, 13 nhóm**. Planner thêm 68 test, `chat-api` thêm 82; web, eval và browser không đổi, vì cờ tắt và không có giao diện mới.
- **CI `main`:** sau #166 [SUCCESS](https://github.com/VinhDat267/ATI_Project/actions/runs/40170087714) đúng `7bb752d`; sau #169 [SUCCESS](https://github.com/VinhDat267/ATI_Project/actions/runs/40196830229) đúng `bd02c9d`, sau #167 [SUCCESS](https://github.com/VinhDat267/ATI_Project/actions/runs/40197054015) đúng `95b1c46`, sau #168 [SUCCESS](https://github.com/VinhDat267/ATI_Project/actions/runs/40197072743) đúng `46b6a5b`, gồm check và browser.
- **Bên thi công** (reviewer), PostgreSQL 16 tạm riêng ở 56533, sandbox; browser chạy ở cổng riêng (API 3999, web 5199):
  - SCHED-01, lần cuối tại `2480261`: check 2.109 + 394, browser 120/1; đột biến 14/14 khi thi công, 7/7 cho phần sửa;
  - SCHED-02, lần cuối tại `29fe222`: check 2.192 + 394, browser 120/1; đột biến 30/30. Mốc SHA-256 của prompt được chụp trên mã chưa sửa, khi planner còn giống hệt `main`.
- **Review độc lập:** chạy ở worktree riêng của người review, mỗi lượt đều chạy check và browser, có probe trên PostgreSQL thật. Lượt check đầu của #167 lần 2 gặp timeout ở `evaluations/generic-plumbing/static-guard.test.ts` (mục 5); chạy lại thì đạt.
- **Cây merge:** cây `95b1c46` và `46b6a5b` khác cây head đã review đúng bằng diff tài liệu của #169 (patch-id trùng); cây `bd02c9d` bằng cây head `8d57d43`. Không gọi model hay dịch vụ thật.

Sau #164 (merge 24/10/2026): [CI #164](https://github.com/VinhDat267/ATI_Project/actions/runs/40108857431) SUCCESS đúng head `1e3db0b`, gồm check và browser: **2.042 v3** (không đổi) **+ 394 eval** (thêm 5 test của quy tắc dừng: 3 ở `91cd5c1`, 2 ở `1e3db0b`); browser **120 pass/1 skip**. [CI `main` sau #164](https://github.com/VinhDat267/ATI_Project/actions/runs/40109633906) SUCCESS đúng `1df2d35`, cùng số.
- **Bên thi công** (reviewer), ở worktree riêng:
  - test runner RED 4 fail rồi GREEN 18/18 (`91cd5c1`); RED 2 fail rồi GREEN 20/20 (`1e3db0b`);
  - golden-v2 và golden-independent 315/315, sau đó `vitest run evaluations` 394/394. Lượt sau chạy khi container DB dev đang mở ở 55533, nên hai file test đã tạo rồi xoá schema tạm trong DB dev (mục 6). Kiểm lại thì chỉ còn schema `public`;
  - typecheck `golden-v2`, `golden-independent` exit 0; đột biến 2/2;
  - không chạy `npm run check` hay browser ở máy.
- **Review độc lập:**
  - lần 1 tại `15ac249`: `test:eval:v3` 392/392, typecheck exit 0, chấm lại sáu report từ response đã lưu khớp từng số, 193/193 response qua `validatePlan`, tái hiện được P2;
  - review lại tại `1e3db0b`: 394 eval, 2.042 v3, typecheck và build đạt; 2 test hồi quy bắt được lỗi cũ khi đột biến. Lượt chạy song song đầu gặp lỗi OID ở `gmail-migration.test.ts` (mục 5); chạy lại chat-api tuần tự 465/465.
- Cây merge `1df2d35` bằng cây head `1e3db0b`. Lượt đo W4-01 ở dòng ngày 24/10 của bảng dưới.

Sau #161 và #162 (merge 20/10/2026): [CI #162](https://github.com/VinhDat267/ATI_Project/actions/runs/39423071441) SUCCESS đúng head `ffc8952`, gồm check và browser: **2.042 v3** (63 + 408 + 291 + 42 + 465 + 773 web) **+ 389 eval**; browser **120 pass/1 skip có chủ đích qua 13 nhóm** (default 93). [CI #161](https://github.com/VinhDat267/ATI_Project/actions/runs/39212908778) SUCCESS đúng head `3d69457`. [CI `main` sau #161](https://github.com/VinhDat267/ATI_Project/actions/runs/39423577073) SUCCESS đúng `729577f`; [CI `main` sau #162](https://github.com/VinhDat267/ATI_Project/actions/runs/39428454095) SUCCESS đúng `6307962`, cùng số.
- **Bên thi công** (reviewer), PostgreSQL 16 tạm riêng ở 55533, sandbox:
  - tại `71bb895`: `npm run check` exit 0, 2.042 + 389. Browser lượt 1 exit 1: 4 ca FE-05 fail do lỗi của chính bên thi công khi sửa test (chú thích `//` chèn giữa một dòng nhiều lệnh); lượt 2 exit 0, 119 pass/1 skip. Đột biến unit 8/8, browser 2/3 (1 đột biến tương đương);
  - tại `ffc8952`: RED 2/2 đúng số của review; check exit 0 cùng số; browser exit 0 ngay lượt đầu, 120 pass/1 skip; đột biến 4/4.
- **Review độc lập:**
  - lần 1 tại `71bb895`: check 2.042 + 389, browser 119/1 skip; probe bổ sung tái hiện được hai lỗi; kiểm SHA-256 bộ ảnh 108/108;
  - review lại tại `ffc8952`: check cùng số, browser 120/1 skip, 2/2 đột biến bị bắt, probe Chromium 1/1.
- Cây merge `729577f` bằng cây head `3d69457`; cây merge `6307962` bằng cây head `ffc8952`. Không gọi model hay dịch vụ thật.

Sau #159 (merge 18/10/2026): [CI #159](https://github.com/VinhDat267/ATI_Project/actions/runs/39107355845) SUCCESS đúng head `ae0b4a4`, gồm check và browser. Số test không đổi (**2.014 v3 + 389 eval**), vì PR chỉ thêm report và tài liệu. [CI `main` sau #159](https://github.com/VinhDat267/ATI_Project/actions/runs/39114210517) SUCCESS đúng `778f22f`, cùng số; browser 115 pass/1 skip.
- **Review độc lập lần 1** tại `d2a1b89`:
  - `npm run check` ở máy exit 0, 2.014 + 389, trên PostgreSQL 16 tạm riêng;
  - chấm lại **264 kết quả** bằng scorer hiện tại và dựng lại thống kê sáu report: khớp;
  - 12/12 file report khớp bản gốc.
- **Review lại** tại `ae0b4a4`: chạy lại probe biên ngày qua `fixtureSearch` (sự kiện 23:59:59 chỉ thêm trong bộ nhớ của tiến trình kiểm) và chấm lại 264 kết quả; không chạy lại toàn suite.
- Cây merge `778f22f` bằng cây head `ae0b4a4`. Kết quả đo ở hai dòng ngày 18/10 của bảng dưới.

Sau #156 và #157 (merge 18/10/2026): [CI #156](https://github.com/VinhDat267/ATI_Project/actions/runs/39097199834) SUCCESS đúng head `e2a2dc8`; [CI #157](https://github.com/VinhDat267/ATI_Project/actions/runs/39099885258) SUCCESS đúng head `54f96b3`, gồm check và browser. Kết quả: **2.014 v3 + 389 eval**; browser 115 pass/1 skip. [CI `main` sau #156](https://github.com/VinhDat267/ATI_Project/actions/runs/39100535870) SUCCESS đúng `f0e24f0`; [sau #157](https://github.com/VinhDat267/ATI_Project/actions/runs/39100650641) SUCCESS đúng `efaafb2`, cùng số.
- **#156:**
  - bên thi công: `npm run check` exit 0 (2.014 + 332) cả hai lượt;
  - tái hiện nguyên nhân (phần lưu trả về chậm 300 ms): test cũ 2/2 fail, test mới 2/2 đạt;
  - đột biến bỏ khoá phiên hoặc khoá `users`: mỗi đột biến chỉ làm fail đúng ca của nó;
  - chạy lặp 20/20; có tiến trình mồi thì cách chọn PID cũ fail 2/2;
  - reviewer độc lập chạy lại cùng các phép thử.
- **#157:**
  - bên thi công: check exit 0 với 2.014 + 353, rồi 2.014 + 366; đột biến 10/10 (5 runner, 5 label);
  - bên sửa lượt cuối: check exit 0 với 2.014 + 389, 3/3 đột biến scorer, browser Gmail 4/4. Lượt check đầu của lần đó dừng ở timeout 5 s của `fe-04-shell.test.tsx` (ngoài diff, chạy riêng 10/10), xem mục 5;
  - reviewer độc lập lượt cuối chạy lại 67/67 test tập trung; browser chỉ đọc log, không tự chạy lại.
- Merge `f0e24f0` (#156) có cây bằng cây head `e2a2dc8`. Merge `efaafb2` (#157) khác cây head `54f96b3` đúng bằng diff của #156. Không gọi model hay Google thật.

Sau #154 (merge 18/10/2026): [CI #154](https://github.com/VinhDat267/ATI_Project/actions/runs/39091082328) SUCCESS đúng head `1ea3139`, gồm check và browser. Kết quả: **2.014 v3 + 332 eval**, số v3 không đổi vì PR chỉ sửa `evaluations/`. [CI `main` sau #154](https://github.com/VinhDat267/ATI_Project/actions/runs/39091798070) SUCCESS đúng `32d71fd`, cùng số; browser 115 pass/1 skip qua 13 nhóm.
- **Bên thi công:**
  - `npm run check` ở máy sau mỗi lượt: bản đầu lần 1 exit 1, do ca chạy khô thừa hưởng `PLANNER_READ_ANSWERS` của shell; sửa ở test (`7373a95`), lần 2 exit 0 với 2.014 + 327. Sau các lượt sửa review: 2.014 + 330, rồi 2.014 + 332, đều exit 0 ngay lần đầu;
  - đột biến: 19/19, rồi 22/22, rồi 26/26.
- **Reviewer độc lập** chạy lại check ở máy mỗi lượt, cùng số. Đột biến riêng mỗi lượt: 5/5, 5/5 và 6/6; lượt cuối thêm 57/57 test mới đạt sau khi khôi phục.
- Cây merge `32d71fd` bằng cây head `1ea3139`. Không gọi model hay Google thật.

Sau #147 (merge 18/10/2026): [CI #147](https://github.com/VinhDat267/ATI_Project/actions/runs/39055601267) SUCCESS đúng head `5f3bb2f`. Kết quả: **2.014 v3** (63 schema + 408 adapter + 291 planner + 42 executor + 465 API + 745 web) **+ 275 eval**; browser **115 pass/1 skip có chủ đích qua 13 nhóm** (default 88, gmail 4). [CI `main` sau #147](https://github.com/VinhDat267/ATI_Project/actions/runs/39081747075) SUCCESS đúng `6233637`, cùng số.
- **Bên thi công**, tại `a2d622e` (trước gộp #149–#151): `npm run check` exit 0, 1.996 + 173. Hai lượt trước đó exit 1, đều vì test GMAIL-01 chập chờn (mục 5). Browser lượt đầu exit 1 ở ca FE-07 thành viên kiểm Notion; lượt sau exit 0, 110 pass/1 skip.
- **Review độc lập lần 1**, tại `a2d622e`: check và browser exit 0 ngay lượt đầu, cùng số trên; 11/16 đột biến bị bắt (G5, G11 lọt, thành P3).
- **Reviewer sửa**, tại `9c46f89`: `npm run check` exit 0 ở lượt 2 (lượt 1 gặp test GMAIL-01), 2.014 + 275; browser 115/1 skip; 12/12 đột biến bị bắt.
- **Review lại**, tại `9c46f89`: check exit 0 ngay lượt đầu, browser 115/1 skip, 4/4 đột biến bị bắt.
- **Sửa P3**, tại `5f3bb2f`:
  - nhóm `gmail`: RED 4/4 fail ở thẻ duyệt, rồi 4/4 fail ở biên nhận, rồi GREEN 4/4;
  - browser toàn bộ: lượt 1 exit 1 ở ca FE-07 hết 30 s chờ `/login` (mục 5); lượt 2 exit 0, 115/1 skip;
  - review lại phần sửa: web 745/745, nhóm `gmail` 4/4, 2/2 đột biến bị bắt.
- Cây merge `6233637` khác cây head `5f3bb2f` đúng bằng diff của #152, chỉ gồm tài liệu bàn giao. Không gọi Google hay model.

Sau #149, #150, #151 (merge 17/10/2026): CI `main` SUCCESS trên cả ba commit merge ([`fb38a4d`](https://github.com/VinhDat267/ATI_Project/actions/runs/39035444725), [`98d880b`](https://github.com/VinhDat267/ATI_Project/actions/runs/39035484133), [`ce59f4f`](https://github.com/VinhDat267/ATI_Project/actions/runs/39035510182)). Trên `ce59f4f`: **1.953 v3 + 275 eval**, browser **110 pass/1 skip có chủ đích qua 12 nhóm**.
- Bên thi công chạy `npm run check` ở máy trên từng head đã sửa, đều exit 0: 1.953 + 201 (#149), 1.953 + 221 (#150), 1.953 + 199 (#151). Đột biến: 17/17 (#149), 30/30 (#150), 19/19 (#151).
- Reviewer độc lập chạy lại ở máy trên từng head: `npm run check` exit 0 cùng số; 3/3 đột biến riêng mỗi PR bị bắt; với #151, browser 5/5 cho các ca W4-04.
- Không gọi model hay dịch vụ thật. Các phép đo W4-01, W4-03, W4-04 chưa chạy.

Sau #146 (merge 16/10/2026): chạy thật W3-11 qua giao diện, xem bảng dưới (dòng "Chạy thật qua frontend (W3-11)") và [log](log/2026-10-16-reviewer-W3-11-new-services-frontend.md). #146 chỉ sửa harness `evaluations/live-app/` và tài liệu, nên số test không đổi so với #142.
- [CI #146](https://github.com/VinhDat267/ATI_Project/actions/runs/38923039712) SUCCESS đúng head `be86948`.
- Bên thi công chạy `npm run check` ở máy, exit 0, **1.953 v3 + 173 eval**; typecheck chặt ba file harness exit 0.
- Reviewer độc lập chạy check (1.953 + 173), browser **105 pass/1 skip**, và ba phép thử harness trên adapter sandbox (bình thường, ẩn tiêu đề biên nhận, Hủy), cả trước và sau bản sửa P2.
- Cây merge `2960ab0` bằng cây head cộng đúng 4 file tài liệu của #145.

Sau #142 (merge 16/10/2026): [CI #142](https://github.com/VinhDat267/ATI_Project/actions/runs/38862974131) SUCCESS đúng head `1971cd0` (đã rebase lên `e03a9c8`): **1.953 v3** (63 schema + 408 adapter + 291 planner + 42 executor + 464 API + 685 web) **+ 173 eval**, browser **105 pass/1 skip có chủ đích qua 12 nhóm** (thêm nhóm `answer` 4). Bên thi công chạy ở máy cùng số.
- Reviewer chạy tại `993e485` (trước rebase): `npm run check` exit 0, 1.836 v3 + 173 eval. Browser lượt 1 exit 1 vì ca `FE-05 … dark 1440` hết giờ chờ trang đăng nhập (mục 5), lượt 2 exit 0, 105 pass/1 skip. 14/16 đột biến bị bắt; P1 lọt thành P2, P8 lọt thành P3.
- Reviewer chạy tại `1971cd0` (worktree riêng, PostgreSQL 16 tmpfs riêng ở 55533 với `max_connections` mặc định 100, sandbox, hai cờ tắt, không dùng `.env`):
  - `npm run check` exit 0 ngay lượt đầu, **1.953 v3 + 173 eval**;
  - browser exit 0 ngay lượt đầu, **105 pass/1 skip**, 12 nhóm;
  - **22/22 đột biến bị bắt**: 16 của lần trước, 5 vào bảo đảm của #143 trên bản tích hợp, và 1 ở chỗ gộp `server.ts` (bỏ `readAnswers`; nhóm browser `answer` fail 4/4).
- Cây merge `96f9f09` bằng cây head. Không gọi model.

Sau #143 (merge 16/10/2026): [CI #143](https://github.com/VinhDat267/ATI_Project/actions/runs/38692036175) SUCCESS đúng head `57c4888`: **1.926 v3** (63 schema + 408 adapter + 272 planner + 42 executor + 462 API + 679 web) **+ 173 eval**, browser **101 pass/1 skip có chủ đích qua 11 nhóm**. Bên thi công chạy ở máy cùng số.
- Reviewer chạy tại `78e6421` (worktree riêng, `npm ci`, PostgreSQL 16 tmpfs riêng ở 55533, sandbox, hai cờ tắt, không dùng `.env`):
  - `npm run check` exit 0, **1.922 v3 + 173 eval**. Lượt đầu exit 1 vì test chập chờn của GMAIL-01 (mục 5);
  - browser exit 0, **101 pass/1 skip**;
  - 8/9 đột biến bị bắt; R8 lọt, thành P2.
- Phần sửa `78e6421..57c4888` chỉ có test và tài liệu. Reviewer chạy 5 đột biến vào bất biến chống gửi trùng: **5/5 bị bắt**. 8 ca mới chạy lặp 5 lần đều đạt; `npm run typecheck:v3` exit 0. Không chạy lại full check/browser ở máy.
- Cây merge `7c260c1` bằng cây head. Không gọi Google hay model.

Sau #140 (merge 14/10/2026): [CI #140](https://github.com/VinhDat267/ATI_Project/actions/runs/38523128374) SUCCESS đúng head `2268d9f`: check và browser đạt. Ở máy bên sửa review (worktree riêng, PostgreSQL 16 tmpfs riêng, sandbox, hai cờ tắt, không dùng `.env`): `npm run check` exit 0, **1.811 v3** (63 schema + 340 adapter + 240 planner + 36 executor + 453 API + 679 web) **+ 173 eval** (routing offline 116 câu không đổi); browser exit 0, **101 pass/1 skip có chủ đích qua 11 nhóm**, không sửa assertion cũ. Review độc lập lần 1 chạy lại check 1.796 + 173, browser 101/1 skip và 13/13 đột biến; sau sửa, 22/22 đột biến bị bắt. Kiểm bản sửa P2 số 3 trên `2268d9f`: test mới fail trên mã cũ (`approved` thay vì `pending`), đạt trên mã mới; 6 file thực thi 76/76. Cây merge `8973a9e` bằng cây head. Không gọi Google hay model.

Sau #137 (merge 14/10/2026): reviewer chạy trên head `345b2c8` (worktree riêng, `npm ci`, PostgreSQL 16 tmpfs riêng ở 55533, sandbox, không dùng `.env`). Test planner trọng tâm **89/89**; `npm run check` exit 0 (**1.699 v3 + 173 eval**, planner 212 → 237); 8/8 đột biến của reviewer bị bắt. Browser không chạy ở máy. [CI #137](https://github.com/VinhDat267/ATI_Project/actions/runs/38350079490) SUCCESS đúng head `345b2c8`: check và browser **101 pass/1 skip có chủ đích qua 11 nhóm**. Cây merge `ebc192d` bằng cây head cộng đúng các file tài liệu của #138 (không trùng file). Không gọi model. [CI main sau #138](https://github.com/VinhDat267/ATI_Project/actions/runs/38504259133) SUCCESS đúng `6185b2c`; [CI main sau #137](https://github.com/VinhDat267/ATI_Project/actions/runs/38505350383) (`ebc192d`) đang chạy khi viết bản này.

Sau #133 (merge 13/10/2026), số đo W4-00 ngày **12/10** trên source `305302b`, model **`cx/gpt-6.1-sol`**, served `gpt-6.1-sol`: core **48/50 PARTIAL** (`cl04` timeout hai lần 30 s, runner hủy `rf07`, exit 2); services **41/44 complete**, tool **96,4%**, argument **96,3%**, p50/p95 **5,195/9,408 s**, 44/44 dưới 15 s, năm service mới đạt ngưỡng tool/argument. Không đóng gate latency core hoặc thay thế số đo Gemini của W3-10. App live preview **6,033 s**, Hủy → PostgreSQL `rejected`, toàn database preview **0 execution steps**, 0 request approve. Reviewer ngày 12/10 tính lại **18 report/306 case**, chạy lại provider **19/19**, eval offline **173/173**, native HTTP fault **5/5** (exit 0), đối chiếu manifest/mirror **70/70**, ảnh và PostgreSQL. [CI #133](https://github.com/VinhDat267/ATI_Project/actions/runs/38279338897) SUCCESS đúng head `2d803550844dc7af05ca188e87bb053929442ffd`: **1.674 v3 + 173 eval**, browser **101 pass/1 skip có chủ đích qua 11 nhóm**; cây merge `6ee41097f2eca21a2c106af25dce0587d0981c8a` bằng cây head đã review. Đây là bằng chứng ngày 12/10, không phải chạy lại ngày 13/10. [Báo cáo và provenance](../ai-evidence/V3-GOLDEN-V2/W4-00-REPORT.md).

[CI main sau #133](https://github.com/VinhDat267/ATI_Project/actions/runs/38283261391) completed/SUCCESS đúng merge head `6ee41097f2eca21a2c106af25dce0587d0981c8a`, được xác nhận ngày 13/10: check và toàn bộ nhóm browser đạt. Không chạy lại suite cục bộ cho cập nhật bàn giao này.

Sau #129 (11/10/2026): [CI](https://github.com/VinhDat267/ATI_Project/actions/runs/38082549178) SUCCESS đúng head `daa023c`: **1.674 v3** (47 + 340 + 212 + 25 + 371 + 679 web) **+ 173 eval**, browser **101 pass, 1 skip có chủ đích, 11 nhóm** (default 83). Nhánh đã rebase lên `84a3461`; cây merge `828c21a` bằng đúng cây head. Ở máy reviewer (worktree head `daa023c`, PostgreSQL tmpfs riêng 56533, sandbox): `npm run check` exit 0 cùng số trên; `npm run test:browser:v3` exit 0 ngay lần đầu, 101 pass/1 skip; ca `FE-11:` lặp 20 lần 20/20; 8/8 đột biến bị bắt; probe trình duyệt hộp đăng nhập 50/50 (focus ô đầu ở `/login`, `/signup`, `/forgot-password`, điền nhanh giữ đúng giá trị). Lượt review đầu (head `7489380`): check 1.658 + 173, browser default 1 fail (ca FE-11 chập chờn 6/10), 14/17 đột biến bị bắt. CI `main` sau #130 (`84a3461`, chỉ tài liệu, [run 38066634198](https://github.com/VinhDat267/ATI_Project/actions/runs/38066634198)) đỏ một ca chập chờn ở bước đăng nhập (mục 5); [CI `main` sau #129](https://github.com/VinhDat267/ATI_Project/actions/runs/38102094048) SUCCESS đúng `828c21a`, browser 101 pass/1 skip.

Sau #128 (10/10/2026): [CI](https://github.com/VinhDat267/ATI_Project/actions/runs/38062515365) SUCCESS đúng head `88f12af`: **1.641 v3** (47 + 340 + 212 + 25 + 368 + 649 web) **+ 173 eval**, browser **100 pass, 1 skip có chủ đích, 11 nhóm** (default 82). Nhánh tách từ `c99b7ba`; cây merge `e08e623` chỉ khác head ở 4 file tài liệu FE-11 của #127, mã bằng head. Ở máy reviewer: lần 1 (head `be39fda`) frontend 648/648, typecheck, quét bản build, static guard đạt, 6/6 đột biến bị bắt; lần 2 (head `88f12af`) frontend 649/649, typecheck exit 0, đột biến đưa nút sáng/tối của `/privacy` về cuối trang bị test mới bắt; vị trí nút trùng bản mẫu ở 1440/375 sáng/tối. Không chạy full `npm run check`/browser ở máy. CI `main` sau #127 (`d319a32`, chỉ tài liệu) đỏ do 2 ca browser chập chờn (mục 5).

Sau #118 (10/10/2026): reviewer Claude Code gộp `main` `56e4c83` vào nhánh PR (không xung đột), head `24bea4f`, cây merge `d87c80e`. [CI](https://github.com/VinhDat267/ATI_Project/actions/runs/38032089565) SUCCESS đúng head: **1.635 v3** (47 + 340 + 212 + 25 + 368 + 643 web) **+ 173 eval**, browser **97/11 nhóm**. Ở máy reviewer (worktree, cây đã gộp): file test 24/24 và frontend 643/643, exit 0; bỏ chốt `hydrateResponse` thì test mới fail. Không chạy full `npm run check`/browser ở máy.

Sau #120 → #122 (09/10/2026): review độc lập **Đạt**, không còn P1/P2/P3 trong phạm vi ba PR. [CI #120](https://github.com/VinhDat267/ATI_Project/actions/runs/37858605477) SUCCESS đúng `1792f12`; [CI #121](https://github.com/VinhDat267/ATI_Project/actions/runs/37878478624) SUCCESS đúng head tích hợp `c4bc567`: **1.622 v3 + 173 eval**, **91 browser/11 nhóm**; [CI #122](https://github.com/VinhDat267/ATI_Project/actions/runs/37878529685) SUCCESS đúng head tích hợp `202da918`: **1.634 v3 + 173 eval**, **97 browser/11 nhóm**. Mỗi cây merge bằng cây head đã kiểm; cây cuối `c4f2170` = `202da918` = `817426abe787795ab4a4abf54aa7986f57cde2fa`. Các số full suite này là CI; reviewer merge chạy độc lập FE-08 **99/99**, bản sao **15/15** rồi bỏ guard mới làm **15/15 fail**, tích hợp AUTH-07/FE-08 **76/76**, tích hợp cả ba **130/130** và runner **10/10**, đều đúng exit kỳ vọng. Không chạy lại full root/browser local trong review merge. [Log merge và giới hạn](log/2026-10-09-codex-merge-fe-08-fe-09.md).

Sau #102 (09/10/2026): Claude Code chạy trên `main` `d40d735` (bản gộp #102 với #116/#117; hai bên không chung file), PostgreSQL tmpfs riêng ở 56533 (Windows đang giữ dải 55448–56047, gồm cổng 55533 mặc định, mục 6), sandbox. `npm run check` exit 0 (**1.570 v3 + 173 eval**). Canonical browser lần 1 exit 1: 77/78, ca `AUTH-04: Google signup…` không thấy thông báo chờ duyệt (mục 5); chạy lại exit 0 (**78/78 qua 11 nhóm**). [CI main](https://github.com/VinhDat267/ATI_Project/actions/runs/37854177550) SUCCESS đúng `d40d735`. Trước merge, reviewer chạy head #102 `7301d66`: 1.544 v3 + 173 eval, browser 73/73.

Sau #116 (09/10/2026): Claude Code chạy trên head `067207c` (cây merge `572da6d` bằng đúng head), PostgreSQL tmpfs riêng ở 55539, sandbox. `npm run check` exit 0 (**1.558 v3 + 165 eval**); canonical browser exit 0 (**78/78 qua 11 nhóm**). CI PR #116 SUCCESS trên `067207c`.

Sau #113 (08/10/2026): Claude Code chạy trên head `ae98ea3` (cây merge `6f65b0c` bằng đúng head), PostgreSQL tmpfs riêng ở 55539, sandbox. `npm run check` exit 0 (**1.532 v3 + 165 eval**; planner 196 → 200); canonical browser exit 0 (**73/73 qua 11 nhóm**). CI PR #113 SUCCESS trên `ae98ea3`.

Sau #110 và #111 (08/10/2026): Claude Code chạy trên `main` `06fdd09` (bản gộp cả hai PR; #111 merge sau #110 mà không cập nhật nhánh vì hai PR không chung file), PostgreSQL tmpfs riêng ở 55539, sandbox. `npm run check` exit 0 (**1.528 v3 + 165 eval**); canonical browser exit 0 (**73/73 qua 11 nhóm**). [CI main sau #110](https://github.com/VinhDat267/ATI_Project/actions/runs/37793337759) SUCCESS đúng `c21afc0`; [CI main sau #111](https://github.com/VinhDat267/ATI_Project/actions/runs/37793391321) SUCCESS đúng `06fdd09`. Trước merge, reviewer chạy từng PR: #110 head `0761c0e` 1.508 + 165, browser 73/73; #111 head `4edcd96` 1.518 + 165, browser 73/73.

Sau #108 và #107 (08/10/2026): reviewer Claude Code chạy trên bản gộp `c39cf42` (nhánh FE-06A đã gộp `main` sau #108; cây merge `f796467` bằng đúng `c39cf42`), PostgreSQL tmpfs riêng ở 55538, sandbox. `npm run check` exit 0 (**1.498 v3 + 165 eval**); canonical browser exit 0 (**73/73 qua 11 nhóm**). [CI PR #107](https://github.com/VinhDat267/ATI_Project/actions/runs/37777503190) SUCCESS trên `c39cf42`; [CI main sau #108](https://github.com/VinhDat267/ATI_Project/actions/runs/37776824417) SUCCESS đúng `d5e7a9e`; [CI main sau #107](https://github.com/VinhDat267/ATI_Project/actions/runs/37778031151) SUCCESS đúng `f796467`. Trước khi gộp, từng PR riêng: FE-07 head `003719c` 1.454 + 165 và browser 69/69 (lần đầu 51/52, ca AUTH-01 chập chờn, mục 5); FE-06A head `0ab2506` 1.474 + 165 và browser 69/69 (lần đầu 51/52, ca FE-06A chập chờn, mục 5).

Sau FE-05b phần (b) #103 (08/10/2026): reviewer Claude Code chạy trên head `66b46ae`, PostgreSQL tmpfs riêng ở 55535 (chọn qua `V3_LOCAL_DB_PORT` mới của #103), sandbox. `npm run check` lần 1 exit 1: 2 test `chat-api` hết thời gian chờ khi máy đang tải nặng (mục 5); chạy lại exit 0 (**1.432 v3 + 165 eval**). Canonical browser exit 0 (**65/65 qua 11 nhóm**). Agent thi công (Codex) chạy được cùng số. [CI PR #103](https://github.com/VinhDat267/ATI_Project/actions/runs/37655453773) SUCCESS trên head `66b46ae`; merge `c7cf6e3` chỉ khác head ở 3 file tài liệu của #101.

Sau FE-05b phần (a) #100 (07/10/2026): Claude Code chạy trên head `4eaba8f` (gồm commit sửa 3 P3 của Claude Code), PostgreSQL tmpfs riêng ở 55533, sandbox: `npm run check` exit 0 (**1.407 v3 + 165 eval**), canonical browser exit 0 (**61/61 qua 11 nhóm**). Trước đó Codex (head `60d1b84`) và reviewer chạy lại đều được 1.404 + 165 và 61/61; reviewer có một lần browser 43/44 do ca chập chờn (mục 5). [CI PR #100](https://github.com/VinhDat267/ATI_Project/actions/runs/37632679206) SUCCESS trên head `4eaba8f` ở lần chạy lại (lần đầu fail 1 test chập chờn, mục 5); cây merge `8155c03` bằng head.

Sau FE-05 #90 (06/10/2026): agent thi công chạy `npm run check` exit 0 trên source `cfcf958` (**1.375 v3 + 165 eval**) và canonical browser exit 0 (**54/54 qua 11 nhóm**, gồm ma trận sáng/tối × 1440/375). Reviewer độc lập chạy lại phần liên quan (156 unit, 7 ownership gốc, 4 browser race, 2 browser repro gốc), đều exit 0, và đối chiếu log của hai lần chạy đầy đủ. [CI PR #90](https://github.com/VinhDat267/ATI_Project/actions/runs/37351219579) SUCCESS trên head `09b8031`; [CI main](https://github.com/VinhDat267/ATI_Project/actions/runs/37390003235) SUCCESS đúng merge `ee65cd0`. Claude Code không chạy lại suite đầy đủ, chỉ chạy thử app thật ở sandbox (mục 4).

Bản gộp sau #88/#86 tại `210d3b6`, ngày 05/10/2026: reviewer chạy mới `npm run check` exit 0 (**1.303 v3 + 165 eval**), canonical browser exit 0 (**39/39 qua đủ 11 scenario**), PostgreSQL tmpfs riêng và sandbox/OIDC giả. [CI main FE-04](https://github.com/VinhDat267/ATI_Project/actions/runs/37331111009) SUCCESS đúng `89d1999`; [CI main bản gộp](https://github.com/VinhDat267/ATI_Project/actions/runs/37331218389) SUCCESS đúng `210d3b6`. Model/golden/provider live không chạy lại; các bằng chứng live dưới đây giữ mốc đo cũ.

Mỗi số liệu ghi kèm ngày đo và commit. Số liệu lịch sử trước hai PR mới từ [CI PR #80](https://github.com/VinhDat267/ATI_Project/actions/runs/37251935959), SUCCESS trên head `dc3dba8` ngày 05/10/2026, sau khi xoá v1/v2. Claude Code cũng chạy lại `npm ci`, `npm run check` và browser trên PostgreSQL tmpfs riêng; cả hai cho đúng số của CI #75 bên dưới. Trước đó: [CI PR #75](https://github.com/VinhDat267/ATI_Project/actions/runs/37222271347), SUCCESS trên head `df3b7e8`, ngày 05/10/2026 giờ Việt Nam; implementer và reviewer độc lập chạy `npm run check` trên PostgreSQL tmpfs riêng trong AUTH-06. Tree merge `bfd824f` bằng head CI (`git diff --exit-code` đạt); PR chỉ đổi tài liệu/ignore, mã sản phẩm vẫn ở `198fe6d`. Browser32/32 chạy trên CI với OIDC giả, chưa chạy lại local trong AUTH-06. Bằng chứng Gmail/Google thật có native UI, DB/API và các bước người dùng trực tiếp xác nhận, ghi riêng ở đoạn AUTH-06/task card. Ba phép đo model thật W3-06 vẫn dùng runtime `7ba60ef`, catalog33tool/8service và fixtures tổng hợp; chưa đo lại sau các thay đổi sản phẩm tiếp theo, gồm wording refusal W3-00b. Không gọi model hoặc ghi workflow dịch vụ trong AUTH-06. Các bằng chứng live cũ giữ ngày và giới hạn; nghiệm thu auth không xác lập chính sách hủy request backend đang chạy hay độ bền gửi thư qua restart.

| Kiểm tra | Kết quả | Đo lúc | Lệnh |
|---|---|---|---|
| Unit + integration v3 | 2.386/2.386 = 65 schema + 425 adapters + 378 planner + 42 executor + 616 API + 860 web (SCHED-01 thêm 67 API; SCHED-02 thêm 68 planner, 15 API; OAUTH-01 thêm 7 API, 19 web; SCHED-03 thêm 43 web; OAUTH-02 thêm 2 schema, 17 adapters, 19 planner, 62 API, 25 web) | 27/10, CI #176 SUCCESS trên `7f37f21`; reviewer chạy ở máy cùng số tại `e9f1dc3` | `npm run test:v3` (trong `npm run check`) |
| Test của bộ đánh giá (offline) | 406/406 = 173 cũ + 28 W4-03 + 48 W4-01 + 26 W4-04 + 57 GMAIL-04 + 57 W4-02 + 5 quy tắc dừng của runner + 12 OAUTH-02 (gồm test trên PostgreSQL thật) | 27/10, CI #176 SUCCESS trên `7f37f21`; reviewer chạy ở máy cùng số | `npm run test:eval:v3` (trong `npm run check`) |
| Browser E2E (sandbox, PostgreSQL thật) | 157 ca pass, 15 nhóm; default 95 (FE-12 thêm 5, SCHED-03 và OAUTH-02 mỗi task thêm 1 ca cờ tắt), auth02 2, auth04 6, clarification 3, partial_failure 2, sáu nhóm service mỗi nhóm 1, answer 4 (`PLANNER_READ_ANSWERS=on`, chế độ `llm`), gmail 10 (`GMAIL_ENABLED=on`, OAuth và Gmail giả; 4 GMAIL-03 và 4 OAUTH-01 ở 1440/375 sáng/tối, 2 ca OAUTH-01 đi bằng Tab ở 1440/375), schedule 22 (`SCHEDULES_ENABLED=on`), mycalendar 7 (`MYCALENDAR_ENABLED=on`, OAuth và Calendar giả) | 27/10, CI #176 trên `7f37f21`; trước đó 149 ca ở CI #171 trên `ec2df5a`; reviewer chạy ở máy cùng số; Google dùng OIDC giả; một ca Google skip có chủ đích ở default và chạy trong auth04 | `npm run test:browser:v3` |
| Typecheck, build | đạt | như trên | `npm run typecheck:v3`, `npm run build:v3` (trong `npm run check`) |
| Gmail SMTP và Google OAuth thật | Email xác minh/duyệt/reset, login mật khẩu mới, link một lần; Google mới pending/approve/login và tài khoản mật khẩu unlink/link/relogin đạt; SMTP535 và Google redirect mismatch đạt | 04–05/10, mã sản phẩm `198fe6d`, handoff merge #75 `bfd824f` | Native Gmail/Google/ATI UI + DB/API và xác nhận người dùng; [task AUTH-06](tasks/AUTH-06-auth-live-setup.md) |
| Golden W4-01, model thật, 3 lần mỗi chế độ | 32 câu, 4 người viết (2 đã xem prompt, nên không độc lập). `llm` **89/96**: tool 93,7%, tham số 100%, p50/p95/max 10,8/60,0/76,6 s, 71/96 dưới 15 s, 17/124 lần thử quá hạn. Nhóm đã xem prompt 47/48, nhóm chưa xem 42/48. `regex` **37/96**: tool 27,0%, tham số 76,7%. Câu quá hạn sau cả hai lần thử được chấm trượt (4 ở `llm`, 15 ở `regex`); bốn lượt dở dang trước đó được giữ | 24/10, label `2cdaf90`, source `91cd5c1`, yêu cầu `ag/gemini-3.8-flash`, phản hồi `gemini-3.8-flash-n`, hai cờ tắt, concurrency 2 | `EVAL_SET=independent … run.ts`; [báo cáo](../ai-evidence/V3-GOLDEN-V2/2026-10-24-W4-01-REPORT.md) |
| Golden GMAIL-04 và W4-02, model thật | `gmail` ×3 **59/60** (injection 9/9), p95 20,2 s. `answers` ×3 **27/30**, mọi câu trả lời có tra cứu do model mở, p95 20,7 s (không tính vào mục tiêu 15 s). `multiturn` ×3 **36/36**, p95 7,3 s. Kiểu trả lời bật: `core` ×1 **50/50**; `services` ×1 37/44, đối chứng cờ tắt 43/44 (phần chênh là 6 câu `read_only` được trả lời). Model chiếm 99,84–99,94% thời gian | 18/10, source `31166cb`, yêu cầu `ag/gemini-3.8-flash`, phản hồi `gemini-3.8-flash-n`, `PLANNER_SEARCH_MODE=llm`, concurrency 2 | `evaluations/golden-v2/run.ts`; [báo cáo](../ai-evidence/V3-GOLDEN-V2/2026-10-18-GMAIL-04-W4-02-W4-04-REPORT.md) |
| Latency qua frontend (W4-04) | 24 câu, mỗi câu một hội thoại mới, mọi kế hoạch bấm Hủy: **23/24 dưới 15 s**, p50/p95/max **9,6/14,7/15,8 s**. 23 kế hoạch, 1 từ chối; server chiếm 96,8% thời gian; 0 bước thực thi | 18/10, app live trên `31166cb`, `ag/gemini-3.8-flash`, PostgreSQL tạm, 8 dịch vụ `healthy`, hai cờ tắt | `LIVE_APP_LATENCY=1`, `evaluations/live-app/latency.config.ts`; bằng chứng ở máy nhóm trưởng (không commit), SHA-256 trong báo cáo |
| Golden sau W3-10, model thật, 3 lần mỗi bộ | Core 50: **150/150**, p50/p95 7,229/18,021 s, 90,7% lượt dưới 15 s. Freeform 18: **52/54**, p50/p95 10,108/24,738 s, 77,8% dưới 15 s (chỉ ff15 sai). Services 44: **129/132**, p50/p95 8,242/20,138 s, 88,6% dưới 15 s (chỉ ca04 vẫn là refusal). read_only **18/18**: hỏi lại ngay, 1 lời gọi model, 0 vòng tra cứu. Năm service mới tools/args đều 100%. Model chiếm 99,96% thời gian lượt | 08/10, source `58d4fcd`, yêu cầu `ag/gemini-3.8-flash`, phản hồi `gemini-3.8-flash-n`, `PLANNER_SEARCH_MODE=llm`, concurrency 2. Đối chứng cùng ngày code cũ (`7898aa7`, giữ bằng tag `evidence/w3-10-control`): core 50/50, p95 18,995 s; services 37/44, p95 44,465 s | `evaluations/golden-v2/run.ts`; [so sánh](../ai-evidence/V3-GOLDEN-V2/W3-10-COMPARISON.md), [log](log/2026-10-09-codex-W3-10-live-remeasurement.md) |
| Golden W3-06 (lịch sử) 50 câu, model thật, 3 lần | 150/150; p50/p95 5,454/13,105 s; 49 câu không đổi147/147, rf06 mới3/3 | 03/10, runtime `7ba60ef` | xem `evaluations/README.md` |
| Golden W3-06 (lịch sử) 18 câu tự do, model thật, 3 lần | 51/54; p50/p95 5,942/13,092 s; ff15=0/3 | như trên | như trên |
| Golden W3-06 (lịch sử) 44 câu services, model thật, 3 lần | 111/132; p50/p95 6,105/31,097 s; max53,021 s | như trên | như trên |
| Năm service mới: tools/args | tools100% cả năm; args Calendar87,5%, bốn service còn lại100% | như trên; successful read traces + labelled writes, args conditional đúng tool | `EVAL_SET=services`, xem denominator trong README |
| Chạy thật năm service mới (W3-07) | Telegram, Notion, Jira, Calendar, Sheets: ghi thật thành công và đọc lại khớp; workflow GitHub → Notion → Telegram → Slack 4/4 step; mỗi service một ca lỗi xác thực thật | 04/10, `run.ts` (không qua frontend) | `evaluations/live-execution/run.ts`, chi tiết ở task card W3-07 |
| Jira đọc thật sau sửa W3-09 | Token giả: check CLI exit1/AUTH_ERROR; query `W3-07` và key `ATIT-4` đều trả issue thử `ATIT-4` | 04/10, sau merge `f284b12`; chỉ đọc | `run.ts check` qua env chỉ Jira và adapter qua helper có guard chặn ghi; task card W3-09 |
| Lập kế hoạch live qua app sau #113 | Một yêu cầu tạo GitHub issue qua giao diện: đúng 1 lần gọi model, gateway HTTP 200, yêu cầu `ag/gemini-3.8-flash`, phản hồi `gemini-3.8-flash-n` được chấp nhận (gọi model 7,6 s; kế hoạch lưu vào PostgreSQL sau 9,1 s tính từ lúc bấm gửi). Kế hoạch 1 bước `github.create_issue` đúng repo/tiêu đề/nội dung, `pending`, SSE `waiting_for_approval`; không duyệt, 0 bước thực thi, không tạo issue thật | 08/10, `main` `ca7bc26`, Codex chạy; `RUNTIME_MODE=live`, PostgreSQL tmpfs riêng, bằng chứng ở máy nhóm trưởng (không commit) | `RUNTIME_MODE=live npm run up` qua trình duyệt |
| Chạy thật qua frontend (W3-11) | Năm service mới, mỗi service một lệnh ghi (kèm Slack), đều `completed` 2/2; workflow Jira → Notion → Telegram → Slack `completed` 4/4, Link của page Notion bằng URL ticket; lượt Hủy `rejected`, 0 bước. Tới xem trước 7,1–15,0 s (từng lượt, không phải phép đo W4-04). Đọc lại bằng tool đọc khớp; Telegram nhóm trưởng xác nhận; tin Slack không đọc lại | 16/10, `main` `96f9f09`, `ag/gemini-3.8-flash`, PostgreSQL tạm riêng, mỗi lệnh ghi duyệt đúng mã băm | `evaluations/live-app/`; [log](log/2026-10-16-reviewer-W3-11-new-services-frontend.md) |
| Chạy thật qua frontend (lịch sử) | GitHub issue → Trello card → Slack: thành công; thực thi 3,8 s | 30/09, trước PR #13 | `evaluations/live-app/` |

Lần kiểm tra kết hợp AUTH-01/FE-02 sau retarget main: CI `37128235604` SUCCESS trên `c68b4b6`, `npm run check` đạt **948 v3** = 47 schema + 317 adapters + 172 planner + 25 executor + 203 API + 184 web; **165 offline evaluations**; typecheck/build/credential scan/launcher/guards đạt. Canonical browser script đạt **20/20** qua đủ 9 scenario trên PostgreSQL thật. Root đã chạy cùng toàn bộ suite local trong phiên thi công; hai reviewer độc lập chạy các test và probe thuộc phạm vi của mình, không gọi kết quả CI là nghiệm thu service/model thật.

Lần kiểm tra cuối W3-08 (Claude Code, `fbab62b`): `npm run check` exit 0: v3 895 = 47 schema + 317 adapters + 172 planner + 25 executor + 173 API + 161 web; eval 165; typecheck/build; quét bản build PASS. Browser 14/14. RED 14 test mới; mutation 10/10 bị bắt (gồm M15 Calendar 403 của audit). Model thật chưa chạy lại sau khi mô tả ba tool đổi nhẹ.

Lần kiểm tra cuối W3-06: npm run check exit0:874v3 =47schema+301adapters+167planner+25executor+173API+161web;151offline evaluations; strict eval typecheck exit0; CI browser14/14 trên PostgreSQL thật. Review độc lập `aaa345d..49dfc61`: C0/I1/M0, rerun check874+151/strict và audit415attempts/1921traces/276plans. I1 mô tả read-only sai được sửa một lượt: audit báo cáo thật RED→GREEN, 15refusal/3plan/0clarification; validator chấp nhận ba plan chỉ đọc, write-only là chỉ dẫn prompt chưa được validator enforce. Raw reports/labels/fingerprints/scores giữ nguyên; không re-review. CI xác nhận head cuối `0b34b64`; tree merge bằng head. Bốn workflow ≥4service đạt12/12. ff15 model hỏi Slack/Telegram khi cùng có frontend: giữ label Slack cũ, ghi parity chưa đạt; không tự kết luận semantic regression. Services p95 vượt15s; usable-plan rate null, quality gate incomplete. Xem [verification W3-06](../ai-evidence/V3-GOLDEN-V2/W3-06-VERIFICATION.md).

Bằng chứng W3-05 trước đó: sửa generic resource collection grounding tại `979a196`, corrected RED6fail25pass→GREEN31/31; SQL/factory/planner search→comment không chèn memory thủ công. Native/adversarial HTTP probes17/17; redirect không chuyển credentials, aborted201 body UNKNOWN không replay. Snapshot72legacy giữ nguyên; W3-06 cập nhật label rf06 trong commit riêng `1ab7f08` theo người dùng và giữ ngoại lệ Calendar unavailable legacy.

Bằng chứng FE-01 trước đó: đóng hộp thoại lỗi gọi lại Stop → 3 test fail; modal gọi `onStop` khi thiếu `onClose` → 1 test fail; gỡ cả hai lớp chặn demo login → quét bản build fail (sau sửa của reviewer ở `20119b6`).

Audit tuần 2 (Claude Code) chạy probe trên PostgreSQL thật: chết giữa hai step → chạy tiếp được, plan `completed`, không gọi lại step đã xong; chết sau step cuối → tự thành `completed`; skip step `unknown` → step sau dùng đúng output đã lưu.

Chỉ tiêu "tỉ lệ plan dùng được ≥ 70%" **chưa đo** (cần người dùng thật duyệt plan).

## 4. Đã làm gần đây (PR đã merge)

- **OAUTH-02, phần mã, #176** (`f616d01`), merge 27/10/2026 lúc 23:32:11 Việt Nam. Nhóm trưởng giao thi công; PR mở từ tài khoản `VinhDat267`. Đặc tả và task card viết lại trong PR.
  - **Schema và dữ liệu:** `MYCALENDAR_SERVICE` (`connection: 'personal'`, `scopeKey: 'calendars'`), `MYCALENDAR_TOOLS` (3 tool, `'x-resource': 'mycalendar'`), `PlanConnections.mycalendar`. Executor biết `mycalendar.create_event` là lệnh ghi. Migration 0012 mở rộng ràng buộc `oauth_states` và `service_credentials`.
  - **Backend:**
    - `env.ts`: `MYCALENDAR_ENABLED`, `MYCALENDAR_OAUTH_*`, `MYCALENDAR_OAUTH_PROJECT_ID` và `GMAIL_OAUTH_PROJECT_ID`; live chặn cùng project hoặc cùng client;
    - `GmailConnectionRepo` tham số theo dịch vụ, thêm `updateConfigIfActive`;
    - route kết nối riêng; `PUT /scope` kiểm lại các lịch ghi được ở Google;
    - `AdapterFactory` kiểm `credentialId` và phạm vi lịch lúc thực thi;
    - `bindConnections` từ chối `calendarId` ngoài phạm vi;
    - router ưu tiên lịch riêng khi câu khớp cả lịch riêng lẫn lịch chung, trừ khi câu nói rõ lịch chung.
  - **Web:** `MyCalendarCallbackView` (chọn lịch, `?mode=select`), `PersonalMyCalendar` ở `/settings`, nút ở màn từ chối, tên lịch và tài khoản ở màn duyệt và biên nhận, `/privacy`.
  - **Test:** schema, adapter, migration, route, dịch vụ, cấu hình project, thu hồi theo project (máy chủ giả mô phỏng thu hồi theo `(tài khoản, project)`), UI; nhóm browser `mycalendar` 7 ca và ca `MYCALENDAR off:`; golden 8 câu `cases-mycalendar.json` (label sửa riêng ở `e9fc6d7`, trước mọi lời gọi model).
  - **Chưa làm:** `EVAL_SET=mycalendar` ×3; nghiệm thu P-LIVE; Google Cloud project riêng cho Calendar. Cờ giữ tắt.
  - Xem [log thi công](log/2026-10-27-OAUTH-02-personal-calendar.md), [log sửa F1–F6](log/2026-10-27-codex-OAUTH-02-review-fixes.md), [review độc lập](https://github.com/VinhDat267/ATI_Project/pull/176#issuecomment-6437340913), [log sửa 3 P3](log/2026-10-27-reviewer-OAUTH-02-review-p3-fixes.md), [kiểm lại](https://github.com/VinhDat267/ATI_Project/pull/176#issuecomment-6447099752) và [log merge](log/2026-10-27-reviewer-merge-176.md).
- **#177** (`ae07723`): ghi #171, #174, #175 vào CURRENT-STATE và ROADMAP; một reviewer khác sửa 1 P2 và 2 P3 trước merge ([log](log/2026-10-27-codex-review-177-fixes.md)).
- **SCHED-03 xong #171** (`f4ff636`), merge 27/10/2026 lúc 13:51:36 Việt Nam. `longnguyen005` thi công theo [task card](tasks/SCHED-03-schedule-ui.md).
  - **Web:**
    - `api-client.ts` có một hàm cho mỗi route lịch; `schedule-text.ts` dựng câu giờ chạy theo `Asia/Ho_Chi_Minh`;
    - `ScheduleMoment`, `ScheduleActions`: đề xuất (tạo, sửa có giá trị cũ gạch ngang, tạm dừng, chạy tiếp, hủy) và trạng thái lịch; "Bỏ qua" chỉ ẩn thẻ trong phiên, không gọi API; lỗi 409 `STALE_VERSION` tải lại hội thoại;
    - `RequestEcho` và `ConversationDrawer` hiện nguồn của tin `schedule_run`; `ScheduleRunRecovery` có "Lập lại kế hoạch";
    - SSE `schedule_proposal`, `schedule_updated`; lịch sử coi `schedule_discarded` là tin kết thúc;
    - `ScheduleSection` ở trang Nhật ký; `MainNav` có số lượt chờ duyệt, gọi `pending-count` khi tải, mỗi 30 giây và khi tab được focus;
    - capability đọc chung ở gốc App, không thêm lời gọi health ở từng trang.
  - **Test:** `sched-03-ui.test.tsx`, `sched-03-state.test.ts` (43 ca sau phần sửa); browser `sched-03.spec.ts` 22 ca ở nhóm `schedule`, cùng `SCHED-03 off:` ở nhóm default.
  - **Review:** lần 1 Đạt sau khi sửa nhỏ (3 P3); kiểm lại Đạt (mục đầu file). Reviewer gộp `main` vào nhánh theo yêu cầu nhóm trưởng.
  - **Giới hạn:** API chỉ trả tối đa 50 lượt mỗi lịch, nên màn phục hồi chỉ tra trong 50 lượt đó; mở một hàng ở Nhật ký thấy 10 lượt gần nhất. Không gọi model hay dịch vụ thật; nghiệm thu thuộc SCHED-04.
  - Xem [log thi công](log/2026-10-25-codex-SCHED-03-schedule-ui.md), [log sửa review](log/2026-10-26-codex-SCHED-03-review-fixes.md), [review lần 1](https://github.com/VinhDat267/ATI_Project/pull/171#issuecomment-6415384685), [kiểm lại](https://github.com/VinhDat267/ATI_Project/pull/171#issuecomment-6430075593) và [log merge](log/2026-10-27-reviewer-merge-171.md).
- **#175** (`2888a9f`): ghi việc nhóm trưởng xác nhận assertion cũ của `gmail-migration.test.ts` (mục 7).
- **#174** (`88791d9`): ghi #172 và #173 vào CURRENT-STATE và ROADMAP.
- **#173 kế hoạch hoàn thành** (`907a2f0`), merge 26/10/2026 lúc 23:23:01 Việt Nam. Chỉ tài liệu; reviewer lập theo yêu cầu nhóm trưởng ("lên plan chi tiết cho các phần còn lại", để vẫn làm theo được khi không còn reviewer cũ). Chưa có review độc lập.
  - [`FINISH-PLAN.md`](FINISH-PLAN.md): trạng thái, mốc cứng, lịch từng ngày tới 11/11, quyết định chờ nhóm trưởng kèm mặc định, thứ tự cắt, quy trình hai phiên agent (A-thi công, A-review; A-review thay vai reviewer, gồm cả ghi bàn giao sau merge), môi trường kiểm và runbook khi 9router hỏng;
  - task card [DEMO-01](tasks/DEMO-01-demo-stability.md), [REPORT-01](tasks/REPORT-01-final-report.md), [SLIDES-01](tasks/SLIDES-01-defense-slides.md), [VIDEO-01](tasks/VIDEO-01-backup-demo-video.md), [REHEARSAL-01](tasks/REHEARSAL-01-defense-rehearsal.md), [LAT-01](tasks/LAT-01-planning-deadline.md) (tuỳ chọn);
  - [đặc tả](../superpowers/specs/2026-10-26-oauth-02-personal-calendar-design.md) và [task card](tasks/OAUTH-02-personal-calendar.md) OAUTH-02, viết sẵn cho quyết định 29/10. Đây là dịch vụ riêng `mycalendar`, sau cờ `MYCALENDAR_ENABLED`, chỉ lịch chính, hai tool, client OAuth thứ hai (dùng chung client với Gmail thì ngắt Gmail sẽ thu hồi luôn quyền Calendar). Mặc định bỏ; mốc cắt 01/11;
  - `PROMPTS.md` mục "Khi không còn reviewer cũ" (P-START → P-PLAN); `.gitignore` thêm `docs/ai-evidence/DEMO-LIVE/`.
  - [CI #173](https://github.com/VinhDat267/ATI_Project/actions/runs/40323521085) SUCCESS đúng head `05447bb`. Xem [log](log/2026-10-26-reviewer-plan-finish.md).
- **OAUTH-01 xong #172** (`13430d9`), merge 26/10/2026 lúc 23:15:01 Việt Nam. Reviewer thi công theo yêu cầu nhóm trưởng (đặc tả [`2026-10-25-oauth-connect-from-chat-design.md`](../superpowers/specs/2026-10-25-oauth-connect-from-chat-design.md)).
  - **DB và API:**
    - `0011_oauth_return_to.sql`: cột `return_to` và ràng buộc `oauth_states_return_to_check`. Chỉ state `connect_gmail` có cột này, và chỉ ở dạng `/c/<uuid>` chữ thường. Migration chạy lại được;
    - `routes/connections/gmail.ts`: `start` kiểm mẫu và chủ hội thoại trước khi tạo state; `callback` chỉ trả `returnTo` khi thành công, lấy từ state vừa dùng;
    - `app.ts` nối `conversationOwner` từ `ConversationRepo`.
  - **Web:**
    - `RefusalMoment` (`ResponseMoment.tsx`): "Kết nối Gmail"/"Kết nối lại Gmail" bắt đầu kết nối với `returnTo`. Có chặn bấm hai lần, kiểm phiên, báo lỗi mạng; bấm kèm phím bổ trợ vẫn mở `/settings#gmail`;
    - trạng thái từng dịch vụ lấy theo dữ liệu hiện tại. "Gửi lại yêu cầu" chỉ hiện khi đã có dữ liệu mới và mọi dịch vụ còn thiếu đã dùng được;
    - `GmailCallbackView` kiểm lại mẫu `/c/<uuid>` rồi quay về hội thoại; sai mẫu thì về `/settings#gmail`;
    - `Cockpit` lấy `gmailEnabled` từ `/api/health`. Cờ tắt thì màn từ chối như bản trước;
    - `index.css`: ba trang của cockpit chừa chỗ dưới `body` và đặt `scroll-padding-bottom` theo chiều cao ô soạn tin. Thay đổi này áp cho mọi phần tử nhận focus trên ba trang đó.
  - **Test:**
    - `gmail-connections.test.ts` 5 ca mới, `oauth-return-to-migration.test.ts` 2;
    - `oauth-01-refusal.test.tsx` 10, `oauth-01-flag.test.tsx` 3 (cờ bật/tắt trên `Cockpit` thật), `gmail-callback.test.tsx` 6;
    - browser `oauth-01.spec.ts` 6 ca trong nhóm `gmail`. Tên ca bắt đầu bằng `OAUTH-01 from chat:`, vì `OAUTH-01:` khớp bộ lọc `AUTH-01:` của nhóm default.
  - **Review:** ba lượt (mục đầu file). Lượt 2 bắt lỗi mà test click không thấy, vì Playwright tự cuộn trước khi click; ca mới đi bằng Tab và kiểm `elementFromPoint`.
  - **Còn lại:**
    - chưa gọi Google thật (thuộc GMAIL-04);
    - chưa làm việc quay về hội thoại khi người dùng huỷ ở Google (đặc tả mục 7).
  - Xem [log thi công](log/2026-10-26-reviewer-OAUTH-01-connect-from-chat.md), [log sửa lần 1](log/2026-10-26-reviewer-OAUTH-01-review-fixes.md), [log sửa lần 2](log/2026-10-26-reviewer-OAUTH-01-review-2-fixes.md) và [log merge](log/2026-10-26-reviewer-merge-172-173.md).
- **#170** (`c760aa3`): ghi #166 → #169 vào CURRENT-STATE và ROADMAP.
- **SCHED-02 xong #168** (`46b6a5b`), merge 25/10/2026 lúc 20:19:19 Việt Nam. Reviewer thi công theo yêu cầu nhóm trưởng ("Chia đôi": reviewer làm backend và planner).
  - **Planner:**
    - `schedules`, `ProcessMessageInput.schedule`/`scheduledRun`;
    - mục prompt `prompts/schedule-rules.ts` nối vào cuối prompt, chỉ khi cờ bật và không phải lượt chạy;
    - `validateSchedule` (giờ, ngày, thứ, hạn 1 phút–365 ngày, lớp an toàn), thử lại một lần ở cả `regex` và `llm`;
    - `routeSchedule`; `nextOccurrence` chuyển sang `@wap/planner`, dùng chung với bộ hẹn giờ.
  - **`ChatService`:**
    - đọc lịch của hội thoại;
    - lưu đề xuất `ScheduleProposalMetadata` và phát SSE `schedule_proposal`. Dịch vụ do router xác định; dịch vụ chưa cấu hình thì từ chối;
    - lịch sử gửi lại JSON của đề xuất;
    - `planScheduledRun` dùng chung phần xử lý kết quả với đường chat (`prepareResponse` → `write(client?)` → `announce()`), ghi trong transaction của bộ hẹn giờ. `PlanRepo.createPlan` nhận client tuỳ chọn.
  - **`server.ts`:** planner dựng theo từng người, có `routeSchedule`; `planRun` thật. Sandbox `schedule` luôn chạy ở chế độ `llm`.
  - **Mốc SHA-256 của prompt** (`regex`, `llm`, kiểu trả lời tắt và bật) chụp trên mã chưa sửa. Cờ tắt và lượt chạy đều giữ đúng các mốc này.
  - **Review:**
    - lần 1 tại `e390a5f` **chưa đạt**: P2 lượt lỗi hoặc quá hạn để trang kẹt ở "đang lập kế hoạch"; P2 không hủy được lịch khi dịch vụ cũ mất cấu hình; P2 validator và bộ hẹn giờ đặt giờ mùa hè khác nhau; P3 vẫn tra danh mục khi tạo đề xuất;
    - sửa ở `3c2c836`: SSE `error` sau COMMIT và `replyToMessageId`; chỉ dịch vụ câu hiện tại nêu mới làm từ chối; dùng chung `nextOccurrence`; không tra danh mục trong hội thoại đã có lịch;
    - lần 2 **chưa đạt**: 1 P2, catalog rỗng vẫn chặn hủy lịch. Sửa ở `29fe222`;
    - lần 3 **Đạt**.
  - **Còn lại:** câu tạo lịch đầu tiên vẫn prefetch (mục 5); SCHED-03 cần coi `schedule_discarded` là tin kết thúc khi nạp lịch sử.
  - Xem [log thi công](log/2026-10-25-reviewer-SCHED-02-schedule-planner.md) và [log sửa](log/2026-10-25-reviewer-SCHED-02-review-fixes.md). Log review độc lập nằm ở worktree của người review, không commit.
- **SCHED-01 xong #167** (`95b1c46`), merge 25/10/2026 lúc 20:19:04 Việt Nam. Reviewer thi công theo yêu cầu nhóm trưởng ("bắt đầu SCHED-01 đi").
  - **Kiểu dữ liệu** của đặc tả mục 4 trong `tool-schemas`; cờ `SCHEDULES_ENABLED`; migration 0010.
  - **`services/schedules/`:** tính giờ hẹn, trạng thái lượt suy ra, `ScheduleService` (xác nhận đề xuất, nút, danh sách, đếm, chạy ngay, lập lại kế hoạch).
  - **Bộ hẹn giờ:**
    - nhịp 30 s, `SKIP LOCKED`, khoá duy nhất cho mỗi giờ hẹn;
    - gộp lượt lỡ quá 10 phút, tự tạm dừng sau 3 lượt quá hạn;
    - lập kế hoạch tuần tự với hạn 180 s qua `AbortSignal`; đối soát lúc khởi động.
  - **Route** `/api/schedules…`, lỗi `{ error: { code, message } }`. Khi cờ tắt thì không mount, không chạy bộ hẹn giờ.
  - **Review:** lần 1 tại `3a9e4b1` **chưa đạt**, 2 P2 (deadlock xác nhận/tạm dừng; bật lại lịch đã xong vượt giới hạn). Sửa ở `2480261`: thứ tự khoá chung (hội thoại của lịch → lịch → `users` → lượt → hội thoại của lượt), `ensureRoom` khi bật lại. Review lại **Đạt**.
  - Xem [log thi công](log/2026-10-25-reviewer-SCHED-01-schedule-backend.md) và [log sửa](log/2026-10-25-reviewer-SCHED-01-review-fixes.md).
- **#169** (`bd02c9d`), merge 25/10 lúc 20:16:03 Việt Nam: kế hoạch OAuth, chỉ tài liệu.
  - Nhóm trưởng nhờ reviewer đề xuất phạm vi rồi duyệt: OAUTH-01 bắt buộc, OAUTH-02 tuỳ chọn, các provider khác không làm.
  - Gồm [đặc tả OAUTH-01](../superpowers/specs/2026-10-25-oauth-connect-from-chat-design.md), task card, ROADMAP, mục 7.
  - Chưa có review độc lập riêng. [Log](log/2026-10-25-reviewer-plan-oauth-01.md).
- **#166** (`7bb752d`), merge 25/10 lúc 13:43:03 Việt Nam: kế hoạch lịch chạy, chỉ tài liệu.
  - Gồm đặc tả, SCHED-common, SCHED-01 → 04, ROADMAP, mục 7 "Chốt 24–25/10".
  - Nhóm trưởng duyệt đặc tả ngày 25/10 sau khi reviewer tự review; không có review độc lập riêng. [Log](log/2026-10-25-reviewer-plan-schedules.md).
- **#165** (`7cf4f3e`): ghi #164 vào CURRENT-STATE và ROADMAP.
- **W4-01 đo xong #164** (`1df2d35`), merge 24/10/2026 lúc 23:01:28 Việt Nam. Nhóm trưởng yêu cầu ngày 23/10 dùng bốn file `member-1.json` → `member-4.json` đã có, và huỷ kế hoạch để hai thành viên viết thêm; reviewer thi công và đo trên máy nhóm trưởng.
  - **Bộ câu:** 32 câu, 4 người × 8 câu: single_step 7, multi_step 7, cross_service 7, clarification 6, refusal 5; 19 câu tiếng Việt, 13 câu tiếng Anh.
    - Hai người viết đã xem hoặc sửa prompt, nên bộ câu không độc lập;
    - ba câu gần câu của bộ cũ (`m4-01`, `m2-03`, `m4-04`);
    - `validate.ts` đầy đủ exit 0.

    Commit đăng ký `2cdaf90` (14:17Z) có trước lời gọi model đầu tiên (14:25Z), và đã ghi trước quy tắc tách kết quả theo nhóm người viết.
  - **Bộ chạy** (`evaluations/golden-v2/run.ts`):
    - bốn lượt đầu dừng ở đúng các câu `m1-03` (`llm`) và `m1-05` (`regex`). Chạy lại để chẩn đoán, không chấm điểm, cho thấy model suy nghĩ 3.786–4.842 reasoning token (34,9–44,6 s) rồi trả lời bình thường;
    - nhóm trưởng chọn "tính là trượt, chạy tiếp". `91cd5c1`: câu quá hạn được chấm trượt và ghi trong `timedOutCases`; lỗi provider khác hoặc 3 lần quá hạn liền nhau vẫn dừng; `runPool` trả `stopReason`.
  - **Kết quả:** `llm` ×3 89/96, `regex` ×3 37/96 (mục 3).
    - Câu trượt ở `llm`: 4 lượt quá hạn, và `m4-07` ×3 (định tuyến từ khoá chỉ đưa Trello cho câu "task row … Tasks tab");
    - `regex`: 27 lượt câu trượt vì bước tra tên đọc sai cụm từ ("bảng tính" thành board "tính"), 15 lượt quá hạn, 10 lượt model xin ID vì bước tra tên chỉ phủ Trello, Slack, GitHub.

    Không thấy label sai.
  - **Bằng chứng:** báo cáo và sáu thư mục report trong `docs/ai-evidence/V3-GOLDEN-V2/`, gồm bốn lượt dở dang. Quét không thấy giá trị bí mật, tên người viết hay prompt.
  - **Review:**
    - lần 1 tại `15ac249` **chưa đạt**, 1 P2: câu không gọi model (hỏi lại ở bước tra tên của `regex`) đặt bộ đếm quá hạn về 0, nên 5 lần quá hạn liền nhau không làm dừng;
    - `1e3db0b` chỉ cho câu model đã trả lời đặt lại bộ đếm, thêm test hồi quy ở concurrency 1 và 2. Đếm lại theo thứ tự trong log: mỗi lượt đủ có tối đa 2 lần quá hạn liền nhau, nên số đo giữ nguyên;
    - review lại **Đạt**.
  - **Còn lại:**
    - nhóm trưởng chưa xác nhận tiêu chí "GUIDE.md đủ cho người chưa đọc code";
    - chưa có đối chứng bộ 50 câu cùng ngày;
    - ba đề xuất backlog ở mục 5.
  - Xem [log đo](log/2026-10-24-reviewer-W4-01-measurement.md), [báo cáo](../ai-evidence/V3-GOLDEN-V2/2026-10-24-W4-01-REPORT.md), [review lần 1](https://github.com/VinhDat267/ATI_Project/pull/164#pullrequestreview-5638836127), [review lại](https://github.com/VinhDat267/ATI_Project/pull/164#pullrequestreview-5638872371) và [log merge](log/2026-10-24-reviewer-merge-164.md).
- **#163** (`a020a55`): ghi #161 và #162 vào CURRENT-STATE và ROADMAP.
- **FE-12 xong #162** (`6307962`), merge 20/10/2026 lúc 20:12:34 Việt Nam. Ngày 19/10 nhóm trưởng yêu cầu "commit và mở PR và bạn thi công luôn"; reviewer thi công.
  - **`MainNav`** (`components/layout/MainNav.tsx`, mới):
    - lưới `1fr auto 1fr`, mỗi cụm ghim cột;
    - tab là `<a href>` trong `<nav aria-label="Điều hướng chính">`; bấm kèm phím bổ trợ thì trình duyệt tự mở tab mới;
    - tên truy cập của tab luôn là tên đầy đủ; `ThemeToggle` và `UserNavMenu` giữ như cũ.
  - **Cockpit:**
    - `CockpitHeader` dựng trên `MainNav`. Hai nút mở ngăn giữ `id`, `aria-*` và hành vi; dải thử nghiệm nằm dưới thanh;
    - `RequestEcho` (mới) đặt ngay trước `h1` của các khoảnh khắc;
    - `#btn-theme-toggle` cũ thay bằng `ThemeToggle` chung.
  - **Trang con:** Nhật ký, Kết nối dịch vụ, Tài khoản, Người dùng; Cẩm nang và Chính sách an toàn chỉ khi đã đăng nhập. Không sửa `page.css`; bản mẫu trong `docs/` không đổi.
  - **Test:**
    - `fe-12-main-nav.test.tsx`, `fe-12-request-echo.test.tsx`: 28 ca, viết trước khi có mã;
    - `browser/fe-12-nav.spec.ts`, 5 ca: ma trận 7 trang × 5 tab; bố cục ở 7 khổ, sáng và tối; thành viên và menu avatar; dòng "Bạn nhờ" trong cockpit thật; câu dài ở 7 khoảnh khắc;
    - sửa 7 test cũ đang khẳng định thanh cũ, lý do trong log; thêm `FE-12:` vào nhóm default của runner browser.
  - **Ảnh trước/sau:** 54 + 54 ảnh (9 màn × 1440/1024/375 × sáng/tối) ở `.codex/fe12-screenshots-2026-10-19/` trên máy nhóm trưởng, không commit. Review lần 1 kiểm SHA-256 khớp 108/108.
  - **Review:**
    - lần 1 tại `71bb895` **chưa đạt**: P2 màn đang thực thi tràn ngang khi câu yêu cầu liền ký tự; P3 tab lệch tâm ở 768–864 px trên cockpit của admin;
    - sửa ở `ffc8952`: cột chữ của `ExecutionMoment` thêm `min-w-0 flex-1`; tab hiện từ 900 px theo quyết định nhóm trưởng ngày 20/10; thêm test câu dài và các khổ 900/899/768 px;
    - review lại **Đạt**.
  - **Còn lại:** test câu dài chưa phủ khoảnh khắc 3 và màn lập kế hoạch lâu. Chưa xoá `AppShell.tsx`/`ShellPageView.tsx` (việc tuỳ chọn).
  - Xem [log thi công](log/2026-10-19-reviewer-FE-12-shared-nav-bar.md), [review lần 1](https://github.com/VinhDat267/ATI_Project/pull/162#issuecomment-6287543791), [log sửa](log/2026-10-20-reviewer-FE-12-review-fixes.md), [review lại](https://github.com/VinhDat267/ATI_Project/pull/162#issuecomment-6291411379) và [log merge](log/2026-10-20-reviewer-merge-161-162.md).
- **#161** (`729577f`), merge 20/10 lúc 19:36:28 Việt Nam: kế hoạch FE-12, gồm task card, đặc tả giao diện (mục 1.1 điểm 10 và mục 4), ROADMAP và mục 7 "Chốt 19/10/2026". Chỉ tài liệu. Reviewer lập theo thiết kế nhóm trưởng duyệt qua mockup ngày 19/10; không có review độc lập riêng. [Log](log/2026-10-19-reviewer-plan-fe-12-nav.md).
- **#160** (`a8383e0`): ghi #159 vào CURRENT-STATE và ROADMAP.
- **Đo GMAIL-04, W4-02, W4-04 xong #159** (`778f22f`), merge 18/10/2026 lúc 16:09:11 Việt Nam. Nhóm trưởng yêu cầu "đo bằng model thật: GMAIL-04, W4-02, W4-04" ngày 18/10, sớm hơn lịch 21–22/10; reviewer chạy trên máy nhóm trưởng. PR chỉ thêm report và tài liệu.
  - **Golden:** sáu report công khai trong `docs/ai-evidence/V3-GOLDEN-V2/*2026-10-18*`:
    - `gmail` ×3, `answers` ×3, `multiturn` ×3;
    - `core` và `services` ×1 khi bật kiểu trả lời;
    - một lượt `services` đối chứng cờ tắt. Lượt này chạy theo quy tắc của task card GMAIL-04, vì `services` bật cờ thấp hơn W3-10 quá 2 câu.
  - **W4-04:** app live trên PostgreSQL tạm; DB dev không bị đụng tới. `batch.json` và `summary.md` có ID hội thoại và tên tài nguyên thật nên giữ ở máy nhóm trưởng; báo cáo ghi SHA-256.
  - **Báo cáo** [`2026-10-18-GMAIL-04-W4-02-W4-04-REPORT.md`](../ai-evidence/V3-GOLDEN-V2/2026-10-18-GMAIL-04-W4-02-W4-04-REPORT.md): nguồn gốc từng lượt (commit, SHA-256 label và catalog, giờ UTC), kết quả, câu trượt, đối chiếu quy tắc bật cờ và giới hạn. `evaluations/README.md` và phần Kết quả của ba task card ghi số đo.
  - **Câu trượt:** `gm04` lượt 3 do label; `an_ca01` cả 3 lượt do truy vấn của model. `ca04` của services vẫn trả `refusal`, như ở W3-10.
  - **Review:**
    - lần 1 tại `d2a1b89`: 1 P2. Báo cáo quy `an_ca01` cho label ("lệch 1 giây, cùng kết quả"), nhưng `timeMax` của Calendar là cận trên loại trừ. Reviewer thêm một sự kiện 23:59:59 vào bộ nhớ của tiến trình kiểm: truy vấn của model bỏ sót sự kiện đó, mốc của label thì thấy;
    - `ae0b4a4` sửa diễn giải ở báo cáo, README, task card GMAIL-04 và log; giữ label và điểm 27/30;
    - review lại **Đạt**.
  - Xem [log đo](log/2026-10-18-reviewer-measurements.md), [review lần 1](https://github.com/VinhDat267/ATI_Project/pull/159#issuecomment-6246992327), [review lại](https://github.com/VinhDat267/ATI_Project/pull/159#issuecomment-6248025764) và [log merge](log/2026-10-18-reviewer-merge-159.md).
- **#158** (`31166cb`): ghi #156 và #157 vào CURRENT-STATE và ROADMAP.
- **Bộ đo W4-02 xong #157** (`efaafb2`), merge 18/10/2026 lúc 12:28:12 Việt Nam. Nhóm trưởng giao reviewer thi công; chưa đo.
  - **Runner:**
    - `historyOf()` dựng lịch sử từ `turns` như `chat-service.ts`: câu người dùng giữ nguyên chữ, kế hoạch đã lưu gửi lại dạng JSON, câu hỏi lại là chữ. Chỉ chấm câu trả lời của lượt cuối, và câu không có `turns` chạy như cũ;
    - bản public che cả câu người dùng ở các lượt trước;
    - `EVAL_SET=multiturn`.
  - **Label:**
    - `4d63bd6`: `cases-multiturn.json`, 12 câu: 6 `turn_edit`, 3 `turn_reply`, 3 `turn_new`;
    - siết theo review ở `9cf3c11`: tiêu đề phải giữ hoặc do người dùng viết rõ thì so khớp chính xác;
    - siết tiếp ở `c864f55`.

    Tất cả trước mọi lời gọi model. Kế hoạch ở lượt trước đều qua `validatePlan`.
  - **Scorer** thêm `excludeExceptions`: các cụm thất bại đã ghi ("unsuccessful", "did not succeed"…) được bỏ qua khi kiểm `excludes`.
  - **Test browser GMAIL-03** (`d40bea0`). Test của #147 sửa nhãn trong PostgreSQL rồi tải lại trang, nhưng SSE phát lại `plan_preview` cũ với nhãn cũ, chạy đua với lần đọc REST. Nay test mở lại hội thoại trong app thay vì tải lại. Đây là lỗi của test, không phải của sản phẩm.
  - **Review:**
    - lần 1 tại `6803f53`: 1 P2. Label chỉ tìm một chữ, nên đạt cả khi đổi tiêu đề phải giữ hoặc báo "build succeeded";
    - lần 2 tại `4fe8fb4`: 1 P2. Loại `success` loại cả "failed to complete successfully"; CI đỏ ở GMAIL-03;
    - nhóm trưởng giao sửa tiếp đến `54f96b3`; review lại **Đạt**.
  - Xem [log thi công](log/2026-10-18-reviewer-W4-02-multi-turn-eval.md), [log sửa lượt cuối](log/2026-10-18-reviewer-W4-02-final-fix.md), [review lần 1](https://github.com/VinhDat267/ATI_Project/pull/157#issuecomment-6245562173), [lần 2](https://github.com/VinhDat267/ATI_Project/pull/157#issuecomment-6245785227) và [log merge](log/2026-10-18-reviewer-merge-156-157.md).
- **#156 sửa test GMAIL-01 chập chờn** (`f0e24f0`), merge 18/10/2026 lúc 12:26:07 Việt Nam. Nhóm trưởng giao reviewer làm; chỉ sửa test.
  - Test `orders %s after the save…` trước đây suy ra thứ tự commit từ lúc hai promise JS trả về, và đã fail 9 lần. Nay test kiểm trong PostgreSQL rằng lệnh đăng xuất hoặc khoá đang chờ đúng transaction lưu kết nối (`pg_blocking_pids`), và kiểm trạng thái cuối.
  - `finally` luôn `ROLLBACK` client giữ dòng.
  - Review lần 1 tại `b388e03`: 1 P2, `waitingPid()` có thể chọn nhầm PID của tiến trình khác chờ cùng câu `DELETE`. Sửa ở `6ffeaa4`: chỉ nhận PID bị chính client giữ dòng chặn, và mỗi ca dựng một tiến trình mồi ở schema khác. Review lại **Đạt**.
  - Xem [log](log/2026-10-18-reviewer-gmail-01-ordering-test.md), [review lần 1](https://github.com/VinhDat267/ATI_Project/pull/156#issuecomment-6245561734) và [review lại](https://github.com/VinhDat267/ATI_Project/pull/156#issuecomment-6245774567).
- **#155** (`3c950db`): ghi #154 và #153 vào CURRENT-STATE và ROADMAP.
- **Bộ đo GMAIL-04 xong #154** (`32d71fd`), merge 18/10/2026 lúc 09:55:29 Việt Nam. Nhóm trưởng giao reviewer thi công. Đây là bước 2 và 3 của task card; phép đo, nghiệm thu Google thật và PR bật cờ chưa làm.
  - **Runner** (`evaluations/golden-v2/run.ts`):
    - `evalCatalog()` thêm `GMAIL_TOOLS` và `GMAIL_SERVICE` cho hai bộ `gmail`, `answers`; bốn bộ cũ giữ catalog và hash cũ;
    - bộ `answers` bật `readAnswers`. Hai biến `EVAL_READ_ANSWERS` và `PLANNER_READ_ANSWERS` lệch nhau thì báo lỗi;
    - mỗi lời gọi model ghi `promptChars`;
    - `summarizeResponses()` tách độ trễ và số lời gọi model của câu trả lời khỏi câu lập kế hoạch. Nó cũng đếm câu trả lời chỉ dựa vào danh mục, và liệt kê các câu có hành động ghi mà nhận câu trả lời.
  - **Fixture:** hộp thư giả của sandbox GMAIL-02, chép vào để hash fixture bao cả hộp thư; test giữ hai bản bằng nhau. Tìm kiếm theo kiểu Gmail: mọi từ phải khớp, có toán tử và phủ định `-`.
  - **Scorer:**
    - `excludes`;
    - `expect.recipients` áp lên mọi tham số người nhận của mọi bước;
    - `expect.acceptKinds`;
    - category `answer`, tính cả lần tra danh mục, và category `injection`;
    - kế hoạch có `expect.searches` phải đạt cả tra cứu lẫn các bước;
    - `found`: các ID mà kết quả tra cứu phải có.

    Cách chấm ba bộ cũ không đổi; không label cũ nào vừa có tra cứu vừa có kế hoạch.
  - **Label:** `34c595c` (Gmail, 20 câu) và `d53f24b` (trả lời, 10 câu), commit trước mọi lời gọi model. Siết lại ở `b6a5450` và `a9d7a5b` sau review, vẫn trước khi đo. Nhóm trưởng đồng ý ngày 18/10 cho câu injection đạt khi hỏi lại hoặc từ chối. Nhóm trưởng cũng đồng ý đo sớm (khoảng 21–22/10) thay vì 26–28/10.
  - **Review:**
    - lần 1 tại `69e76ee`: 2 P2 (`an_gm02` nhận câu tìm chữ "unread"; `gm15` không buộc đọc thư);
    - lần 2 tại `06a06ad`: 1 P2. Lần tra cứu khớp label mà không tìm thấy gì (`is:unread in:trash`) vẫn đạt; lỗi cùng loại có ở 6 label;
    - lần 3 tại `1ea3139`: **Đạt**.
  - Xem [log thi công](log/2026-10-18-reviewer-GMAIL-04-measure-harness.md), [log sửa](log/2026-10-18-reviewer-GMAIL-04-review-fixes.md), [review lần 1](https://github.com/VinhDat267/ATI_Project/pull/154#issuecomment-6244612341), [lần 2](https://github.com/VinhDat267/ATI_Project/pull/154#issuecomment-6244773528), [lần 3](https://github.com/VinhDat267/ATI_Project/pull/154#issuecomment-6244921347) và [log merge](log/2026-10-18-reviewer-merge-154.md).
- **#153** (`e8e31b9`): ghi #147 và #152 vào CURRENT-STATE và ROADMAP.
- **GMAIL-03 xong #147** (`6233637`), merge 18/10/2026 lúc 07:09:55 Việt Nam. `longnguyen005` thi công. Long đang bận nên nhóm trưởng giao reviewer sửa theo review.
  - **`/settings`:**
    - nhóm "Của riêng bạn" ở đầu trang, gồm các dịch vụ `connection === 'personal'`;
    - hàng Gmail có bốn trạng thái. Lúc chưa kết nối, hàng nói rõ ATI được làm gì và không xoá vĩnh viễn thư;
    - mọi thành viên thao tác được, không dựa vào `canConfigure`;
    - `/settings#gmail` focus đúng hàng;
    - hộp xác nhận ngắt kết nối có nút phụ "Giữ kết nối".
  - **Callback:**
    - query bị xoá khỏi URL trước khi gửi;
    - gửi một lần, kể cả ở StrictMode;
    - không làm mới token hay gửi lại khi nhận 401;
    - phản hồi đến muộn không điều hướng.
  - **Cockpit:**
    - "Gửi từ" giữ qua SSE, reload và khôi phục;
    - Tới/Cc/Bcc kèm nguồn, cảnh báo ở `send_message`/`forward`;
    - link "Mở thư mục Đã gửi" chỉ có ở ba tool gửi khi bước ở trạng thái `unknown`;
    - màn từ chối có nút "Kết nối Gmail" cho mọi người.

    Phần thẻ từng bước (sửa theo P2 của review):
    - web tra tool qua `toolDefinition()`, hàm này tra cả `GMAIL_TOOLS`;
    - 7 tool ghi Gmail có nhãn hành động riêng;
    - "Đích đến" là tiêu đề luồng thư; nhãn Gmail không tính là đích;
    - xem trước bước đổi nhãn và chuyển vào thùng rác hiện tên trường tiếng Việt, tiêu đề luồng và tên nhãn.
  - **Trang công khai:** `/privacy` thay câu "ATI không đọc Gmail…" và thêm các điểm của đặc tả mục 3.8 khi cờ bật. `/guide` và lưới dịch vụ của Landing có Gmail khi cờ bật. Quét bản build có mẫu chặn "không đọc Gmail".
  - **Browser:** nhóm `gmail` (OAuth và Gmail giả, có ca tiêu đề luồng 120 ký tự) và ca `GMAIL-03 off` ở nhóm default.
  - **Review lần 1** (16–17/10) tại `a2d622e`:
    - P2: thẻ duyệt ghi "Cập nhật" cho bước trả lời thư, đích luôn là "Trong phạm vi dịch vụ đã thiết lập", và xem trước bước chuyển vào thùng rác chỉ hiện ID thô. Nguyên nhân: `getToolDefinition` chỉ biết `ALL_TOOLS`;
    - P3: thẻ Gmail ở Landing nằm trong khoảnh khắc demo bị ẩn;
    - P3: đột biến G5 (link Đã gửi khi `failed`) và G11 (`/privacy` khi cờ tắt) lọt test;
    - P3: nút huỷ của hộp ngắt kết nối cùng kiểu nút chính.

    Reviewer gộp `main` (`0179ef3`, không rebase) rồi sửa ở `9c46f89`.
  - **Review lại:**
    - tại `9c46f89`: 1 P3, tiêu đề luồng dài liền ký tự làm trang 375 px rộng 1.120 px. `5f3bb2f` sửa ở thẻ duyệt và cả thẻ biên nhận;
    - tại `5f3bb2f`: **Đạt**.
  - **Còn lại:** đột biến G13–G15 của review lần 1 vẫn lọt test; mã hiện tại đúng, review ghi rủi ro thấp. Google thật và bật cờ thuộc GMAIL-04.
  - Xem [log thi công](log/2026-10-16-codex-GMAIL-03-gmail-ui.md), [review lần 1](https://github.com/VinhDat267/ATI_Project/pull/147#issuecomment-6231045632), [log sửa](log/2026-10-17-reviewer-GMAIL-03-review-fixes.md), [review lại](https://github.com/VinhDat267/ATI_Project/pull/147#issuecomment-6237634859), [log sửa P3](log/2026-10-18-reviewer-GMAIL-03-review-p3.md), [review lại lần 2](https://github.com/VinhDat267/ATI_Project/pull/147#issuecomment-6243532699) và [log merge](log/2026-10-18-reviewer-merge-147.md).
- **#152** (`2036396`): ghi #149, #150, #151 vào CURRENT-STATE và ROADMAP.
- **Khung W4-03 #149** (`fb38a4d`), **khung W4-01 #150** (`98d880b`), **công cụ W4-04 #151** (`ce59f4f`), merge 17/10/2026 theo thứ tự đó, mỗi lần khoá theo SHA head đã review. Nhóm trưởng giao reviewer thi công.
  - **#149 W4-03:**
    - `PROTOCOL.md`: định nghĩa chép nguyên văn task card; cách làm chỉ xem; bối cảnh 8 tài nguyên thử nghiệm; 10 tình huống không gợi ý câu chat; chia lượt 5 người × 4 lượt; phiếu ghi mã `P01`…; lượt được phép chạy thật ghi `chay-that` trong `note`.
    - `report.ts`: đọc phiếu, đọc PostgreSQL trong `READ ONLY`, tính số lần sửa (mỗi kế hoạch sau kế hoạch đầu), Wilson 95%. Exit 2 khi chưa đủ 20 lượt, 5 người, hoặc 4 lượt mỗi người.
    - Review lần 1 tại `0f076be`: P2 mẫu 16–1–1–1–1 vẫn báo đủ; P2 đếm cả bước `pending`/`skipped` là đã thực thi và tự ghi "chủ dự án cho chạy thật"; P3 CSV thiếu `superseded`. Sửa ở `4a7aa2c`.
  - **#150 W4-01:**
    - `GUIDE.md` (năm nhóm câu, workspace giả lập, 14 tool ghi, 11 loại điều kiện, 5 ví dụ được test kiểm), `cases.json` rỗng.
    - `validate.ts` kiểm định dạng từng câu và thành phần cả bộ; `run.ts` nhận `EVAL_SET=independent` và chạy cổng chặn trước mọi lời gọi model.
    - Ba file label cũ không đổi; câu cũ không có `author` được hiểu là `author-v2`.
    - Review lần 1 tại `40ac7a0`: P2 câu từ chối chỉ nhắc email không có `services` hợp lệ; P2 điều kiện sai kiểu (ví dụ `rows: {equals: true}`) vẫn được nhận; P3 test chưa giữ lời gọi cổng chặn trong `main()`. Sửa ở `ee05d2a`. Reviewer xác nhận `GUIDE.md` đủ để giao cho thành viên.
  - **#151 W4-04:**
    - `batch.ts`, `latency.e2e.ts`, `latency.config.ts` (`LIVE_APP_LATENCY=1`), `latency-prompts.json` (24 câu, 6 câu mỗi nhóm 1/2/3/≥4 dịch vụ). Thêm 5 test browser sandbox vào nhóm default và clarification.
    - Review lần 1 tại `a92accd`: P2 hết thời gian chờ vẫn báo hoàn tất và bỏ lại kế hoạch đến muộn (reviewer tái hiện bằng trigger `pg_sleep`); P2 percentile bỏ các lượt timeout nhưng ghi "Toàn bộ". Sửa ở `63149bd`: vòng chờ cuối, `resolved`/`unresolved`, timeout tính là "> N s".
  - Bằng chứng ở máy reviewer độc lập (ngoài Git): `ATI_Project-review-pr149/.codex/`, `ATI_Project-review-pr150/.codex/`, `ATI_Project-review-pr151/.codex/`. Xem [log merge](log/2026-10-17-reviewer-merge-149-150-151.md).
- **W3-11 xong #146** (`2960ab0`), merge 16/10/2026 lúc 22:33:45 Việt Nam. Nhóm trưởng giao reviewer thi công và ngồi duyệt từng lệnh ghi. Review độc lập lần 1 tại `f636d98` **chưa đạt** (1 P2); review lại tại `be86948` **Đạt**.
  - **Môi trường:** app live trên `main` `96f9f09`, model `ag/gemini-3.8-flash` qua 9router, PostgreSQL tmpfs riêng, không dùng DB của `.env`. 7 dịch vụ lưu khoá bằng `setup-credentials.ts`; Google Sheets do nhóm trưởng nhập ở `/settings` với private key nhiều dòng thật. Cả 8 dịch vụ kiểm tra kết nối `healthy`.
  - **Bảy lượt:**
    - Hủy (Trello, Slack): `rejected`, 0 bước;
    - Sheets, Calendar, Notion, Telegram, Jira, mỗi lượt kèm Slack: `completed` 2/2;
    - workflow Jira → Notion → Telegram → Slack: `completed` 4/4. Link của page Notion bằng URL ticket `ATIT-6`.
  - **Đối chiếu:** mỗi kết quả khớp ở biên nhận trên giao diện (link "Xem dòng", "Mở lịch", "Mở trang", "Mở issue"), ở PostgreSQL, và bằng tool đọc của dịch vụ. Telegram không có tool đọc tin; nhóm trưởng xác nhận bằng mắt và có ảnh. Màn xem trước hiện tên tài nguyên thay cho ID. Tới xem trước 7,1–15,0 s.
  - **Harness `evaluations/live-app/`** sửa theo giao diện hiện tại: `/login`, ô nhập chung, mã hội thoại từ URL, nút "Duyệt kế hoạch"/"Hủy", biên nhận "Đã xong…", che menu người dùng khi chụp. Thêm `LIVE_APP_CANCEL` và `LIVE_APP_SKIP_SERVICES`. Không sửa mã sản phẩm.
  - **Review lần 1:** P2, harness kiểm tiêu đề biên nhận trước khi lưu `result.json`. Reviewer tái hiện bằng cách ẩn `#heading-moment-6` trên adapter sandbox: PostgreSQL `completed` 3/3, nhưng thư mục chạy không có kết quả. `63ebd97` lưu kết quả PostgreSQL trước (cả khi chờ quá hạn), rồi mới kiểm giao diện; lượt ẩn tiêu đề vẫn fail nhưng giữ đủ bằng chứng (RED/GREEN trong log).
  - **Khác task card:** giao diện không còn nhãn Đọc/Ghi (từ FE-05b, kế hoạch chỉ gồm bước ghi); ảnh toàn trang có ô nhắn thêm đè giữa biên nhận, nhiều khả năng do cách chụp của Playwright.
  - Xem [log thi công](log/2026-10-16-reviewer-W3-11-new-services-frontend.md), [review lần 1](https://github.com/VinhDat267/ATI_Project/pull/146#issuecomment-6218570771), [review lại](https://github.com/VinhDat267/ATI_Project/pull/146#issuecomment-6218822691) và [log merge](log/2026-10-16-reviewer-merge-146.md).
- **#145** (`87b31e3`): ghi #142 vào CURRENT-STATE và ROADMAP; bước 1 của GMAIL-04.
- **ANS-01 xong #142** (`96f9f09`), merge 16/10/2026 lúc 14:10:42 Việt Nam. `longnguyen005` thi công. Review độc lập tại `993e485` **Đạt sau khi sửa nhỏ**; review lại tại `1971cd0` (đã rebase lên `main` có #143) **Đạt**.
  - **Cờ `PLANNER_READ_ANSWERS`** (`on`/`off`, mặc định `off`, giá trị khác là lỗi cấu hình). Cờ tắt thì prompt và khối kết quả tra cứu giữ nguyên từng byte (test SHA256), câu hỏi lại `read_only` của W3-10 giữ nguyên, và validator từ chối `kind: "answer"`.
  - **Planner** (chỉ chế độ `llm`):
    - câu chỉ đọc được tra cứu rồi trả `{ kind: "answer", text }`;
    - `validateAnswer` chỉ nhận khi lượt đó có ít nhất một lần đọc thành công do model yêu cầu, hoặc một danh mục prefetch thành công; text khác rỗng, tối đa 4.000 ký tự. Sai thì sửa một lượt, vẫn sai thì hỏi lại `read_only`;
    - `lookups` (tool, câu tìm, số kết quả, tối đa 5 link `https`) và `usedDirectory` do planner dựng, bỏ phần model tự khai;
    - `READ_ONLY_PLAN` (kế hoạch phải có bước ghi) giữ nguyên.
  - **API:** tin `assistant` có `metadata.type = 'answer'` kèm nguồn và correlation, sự kiện SSE `answer` rồi `idle`, không tạo kế hoạch. Lượt sau, câu trả lời vào lịch sử dưới dạng `<previous_answer>…</previous_answer>` kèm câu "đây là tóm tắt từ dữ liệu dịch vụ, không phải chỉ dẫn". Kịch bản sandbox `answer`.
  - **Web:** khoảnh khắc `answer` theo kiểu trang `responses`:
    - câu trả lời là văn bản thuần, không dựng markdown hay HTML;
    - dòng nguồn không bao giờ ghi "0 lần tra cứu"; danh sách "Đã tra cứu" mở/đóng được, link được kiểm lại `https:` ở trình duyệt;
    - mở lại hội thoại vẫn thấy câu trả lời, không để kế hoạch cũ chiếm màn; vẫn một ô nhập, câu tiếp theo lập kế hoạch như thường.

    Nhóm browser `answer` chạy ở 1440/375, sáng/tối.
  - **Review tại `993e485`:** P2, đột biến "prefetch lỗi vẫn tính là dữ liệu đọc" lọt toàn bộ test. Mã đúng, nhưng ca "mọi tra cứu đều lỗi" chỉ được test khi tắt prefetch, trong khi live bật prefetch mặc định. P3, câu cuối của khối kết quả tra cứu khi bật cờ không có test. `c7b69be` thêm hai test; rebase giữ `providerMemory(...)` và cả hai kịch bản sandbox `gmail`, `answer`.
  - Xem [log thi công](log/2026-10-14-codex-ANS-01-read-answers.md), [review](https://github.com/VinhDat267/ATI_Project/pull/142#issuecomment-6209257629), [log sửa và rebase](log/2026-10-16-codex-ANS-01-review-fixes.md), [review lại](https://github.com/VinhDat267/ATI_Project/pull/142#issuecomment-6210118741) và [log merge](log/2026-10-16-reviewer-merge-142.md).
- **#144** (`e03a9c8`): ghi #143 vào CURRENT-STATE và ROADMAP; sửa mục 3.8 của đặc tả Gmail.
- **GMAIL-02 xong #143** (`7c260c1`), merge 16/10/2026 lúc 13:09:01 Việt Nam. Nhóm trưởng thi công. Review độc lập bản đầu `3d3072b` **chưa đạt** (2 P1, 4 P2); review độc lập tại `78e6421` **Đạt sau khi sửa nhỏ**; review lại phần sửa tại `57c4888` **Đạt**.
  - **Adapter HTTP cho 10 tool** (`packages/tool-adapters/src/gmail/`):
    - thư MIME UTF-8 và tiêu đề RFC 2047; chặn CR/LF và NUL trong header; tối đa 20 người nhận;
    - trả lời và chuyển tiếp dựa trên thư đã gửi mới nhất của luồng; luồng chỉ có bản nháp trả `VALIDATION`;
    - 401 thì làm mới token một lần; không theo redirect; huỷ bằng `AbortSignal` thật.

    Ở sandbox, Gmail dùng adapter giả nhưng vẫn đi qua kết nối riêng của từng người.
  - **Chống gửi trùng.** Lỗi xảy ra trước khi gửi request ghi mang `requestSent: false`, và executor xếp nó vào `failed`. Lỗi sau khi đã gửi (treo, mất kết nối, JSON hỏng, 5xx) giữ `unknown` và không tự gửi lại.
  - **Người nhận** (`x-recipient`) chỉ nhận chuỗi viết thẳng, không nhận `$ref`/`$template`. Địa chỉ phải có trong câu người dùng hoặc trong danh sách người tham gia của luồng đã tra; địa chỉ chỉ xuất hiện trong nội dung thư bị từ chối.
  - **Dữ liệu thư gửi cho model:**
    - tool đọc Gmail chỉ giữ `id` và `participants` trong bộ nhớ làm việc (`observedFields`);
    - tiêu đề luồng giữ ở `__labels` để làm nhãn xem trước, và bị bỏ khỏi mọi input gửi provider;
    - prefetch của Gmail chỉ gọi `list_labels`.
  - **Định tuyến:** router không đưa dịch vụ riêng vào nhánh dự phòng khi câu không nhắc tới. Gmail lỗi thì không rơi về kế hoạch soạn sẵn của dịch vụ chung.
  - **Review tại `78e6421`:**
    - P2: đột biến R8 lọt toàn bộ test. R8 làm lệnh ghi đã gửi bị đánh dấu là chưa gửi, nên executor cho thử lại và thư có thể bị gửi hai lần. `57c4888` thêm assertion và 4 ca `StepRunner` → adapter thật → HTTP giả; R8 nay bị bắt;
    - 3 P3: hai P3 về adapter còn mở (mục 5); P3 về mục 3.8 của đặc tả (bộ nhớ làm việc và nhãn xem trước còn giữ tiêu đề luồng) được sửa trong PR bàn giao của #143.
  - Xem [log thi công](log/2026-10-14-codex-GMAIL-02-gmail-tools.md), [review](https://github.com/VinhDat267/ATI_Project/pull/143#issuecomment-6183517969), [log sửa P2](log/2026-10-15-codex-GMAIL-02-review-R8.md), [review lại](https://github.com/VinhDat267/ATI_Project/pull/143#issuecomment-6208991418) và [log merge](log/2026-10-16-reviewer-merge-143.md).
- **#141** (`61d3be4`): ghi #140 vào CURRENT-STATE và ROADMAP.
- **GMAIL-01 xong #140** (`8973a9e`), merge 14/10/2026 lúc 19:24:46 Việt Nam. Nhóm trưởng giao reviewer thi công. Review độc lập lần 1 **chưa đạt** (3 P2); sau khi sửa lỗi 1 và 2, review lại **Đạt**.
  - Gmail là dịch vụ riêng của từng người, sau cờ `GMAIL_ENABLED` (mặc định `off`). 10 tool schema và `GMAIL_SERVICE` export riêng, không vào `ALL_TOOLS`/`SERVICE_REGISTRY`; executor luôn biết tool Gmail là lệnh ghi. Migration 0009 thêm mode `connect_gmail` cho `oauth_states`, cột `status`/`status_changed_at` và ràng buộc "Gmail luôn có chủ" cho `service_credentials`.
  - Route `/api/connections/gmail` (start, callback, DELETE) theo khuôn AUTH-04, với client OAuth riêng; state dùng một lần và tách khỏi luồng đăng nhập/liên kết Google. Quản lý token: mỗi người một lượt làm mới tại một thời điểm; người gọi huỷ không huỷ lượt chung; `invalid_grant` chuyển kết nối sang `reconnect_required`. `GET /api/services` có `connection` và hàng Gmail của chính người gọi; ba route khoá chung từ chối Gmail; `/api/health` có `gmailEnabled` khi cờ bật.
  - Planner chuyển `actor` cho tra cứu. `AdapterFactory` lấy kết nối theo người, cache `gmail:<userId>`, kiểm `credentialId` của kế hoạch trước bước Gmail. Kế hoạch có bước Gmail được gắn `connections.gmail` trước khi băm.
  - Review lần 1 bắt 3 P2: callback OAuth cũ ghi đè kết nối mới; đăng xuất đã commit mà callback vẫn lưu; lỗi đọc DB sau khi duyệt làm kế hoạch kẹt ở `approved` (cả khi Gmail tắt). Lỗi 1 và 2 sửa ở `c420cfd`: khoá advisory → user → session giữ tới COMMIT, lần lưu đầu vô hiệu hoá các luồng còn lại, không thu hồi grant có thể đang dùng chung. Lỗi 3 sửa ở `7849f43`: dựng context trước CAS, không đọc DB sau khi duyệt. Bản sửa lỗi 3 chỉ có kiểm RED/GREEN của bên thi công.
  - Khác task card: mô tả tool viết tiếng Việt; `list_labels` giữ `id`, `name` trong bộ nhớ; `gmailEnabled` và hàng Gmail chỉ có khi Gmail dùng được; callback sau khi đăng xuất trả `401 INVALID_SESSION`. GMAIL-common mục 4.2 đã cập nhật.
  - Xem [log thi công](log/2026-10-14-reviewer-GMAIL-01-personal-connection.md), [review lần 1](https://github.com/VinhDat267/ATI_Project/pull/140#issuecomment-6161726666), [log sửa](log/2026-10-14-codex-GMAIL-01-review-fixes.md), [kiểm lỗi 3](https://github.com/VinhDat267/ATI_Project/pull/140#issuecomment-6168248566) và [log merge](log/2026-10-14-reviewer-merge-140.md).
- **#139** (`b9ceaee`): ghi #137, #138 vào CURRENT-STATE và ROADMAP.
- **W4-00b xong #137** (`ebc192d`), merge 14/10/2026 lúc 10:15:57 Việt Nam. `longnguyen005` thi công; review độc lập **Đạt**, không có P1/P2/P3.
  - `validator.ts` duyệt đệ quy `args` của mọi bước, cả mảng và object lồng. Chuỗi thường chứa `${<id>.output…}` bị từ chối ở lớp semantic; câu lỗi nêu bước, đường dẫn tham số và cách dùng `$template`/`$ref`, để model tự sửa ở lượt thử lại hiện có. `${HOME}`, `$100`, `${{ secrets.X }}` vẫn hợp lệ.
  - Placeholder người dùng gõ nguyên văn được giữ khi có grounding. Câu lỗi của lượt thử lại và lịch sử assistant không được tính là câu người dùng.
  - Không đổi prompt, executor, label hay matcher golden. Thêm 25 test (17 validator, 8 planner ở cả `regex`/`llm`). RED 16 fail trước sửa; 3 đột biến của người thi công và 8 đột biến của reviewer đều bị bắt.
  - Công cụ chạy thật `evaluations/live-execution/harness.ts` kiểm lại plan mà không có grounding, nên placeholder người dùng gõ sẽ bị từ chối khi chạy bằng `run.ts`. Đúng quy tắc của task card và an toàn hơn; app không kiểm lại khi duyệt nên không bị ảnh hưởng.
  - Xem [log thi công](log/2026-10-13-codex-W4-00b-raw-step-placeholders.md), [bình luận review](https://github.com/VinhDat267/ATI_Project/pull/137#issuecomment-6160075930) và [log merge](log/2026-10-14-reviewer-merge-137.md).
- **#138** (`6185b2c`), merge 14/10 lúc 10:03:20 Việt Nam: [đặc tả Gmail theo kết nối riêng và kiểu "trả lời"](../superpowers/specs/2026-10-13-gmail-personal-connections-design.md) (nhóm trưởng duyệt 13/10), task card [GMAIL-common](tasks/GMAIL-common.md), GMAIL-01 → GMAIL-04 và ANS-01. ROADMAP thêm 5 dòng, mục 7 thêm "Chốt 13/10/2026", `.gitignore` thêm `docs/ai-evidence/GMAIL-LIVE/`. Chỉ tài liệu. Review độc lập ngày 13/10 chỉ xét bản 1 của đặc tả; bản chỉnh ở mục 11 và các task card chưa có review độc lập. Xem [log](log/2026-10-13-reviewer-plan-gmail.md).
- **W4-00 xong #133** (`6ee4109`), merge 13/10/2026 (Asia/Saigon), review độc lập Codex **Đạt**, CI đúng head `2d80355` xanh. Chỉ thêm runbook, báo cáo, Kết quả task card và log; mã sản phẩm/prompt/label không đổi. Chọn `cx/gpt-6.1-sol` bằng probe ba ứng viên và các campaign riêng; core partial được giữ nguyên, services complete, app live tới preview rồi Hủy. Chuyển thủ công và quay lại Gemini bằng environment, không sửa `.env` chính. [Log merge](log/2026-10-13-codex-W4-00-merge.md).
- **FE-11 xong #129** (`828c21a`), merge 11/10 lúc 08:30:55 Việt Nam. `longnguyen005` thi công bằng Codex; Claude Code review độc lập: lần 1 "Chưa đạt, sửa nhỏ", lần 2 **Đạt**.
  - Đăng nhập lại về đúng trang: lưu `pathname + search + hash` trong `sessionStorage`, chỉ đường dẫn nội bộ, dùng một lần, khoá theo người dùng khi biết phiên cũ; đi qua cả mật khẩu và Google; đăng xuất chủ động không lưu. Mất phiên do tab khác báo "Phiên đăng nhập đã kết thúc ở một tab khác."
  - API trả 404 cho ID hội thoại/kế hoạch sai định dạng, chặn ở repository trước PostgreSQL (test HTTP 14 route). Frontend mã hoá ID trong HTTP/SSE; 500 báo "Máy chủ gặp lỗi", chỉ lỗi mạng và 502–504 báo mất kết nối; màn lỗi tải hội thoại có `h1`; lỗi lập kế hoạch do mất mạng có tiêu đề riêng.
  - `ClarificationResponse.reason` (`read_only`/`destination`) đi từ tool-schemas → planner → API → web; dữ liệu cũ vẫn dùng regex. Đóng các P3 còn mở: hai điều kiện của chốt `hydrateResponse` có test riêng, test `openWhenHidden`, Back sau khi tạo hội thoại lỗi bỏ qua trang nháp, test Google chờ đúng phản hồi config (server test trả chậm 200 ms).
  - Sửa thêm lỗi có sẵn từ FE-08: timer 100 ms đặt focus vào ô Email chạy sau khi người dùng (hoặc Playwright) đã sang ô Mật khẩu, làm mật khẩu bị gõ vào ô Email. Nay đặt focus trong `useLayoutEffect` và không giành focus của ô đang sửa. Dấu hiệu này khớp các ca browser chập chờn ở bước đăng nhập (mục 5), chưa chứng minh cho từng ca.
  - Review lần 1 bắt 2 P2 (ca browser FE-11 chập chờn do fixture cùng `created_at` và trang cũ phát hiện thu hồi phiên trước reload; bản sửa C7 chỉ chờ request đến server) và 3 P3 (đường Google và việc truyền `networkError` chưa có test, câu tab khác khẳng định sai lý do). Cả năm đã đóng. Long sửa email git và rebase kèm `--reset-author`, nên 13 commit của #129 gắn tài khoản `longnguyen005`; commit FE-10 đã vào `main` giữ nguyên, không viết lại lịch sử.
  - Còn lại: D1 (bundle 877 kB) và D2 (xoá `MissionControlLaunchpad`) tuỳ chọn, chưa làm; P3 effect focus chạy lại khi `signupEnabled` đổi có thể kéo focus khỏi một nút trong hộp nếu config về trễ.
  - Xem [log thi công](log/2026-10-10-codex-fe-11-frontend-bugfixes.md), [log sửa review](log/2026-10-11-codex-fe-11-review-fixes.md), [review lần 1](https://github.com/VinhDat267/ATI_Project/pull/129#issuecomment-6099178321) và [log merge](log/2026-10-11-claude-code-merge-129.md).
- **#130** (`84a3461`): ghi #128 vào CURRENT-STATE và ROADMAP.
- **FE-10 xong #128** (`e08e623`), merge 10/10 lúc 22:45:42 Việt Nam. `longnguyen005` thi công bằng Codex; Claude Code review độc lập: lần 1 "Đạt sau khi sửa nhỏ", lần 2 **Đạt**.
  - `/guide` và `/privacy` là trang React của bản mẫu, thay hai placeholder; nối điều hướng, theme, menu thật, bỏ vai trò/tài khoản/kịch bản demo. Cẩm nang có 8 dịch vụ, 12 mẫu câu (5 mẫu viết lại cho làm được), mỗi mẫu khai báo tool và test đối chiếu `ALL_TOOLS`. Privacy chỉ nói đúng hệ thống: phiên 7 ngày, khoá dịch vụ mã hoá khi lưu; không quảng bá tính năng không có. 404 bỏ câu "an toàn tuyệt đối".
  - Quét bản build chặn 6 nhóm câu sai sự thật. Static guard có ngoại lệ hẹp cho `Guide/data.tsx`. Logo Jira ở chế độ tối đổi sang `#60A5FA` (7,14:1 trên `#0E1528`), chờ người dùng quyết (mục 5).
  - Audit tự động mọi route ở sáng/tối: một `h1`, một `main`, nút biểu tượng có nhãn; bảng chữ dưới 3:1 ghi trong [log FE-10](log/2026-10-10-codex-fe-10.md). 12 cặp ảnh app/bản mẫu cho Guide, Privacy, 404 (không commit).
  - Review lần 1 bắt 2 P2: nút sáng/tối của `/privacy` nằm cuối trang, sau footer (bộ 12 cặp ảnh không phát hiện); tiêu chí "Rà soát cuối" (chụp lại FE-05b → FE-09 cạnh bản mẫu) chưa làm mà không ghi. Commit `88f12af` chuyển nút vào header, có test DOM và browser, và ghi rõ phần rà soát là **chưa làm**. Hai lần tăng timeout trong `auth-google.test.tsx` và `fe-08-landing-auth.test.tsx` trùng FE-11 C7; bundle 779 → 875 kB (FE-11 D1).
  - Xem [log Codex](log/2026-10-10-codex-fe-10.md), [review lần 1](https://github.com/VinhDat267/ATI_Project/pull/128#issuecomment-6096421782) và [review lần 2](https://github.com/VinhDat267/ATI_Project/pull/128#issuecomment-6099235906).
- **#127** (`d319a32`): task card FE-11 từ audit frontend 10/10, giao `longnguyen005`.
- **#118 test chốt `hydrateResponse`** (`d87c80e`), merge 10/10. Codex thi công; Claude Code review độc lập: **Đạt**. Một test giữ kế hoạch mới đến qua SSE trong lúc tải lịch sử kết thúc bằng refusal cũ; chỉ mock ranh giới API, race bằng deferred Promise. Đột biến: bỏ hẳn chốt thì test mới fail; bỏ riêng một trong hai điều kiện (`messages` hoặc `planRevision`) thì 643/643 vẫn đạt, vì ca này đổi cả hai (mục 5). Xem [bình luận review](https://github.com/VinhDat267/ATI_Project/pull/118#issuecomment-6094859548).
- **#124, #125 và dọn repo** (10/10, Claude Code theo yêu cầu người dùng): giao FE-10 cho `longnguyen005` (task card và ROADMAP; thêm mục đo logo Jira trên nền tối); `.gitignore` thêm `docs/reports/` (báo cáo môn học, trước đó untracked mà chưa ignore), `.github/agents`, `.github/hooks`. Bật `delete_branch_on_merge`; xoá 11 worktree Codex trong `orca` (nhánh đã merge, worktree FE-10 rỗng, hoặc nội dung đã lưu bằng tag/PR), 19 nhánh local và 18 nhánh GitHub đã merge hoặc đã lưu bằng tag. Ba nhánh của Nguyen Thanh Long (`Frontend_UXUI`, #47, #87, hướng Planora) giữ nguyên, chờ người dùng/tác giả quyết. Log Codex chạy thử live 08/10 chưa từng commit được đưa vào cùng PR với bản cập nhật này.
- CI `main` sau merge #121 (`b4227de`, [run 37879110051](https://github.com/VinhDat267/ATI_Project/actions/runs/37879110051)) đỏ một lần: 72 pass/1 fail, ca FE-04 route công khai lỗi `page.screenshot: Protocol error (Page.captureScreenshot)`; CI `main` sau #122 và #123 xanh (mục 5).

- **AUTH-07, FE-08, FE-09 xong #120 → #122**, merge 09/10; review độc lập nguồn, đối chứng và tích hợp đạt. AUTH-07 yêu cầu mật khẩu thật khi gỡ Google, giữ kiểm hash/phiên sau chờ khóa. FE-08 đưa Landing/AuthAction của bản React vào app và sửa phản hồi đăng nhập tại deep link. FE-09 đưa Account/Users/History vào app, giữ draft mới, mật khẩu nguyên văn và quyền quản trị; runner dùng chung khóa JWT thử nghiệm cho API/browser khi chưa cấu hình.
  - Merge lần lượt `5c7bed4`, `b4227de`, `c4f2170`; CI trước mỗi merge xanh đúng head. Bản tích hợp cuối: check **1.634 + 173**, browser **97/11 nhóm**. [Log reviewer](log/2026-10-09-codex-merge-fe-08-fe-09.md) có head, CI, đối chứng và giới hạn.
  - Visual giữ provenance bộ ảnh cũ đã review: FE-08 96 cặp/192 PNG, FE-09 40 PNG; 1440×900 và 375×812 sáng/tối, năm CSS trang bằng prototype từng byte. Không chụp lại trong review merge. Không gọi lại Google/SMTP/model/dịch vụ live; FE-10 tiếp tục rà soát trợ năng.
- **W3-10 xong #102** (`d40d735`), merge 09/10 lúc 05:33:01 Việt Nam. Codex thi công; Claude Code review độc lập: **Đạt**, không có P1/P2.
  - Yêu cầu chỉ đọc: prompt có quy tắc 0 (hỏi lại ngay, không tra cứu); validator từ chối plan không có bước ghi (`READ_ONLY_PLAN`), planner đổi thành câu hỏi lại cố định mà không tốn thêm lời gọi. Plan vừa đọc vừa ghi giữ hành vi cũ.
  - Đo từng lời gọi model qua kênh phụ: thời điểm, thời lượng, số lần thử và lý do, model được phục vụ, token; thời gian prefetch/tra cứu. `run.ts` đưa vào `report.json` và `summary.md`; bản public che prompt bị model lặp lại, kể cả trong tên khóa JSON.
  - Label 6 câu read_only sửa trong commit riêng `795229e` trước báo cáo model đầu `66896ca`; label và fixture không đổi sau đó. Đo lại đủ ba bộ, mỗi bộ 3 lần (mục 3). Mục tiêu p95 services chưa đạt, đã báo cáo nguyên nhân bằng số liệu.
  - Review: chạy lại check/browser, 8/9 đột biến bị bắt (phép còn lại là prompt, kiểm bằng phép đo thật), đối chiếu số liệu với báo cáo gốc. 3 điểm ghi ở mục 5. Xem [log đo](log/2026-10-09-codex-W3-10-live-remeasurement.md) và [bình luận review](https://github.com/VinhDat267/ATI_Project/pull/102#issuecomment-6070117788).
- **#117** (`55b4a58`): ghi #116 vào CURRENT-STATE và ROADMAP.
- **FE-06 phần (b) xong #116** (`572da6d`), merge 09/10 lúc 04:53:45 Việt Nam. Codex thi công; Claude Code review độc lập: **Đạt**, không có P1/P2.
  - Từ chối: dùng `unavailableServices` và trạng thái thật của từng dịch vụ trong yêu cầu; người có `canConfigure` thấy "Kết nối <dịch vụ>" tới `/settings#<id>` (nhiều dịch vụ thì `/settings`), thành viên chỉ thấy câu nhờ quản trị viên; từ chối kiểu cũ không có metadata vẫn hiện lý do. "Sửa yêu cầu" đưa câu cũ vào ô nhập, không tự gửi. Mọi màn từ chối/hỏi lại có câu "Chưa có gì được ghi lên công cụ nào."
  - Hỏi lại mở rộng (chỉ để xem, không thấy nơi cần ghi) theo `responses.html`; loại câu hỏi lại đang được đoán từ nội dung câu (mục 5).
  - Lỗi chung: dải mất mạng, nút "Thử lại" chỉ gọi `/api/health` và nối lại SSE; hết phiên về đăng nhập với "Phiên đăng nhập đã hết hạn"; lập kế hoạch quá 15 giây hiện tiến trình tra cứu thật, "Thôi chờ" giữ câu yêu cầu và kế hoạch đến muộn vẫn phải duyệt; lỗi lập kế hoạch dùng câu hệ thống, "Thử lại" chỉ gửi lại câu cũ.
  - Khi mở lại hội thoại, phản hồi mới nhất (từ chối, hỏi lại, lỗi) giữ màn dù snapshot cũ về trước hay sau lịch sử. Review agent của Codex bắt và đóng 1 P2 về việc này. Sửa fixture cuộn của test FE-02 (một nguồn chập chờn ở mục 5), giữ nguyên assertion.
  - Review: chạy lại check/browser, 11/12 đột biến bị bắt, xem ảnh đối chiếu. 4 P3 ở mục 5. Xem [log Codex](log/2026-10-09-codex-fe-06b-responses-and-errors.md) và [bình luận review](https://github.com/VinhDat267/ATI_Project/pull/116#issuecomment-6065918028).
- **#115** (`e269743`): ghi kết quả chạy thử lập kế hoạch live sau #113. **#114** (`ca7bc26`): ghi #113 vào CURRENT-STATE và ROADMAP.
- **#113 chấp nhận tên model `gemini-3.8-flash-n`** (`6f65b0c`), merge 08/10 lúc 22:35:40 Việt Nam. Claude Code thi công theo yêu cầu người dùng, **tự review**.
  - Trên `main`, provider từ chối mọi phản hồi có tên model khác cấu hình, nên live không lập được kế hoạch nào. Audit 9router 0.5.95 ngày 08/10 (báo cáo ở máy người dùng, ngoài repo): trường `model` của response lấy từ `modelVersion` của upstream Antigravity; alias `ag/gemini-3.8-flash` trỏ tới `gemini-3.8-flash-medium`; không có combo nên không có fallback sang model khác; nghĩa của `-n` chưa xác minh.
  - Người dùng đã duyệt cặp tên này ngày 07/10 (W3-10, commit `845701c` của #102). #113 đưa riêng phần đó vào `main`: chỉ chấp nhận đúng cặp `ag/gemini-3.8-flash` → `gemini-3.8-flash-n`, vẫn từ chối hậu tố, model và route khác; `lastServedModel` vẫn ghi tên thật. Không đổi prompt hay cách lập kế hoạch.
  - Test RED commit riêng (1 fail / 18 đạt), GREEN 19/19, 2/2 đột biến bị bắt. Chưa gọi model thật sau sửa. Xem [log](log/2026-10-08-claude-code-planner-flash-n-alias.md).
- **#112** (`4afa2c2`): ghi #110, #111 vào CURRENT-STATE và ROADMAP.
- **#111 dọn FE-06A** (`06fdd09`), merge 08/10 lúc 21:33:02 Việt Nam. Codex thi công; Claude Code review độc lập: **Đạt**.
  - Codex review độc lập commit `2e4e6c7` (phần Claude Code tự sửa sau review #107) và bắt các P2: ô Sheets có dấu phẩy/gạch chéo bị gộp lẫn với ô khác; chuỗi người dùng dạng `${…}` bị đổi thành tham chiếu kế hoạch; tham chiếu `.id`/`.url`/`.fullName` mất nghĩa trường; dịch vụ có schema không mô tả hiện tên trường kỹ thuật (`spreadsheetId`, `chatId`…); template không đổi giá trị theo đúng cách executor làm. Sửa trong `recovery-request.ts` và nhãn ở `recovery-labels.json`.
  - Ca browser FE-06A có thêm ghi chẩn đoán khi fail (DOM, ảnh, request, lỗi console). Chụp lại 8 ảnh màn kết thúc. Chạy planner thật với câu sửa: gateway trả `gemini-3.8-flash-n` nên provider từ chối (mục 5).
  - Review: chạy lại check/browser, 7/7 đột biến bị bắt. Xem [log Codex](log/2026-10-08-codex-FE-06A-followups.md) và [bình luận review](https://github.com/VinhDat267/ATI_Project/pull/111#issuecomment-6062127169).
- **#110 dọn FE-07** (`c21afc0`), merge 08/10 lúc 21:32:39 Việt Nam. Codex thi công; Claude Code review độc lập: **Đạt**.
  - Đóng 5 P3 của review #108. `GET /api/services` trả `canConfigure` tính bằng `isAdmin(user, SERVICE_ADMIN_USER_IDS)`, frontend dùng trường này thay vì `role`; test HTTP trên PostgreSQL thật cho admin, member trong allowlist, member thường và đổi vai trò. Ô text không phải khoá có ví dụ định dạng. Hàng dịch vụ bọc `role="listitem"`. Xoá `ServiceCard.tsx`. Ca browser thành viên tự chuẩn bị Notion qua API.
  - Review: chạy lại check/browser, ca thành viên chạy riêng 1/1, 4/5 đột biến bị bắt (1 tương đương). Xem [log Codex](log/2026-10-08-codex-FE-07-followups.md) và [bình luận review](https://github.com/VinhDat267/ATI_Project/pull/110#issuecomment-6062126343).
- **#109** (`c37e2e9`): ghi #104 → #108 vào CURRENT-STATE và ROADMAP.
- **FE-06 phần (a) xong #107** (`f796467`), merge 08/10 lúc 19:36:03 Việt Nam. Codex thi công; Claude Code review độc lập rồi tự sửa theo yêu cầu người dùng.
  - Khoảnh khắc 7 (lỗi đã biết), 8 (chưa rõ kết quả), 9 (khôi phục sau khởi động lại) chép từ `app-stage` của bản React, nối snapshot thật; thay `PartialFailureModal` và `ReconciliationNotice` (đã xoá, 11 ca test cũ chuyển sang). Bước chưa rõ kết quả không có Thử lại/Sửa/Làm tiếp kể cả khi `recoveryActions` sai; Dừng phải xác nhận; phản hồi khôi phục đến muộn không đổi màn của hội thoại hay kế hoạch khác.
  - Kết thúc không thành công (`stopped`/`rejected`/`failed`) dùng bố cục khoảnh khắc 6. Đóng 5 P3 của #103 (câu cảnh báo theo `runtimeMode`, đếm công cụ chỉ theo bước thành công, bước bị bỏ qua không có link, đóng "Sửa qua Chat" khi kế hoạch đổi, tin "Kế hoạch … sẵn sàng" qua SSE).
  - "Sửa rồi thử lại": API retry không nhận tham số, nên dừng kế hoạch cũ rồi gửi một yêu cầu sửa; kế hoạch mới phải duyệt lại.
  - Review độc lập trên `c8c5fc0`: "Đạt sau khi sửa nhỏ", 2 P2: yêu cầu sửa gửi dưới tên người dùng có mã bước và JSON, tràn ngang ngăn hội thoại; test link của bước bị bỏ qua tìm sai nhãn nên không kiểm gì. Người dùng giao Claude Code sửa ở `2e4e6c7` (câu tiếng Việt theo nhãn schema, ô ghi chú trống, tin dài xuống dòng, sửa test, thêm 2 test chốt chặn). Phần sửa **chỉ Claude Code tự kiểm**, chưa có review độc lập.
  - 18 phép đột biến trên bản gốc (13 bị bắt), 5 phép trên bản sửa (5 bị bắt). Chạy thử app thật ở sandbox kịch bản `partial_failure`. Chưa chạy model thật với câu sửa mới.
  - Gộp `main` sau #108 có xung đột ở bộ lọc browser (`FE-06A:` và `FE-07:`), đã giữ cả hai. Xem [log Codex](log/2026-10-08-codex-fe-06a-cockpit-recovery.md), [bình luận review](https://github.com/VinhDat267/ATI_Project/pull/107#issuecomment-6058605141) và [log sửa](log/2026-10-08-claude-code-FE-06A-review-fixes.md).
- **FE-07 xong #108** (`d5e7a9e`), merge 08/10 lúc 19:26:04 Việt Nam. Codex thi công; Claude Code review độc lập: "Đạt sau khi sửa nhỏ", rồi **Đạt** sau khi Codex sửa P2.
  - `/settings` là trang Settings của bản React (ngoài `AppShell`), `page.css` giữ nguyên byte; `SettingsModal` đã xoá. Hai nhóm "Đã thiết lập"/"Chưa thiết lập", nhãn 4 trạng thái kèm giờ kiểm tra; ngăn chi tiết có focus trap, Esc, trả focus về hàng kể cả khi danh sách vẽ lại; `/settings#<id>` mở thẳng ngăn.
  - Đổi khoá gửi đủ khoá; chỉ đổi nơi được dùng thì PUT scope riêng (UI-API-01); lưu xong về "Chưa kiểm tra". Kiểm tra kết nối huỷ bằng `AbortSignal` sau 10 giây, kể cả khi headers đã về mà body treo. Thành viên bị khoá ô khoá/chip/Lưu, vẫn kiểm tra được. Giữ 4 ca W3-00b.
  - P2 của review: lúc đang tải hoặc tải lỗi, trang ghi "Tất cả 8 dịch vụ đều đã được thiết lập." Codex sửa ở `658420c` (chỉ hiện số và hai nhóm khi đã có danh mục), có RED/GREEN; reviewer chạy lại 53/53 và đột biến bị bắt. 5 P3 ở mục 5.
  - 15 phép đột biến (13 bị bắt, 2 tương đương). Xem [log Codex](log/2026-10-08-codex-FE-07.md), [log sửa P2](log/2026-10-08-codex-FE-07-review-p2.md) và [bình luận review](https://github.com/VinhDat267/ATI_Project/pull/108#issuecomment-6056958988).
- **#106 sửa test chập chờn** (`eb48f0b`), merge 08/10 lúc 11:36:24 Việt Nam: test tài khoản chờ `/api/auth/config` bằng `findByRole`; 2 test `chat-api` nới thời gian chờ tiến trình; mặc định `DATABASE_URL` của 12 file test `chat-api` đổi từ 55532 sang 55533. Claude Code tự kiểm. Xem [log](log/2026-10-08-claude-code-stabilize-flaky-tests.md).
- **#105 xoá `System Design/`** (`564b6cb`), merge 08/10 lúc 00:54:36 Việt Nam: 4 file design system "Chat UI" thời v2, mâu thuẫn với `DESIGN.md` Agentic; bản lưu trong tag `archive/v2-final`. Xem [log](log/2026-10-08-claude-code-remove-system-design-v2.md).
- **#104** (`34d1f53`): ghi #103 vào CURRENT-STATE và ROADMAP.
- **FE-05b phần (b) xong #103** (`c7cf6e3`), merge 08/10 lúc 00:26:10 Việt Nam. Codex thi công; Claude Code review độc lập: **Đạt**, không có P1/P2.
  - Khoảnh khắc 4–6 chép từ trang `app-stage` của bản React, nối store/API: thẻ từng việc và thanh hành động dính đáy (khoảnh khắc 4); thanh tiến độ bằng số bước xong / tổng (5); biên nhận lưới 2 cột, mũi tên chỉ khi plan có `$ref`/`$template`, link chỉ `https` (6). Ô nhắn thêm cố định ở đáy, "Sửa qua Chat" ngay trên thanh, ngăn hội thoại 420px và ngăn lịch sử 380px có nền mờ, hộp xem trước theo loại nội dung; luôn một ô nhập. Thời lượng kiểu Việt. `ExecutionProgress` cũng chỉ cho link `https`.
  - Script test cho chọn cổng DB/API/web riêng (`V3_LOCAL_DB_PORT`, `PORT`, `V3_WEB_PORT`) và callback OIDC theo cổng web, để nhiều agent chạy song song; mặc định giữ nguyên, vẫn chặn DB dev 15433 và 5432. Người dùng cho phép.
  - Review: chạy lại check và browser (mục 3), 14 phép thử đột biến (10 bị test bắt), so ảnh app thật (sandbox `three_service`) với bản React. 5 P3 chuyển vào [FE-06](tasks/FE-06-cockpit-recovery-and-responses.md) (mục 5 bên dưới).
  - CI PR xanh đúng head `66b46ae`. Xem [log Codex](log/2026-10-07-codex-FE-05b-part-b.md) và [bình luận review](https://github.com/VinhDat267/ATI_Project/pull/103#issuecomment-6043156077).
- **#101 cập nhật trạng thái** (`2f7b086`), merge 08/10 lúc 00:25:59 Việt Nam: ghi #98, #99, #100 vào CURRENT-STATE và ROADMAP. Chỉ tài liệu, tự review. Lần merge đầu (07/10 khoảng 23:56) bị GitHub trả lỗi 500 cho mọi thao tác ghi; thử lại sau thì được. Xem [log](log/2026-10-07-claude-code-merge-100.md).
- **FE-05b phần (a) xong #100** (`8155c03`), merge 07/10 lúc 22:04:26 Việt Nam. Codex thi công; Claude Code review độc lập.
  - Cockpit ở `/` và `/c/:id` dùng `usePrototypePage` với trang `app-stage`: thanh trên của bản React (gộp "Yêu cầu hiện tại", nút Lịch sử/Xem hội thoại, menu người dùng thật, dải thử nghiệm theo `runtimeMode`), khoảnh khắc 1–3 nối store/API. `AppShell` không còn dựng ở route cockpit. Trang cuộn cả document; đổi khoảnh khắc thì cuộn về đầu và focus `h1`, trừ khi đang gõ hoặc đang ở dialog (đóng 2 P3 của FE-05).
  - Hỏi lại: radio chỉ chọn, "Xác nhận và tiếp tục" mới gửi; một ô nhập duy nhất. Thẻ gợi ý theo dịch vụ đã kết nối, tối đa 4.
  - Review lần 1 "Đạt sau khi sửa nhỏ": 2 P2 (báo sai "Chưa có dịch vụ nào được kết nối" khi đang tải/lỗi; thẻ gợi ý không chép từ bản React và chưa so ảnh) và 5 P3; Codex sửa ở `af27e82`. Review lại: Đạt, còn 3 P3; người dùng giao Claude Code sửa luôn ở `65f2c9a` (câu hỏi lại chỉ nhận chữ, tránh trắng trang khi model trả object; `prototype/theme.css` lại khớp nguyên văn bản gốc, có test giữ; logo Slack bốn màu). Commit `65f2c9a` chỉ Claude Code tự kiểm.
  - Phần (b) còn mở: khoảnh khắc 4–6, ô nhắn thêm, hai ngăn, hộp xem trước, định dạng thời lượng; hiện vẫn là FE-05 nhưng chịu chữ/màu của bản mẫu (quy tắc FE-04 không áp ở trang `app-stage`).
  - CI PR xanh đúng head `4eaba8f`; cây merge bằng head. Xem [log Codex](log/2026-10-07-codex-FE-05b-part-a.md) và [log Claude Code](log/2026-10-07-claude-code-FE-05b-part-a-p3.md).
- **#99 `DESIGN.md` theo Agentic** (`b41031d`), merge 07/10 lúc 16:34:24 Việt Nam. Chỉ tài liệu, tự review. `DESIGN.md` ở gốc repo (định dạng DESIGN.md, hình ảnh chủ đạo "Sân khấu điều phối") và `.impeccable/design.json` thay bản "Warm Workshop" thời v2; `PRODUCT.md` không đổi. [CI main](https://github.com/VinhDat267/ATI_Project/actions/runs/37601544999) xanh. Xem [log](log/2026-10-07-claude-code-DESIGN-md-agentic.md).
- **FE-04b xong #98** (`7df8eac`), merge 07/10 lúc 16:39:40 Việt Nam. Claude Code thi công theo yêu cầu người dùng, tự review; **chưa có review độc lập**.
  - Lớp nền của bản React trong `apps/chat-web/src/prototype/` (CSS tương thích v3, bảng màu, `theme.css`, `usePrototypePage`, nút sáng/tối). Mọi thứ đổi theo phạm vi `data-proto-page`: màn chưa chuyển giữ quy tắc FE-04. Trang 404 làm thử, khớp bản React 0 pixel lệch ở 1440/375 sáng/tối.
  - `npm run check` 1.380 + 165, browser 56/56. [CI main](https://github.com/VinhDat267/ATI_Project/actions/runs/37602149247) xanh đúng `7df8eac`. Xem [log](log/2026-10-07-claude-code-FE-04b.md).
- **#97 kế hoạch đưa bản React vào app** (`0cdb02a`), merge 07/10 lúc 15:48:56 Việt Nam. Chỉ tài liệu, tự review; người dùng cho merge. CI `v3` xanh đúng head `61cf11f`, cây merge bằng head.
  - Người dùng chốt: đưa thẳng bản React của bản mẫu vào app; app theo Agentic đúng như 12 bản mẫu, bỏ các điều chỉnh riêng cho app (chữ tối thiểu 14px, nền `#F6F6F1`, token suy ra). Đặc tả mục 1, 1.1, 1.2 viết lại; thêm FE-04b; FE-05b dời 13/10; FE-06 → FE-10 chép trang của bản React.
  - `docs/design/design-system.md`: design system rút từ 12 bản mẫu, đối chiếu gói Agentic của Open Design 0.24.1 (gói tự mâu thuẫn giữa `DESIGN.md` và `tokens.css`; không chép file vì không ghi giấy phép).
  - Xem [log](log/2026-10-07-claude-code-plan-port-prototypes.md).
- **PROTO-01 bước 4 xong #96** (`581addd`), merge 07/10 lúc 14:14:47 Việt Nam: `index` (route `/`) và `app-stage` sang React; cả 12 trang không còn `todo()`.
  - Lớp tương thích mới: class `transform` của v3 luôn đặt ma trận đơn vị (phần tử có lớp vẽ riêng, đổi cách khử răng cưa chữ bên cạnh), v4 không; giữ cách của v3 ở 20 chỗ trong 9 trang. Biến `--font-*` của trang đổi thành `--page-font-*` vì bị biến theme v4 đè.
  - Script so có thêm so transform thực tế, bước `move`, tuỳ chọn `only`/`motion`; mặc định chạy 12 trang.
  - Trước merge: so toàn bộ 462/464 (`index` 44/44, `app-stage` 72/72; 2 lệch là dao động nét chữ Playfair và hover), chạy lại `account settings` 116/116 exit 0. Sau merge, so lại trên `main` `581addd`: 459/464 trường hợp, exit 1 (`index` 43/44, `app-stage` 57/58, `auth-action` 47/50, chín trang còn lại đạt hết; 9 trường hợp đạt ở lần chạy lại). Cả 5 trường hợp lệch đều là trạng thái chụp giữa chừng một hẹn giờ: `auth-action` "Đang gửi lại" (2 khổ) và đồng hồ đếm ngược, `index` trả focus sau Esc, `app-stage` gợi ý tự chuyển khoảnh khắc. Chạy riêng từng trạng thái đều đạt (2 trong 4 lần cần chạy lại). Chưa có lần so toàn bộ 12 trang nào exit 0.
  - [CI `v3`](https://github.com/VinhDat267/ATI_Project/actions/runs/37585664606) xanh đúng head `841e674`; cây merge bằng head; [CI main](https://github.com/VinhDat267/ATI_Project/actions/runs/37586153208) xanh đúng merge `581addd`. Claude Code thi công theo yêu cầu người dùng, tự review; người dùng cho merge. Xem [log](log/2026-10-07-claude-code-PROTO-01-step4.md).
- **PROTO-01 bước 3 xong #95** (`458c5ad`), merge 07/10 lúc 11:18:40 Việt Nam: `account`, `users`, `settings`, `history`, `guide` sang React; lần so toàn bộ thứ tư khớp 348/348 trường hợp của 10 trang, exit 0 (head `b36a99b`). Script so có thêm: ép vẽ lại cả trang trước khi chụp (nguyên nhân lệch 9 pixel ở avatar) và chờ hai khung hình sau mỗi thao tác. [CI `v3`](https://github.com/VinhDat267/ATI_Project/actions/runs/37550955997) xanh đúng head `4dc4a39`; cây merge bằng head; [CI main](https://github.com/VinhDat267/ATI_Project/actions/runs/37570850340) xanh đúng merge `458c5ad`. Claude Code thi công theo yêu cầu người dùng, tự review; người dùng cho merge. Giới hạn: script lúc đó chưa so `transform`, bước 4 bổ sung và so lại cả 12 trang. Xem [log](log/2026-10-07-claude-code-PROTO-01-step3.md).
- **PROTO-01 bước 2 xong #94** (`852342c`), merge 06/10 lúc 19:43:58 Việt Nam: `errors`, `responses`, `auth-action` khớp bản gốc ở 110/110 trường hợp (lúc mở và 45 trạng thái thao tác). [CI `v3`](https://github.com/VinhDat267/ATI_Project/actions/runs/37464836379) xanh đúng head `27a9421`. Claude Code thi công theo yêu cầu người dùng, tự review; người dùng cho merge. Xem [log](log/2026-10-06-claude-code-PROTO-01-step2.md).
- **PROTO-01 bước 1 xong #93** (`00e9c5f`), merge 06/10 lúc 18:37:29 Việt Nam.
  - Có `docs/design/prototypes/react/`: bản React của bản mẫu, cùng React/Vite/Tailwind 4.3 với app. Dùng `node_modules` gốc, không thêm gói, ngoài workspace nên CI không chạy.
  - Trong thư mục có: bộ chuyển HTML → JSX, token theo trang, bảng màu v3, lớp tương thích Tailwind v3 → v4, và script so từng phần tử/từng pixel với HTML gốc.
  - Trang 404 và privacy khớp 8/8 trường hợp.
  - CI `v3` xanh đúng head `1359d7e`. Claude Code thi công theo yêu cầu người dùng, tự review; người dùng cho merge.
- #92 (`18980ec`), merge 06/10 lúc 18:04:20 Việt Nam:
  - bản mẫu là chuẩn hình thức (đặc tả giao diện mục 1, 1.1, 1.2); cách làm là chuyển markup bản mẫu sang JSX;
  - task card FE-05b;
  - FE-06 → FE-10 có tiêu chí giống bản mẫu.

  Chỉ tài liệu, tự review. Xem [log](log/2026-10-06-claude-code-plan-visual-parity.md).

- **FE-05 xong #90** (`ee65cd0`), merge 06/10 lúc 06:42:18 Việt Nam: luồng chính chuyển sang cockpit (nhờ việc → tìm đúng chỗ → hỏi lại → duyệt → đang làm → biên nhận).
  - Bộ chọn khoảnh khắc thuần theo bảng đặc tả mục 5. Một ô nhập chung; ngăn hội thoại và ngăn lịch sử có focus trap, Esc, trả focus. Phản hồi muộn được gắn đúng hội thoại, kế hoạch và yêu cầu.
  - Review độc lập (GPT-6.1 Sol) đạt sau 2 vòng, đóng 4 P2:
    - receipt/preview cũ che plan mới;
    - tiến độ cũ dùng cho plan mới;
    - link dài tràn ngang ở 375px;
    - lỗi SSE bị ẩn;
    và một race snapshot đến muộn. Thêm 72 test frontend và 15 browser. Xem [log thi công](log/2026-10-06-codex-FE-05.md).
  - **Claude Code chạy thử app thật trước merge** (worktree head `09b8031`, sandbox, PostgreSQL tạm 55533, tài khoản test của CI):
    - đủ 6 khoảnh khắc; hộp "Xem trước" có `aria-modal`, Esc, trả focus; nội dung tham chiếu bước trước hiện `‹kết quả step_1: url›`, không bịa link;
    - biên nhận chỉ link `https`, `target=_blank`, `rel=noopener noreferrer`; không có câu "đã xác nhận";
    - ngăn hội thoại có `role=log`/`aria-live=polite`; toàn trang một ô nhập;
    - 375px không cuộn ngang; sáng/tối đổi được và lưu lại.
    Hai P3 chuyển vào [FE-06](tasks/FE-06-cockpit-recovery-and-responses.md) (mục 5 bên dưới). Xem [log](log/2026-10-06-claude-code-merge-90.md).
  - Merge có khoá theo SHA head; nhánh trên GitHub đã xoá. Nhánh local và worktree `fe-05` nằm trong thư mục của Codex nên để Codex dọn (cùng `fe-04`, `ui-api-01` của các PR trước).
- **UI-API-01 xong #86** (`210d3b6`), merge 05/10 lúc 22:14:34 Việt Nam: refusal thêm metadata có cấu trúc, router cấp danh sách dịch vụ chưa kết nối (không nhận danh sách model tự khai); quản trị viên lưu riêng scope bằng PUT, giữ khóa đã mã hóa và vô hiệu kết quả kiểm tra cũ; frontend có helper dùng protected transport.
  - Review độc lập toàn nhánh và delta tài liệu đạt, 0 finding trên head `f357279`. Native PostgreSQL chứng minh advisory waiter và giữ khóa mới khi đổi scope đồng thời. Check **1.278 v3 + 165 eval**, browser **32/32 qua 11 nhóm**, exit 0 trong review riêng trước merge.
  - [CI PR #86](https://github.com/VinhDat267/ATI_Project/actions/runs/37316087933) SUCCESS đúng head `f357279`; merge vào main sau FE-04 không có file giao nhau. Xem [log thi công](log/2026-10-05-codex-UI-API-01.md) và [log merge](log/2026-10-05-codex-FE04-UIAPI01-merge.md).
- **FE-04 xong #88** (`89d1999`), merge 05/10 lúc 22:13:46 Việt Nam: token/font, sáng-tối theo OS/localStorage/cross-tab; AppShell, menu có bàn phím/phân quyền, banner sandbox và route mới. Chưa thay luồng chat bằng cockpit.
  - Review độc lập đạt sau sửa bốn P2: locator AUTH-05, weight 600 cho nút màu đặc, tương phản landing tối và vùng chạm tối thiểu 40×40. Check **1.270 v3 + 165 eval**, browser **39/39 qua 11 nhóm**, exit 0 trong review riêng trước merge; tương phản đoạn landing tối đo thật **9,5665:1**.
  - [CI PR #88](https://github.com/VinhDat267/ATI_Project/actions/runs/37328409989) SUCCESS đúng head `e5894c3`; cây merge bằng head đã review. Xem [log thi công](log/2026-10-05-codex-FE-04.md) và [log merge](log/2026-10-05-codex-FE04-UIAPI01-merge.md). Bằng chứng hai PR chỉ sandbox/OIDC giả; model và provider live chưa chạy lại.
- #84 kế hoạch giao diện mới (`ab0817e`), merge 05/10 lúc 19:22:29 Việt Nam. Chỉ tài liệu; **tự review, người dùng cho merge khi chưa có review độc lập**. CI `v3` xanh trên head `c245170`.
  - `docs/design/prototypes/`: 12 trang HTML làm bằng OpenDesign, review với mã thật nhiều vòng trong ngày. Đã gỡ khỏi bản mẫu các tính năng không có trong API (mời thành viên, từ chối tài khoản, gỡ khoá, lịch sử cả nhóm, lưu bản nháp…) và các câu sai về hệ thống.
  - Đặc tả `docs/superpowers/specs/2026-10-05-ui-redesign-agentic-design.md`:
    - token Agentic và các điểm lệch đã chốt;
    - route mới `/settings`, `/history`, `/guide`, `/privacy`;
    - bảng trạng thái thật → khoảnh khắc của cockpit;
    - quy tắc trung thực, trợ năng, chế độ tối;
    - thay đổi backend (UI-API-01), mốc thời gian, phương án cắt.
  - Task card FE-04 → FE-10 và UI-API-01; ROADMAP thêm 8 dòng. Phần tối thiểu để demo: FE-04 → FE-07.
  - Thứ tự cần giữ: FE-05 merge trước 16/10 để buổi thử W4-03 chạy trên giao diện mới. Nếu không kịp thì W4-03 dùng giao diện hiện tại và báo cáo ghi rõ.
  - Xem [log](log/2026-10-05-claude-code-plan-ui-redesign.md).
- **DOC-01 xong #82** (`841d9da`), merge 05/10 lúc 09:32:41 Việt Nam: đóng finding P3 của review độc lập #80; sửa năm href trong `docs/screens.html` và `docs/wireframes.html` tới tag `archive/v2-final`, có nhãn "lưu trữ"; bốn href local còn tồn tại giữ nguyên.
  - Review độc lập `0ecaa18..36cef3b` đạt: base có năm đích thiếu; head có năm link archive (BASELINE 2/API 2/EXECUTION-CONTRACT 1), bốn link local và `missing=[]`. GitHub Contents API trả ba `html_url` đúng href; tag peel về `badccb3`; `git diff --check` exit 0.
  - [CI PR #82](https://github.com/VinhDat267/ATI_Project/actions/runs/37255434085) SUCCESS trên head `36cef3b`; cây merge bằng head đã kiểm. [CI main](https://github.com/VinhDat267/ATI_Project/actions/runs/37255822408) SUCCESS đúng merge `841d9da`.
  - Chỉ sửa liên kết tài liệu; không chạy lại suite ứng dụng local, model hoặc service workflow. Các giới hạn live và backlog giữ nguyên. Xem [task DOC-01](tasks/DOC-01-pr80-archive-links.md) và [log reviewer](log/2026-10-05-codex-DOC-01-merge.md).
- #80 dọn repo (`7060a37`), merge 05/10 lúc 08:38:32 Việt Nam; tự review, người dùng cho merge khi chưa có review độc lập. Review độc lập sau merge chỉ phát hiện lỗi P3 link lưu trữ, đã sửa ở #82.
  - Xoá 899 file v1/v2 (1.511 → 612 file được theo dõi) theo thiết kế người dùng duyệt; giữ tài liệu đề tài ban đầu (mô tả dự án, yêu cầu chức năng, wireframe, ADR).
  - Khai báo lại ba package v3 trước đây chỉ có nhờ workspace v2: `tsx`, `@playwright/test`, `ajv`. Lock bỏ 145 gói, không đổi phiên bản gói nào.
  - AGENTS.md mục 1.3, README, `docs/README.md`, `.env.example`, `.gitignore` cập nhật.
  - CI [37251935959](https://github.com/VinhDat267/ATI_Project/actions/runs/37251935959) SUCCESS trên head `dc3dba8`; check 1.245+165 và browser 32/32 qua 11 scenario, cả CI lẫn local. Worktree xoá trước merge; nhánh local/remote đã xoá; local main fast-forward, chạy `npm ci`.
  - File v2 chưa từng commit còn trên máy nhóm trưởng (output build/test, 388 file bằng chứng) được chuyển vào Thùng rác Windows theo yêu cầu người dùng, không xoá vĩnh viễn.
  - Xem [log](log/2026-10-05-claude-code-remove-v2.md).
- #77 kế hoạch (`badccb3`), merge 05/10 lúc 07:38:41 Việt Nam; chỉ sửa tài liệu, tự review. Ba task card mới:
  - **W3-10:** yêu cầu chỉ đọc hỏi lại ngay, plan phải có bước ghi; ghi thời gian, số lần thử, token từng lời gọi model; đo lại golden một lần;
  - **W3-11:** chạy thật năm service mới qua frontend;
  - **W4-00:** dự phòng bằng model Codex `cx/` trong 9router.

  Người dùng chốt hai quyết định ngày 05/10 (xem mục 6 và 7). CI [37248029172](https://github.com/VinhDat267/ATI_Project/actions/runs/37248029172) SUCCESS trên head `fdf073e`; worktree xoá trước merge, nhánh local/remote đã xoá, local main fast-forward. Xem [log kế hoạch](log/2026-10-05-claude-code-plan-week4-risks.md).
- #78 (`2fb15df`), 05/10: thêm "Quy tắc cho một phiên Claude Code" vào `docs/handoff/PROMPTS.md`.
- #75 AUTH-06 (`bfd824f`), merge 05/10 lúc01:02:48 Việt Nam: nghiệm thu Gmail/Google thật và hướng dẫn setup/troubleshooting; không đổi mã sản phẩm. Review độc lập đạt, CI head `df3b7e8` xanh, tree merge bằng head; check1.245+165/browser32 qua11scenario. Local main fast-forward, bằng chứng28file sao chép vào AUTH-LIVE ignored và SHA256 khớp; runtime lỗi/container tạm đã dọn. Kiểm cuối bàn giao: API3000/web5174 đã dừng, DB dev15433 vẫn healthy. Xem [log merge](log/2026-10-05-codex-AUTH-06-merge.md).
- #73 sửa AUTH-05 (`198fe6d`), merge 04/10 lúc 22:38:04 Việt Nam: đóng 2 P2 và 1 P3 sau review #68, bổ sung 9 test native HTTP và 4 browser Google account; runner dùng chung khóa JWT test khi chưa cấu hình. Review độc lập delta và runner đạt, CI head `4e469a1` xanh, cây merge bằng head. Check1.245+165/browser32 qua11scenario; Google/SMTP thật NOT_RUN. Local main fast-forward, năm file riêng giữ nguyên; xem [log merge](log/2026-10-04-codex-AUTH-05-merge.md).
- #71 W3-00b (`1200a3f`), merge 04/10 lúc 20:47:23 Việt Nam: frontend và refusal naming theo registry/API, không đổi routing policy; P2 mất draft sau phản hồi lưu cũ đã sửa. Review độc lập planner/frontend và re-review delta đạt; CI head `e60e4b3` xanh, cây merge bằng head. Check1.236+165/browser28 đạt; log thi công và sửa review trong task card, [log merge](log/2026-10-04-codex-W3-00b-merge.md). Model/golden/service thật chưa đo lại.
- #66 AUTH-04 (`5cc07ca`), merge 04/10 lúc 18:35:28 Việt Nam: đăng nhập/đăng ký Google, ghép tài khoản an toàn, link/unlink API và bảo toàn phiên khi phản hồi muộn. Review độc lập đóng các P1/P2 về refresh409, quota, hydration và callback khác tab; CI [37198604541](https://github.com/VinhDat267/ATI_Project/actions/runs/37198604541) SUCCESS trên head `b4029e9`, tree merge bằng head. Check1.188+165/browser27/repeat3 đạt; migration0007, 11 bảng. PostgreSQL test riêng đã dọn; DB dev15433 và năm file riêng của người dùng giữ nguyên. Google/SMTP thật chưa chạy; xem [log thi công](log/2026-10-04-codex-AUTH-04-google-login.md).
- #68 AUTH-05 (`dbc053f`), 04/10: `routes/auth/account.ts` (`GET /api/account`, đổi tên, đổi mật khẩu, danh sách/thu hồi phiên), `auth/login-failures.ts` dùng chung với đăng nhập, `auth/user-agent.ts`, migration 0008; `AccountView` ở `/account`, mục "Tài khoản" trong menu. RED backend 21/21, frontend 9/9, browser timeout; GREEN auth 130, web 9, browser AUTH-05 3/3; mutation 20/20. Thi công tự review; review độc lập sau đó bắt ba lỗi đã sửa qua #73 (xem trên).
- #64 FE-03b (`965c8bc`) và #63 W3-09 (`f284b12`), 04/10: hai P2 frontend sửa sau review độc lập, bổ sung guard vòng đời, bảo toàn dữ liệu khi tạo lỗi và Back khi tạo thành công. CI #64 trên `bf7ea3b`, #63 trên `971c3b2` xanh; tree sau cập nhật main/merge bằng snapshot kiểm thử. Check kết hợp1.096+165/browser26, FE repeat40 đạt. AUTH-02b review độc lập đạt; Jira post-merge read-only acceptance đạt. Xem [log reviewer](log/2026-10-04-codex-auth-fe-jira-independent-review.md).
- #60 (FE-03b), merge `7d2b292`, và #61 (AUTH-02b), merge `445d1b3`, ngày 04/10. Thi công: Claude Code, tự review. FE-03b: `Workspace` giữ promise tạo hội thoại đang chạy; RED unit 3/3 và browser giống CI #57; GREEN: repeat 20 lần 40/40; mutation 5/5. AUTH-02b: `sendEmailInBackground` cho quên mật khẩu/gửi lại xác minh; `EMAIL_ENABLED` trong `validateEnv`; test spawn `server.ts` live không SMTP; mutation 9/9.
- #48–#51, #55, #57 (W3-07), merge 04/10; #57 tại `ff93cc9`: chạy thật năm service mới và workflow 4 service qua `run.ts`, plan duyệt đúng hash, đọc lại bằng tool đọc, ca lỗi xác thực thật cho từng service. #49 sửa host Notion `app.notion.com` theo TDD. Bằng chứng giữ ở máy (`docs/ai-evidence/V3-LIVE-EXECUTION/`, không commit). #58 tại `e520616`: task card FE-03b.
- #52 (AUTH-02), #53 (AUTH-03), #54 (FE-03), merge 04/10 theo thứ tự: đăng ký/xác minh email/quên mật khẩu (token SHA-256 một lần, reset thu hồi phiên, outbox ở sandbox, SMTP TLS ở live); trang quản trị duyệt/khóa/phân quyền trong transaction có khóa; plan hiện tên tài nguyên (`resource_labels` ngoài hash duyệt), kết quả có link an toàn, SSE tự refresh khi 401, chuỗi tiếng Việt. Review: [log](log/2026-10-04-claude-code-review-auth02-03-fe03.md). Golden cần đo lại vì câu chữ planner/registry đổi.
- #41 (AUTH-01), merge `fbd993f` lúc 21:01:00 Việt Nam ngày 03/10: access JWT gắn `sid`, refresh token ngẫu nhiên lưu SHA-256 ở PostgreSQL; CAS rotation một winner, grace 30 giây cho hash ngay trước, replay cũ thu hồi phiên; logout/logout-all và CLI đổi mật khẩu thu hồi phiên. Middleware kiểm phiên và trạng thái tài khoản; role admin và env allowlist dùng chung cho quyền cấu hình. Chặn đoán mật khẩu theo IP/email trong một API instance, burst 12 request sai cho 5×401 + 7×429 sau sửa review. Review độc lập đạt; [CI head `4f5aa47`](https://github.com/VinhDat267/ATI_Project/actions/runs/37126813181) SUCCESS, check927+165 và browser16/16. Chưa làm signup/email/Google/quản trị tài khoản.
- #42 (FE-02), merge `8b6c8e6` lúc 21:05:01 Việt Nam ngày 03/10: route `/`, `/login`, `/c/:id`, Back/Forward và direct reload phục hồi detail/preview/execution; App còn 12 dòng, AuthGate/Workspace/views/recovery hook. Lịch sử title 60 Unicode code points, tìm kiếm, đổi tên và cursor microsecond+UUID; migration0004 backfill một lần. Scroll giữ vị trí khi đọc phía trên. Review độc lập phát hiện rồi xác nhận sửa optional snapshot lỗi làm mất detail/SSE evidence; regression 2 ca và probe độc lập đạt. Retarget từ AUTH-01 sang `main`, tích hợp main chỉ thêm metadata #40, [CI head `c68b4b6`](https://github.com/VinhDat267/ATI_Project/actions/runs/37128235604) SUCCESS: check948+165, browser20/20; cây merge giống head. Không đổi catalog/prompt hoặc đo lại model.
- #6–#9: chặn ID bịa (grounding), LLM qua cổng tương thích OpenAI, golden set có label, model tự gọi search tool.
- #10–#12: công cụ chạy thật có kiểm soát; giảm latency 31–37 s → 8–10 s; chạy thật qua frontend; sửa plan preview hiện `[object Object]`.
- #14: thiết kế lại frontend (trang giới thiệu, đăng nhập, lịch sử hội thoại, gợi ý yêu cầu, hộp thoại lỗi).
- #13 (tuần 1): retry khi model timeout; kiểm tra thành viên đúng board của card; liệt kê bằng query rỗng thay vì đoán tên; ghi thời lượng từng step; lưu plan vào hội thoại để "Sửa qua Chat" hoạt động.
- #16 (W2-01): đã merge vào `docs/agent-handoff` tại `1a0b623`, nay có trên `main` qua #15 tại `35f454a`. Startup đối soát trong transaction trước HTTP: step `running` thành `unknown`, plan cần kiểm tra thành `reconciliation_required`; giữ output đã thành công và step `pending`, không tự chạy lại. Lỗi đối soát thì rollback và không listen; API durable status trả `pausedStepId` theo thứ tự plan. Đặc tả mục 5.8 đã đồng bộ chính sách này. Phạm vi một instance, executor cũ phải đã dừng.
- #17 và #15: metadata reviewer đã merge vào nhánh bàn giao lúc 06:53:57 UTC và nhánh bàn giao đã merge vào `main` lúc 06:56:35 UTC ngày 01/10. Các nhật ký trước đó là lịch sử tại thời điểm viết, không thay thế trạng thái mới này.
- #20 và #18: #20 merge W2-04 vào nhánh W2-02 tại `c30604b` lúc 08:59:25 UTC ngày 01/10; #18 đưa cả hai vào `main` tại `9c652c4` lúc 09:03:35 UTC. W2-02 khôi phục controller từ approved plan và progress đã lưu, kiểm tra integrity/CAS trước dispatch; skip UNKNOWN, retry failed đã biết, Stop giữ bằng chứng, không chạy lại success. API latest execution snapshot theo owner cung cấp plan/steps/output/timing/recoveryActions; invalid recovery là Stop-only theo spec 5.8. W2-04 tải snapshot khi mở lại hội thoại, hiện ngữ cảnh UNKNOWN cùng Skip/Stop theo server, giữ preview mới và target execution đúng; tin nhắn gửi/lịch sử hiển thị giờ/ngày theo máy người dùng. Tham số hiển thị dựng lại từ saved plan/output, không phải log của request đã gửi service.
- #19: metadata hậu merge #15 được đưa vào `main` tại `abbb55f` lúc 09:04:40 UTC ngày 01/10. File này cập nhật tiếp trạng thái sau #18/#20; không sửa lại task card hoặc nhật ký thi công cũ.
- #22: kết quả audit tuần 2 và task card W2-05.
- #24: ghi nhận W2-05 vào `CURRENT-STATE.md`.
- #27 (FE-01): đóng hộp thoại lỗi (Esc, bấm ngoài, ✕) chỉ ẩn, Stop cần xác nhận; bản build không còn chứa mật khẩu admin/demo (`scripts/test-v3-web-build-security.mjs` trong `npm run check`); trạng thái dịch vụ và quy trình mẫu lấy từ API (`GET /api/services` thêm `tools`, `configured`, `connectionStatus`); dải "Chế độ thử nghiệm" khi sandbox (`GET /api/health` trả `runtimeMode`); trang giới thiệu bỏ số liệu chưa đo; không còn ID giả; lỗi mạng tiếng Việt; chỉ đăng xuất khi refresh trả 401. Kết quả kiểm tra kết nối lưu theo tiến trình, mất khi restart.
- #29 (W3-00), merge tại `c7a38c0`: registry/transport/sandbox tách theo service; allowlist chung theo scopeKey/scopePattern và scopeLabel API; dữ liệu credentials cũ giữ nguyên; live harness đọc bảng service; grounding giữ thêm key. Có guard keyword/static/routing và hợp đồng mở rộng demo qua HTTP/PostgreSQL/planner/factory. Số file sản phẩm hiện có cần sửa khi thêm service giảm 9 → 7; chưa thêm service thật. Review độc lập Đạt, CI xanh trên `ff67b4c`; ngoại lệ `rf06` đã chốt trong W3-00/common/W3-02. W3-01 → W3-05 được gỡ chặn bởi W3-00, riêng W3-02 vẫn cần W3-01.
- #30 (W3-01), merge tại `716f568`: service-account Google và bốn Sheets tools có allowlist, local A1, chống công thức, bounded retries và UNKNOWN không replay; API mã hóa/grounding và sandbox Sheets→Slack. Module auth dùng lại cho Calendar; W3-02 đã gỡ chặn. Google thật/model chưa nghiệm thu.
- #31 (W3-02), merge tại `ab2c599`: ba tool Calendar (list_calendars, list_events, create_event), scope/token riêng khi dùng chung service account với Sheets; allowlist trước mạng, kiểm thời gian và phân trang có giới hạn, create không mời attendees và dùng sendUpdates=none. Lỗi ghi không rõ kết quả thành UNKNOWN, không replay; retry lỗi rate có giới hạn và AbortSignal. API dùng credentials mã hóa, catalog có điều kiện, grounding; browser Calendar→Slack đọc output thực thi từ PostgreSQL. Google thật/model chưa nghiệm thu. Primary `main` đã đồng bộ; worktree Calendar được archive sau khi xác minh tích hợp, giữ nguyên các file riêng của người dùng.
- #32 (W3-03), merge tại `fca384d` lúc 09:55:14 ngày03/10/2026 (Việt Nam): bốn tool Notion search_databases/query_database/create_page/append_text; UUID chuẩn hóa, Database ID allowlist, mapping data source theo API2026-03-11. Query/create yêu cầu một data source; append kiểm source cha tại execution trước ghi. Property values giữ formula/rollup/files/unique_id/place/verification và marker khi snapshot chưa đầy đủ; select chỉ option có sẵn. Limiter3request/giây/token, mọi lệnh ghi không rõ kết quả UNKNOWN không replay. Browser Notion→Slack kiểm URL từ PostgreSQL. CI head dd111c4 xanh, cây merge giống head; primary main đã đồng bộ, giữ nguyên năm file riêng của người dùng. Google/Notion/model thật chưa nghiệm thu.
- #33 (W3-04), merge `4a4553b` lúc11:29:10 Việt Nam ngày03/10: Telegram list_chats/send_message, signed Chat ID chuẩn hóa BigInt, allowlist trước fetch và getChat trước gửi, text thuần, redirect chặn; limiter per token/chat trong process. Indeterminate writes UNKNOWN không replay, 429 chờ có giới hạn. Browser Telegram→Slack kiểm messageId từ output_json PostgreSQL. Primary main đã đồng bộ, năm file riêng SHA256 giữ nguyên, worktree Telegram đã archive và nhánh local/remote đã xóa sau kiểm tích hợp. Telegram thật W3-07 và model W3-06 NOT_RUN.
- #34 (W3-05), merge `dc80de4` lúc13:40:43 Việt Nam ngày03/10: Jira search_projects/search_issues/create_issue/add_comment; Basic email/token, exact site domain, project allowlist, POST search/jql, hai lớp Lucene/JQL escape, plaintext ADF. Create đọc issue types, comment đọc lại project thật; write UNKNOWN không replay. Sửa generic search collection grounding tại `979a196`, SQL/factory/planner search→comment không chèn memory thủ công. Browser Jira→Slack kiểm key/URL từ PostgreSQL. CI head `089a871` xanh, cây merge giống head; primary main đồng bộ, năm file riêng giữ nguyên. Task DB tạm đã dọn, user DB15433 giữ nguyên. Jira/model thật NOT_RUN.
- #39 (W3-08), merge `c5ce8a0`: giới hạn kết quả adapter và phân loại lỗi token Google. Review độc lập sau merge phát hiện hai P2; #45 tại `81225de` đã sửa cả hai, review đạt và CI xanh. Log review trước sửa giữ nguyên lịch sử; kết quả hiện tại theo #45.
- #35 (W3-06), merge `a75ac35` lúc19:02:09 Việt Nam ngày03/10: 44 câu services đăng ký trước, 10 read-tool fixtures mới, scorer theo service và successful read traces, bounded provider pool/AbortSignal/checkpoint, routing116câu ở legacy/full. Label rf06 clarification commit riêng `1ab7f08`; 67 câu khác không đổi. Ba campaign đủ336attempts/source7ba60ef, model ag/gemini-3.8-flash/served gemini-3.8-flash; core150/150, freeform51/54, services111/132. Numeric tools/args đạt cả năm, parity/latency chưa đạt; không sửa sản phẩm/prompt, không thực thi plan. Campaign gián đoạn79/132 giữ riêng, fresh probe trước full rerun. CI head0b34b64 xanh/tree merge bằng head; review I1 docs đã sửa, các giới hạn còn mở ở mục5.
- #25 (chỉ tài liệu): kế hoạch tuần 3–4. Thêm task card cho:
  - năm service mới, có W3-00 gỡ các chỗ viết cố định theo service trước khi thêm;
  - mảng tài khoản: đăng ký có admin duyệt, Gmail SMTP, Google, đăng xuất thu hồi token, trang tài khoản;
  - mảng frontend, lập sau khi review `apps/chat-web`.

  Đặc tả v3 §1.4 và §8.1 có đoạn cập nhật 02/10. W4-03 được sửa để đo ở chế độ live.
- #23 (W2-05): khôi phục an toàn hơn sau khi server khởi động lại. Plan có mọi step `succeeded`/`skipped` tự thành `completed`; plan không có step chưa rõ kết quả mà còn step `pending` được **chạy tiếp** (`POST /api/executions/:planId/continue`, nút "Chạy tiếp các bước còn lại"). Đặc tả v3 §5.8 đã được sửa theo. Bất biến "ghi `running` xong mới gọi service" có test khóa.

## 5. Lỗi và hạn chế đã biết

| Vấn đề | Ở đâu | Ghi chú |
|---|---|---|
| W4-00: core của model dự phòng chưa có campaign hoàn chỉnh; quota chưa rõ | [W4-00](tasks/W4-00-llm-fallback-provider.md), 9router | Số đo 12/10: `cx/gpt-6.1-sol` core 48/50 PARTIAL do `cl04` timeout và runner hủy `rf07`; không đóng gate latency core. Services 41/44 complete, p95 9,408 s là số đo riêng, không đóng mục tiêu Gemini/W3-10. Preview rồi Hủy đã kiểm; ghi live bằng Codex, usable-plan rate, W4-01 và W4-03 chưa nghiệm thu (W3-11 xong #146, W4-02 và W4-04 đo xong #159, đều với model chính, không dùng Codex). Cùng 9router/máy nhóm trưởng nên sự cố gateway/host vẫn ảnh hưởng cả hai đường |
| Latency chưa đạt mục tiêu; parity ff15 chưa đạt | evaluations / W3-10 | Sau #102: services p95 20,138 s (mục tiêu < 15 s), 117/132 lượt dưới 15 s; model chiếm 99,96% thời gian, 2 lần quá hạn có retry, 13 lượt chậm còn lại thành công ngay lần đầu. Core p95 13,1 → 18,0 s so với W3-06, nhưng đối chứng cùng ngày code cũ cũng 19,0 s, nên nhiều khả năng do model `-n`/gateway. **Freeform** p95 24,7 s, 77,8% dưới 15 s, **không có đối chứng cùng ngày**, chưa tách được nguyên nhân. ff15=1/3 lượt đúng (giữ label cũ). **W4-04 qua giao diện** (#159, 18/10, 24 câu, hai cờ tắt): 23/24 lượt dưới 15 s, p95 14,7 s, max 15,8 s (`s2-06`, Jira + Sheets). Server chiếm 96,8% thời gian; thời gian model chưa tách được khỏi planner. Cùng ngày, golden `services` cờ tắt p95 14,7 s; bật kiểu trả lời p95 25,4 s (1 lần quá hạn rồi thử lại thành công). Nên lập task latency riêng có đối chứng freeform. Usable-plan rate vẫn chưa đo |
| Legacy Trello member fixture sai output schema | evaluations/golden-v2/fixtures.ts | 531trace thiếu fullName nhưng có name, đã tồn tại ở base; service mới zero schema mismatch. Sửa fixture cần documented rerun, không sửa ngầm context |
| Phục hồi startup chưa có lease/fencing cho nhiều replica | startup reconciliation / recovery | Chỉ một API instance, executor cũ đã dừng; W2-01/W2-02 không cung cấp bảo đảm nhiều instance |
| Lịch chạy (SCHED-01/02): giới hạn đã biết khi bật cờ | `apps/chat-api/src/services/schedules/`, `packages/planner` | **Chỉ một API instance:** bộ hẹn giờ không có lease, giống W2-01. **Prefetch:** ở chế độ `llm`, câu tạo lịch đầu tiên vẫn tra danh mục, vì planner chưa biết model sẽ trả lịch hay kế hoạch (đặc tả mục 5.1; P3 của review #168 được giữ làm giới hạn). **Rơi về kế hoạch soạn sẵn:** ở sandbox, planner chính ném lỗi thì runtime trả kế hoạch Trello soạn sẵn, kể cả với lượt chạy; live không rơi về. **Chưa đo:** prompt lịch chưa đo với model thật (SCHED-04). **Chưa có giao diện:** web chưa hiện đề xuất hay trạng thái lịch (SCHED-03) |
| Các ca lỗi của service thật: 429, timeout, ngoài scope và token hết hạn mới test bằng dữ liệu giả | adapters | W3-07 đã chạy ca token/key sai thật cho năm service mới (Telegram 401, Notion 401, Jira 401/404, Google `invalid_grant`). W2-03 (ba service cũ) vẫn chờ người dùng duyệt plan ghi |
| Notion query/create chưa chọn được data source trong database đa nguồn; relation/rollup là snapshot có giới hạn; page có thể bị di chuyển sau kiểm cha, trước PATCH | `packages/tool-adapters/src/notion/` | Ambiguous source trả VALIDATION; `[incomplete]` khi provider báo thiếu; không tuyên bố kiểm quyền nguyên tử tại API ngoài. Provider thật đã chạy ở W3-07 với database một nguồn; database đa nguồn chưa thử thật |
| Nhánh frontend streaming `text_*` chưa có timestamp và chưa giữ message khi `text_end` | `apps/chat-web` | Minor hoãn sau review W2-04; chưa tìm thấy production emitter, reachability chưa chứng minh (NOT_RUN); xử lý trước khi nối producer này |
| Sandbox dùng planner mock trả một plan soạn sẵn (giao diện đã báo "Chế độ thử nghiệm"); minor sau FE-01: tiêu đề mẫu "Phát hành Sprint" không khớp nội dung, chấm xanh nhấp nháy luôn hiện, dòng "Chưa xác định chế độ chạy" hiện thoáng khi tải | `server.ts`, `MissionControlLaunchpad.tsx`, `App.tsx` | Không demo sandbox như AI thật. Audit 10/10: `MissionControlLaunchpad.tsx` chỉ còn test dùng, giao diện không dựng nữa, nên ba minor này không còn hiện; xoá component là mục D2 (tuỳ chọn) của [FE-11](tasks/FE-11-frontend-bugfixes.md), chưa làm khi merge #129 |
| Thư gửi ở nền chưa có hàng đợi bền (API dừng ngay sau khi trả lời thì có thể mất thư); chi phí DB hai nhánh known/unknown chưa tương đương (giới hạn 3 yêu cầu/giờ/email); giới hạn đoán mật khẩu theo một API instance và chưa có giới hạn chung theo IP cho login | `apps/chat-api/src/routes/auth/`, `services/email/` | AUTH-05 đã merge #68 và bản sửa sau review #73; "lần dùng cuối" của phiên là lần refresh gần nhất. Google login đã merge AUTH-04, quota signup chung email/Google 10/IP/giờ đã có. Review AUTH-02b không thấy chênh lệch 800 ms còn lại; chưa coi là bảo đảm timing tuyệt đối. Review delta #73 không chứng nhận hủy mutation backend in-flight. Google/SMTP thật đã nghiệm thu ở AUTH-06 |
| 6 test integration `*-extension.test.ts` của `chat-api` sau #102 chỉ kiểm thư mục tài nguyên ở lần gọi model cuối (bảo đảm "có ngay lần gọi đầu" vẫn do `directory-prefetch.test.ts` giữ) | `apps/chat-api/tests/integration/` | Golden đã đo lại đủ ba bộ ở W3-10 (#102), thay cho các lần đo còn nợ sau FE-03, W3-08, W3-00b |
| Tin nhắn Slack chưa đọc lại tự động sau khi gửi | live-execution | |
| Hành vi của model khi lịch sử có plan cũ (sau PR #13) mới đo trên fixture | planner, `evaluations/golden-v2/cases-multiturn.json` | W4-02 (#159, 18/10): 36/36 qua 3 lượt trên 12 câu (6 sửa kế hoạch, 3 trả lời câu hỏi lại, 3 yêu cầu mới). Label do một người viết; chưa đo qua giao diện |
| Bộ câu đánh giá chưa có bộ nào độc lập hoàn toàn với người viết prompt | evaluations | Ba bộ cũ do một người viết; prompt đã được chỉnh trên bộ 50 câu. Bộ W4-01 (#164, 32 câu) do bốn thành viên viết, trong đó hai người đã xem hoặc sửa prompt, và ba câu gần câu của bộ cũ. Kết quả tách theo nhóm người viết: `llm` 47/48 và 42/48, mỗi nhóm 16 câu, không đủ để kết luận thống kê |
| Model suy nghĩ quá deadline 30 s ở một số câu | planner (`openai-compatible-provider.ts`, deadline 30 s × 2 lần thử), 9router | W4-01 (#164, 24/10): `gemini-3.8-flash-n` dùng 3.800–4.800 reasoning token (35–45 s) cho các câu như `m1-03`; 17/124 lần thử ở `llm` quá hạn, 4 câu bị chấm trượt. Trên app, người dùng chờ khoảng 60 s rồi nhận lỗi lập kế hoạch. Tốc độ sinh token không đổi so với 18/10 (trung vị 71–74 token/s); cái đổi là số token suy nghĩ. **Đề xuất task độ trễ, chờ nhóm trưởng:** giới hạn thời gian suy nghĩ qua 9router hoặc xem lại deadline của app, có đối chứng cùng ngày, rồi đo lại các bộ |
| Định tuyến từ khoá đưa câu "task row … Tasks tab" vào Trello | `packages/planner/src/router.ts` | W4-01 `m4-07` ×3 ở cả hai chế độ: câu không nhắc tên Sheets, chỉ danh mục Trello được tra, model từ chối với lý do "only Trello is available" thay vì hỏi bảng tính nào. Đề xuất backlog, chờ nhóm trưởng |
| Bước tra tên của chế độ `regex` đọc sai cụm từ và chỉ phủ Trello, Slack, GitHub | `packages/planner` (gather của `regex`) | W4-01 `regex` 37/96: "bảng tính" thành board "tính", "PR #15" thành kênh "15", "board and assign" thành board "and"; không có ID cho năm dịch vụ mới. Live dùng `llm`; sandbox mặc định `regex`. Ưu tiên thấp |
| Các bản mẫu ngoài `app-stage.html` chưa kiểm bằng ảnh ở khổ desktop | `docs/design/prototypes/` | `app-stage.html` đã chụp ở 1440 và 375 (chế độ tối) ngày 06/10 khi so với FE-05; các trang khác đã kiểm ở 375–411px, sáng và tối, không lỗi console. Màn kết thúc không thành công không có bản mẫu; #107 dựng theo bố cục khoảnh khắc 6 |
| Gateway 9router trả model `gemini-3.8-flash-n` khi gọi `ag/gemini-3.8-flash` (tên lấy từ `modelVersion` của Antigravity) | `packages/planner/src/providers/openai-compatible-provider.ts`, 9router ở máy nhóm trưởng | Đã chấp nhận đúng cặp tên này ở #113; **chạy thử live ngày 08/10 lập được kế hoạch** (mục 3). Upstream có thể đổi tên tiếp; khi đó live lại bị chặn cho tới khi cập nhật cặp tên (có thể đưa danh sách tên ra biến môi trường). Số đo trước 07/10 (tên `gemini-3.8-flash`) và sau đó cần đối chứng cùng ngày. #102 đã merge, giữ bản có metrics; phép đo W3-10 dùng phản hồi `-n` |
| API kiểm tra kết nối vẫn gọi dịch vụ thật ở sandbox, trong khi dải thử nghiệm ghi "không gọi dịch vụ thật"; browser test FE-07 gọi Notion thật bằng token giả | `apps/chat-api/src/routes/services-routes.ts`, `tests/browser/fe-07-settings.spec.ts` | Không lộ khoá thật; CI phụ thuộc mạng ra ngoài. Người dùng chưa chốt sandbox nên hiện gì khi kiểm tra kết nối |
| FE-06A "Sửa rồi thử lại": chưa nghiệm thu với đúng model `ag/gemini-3.8-flash` (gateway trả `-n`, xem dòng trên; ba phản hồi của gateway giữ đúng giá trị sửa và không làm lại việc đã xong); template lấy output là object hiện `[object Object]` (đúng như executor gửi, hiếm gặp) | `apps/chat-web/src/pages/Cockpit/recovery-request.ts` | Kế hoạch mới luôn phải duyệt lại nên không có lệnh ghi tự chạy. Đo lại khi gateway đúng model (W3-11 hoặc W4-02) |
| Test browser chập chờn (07–08/10), mỗi ca fail một lần rồi chạy lại đạt: `FE-04: retained landing comparison copy … light` (hết 30 giây chờ trang giới thiệu); `AUTH-01: logout-all …` (refresh token chưa bị xoá); `FE-06A … 375` (trang trắng, `#root` rỗng, 1/80 lần khi chạy lặp); `FE-02` giữ vị trí cuộn (80 so với 16268; #116 sửa fixture: phát sự kiện cuộn ngay khi gán vị trí); `FE-05b 1440 dark` không thấy `#moment-6`; `AUTH-04: Google signup…` không thấy thông báo chờ duyệt (09/10, trên `main` `d40d735`); ca FE-04 route công khai lỗi `page.screenshot: Protocol error (Page.captureScreenshot)` (09/10, CI `main` sau merge #121, `b4227de`); CI `main` sau #127 (`d319a32`, chỉ tài liệu, [run 38039544418](https://github.com/VinhDat267/ATI_Project/actions/runs/38039544418)) fail 2 ca: `AUTH-01: logout-all …` không thấy ô nhập sau đăng nhập và `… Continue safe pending after reload` (10/10); CI `main` sau #130 (`84a3461`, chỉ tài liệu, [run 38066634198](https://github.com/VinhDat267/ATI_Project/actions/runs/38066634198)) fail `FE-08: pending and disabled email accounts…` không thấy tiêu đề "Tài khoản đang chờ duyệt" sau đăng nhập; review #142 tại `993e485` (16/10) fail `FE-05: real sandbox request approval receipt and accessible dialogs dark 1440`, hết 30 s chờ ô Email ở `/login`, không có snapshot trang, lượt chạy lại đạt; bên thi công GMAIL-03 (16/10) fail ca FE-07 thành viên kiểm Notion (`fe-07-settings.spec.ts:74`, ô kết quả còn trống sau 10 s; ca này gọi Notion thật bằng token giả), chạy riêng đạt; reviewer khi sửa P3 của #147 tại `5f3bb2f` (18/10) fail `FE-07: dark mobile page/drawer …`, hết 30 s chờ ô Email ở `/login`, không có snapshot trang, lượt chạy lại toàn bộ đạt | `tests/browser/*.spec.ts`, Vite dev server | Nhiều ca khác nhau cùng fail khi máy tải nặng (nhiều agent chạy song song); nghi Vite dev server (có thể "504 Outdated Optimize Dep"), chưa có bằng chứng. Ca FE-06A đã ghi chẩn đoán khi fail (#111). Nên lập task chạy browser trên bản build hoặc ghi request mạng khi lỗi. Ba ca unit/`chat-api` chập chờn trước đây đã sửa ở #106. **#129 sửa một nguyên nhân thật** ở bước đăng nhập: timer 100 ms của hộp đăng nhập (từ FE-08) giành focus về ô Email khi đang điền Mật khẩu, nên mật khẩu bị gõ vào ô Email (error context trong log sửa review #129). Khớp các ca fail ở bước đăng nhập sau FE-08; các ca trước FE-08 và ca không ở bước đăng nhập có nguyên nhân khác. Theo dõi CI `main` sau #129 trước khi lập task riêng. **Lặp lại 27/10:** khi review #171 trên bản gộp thử, ca `AUTH-04: Google signup waits for approval…` không thấy `status` "chờ quản trị viên duyệt" sau 10 s; chạy lại từ nhóm `auth04` trên DB mới thì đạt 6/6 |
| FE-05 dark/375 từng thiếu receipt link trong canonical local FE-08 (`6bf51de`), DOM báo `Failed to fetch`; một lần CI FE-09 cũ hết giờ chụp ảnh sau khi assertion SSE đã pass | `tests/browser/fe-05-cockpit.spec.ts`, evidence FE-08/FE-09 | Nguyên nhân chưa chứng minh; giữ log/DOM/ảnh. Đối chứng FE-08 nguyên trạng 3/3 pass, CI tích hợp #121 91 và #122 97 browser pass qua 11 nhóm; không sửa assertion/timeout để đạt, chưa coi nguyên nhân đã được sửa. Xem log merge #120–#122 |
| **Chờ người dùng quyết (sau #128):** logo Jira ở chế độ tối đã đổi từ `#0052cc` của bản mẫu sang `#60A5FA` (7,14:1 trên `#0E1528`), là chỗ đổi hình thức bản mẫu mà quy tắc 07/10 chỉ cho đo và ghi lại | `apps/chat-web/src/index.css` (quy tắc `html.dark svg [fill="#0052cc"]`) | Giữ màu sáng hơn hay trả về màu bản mẫu. Logo Slack đã đổi sang logo bốn màu ở #100 |
| Giao diện theo đúng bản mẫu không đạt một số yêu cầu trợ năng: chữ 10–12px, chữ nhỏ màu xám dưới 4,5:1, nút thanh trên 32px | app, sau FE-04b → FE-10 | Người dùng chấp nhận ngày 07/10 khi chốt đưa thẳng bản React vào app. FE-10 (#128) đã đo: nhiều chữ dưới 3:1, nhất là chế độ sáng (`/` 23 chỗ, `/login` 24, `/privacy` 8; tỷ lệ thấp nhất 1,07–1,39 nhiều khả năng do nền trang trí, script là ước lượng), xem [log FE-10](log/2026-10-10-codex-fe-10.md). **Chờ người dùng quyết** giữ như bản mẫu hay sửa. Báo cáo môn học nên ghi giới hạn này |
| FE-10 chưa làm tiêu chí "Rà soát cuối": chụp lại mọi route và khoảnh khắc của FE-05b → FE-09 cạnh bản mẫu ở 1440/375 sáng/tối | `docs/handoff/tasks/FE-10-guide-privacy-and-audit.md` | Ghi rõ là chưa làm trong task card và log #128. **Chờ người dùng quyết** tách thành task riêng hay bỏ. Bộ browser chỉ kiểm hành vi, không thay được việc đặt ảnh cạnh bản mẫu |
| OAUTH-02 (sau #176): chưa đo bằng model thật, chưa nghiệm thu với Google thật; chưa có Google Cloud project riêng cho Calendar | `apps/chat-api/src/config/env.ts`, `docs/handoff/tasks/OAUTH-02-personal-calendar.md` | Cờ `MYCALENDAR_ENABLED` giữ tắt cho tới khi `EVAL_SET=mycalendar` ×3 và P-LIVE đạt quy tắc đặc tả mục 8.3. Ngoài live, `env.ts` chỉ bắt buộc đủ bốn biến `MYCALENDAR_*` override và không kiểm URL là máy chủ giả; đặt URL Google thật thì sandbox sẽ gọi Google. Runner browser trỏ các biến này tới `scripts/fake-google-gmail.mjs` |
| Gmail: bản sửa P2 số 3 của review #140 chỉ có kiểm của bên thi công; chưa gọi Google thật | `apps/chat-api/src/services/execution-service.ts`; GMAIL-04 | Lỗi 3 (`7849f43`): test fail trên mã cũ, đạt trên mã mới; chưa có reviewer độc lập xem. Từ #143, khi cờ bật Gmail đã vào planner, executor và sandbox; từ #147 có giao diện kết nối, xem trước và trang công khai; từ #154 có bộ đo riêng, đo trên fixture ở #159 (`gmail` 59/60, injection 9/9). Mọi kiểm thử dùng OAuth và Gmail giả; Google thật và PR bật cờ thuộc GMAIL-04 |
| P3 sau review #143: kết quả của `send_message`, `trash_thread`, `create_label` là response thô của Google, chưa chuẩn hoá theo `outputSchema` như `modify_thread_labels` và `create_draft`; response 401 có body không phải JSON ở lệnh ghi thành `UNKNOWN`, không làm mới token một lần | `packages/tool-adapters/src/gmail/gmail-adapter.ts` | Không ảnh hưởng an toàn. `$ref` và biên nhận thấy thêm các trường như `labelIds`. 401 không phải JSON hiếm gặp vì Google thường trả JSON, và `UNKNOWN` nghiêng về an toàn (`response.json()` chạy trước khi kiểm status) |
| Test unit/integration và browser chập chờn ghi nhận 18/10, đều ngoài diff của PR đang chạy, chạy riêng thì đạt | `apps/chat-api/tests/db/gmail-migration.test.ts:68`, `apps/chat-api/tests/integration/memory-execution-snapshot.test.ts`, `apps/chat-web/tests/fe-04-shell.test.tsx` | CI #157 lần đầu (`4fe8fb4`) fail `gmail-migration.test.ts:68` (`could not open relation with OID 20506`), chạy lại đạt. Reviewer #157 chạy check ở máy: timeout khởi động server ở `memory-execution-snapshot.test.ts`, chạy riêng 6/6. Bên sửa #157: timeout 5 s ở `fe-04-shell.test.tsx` ca `/settings`, chạy riêng 10/10. Reviewer #156 cũng gặp lỗi timeout/OID ở các test ngoài diff khi chạy check tổng ở máy. Test GMAIL-01 (`orders %s after the save…`, 9 lần fail) đã sửa ở #156. Test browser GMAIL-03 tiêu đề dài (race SSE sau khi sửa DB rồi tải lại) đã sửa ở #157. Nếu lặp lại, nên lập task riêng: OID gợi ý migration/DDL của test chạy song song trên cùng DB. **Lặp lại 24/10:** lượt chạy song song đầu của reviewer độc lập #164 gặp lỗi OID ở `gmail-migration.test.ts`; chạy lại chat-api tuần tự 465/465. **25/10, có thêm hai ca:**<br>• review độc lập #167 lần 2: lượt check đầu exit 1 vì `evaluations/generic-plumbing/static-guard.test.ts` hết 5 s (chạy mất 8,2 s). Chạy riêng 2/2 (708 ms); chạy lại toàn bộ thì đạt;<br>• bên thi công SCHED-01: browser lượt 1 fail ca `FE-12: the bar fits without overlap…` (`fe-12-nav.spec.ts:103`), không thấy `[data-main-nav]` sau 10 s. Lượt 2 trên DB sạch đạt 120/1 |
| P3 sau #157: matcher chỉ có `excludes` và `excludeExceptions` gặp tham số vắng mặt thì bị chấm trượt; quy ước của `excludes` là tham số vắng thì đạt | `evaluations/golden-v2/scorer.ts` (`checkMatcher`) | Dòng kiểm tham số vắng chỉ chấp nhận khoá `excludes`. Label hiện có không bị ảnh hưởng: `mt_reply02` còn `includesAll`, nên tham số vắng đằng nào cũng trượt. Sửa nhỏ khi có PR scorer tiếp theo |
| Kiểu trả lời (ANS-01): kiểm "có dữ liệu đọc" đạt chỉ nhờ một danh mục prefetch | `packages/planner/src/planner.ts`, GMAIL-04 | Ở live, prefetch bật mặc định nên `usedDirectory` gần như luôn có dịch vụ được định tuyến. Một danh mục (ví dụ danh sách project Jira) đã đủ để câu trả lời được nhận, kể cả khi câu hỏi về dữ liệu ngoài danh mục (issue tuần này, lịch, thư); validator không chặn được model trả lời bằng trí nhớ trong trường hợp này. Màn ghi đúng nguồn ("Danh mục Jira"), nên không nói sai. Đặc tả mục 5.3 cho phép. Đo 18/10 (#159): 30/30 câu trả lời của bộ `answers` đều có ít nhất một tra cứu do model mở, chưa gặp câu nào chỉ dựa vào danh mục; validator vẫn không chặn trường hợp này |
| Planner lập khung "cả ngày" bằng `timeMax` 23:59:59, nên bỏ sót sự kiện bắt đầu ở giây cuối ngày | planner (prompt) hoặc adapter Calendar; golden `an_ca01` | Calendar `events.list` coi `timeMax` là cận trên loại trừ của giờ bắt đầu sự kiện ([tài liệu](https://developers.google.com/workspace/calendar/api/v3/reference/events/list)). Model dùng 23:59:59 ở cả 3 lượt `an_ca01` (#159, 18/10); câu trả lời vẫn đúng chỉ vì fixture không có sự kiện ở giây đó, và review #159 tái hiện được việc bỏ sót. **Đề xuất backlog**, chờ nhóm trưởng đồng ý: dùng 00:00 hôm sau làm `timeMax`, rồi đo lại `answers` và `services` |
| Label `gm04` (bộ `gmail`) chỉ nhận chữ tiếng Anh, nên chấm trượt nội dung thư tiếng Việt đúng yêu cầu | `evaluations/golden-v2/cases-gmail.json` | Lượt 3 ngày 18/10 (#159). Label đã đăng ký nên giữ nguyên điểm. Nếu sửa thì sửa trong commit riêng có giải thích, trước lần đo sau |
| P3 sau review #129: effect đặt focus của hộp đăng nhập chạy lại khi `authConfig.signupEnabled` đổi; nếu config về trễ trong lúc người dùng đang focus một nút trong hộp (tab Đăng ký, nút Google), focus nhảy về ô đầu tiên | `apps/chat-web/src/pages/Landing/LandingPage.tsx` | Config thường về ngay khi mở trang nên hiếm gặp; ô đang sửa không bị giành focus |
| Một số trạng thái của script so bản React với bản mẫu chụp giữa chừng một hẹn giờ, nên lệch khi máy chạy chậm: `auth-action` "Đang gửi lại" (700 ms) và đồng hồ đếm ngược, `index` trả focus sau Esc, `app-stage` gợi ý tự chuyển khoảnh khắc | `docs/design/prototypes/react/scripts/parity-states.mjs` | Không phải trang khác bản mẫu: ở các lần so khác chúng đạt, chạy riêng đạt. Lần so trên `main` `581addd` ngày 07/10: 459/464, cả 5 lệch thuộc loại này, chạy riêng đều đạt. Nên đổi sang chờ theo điều kiện; ưu tiên thấp vì bản React đã khớp |

## 6. Môi trường chạy

- Database: `npm run db:up:v3` (PostgreSQL 16 tại `127.0.0.1:55533`, user/db `ati_v3`). **Ngày 09/10, sau khi Docker khởi động lại, Windows giữ dải cổng 55448–56047 (gồm 55533)**: dùng `V3_LOCAL_DB_PORT` khác (ví dụ 56533), hoặc giải phóng bằng khởi động lại máy / `net stop winnat` rồi `net start winnat` (quyền admin); máy Windows nhóm trưởng đang dùng override ignored `.codex/` tại port15433 và giữ volume dev. Migration: `npm run db:migrate:v3`. **Chú ý (24/10):** khi DB dev được bật bằng `compose.v3.yaml` (như `npm run db:up:v3`), container `ati-v3-postgres-1` gắn volume dev mở ở 55533, trùng cổng mặc định của test; `.env` vẫn trỏ 15433 nên `npm run up` báo `ECONNREFUSED`. Bật DB dev bằng `.codex/db-up.ps1` (15433). Trước khi chạy test có PostgreSQL, kiểm `docker ps` xem ai đang giữ 55533.
- `.env` (không commit, không in giá trị ra log): `RUNTIME_MODE` (`sandbox` mặc định), `DATABASE_URL`, `JWT_SECRET`, `ENCRYPTION_KEY`, `CHAT_ADMIN_EMAIL`, `CHAT_ADMIN_PASSWORD`, `SERVICE_ADMIN_USER_IDS`, `LLM_PROVIDER`, `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL`, `PLANNER_SEARCH_MODE`, `PLANNER_READ_ANSWERS`, `APP_TIME_ZONE`, `TRELLO_API_KEY`, `TRELLO_TOKEN`, `SLACK_BOT_TOKEN`, `GITHUB_TOKEN`, `LIVE_TRELLO_BOARD_IDS`, `LIVE_SLACK_CHANNELS`, `LIVE_GITHUB_REPOS`, `GOOGLE_CLIENT_EMAIL`, `GOOGLE_PRIVATE_KEY`, `LIVE_SHEETS_SPREADSHEET_IDS`, `LIVE_CALENDAR_IDS`, `NOTION_TOKEN`, `LIVE_NOTION_DATABASE_IDS`, `TELEGRAM_BOT_TOKEN`, `LIVE_TELEGRAM_CHAT_IDS`, `JIRA_SITE_URL`, `JIRA_EMAIL`, `JIRA_API_TOKEN`, `LIVE_JIRA_PROJECT_KEYS`, `AUTH_SIGNUP_ENABLED`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `MAIL_FROM`, `APP_BASE_URL`, `V3_WEB_PORT`, `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_OAUTH_REDIRECT_URI`, `GMAIL_ENABLED`, `GMAIL_OAUTH_CLIENT_ID`, `GMAIL_OAUTH_CLIENT_SECRET`, `GMAIL_OAUTH_REDIRECT_URI`, `SCHEDULES_ENABLED`.
- LLM: model `ag/gemini-3.8-flash` qua 9router chạy ở máy nhóm trưởng (`LLM_PROVIDER=openai-compatible`, `LLM_BASE_URL=http://localhost:20128/v1`). 9router gom nhiều tài khoản Gemini chạy song song.
  - **Dự phòng (W4-00 #133, kiểm 12/10):** đổi `LLM_MODEL` sang **`cx/gpt-6.1-sol`**, served `gpt-6.1-sol`, trong cùng 9router; chuyển thủ công rồi khởi động lại, đã kiểm app live tới preview rồi Hủy. Quay lại `ag/gemini-3.8-flash` bằng environment; `.env` chính giữ nguyên. [Runbook PowerShell/bash](../../evaluations/README.md#w4-00-manual-codex-fallback-through-9router). Core còn partial, quota chưa rõ; chưa chạy ghi live bằng Codex.
  - Không dùng Gemini API chính thức: quota miễn phí 20 request/ngày và 503 liên tục khi thử ngày 29–30/09.
  - Rủi ro còn lại: sự cố của chính 9router hoặc máy nhóm trưởng (ngày 03/10 một campaign dừng ở 79/132 lượt khi tiến trình cổng đổi).
- Chạy app: `npm run up` (API cổng 3000, web cổng 5174). Chế độ live: `RUNTIME_MODE=live npm run up`, xem mục "Through the app" trong `evaluations/README.md`. Live không có biến SMTP nào vẫn chạy, nhưng đăng ký bằng email và các chức năng gửi email tắt (503); cấu hình SMTP thiếu một phần là lỗi khởi động.
- Gmail (GMAIL-01): chỉ bật khi `GMAIL_ENABLED=on`, đủ ba biến `GMAIL_OAUTH_*` và có PostgreSQL; dùng client OAuth của Google Cloud project riêng, không dùng client đăng nhập. Live thiếu biến thì không khởi động. Sandbox cần đủ bốn endpoint giả (`GMAIL_OAUTH_AUTH_URL`, `GMAIL_OAUTH_TOKEN_URL`, `GMAIL_OAUTH_REVOKE_URL`, `GMAIL_API_BASE_URL`, máy chủ `scripts/fake-google-gmail.mjs`); thiếu thì route trả 503. Từ GMAIL-02 (#143), cờ bật thì Gmail vào catalog và registry của người gọi; sandbox dùng adapter Gmail giả nhưng vẫn cần kết nối riêng qua OAuth giả. Kịch bản `SANDBOX_SCENARIO=gmail` tự chuyển planner sang chế độ `llm` để tra cứu rồi lập kế hoạch trả lời thư. Không bật cờ trên máy chạy buổi thử 23–25/10.
- Kiểu trả lời (ANS-01): `PLANNER_READ_ANSWERS=on` chỉ có tác dụng ở chế độ tra cứu `llm` (mặc định ở live; sandbox mặc định `regex`). Kịch bản `SANDBOX_SCENARIO=answer` cần thêm `PLANNER_SEARCH_MODE=llm`; runner browser tự đặt cả hai cho nhóm `answer` và đặt `off` cho mọi nhóm khác. Cờ vẫn tắt ở buổi thử 23–25/10.
- Lịch chạy (SCHED-01/02): `SCHEDULES_ENABLED=on` chỉ có tác dụng khi có PostgreSQL. Khi đó server chạy đối soát lượt dở, mount `/api/schedules…`, chạy bộ hẹn giờ sau `listen`, và `/api/health` có `schedulesEnabled: true`. Thiếu PostgreSQL thì server cảnh báo và tắt lịch.
  - Trước khi bật, chạy `npm run db:migrate:v3` để có migration 0010.
  - Giờ hẹn theo `APP_TIME_ZONE`.
  - Kịch bản `SANDBOX_SCENARIO=schedule` tự chuyển planner sang chế độ `llm`, nhưng không tự bật cờ.
  - Cờ tắt mặc định cho tới PR bật cờ của SCHED-04.
- Google login cần đủ `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_OAUTH_REDIRECT_URI` và PostgreSQL; thiếu thì ẩn nút và route Google trả 503. Google signup theo `AUTH_SIGNUP_ENABLED`, không phụ thuộc việc SMTP đã bật; Callback web `/auth/google/callback`; Google OAuth và Gmail SMTP thật đã cấu hình/kiểm ở AUTH-06 ngày04–05/10; xem hướng dẫn AUTH-06 trong `evaluations/README.md`.
- Tài nguyên thử nghiệm thật: Trello board "To Do", Slack `#ati-test`, GitHub `VinhDat267/ati-test`. Chỉ ghi ra service thật khi người dùng đã duyệt đúng plan đó.

## 7. Quy tắc đã chốt

- **Phạm vi chốt 02/10/2026:**
  - thêm Google Sheets, Google Calendar, Notion, Telegram, Jira; mốc chốt catalog 20/10;
  - đăng ký mở nhưng admin duyệt, vì credentials service dùng chung cả nhóm;
  - gửi email bằng Gmail SMTP (`nodemailer` là thư viện mới duy nhất được phép cho mảng tài khoản);
  - đăng nhập Google bằng OIDC.

- **Chốt 05/10/2026:**
  - yêu cầu chỉ đọc được hỏi lại ngay ở lời gọi model đầu tiên, không tra cứu; plan phải có ít nhất một bước ghi; không thêm kiểu trả lời đọc dữ liệu (W3-10);
  - LLM dự phòng là model Codex `cx/` trong cùng 9router, chuyển thủ công, không tự chuyển model khi lỗi (W4-00);
  - phép đo trước/sau của W3-10 phải dùng đúng `ag/gemini-3.8-flash`;
  - xoá mã và tài liệu v1/v2 khỏi `main` (#80). Cần đối chứng thì đọc từ tag `archive/v2-final`; không khôi phục vào `main` khi chưa có yêu cầu của chủ dự án.
  - giao diện mới theo design system "Agentic" (#84): Primary `#FF5701`, nền `#F6F6F1`, thang chữ 14/16/18/24/32/40, không thêm màu ngoài bảng;
  - chữ trên nút cam giữ màu trắng (3,2:1, ngoại lệ có chủ đích). Đặc tả áp dụng cùng quy tắc cho nút nền Success/Warning; người dùng merge mà không phản đối;
  - chữ thường Be Vietnam Pro, tiêu đề Playfair Display, mã/ID JetBrains Mono;
  - cỡ chữ tối thiểu 14px áp dụng khi làm app; bản mẫu giữ nguyên, không sửa theo app.

- **Chốt 06/10/2026:** bản mẫu là chuẩn về hình thức. App phải giống bản mẫu, chỉ khác ở các điểm trong đặc tả giao diện mục 1.1 (công cụ demo, dữ liệu thật, quy tắc trung thực, chữ ≥ 14px và tiêu đề ≤ 40px, token màu, trợ năng, gợi ý theo dịch vụ đã thiết lập, một ô nhập). Cách làm: chuyển markup bản mẫu sang JSX, đổi màu sang token và class Tailwind v3 sang v4, nối dữ liệu thật (đặc tả mục 1.2). Mỗi task FE có tiêu chí ảnh đặt cạnh bản mẫu ở 1440 và 375, sáng và tối. (Cách làm thay bằng bản 07/10 dưới đây.)

- **Chốt 07/10/2026:** đưa thẳng bản React của bản mẫu (`docs/design/prototypes/react/`, PROTO-01) vào app. App theo **design system Agentic đúng như 12 bản mẫu thể hiện**: kể cả chữ 10–12px, tiêu đề 42–52px, nền `#F8F8F6`, chế độ tối theo `theme.css` của bản mẫu.
  - Không còn hiệu lực cho app: các điều chỉnh riêng cho app chốt 05/10 (chữ tối thiểu 14px, nền `#F6F6F1` thay `#F8F8F6`, bộ token suy ra của đặc tả 3.3/FE-04) và cách làm "chuyển markup HTML sang JSX, đổi token, nâng chữ" (chốt 06/10). Giữ: cam `#FF5701`, ba font, chữ trắng trên nút cam (đều có trong bản mẫu).
  - Trợ năng làm đổi hình thức (chữ ≥ 14px, vùng chạm 40×40, tương phản 4,5:1 cho chữ nhỏ màu xám) chỉ đo và ghi lại ở FE-10; trợ năng không đổi hình thức (aria, landmark, một `h1`, focus) vẫn bắt buộc.
  - Design system rút từ 12 bản mẫu, đối chiếu gói Agentic của Open Design: [`docs/design/design-system.md`](../design/design-system.md). Chỗ lệch giữa các trang giữ nguyên; màn mới dùng giá trị chuẩn trong tài liệu (người dùng chốt 07/10).
  - Cách làm: đặc tả giao diện mục 1, 1.1, 1.2 bản 07/10; [FE-04b](tasks/FE-04b-prototype-foundation.md) đưa lớp nền vào trước, FE-05b → FE-10 chép trang của bản React rồi nối dữ liệu thật.

- **Chốt 13/10/2026** ([đặc tả Gmail và kiểu "trả lời"](../superpowers/specs/2026-10-13-gmail-personal-connections-design.md), task [GMAIL-common](tasks/GMAIL-common.md)):
  - thêm Gmail như dịch vụ **riêng của từng người**: mỗi người tự kết nối Google của mình, không rơi về khoá chung, quản trị viên không dùng được hộp thư người khác. Không xoá vĩnh viễn thư;
  - Google Cloud project và client OAuth **riêng** cho Gmail, không dùng chung với đăng nhập Google (AUTH-04);
  - cờ `GMAIL_ENABLED` và `PLANNER_READ_ANSWERS` tắt mặc định cho tới PR bật cờ của GMAIL-04. Gmail không vào `ALL_TOOLS`/`SERVICE_REGISTRY`, nên catalog 33 tool/8 dịch vụ chốt 20/10 và các phép đo tuần 4 không đổi; buổi thử 23–25/10 chạy với cờ tắt;
  - khi `PLANNER_READ_ANSWERS` bật, câu chỉ đọc được **trả lời** sau khi tra cứu, thay phần "không thêm kiểu trả lời đọc dữ liệu" của chốt 05/10. Quy tắc "plan phải có ít nhất một bước ghi" giữ nguyên;
  - nhóm trưởng chấp nhận việc nội dung thư đi qua 9router tới tài khoản model bên thứ ba và được giữ trong hội thoại; `/privacy` phải ghi đúng điều này khi Gmail bật.

- **Chốt 19/10/2026** ([FE-12](tasks/FE-12-shared-nav-bar.md), đặc tả giao diện mục 1.1 điểm 10):
  - mọi trang sau khi đăng nhập, kể cả cockpit, dùng một thanh điều hướng chung. Các tab căn giữa thanh;
  - câu "Yêu cầu hiện tại" rời thanh trên và thành dòng "Bạn nhờ" trong nội dung cockpit. Không thêm dòng thứ hai dưới thanh;
  - đây là chỗ lệch bản mẫu có chủ đích, ngoài chốt 07/10. Bản mẫu trong `docs/` không sửa theo;
  - ngày 20/10, sau review #162, nhóm trưởng chốt tab hiện từ 900 px (trước đó 768 px). Dưới 900 px, thanh dùng bố cục điện thoại.

- **Chốt 23–24/10/2026** ([W4-01](tasks/W4-01-independent-eval-set.md)):
  - W4-01 dùng 32 câu do bốn thành viên viết, trong đó hai người đã xem hoặc sửa prompt. Bỏ kế hoạch để hai thành viên viết thêm. Báo cáo tách kết quả theo hai nhóm, không ghi mã nào thuộc nhóm nào, và không gọi cả bộ là độc lập;
  - trong bộ chạy golden, câu có lời gọi model quá deadline của production sau cả hai lần thử được chấm trượt, và campaign chạy tiếp. Lỗi provider khác, hoặc 3 lần quá hạn liền nhau (chỉ câu model đã trả lời mới cắt chuỗi), vẫn dừng campaign. Deadline của app không đổi;
  - nhóm trưởng cho đo và merge #164 ngày 24/10, trong ba ngày thử W4-03, vì tối đó không có lượt thử và PR không đổi mã sản phẩm.

- **Chốt 24–25/10/2026** ([đặc tả lịch chạy](../superpowers/specs/2026-10-24-scheduled-workflows-design.md), task [SCHED-common](tasks/SCHED-common.md)):
  - nhóm trưởng quyết triển khai đề xuất "OAuth và tạo lịch workflow bằng AI" của `longnguyen005`; lịch chạy làm trước, OAuth làm sau;
  - **mốc ngừng thêm tính năng dời từ 29/10 sang 04/11**; phần ổn định demo của tuần 5 dời sang 05–06/11;
  - lịch chạy chỉ có chế độ chờ duyệt từng lần: mỗi lượt lập kế hoạch mới, có mã băm và lần duyệt riêng. Quy tắc "chỉ ghi khi người dùng duyệt đúng kế hoạch" giữ nguyên;
  - demo lịch chạy dùng Google Calendar → Slack;
  - cờ `SCHEDULES_ENABLED` tắt mặc định cho tới PR bật cờ của SCHED-04; catalog 33 tool/8 dịch vụ không đổi;
  - chia việc: reviewer làm backend và planner, `longnguyen005` làm giao diện;
  - đặc tả được duyệt ngày 25/10;
  - nhóm trưởng cho merge #167 và #168 tối 25/10, sớm hơn mốc 26/10, vì toàn bộ nằm sau cờ `SCHEDULES_ENABLED` tắt.

- **Chốt 25/10/2026 (OAuth)** ([đặc tả OAUTH-01](../superpowers/specs/2026-10-25-oauth-connect-from-chat-design.md)):
  - OAuth làm hẹp nhưng chạy thật. OAUTH-01 (kết nối Gmail ngay trong hội thoại, quay về đúng hội thoại, gửi lại yêu cầu) là bắt buộc;
  - OAUTH-02 (Google Calendar riêng) là tuỳ chọn, quyết ngày 29/10;
  - OAuth cho Slack, GitHub, Notion, Jira, Trello không làm trước 04/11; Telegram giữ bot token;
  - quay về hội thoại chỉ tới `/c/<uuid>` của chính người gọi. Không tự gửi lại yêu cầu, không tự duyệt kế hoạch;
  - **OAUTH-02, chốt 27/10** ([đặc tả viết lại](../superpowers/specs/2026-10-26-oauth-02-personal-calendar-design.md)): chọn nhiều lịch ngay trên màn callback, thay cho "chỉ lịch chính, 2 tool" của bản 26/10; client OAuth ở Google Cloud project riêng, không chung project với Gmail, vì Google thu hồi token theo project; nhóm trưởng cho merge phần mã trước buổi quyết 29/10, cờ vẫn tắt;
  - **OAUTH-03, chốt 28/10** ([đặc tả](../superpowers/specs/2026-10-28-oauth-03-personal-sheets-design.md)): thêm Google Sheets riêng (`mysheets`), phủ bốn tình huống (ghi vào bảng riêng, Jira → bảng riêng, bảng riêng → Slack, lịch chạy); chọn bảng tính bằng Google Picker với quyền `drive.file`, nên trình duyệt nhận access token qua route `picker-session` (ngoại lệ có ràng buộc, đặc tả mục 7.2); Google Cloud project thứ ba; `/guide` và Landing có Sheets riêng khi cờ bật; nhóm trưởng làm phần mã trong ngày 28/10, cờ `MYSHEETS_ENABLED` tắt; OAUTH-03 không nằm trong danh sách bỏ khi thiếu thời gian;
  - ngày 26/10, nhóm trưởng xác nhận việc #172 sửa assertion cũ của `gmail-migration.test.ts`: test kiểm đúng tập tên ba ràng buộc (`oauth_states_mode_check`, `oauth_states_mode_owner_check`, `oauth_states_return_to_check`) thay vì đếm 2 ràng buộc có chữ `mode`.

- TDD: viết test fail trước, rồi mới sửa. Không mock hình thức; timeout phải test bằng `AbortSignal` thật; logic database phải test trên PostgreSQL thật.
- Không tuyên bố "xong" nếu chưa có output lệnh thật (test, exit code). Ghi rõ cái gì đã kiểm, cái gì chưa.
- Label của golden set được đăng ký trước. Chỉ sửa label trong commit riêng, có giải thích, không sửa để khớp kết quả.
- W3-06: người dùng chốt rf06 clarification trước commit `1ab7f08`; labels44services `20fa6f0` trước provider calls. Catalog33tool/8service đóng băng cho phép đo03/10; giữ mốc20/10 và đo lại nếu catalog đổi.
- Mô tả PR và commit **không** có dòng "Generated with …" hay chữ ký của AI.
- Conventional Commits. Một task một nhánh một PR. Chỉ merge khi CI xanh.
- Repo công khai: không commit `.env`, token, `docs/ai-evidence/V3-LIVE-EXECUTION/`, `docs/ai-evidence/AUTH-LIVE/`, `docs/ai-evidence/GMAIL-LIVE/` hay báo cáo môn học.
- Báo cáo môn học viết tiếng Việt, tiêu đề mục tiếng Anh, giữ thuật ngữ kỹ thuật tiếng Anh, file `.docx`, chữ đen, Times New Roman.
