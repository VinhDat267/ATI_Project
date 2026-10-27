# 25/10/2026 · Codex · SCHED-03: giao diện lịch chạy

**Nhánh:** `codex/feat-sched-03-ui`. **Base:** `c760aa3` (#170). **PR:** [#171](https://github.com/VinhDat267/ATI_Project/pull/171). **Commit mã và test:** `4b825ab`, sửa replay/hydration cuối ở `c966c2e`. Task: [SCHED-03](../tasks/SCHED-03-schedule-ui.md). Người dùng giao pull code mới và thi công SCHED-03; checkout ban đầu sạch tại `6307962`, đã fast-forward rồi tạo nhánh riêng.

## Đã làm

- API client dùng kiểu lịch chung, giữ `error.code` và câu tiếng Việt của lỗi lồng. Bộ định dạng thời gian dùng `Asia/Ho_Chi_Minh`, không phụ thuộc múi giờ máy.
- Khoảnh khắc `schedule`: tạo/sửa có giá trị cũ gạch ngang, dịch vụ, ba lần chạy tới và câu chờ duyệt; xác nhận có chốt đồng bộ chống bấm hai lần. Sửa focus ô chat. Bỏ qua chỉ ẩn trong phiên, không gọi API.
- Trạng thái lịch và các nút tạm dừng/chạy tiếp/hủy/chạy ngay. Hủy dùng `useDialogFocus`; lỗi đóng modal để câu lỗi không bị che. 409 đọc lại dữ liệu; đọc muộn không ghi đè phản hồi SSE mới.
- Hội thoại của lượt dùng nguồn lịch ở mọi màn (tra cứu, kế hoạch, kết quả, phục hồi, phản hồi và lỗi), cùng ngăn hội thoại. Nút lập lại kế hoạch cho lượt hết hạn/lỗi/gián đoạn mở hội thoại mới, không tái dùng kế hoạch hay approval.
- `run-now`/`replan` trả trước khi runner gán `convId`: web đọc lại lượt cho tới khi có hội thoại (hủy khi rời màn, hạn chờ 30 s; nếu chưa có thì báo mở từ Nhật ký sau ít giây). Khi mở lúc đang lập kế hoạch, dựng trạng thái chờ từ dữ liệu bền, đối soát kết quả nếu bỏ lỡ SSE.
- Mục Lịch chạy nằm sau phần giới thiệu/an toàn và trước danh sách hội thoại ở Nhật ký; mở hàng xem 10 lượt gần nhất. Số chờ duyệt trên tab và menu avatar cập nhật lúc tải, mỗi 30 s, focus và khi lịch/kế hoạch thay đổi; dừng khi đăng xuất.
- Capability đọc một lần ở gốc app; không thêm request health vào từng trang con. Cờ tắt không gọi API lịch hoặc hiện thành phần lịch. Không thêm route, tab, màu hay dependency.
- Runner browser thêm nhóm `schedule`; mọi nhóm khác ép `SCHEDULES_ENABLED=off`. Không sửa assertion cũ.

## RED → GREEN và review độc lập

- Trước cài đặt: test state và test UI đều exit 1 vì chưa có module `schedule-text`/`ScheduleMoment`. Log RED ban đầu ở `node_modules/.cache/sched03/red-state.log`, `red-ui.log`.
- RED hành vi theo review:
  - mở lượt có trạng thái bền `planning` nhưng `isPlanning=false` (expected true, received false);
  - GET lịch sử nền cũ tới sau câu trả lời mới: expected `refusal`, received `old-plan`.
- Hai ca trên GREEN sau khi dựng pending từ lượt và thêm guard `messages`/`planRevision` trước khi append lịch sử nền. Đường tải foreground cũ giữ hợp đồng hiện có.
- Review độc lập bằng subagent, không sửa file: vòng đầu **chưa đạt**, 5 P2 (race reload, mất pending, lỗi dưới modal, nguồn lịch khi cờ tắt, nguồn lịch thiếu ở phản hồi/lỗi). Đã sửa; vòng sau phát hiện thêm race loader nền, cũng đã tái hiện RED và sửa. Reviewer chạy lại **33/33** test khi đó, exit 0, kết luận **Đạt phần mã nguồn**; sau đó thêm một test replay SSE, tổng **34 test mới**.
- Một lần chạy web toàn bộ phát hiện 3 hồi quy ở Settings do health request mới từ MainNav. Đã chuyển capability lên provider gốc; không sửa test cũ.
- Review đúng `4b825ab` phát hiện thêm replay proposal không có `requestId` làm mất pending mới: RED `true` → `false`. Đã đưa chốt trùng lên trước settlement.
- Full browser phát hiện 4 ca reload lịch sửa trượt: SSE phản hồi đến trước GET, upsert giữ vị trí khiến tin người dùng cũ nằm sau trạng thái lịch. RED unit tái hiện thứ tự `proposal-1, proposal-2, state, user-1, user-2`. Đã merge phần DB theo đúng thứ tự trước, giữ tin mới chưa có trong DB ở cuối; nhận diện cùng response qua `planId` hoặc `type`/`replyToMessageId`, không chỉ ID hiển thị SSE. Lỗi SSE giữ correlation nếu có.
- Reviewer độc lập kiểm lại delta cuối và chạy **106/106** test trong 9 file, gồm **36 test SCHED-03**, exit 0 lúc 22:12, kết luận **Đạt phần mã nguồn**, không còn P1/P2. Web toàn bộ cuối **809/809**.

## Đột biến

Mỗi lượt sửa đúng một chỗ, chạy test liên quan, khôi phục và so SHA-256. Script/log bị ignore ở `node_modules/.cache/sched03/`.

| Mã | Đột biến | Kết quả |
|---|---|---|
| M1 | Bỏ câu chưa ghi lên công cụ | bị bắt |
| M2 | Bỏ qua gọi confirm API | bị bắt |
| M3 | Gọi pending-count khi cờ tắt | bị bắt |
| M4 | Hiện lượt lịch như người dùng tự gõ | bị bắt |
| M5 | Không đọc lại khi STALE_VERSION | bị bắt |
| M6 | Tên truy cập tab không có số | bị bắt |
| M7 | GET 409 cũ ghi đè SSE mới | bị bắt |
| M8 | Không dựng trạng thái đang lập kế hoạch | bị bắt |
| M9 | Lỗi hủy nằm dưới modal vẫn mở | bị bắt |
| M10 | Replay proposal trùng kết thúc pending mới | bị bắt |
| M11 | Response replay nằm trước các tin người dùng đã lưu | bị bắt |

**11/11 bị bắt** trên cây mã cuối, mỗi lượt exit 1 do assertion hành vi fail, không phải lỗi import/hạ tầng. Kết quả máy đọc ở `mutations.json`.

## Kiểm tra

PostgreSQL 16 Alpine tmpfs riêng `ati-sched03-pg`, `127.0.0.1:55533`, sandbox; API/web browser ở 3999/5199. Không dùng DB dev; không gọi model hay dịch vụ thật. Migration 0010 đã áp dụng.

- `npm run check`, với `VITEST_MAX_WORKERS=4`: **exit 0**, **2.228 v3** = 63 schema + 408 adapter + 359 planner + 42 executor + 547 API + 809 web; **394 eval**. Typecheck, build, quét build, launcher (1) và các test Node cuối (10) đạt. Log cuối `check-5.log`; lượt trước `check-4.log` cũng đạt (ít hơn 2 test hồi quy mới).
- Các lượt check trước được giữ nguyên: lượt đầu lỗi TypeScript ở test mới (`exact` không thuộc `ByRoleOptions`), đã sửa; lượt tiếp lỗi OID ở `gmail-migration.test.ts` khi các schema bị dọn đồng thời; lượt sau có `too many clients already` ở test API. Giới hạn 4 worker giải quyết tải của DB test; không sửa backend/assertion hay bỏ test.
- Nhóm browser lịch lần đầu: **17/17, exit 0**, trước khi bổ sung bốn ca version/replan và chốt loader nền cuối.
- Browser toàn bộ lượt 1: default **94 pass/1 skip**, auth02 **2**, auth04 **6** đạt; clarification **3 fail** vì `.env` cá nhân đặt `PLANNER_SEARCH_MODE=llm`. Lượt 2 đặt rõ `regex` như CI; nhóm answer/Gmail/schedule vẫn tự chọn `llm` theo runtime đã merge. **13 nhóm ngoài lịch: 121 pass/1 skip**, nhưng nhóm lịch **17 pass/4 fail** ở reload như mô tả trên; không gọi lượt này là full pass.
- Sau sửa, nhóm `schedule` trên cây mã `c966c2e`: **21/21, exit 0** (`browser-schedule-3.log`), gồm 4 ca reload, version cũ và lập lại kế hoạch cho cả `expired`/`planning_failed`/`interrupted`. Các lượt trên bao phủ tổng **142 ca đạt/1 skip**; cổng tổng hợp `npm run test:browser:v3` trên head cuối được kiểm lại bằng [CI của #171](https://github.com/VinhDat267/ATI_Project/pull/171/checks), kết quả và head SHA ghi ở mô tả PR.
- `git -c core.whitespace=cr-at-eol diff --check`: đạt.

## Ảnh

20 ảnh tạo/sửa/trạng thái/Nhật ký/số chờ duyệt ở 1440/375, sáng/tối. Bằng chứng gốc ở `node_modules/.cache/sched03/`, đã chép log, đột biến và ảnh vào **`D:/ATI_Project/ATI_Project/.codex/sched03/`** để không mất khi `npm ci` dọn cache. Không commit ảnh. Manifest `screenshots/manifest.sha256`: `270fbfae50aedcc6944f506b564ed5e0c6445076b9f7075d4661b3ed22680f97`. Đã xem trực tiếp ảnh sửa lịch 375 sáng, kế hoạch có số chờ 1440 tối, Nhật ký 375 tối và đề xuất 1440 sáng; chữ xuống dòng, không tràn ngang. Browser có assertion 375 với tên 80 ký tự và request 1.000 ký tự liền.

## Môi trường và giới hạn

- Docker Desktop không khởi động được vì `docker-secrets-engine/engine.sock` cũ là reparse point hỏng. Thư mục IPC chỉ có socket 0 byte đó; đã dừng Docker, chuyển thư mục sang `C:/Users/Admin/AppData/Local/docker-secrets-engine-sched03-stale`, rồi khởi động để Docker tạo IPC mới. Không reset Docker, không sửa/xóa volume hay file secrets. Bản dự phòng giữ nguyên.
- API hiện chỉ trả tối đa 50 lượt; màn phục hồi tra lượt trong cửa sổ này, danh sách mở hàng hiển thị 10 lượt theo task. Không đổi hợp đồng backend.
- Không sửa `CURRENT-STATE.md`, `ROADMAP.md`, backend, planner, catalog hay prompt. Không bật cờ; đo/nghiệm thu thật và PR bật cờ thuộc SCHED-04.
- CI đầu tiên của #171 tại `4b825ab`: `check` đạt, browser trượt; giữ [run 40204428838](https://github.com/VinhDat267/ATI_Project/actions/runs/40204428838) làm bằng chứng trước sửa. CI head mới được theo dõi ở PR, không merge trong phiên thi công.
