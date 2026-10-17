# 17/10/2026 · W4-04 · Chế độ đo latency hàng loạt qua giao diện

**Người viết:** reviewer (nhóm trưởng giao thi công) · **Nhánh:** `test/w4-04-frontend-latency`, base `ab54c77` · Task: [W4-04](../tasks/W4-04-frontend-latency.md).

## Đã làm

- `evaluations/live-app/batch.ts`:
  - `parseLatencyPrompts`: kiểm file câu đo;
  - `runLatencyTurn`, `runLatencyBatch`: chạy từng câu;
  - `readServerTiming`: đọc thời gian phía server từ PostgreSQL;
  - `cancelThroughUi`: hủy kế hoạch qua giao diện;
  - `summarizeLatency`: tổng hợp số liệu;
  - `loginAtLoginPage`: đăng nhập.
- `evaluations/live-app/latency.e2e.ts`, `latency.config.ts`: lượt đo live, cần `LIVE_APP_LATENCY=1`. Ghi `batch.json` sau mỗi lượt (kèm SHA-256 của file câu, commit, model yêu cầu) và `summary.md` ở cuối.
- `evaluations/live-app/latency-prompts.json`: 24 câu, chuyển từ bộ tự do (ff05, ff06, ff08, ff13) và bộ services sang tài nguyên thử nghiệm thật. Có 6 câu cho mỗi nhóm 1, 2, 3 và ≥ 4 dịch vụ.
- `evaluations/live-app/batch.test.ts`: 23 test.
- `apps/chat-web/tests/browser/w4-04-latency-batch.spec.ts`: 3 test browser sandbox. `scripts/test-v3-browser.mjs` thêm hai nhóm grep.
- Mục "W4-04: batch latency" trong `evaluations/README.md`, ghi rõ chưa đo.

Không sửa mã sản phẩm.

## Cách đo

- **Đầu lượt:** mỗi câu mở một hội thoại mới bằng `page.goto('/')`. Bấm gửi xong, chờ đồng thời URL `/c/<id>` và phần tử phản hồi đầu tiên:
  - `section[data-moment="4"]`: kế hoạch;
  - `section[data-moment="3"]`: hỏi lại;
  - `section[data-moment="refusal"]`: từ chối;
  - `section[data-moment="answer"]`: trả lời;
  - `#view-server`: lỗi lập kế hoạch.

  Màn "đang tìm" (moment 2) và màn chờ lâu không tính là phản hồi.
- **Thời gian phía server** lấy từ `messages` và `plans`. Theo `chat-service.ts`, server lưu câu chat, chạy planner, lưu working memory ngay khi planner trả về, rồi lưu phản hồi và mới gửi SSE. Vì vậy:
  - planner = working memory − câu chat (gồm model, tra danh mục, tra cứu, kiểm kế hoạch);
  - lưu = phản hồi − working memory;
  - server = phản hồi − câu chat;
  - frontend = thời gian thấy phản hồi − server (request tới API, SSE, vẽ).

  Các hiệu này chỉ dùng mốc giờ của PostgreSQL hoặc chỉ mốc giờ của trình duyệt, không trộn đồng hồ của hai máy.
- **Hủy:** kế hoạch được hủy bằng nút **Hủy** trên giao diện. Nếu sau `LIVE_APP_TURN_TIMEOUT_MS` chưa thấy phản hồi, lượt ghi `timeout`, chờ thêm `LIVE_APP_GRACE_MS` để hủy kế hoạch đến muộn. Cuối lượt chạy, mọi hội thoại được kiểm lại, kế hoạch nào còn mở thì hủy nốt. Mã không có nút hay request duyệt; test đọc mã nguồn để giữ điều này.
- **Tỉ lệ dưới 15 s** tính trên mọi lượt; lượt không có phản hồi tính là không đạt. Percentile theo cách nearest-rank như báo cáo golden-v2.

## Kiểm thử

- PostgreSQL 16 tmpfs riêng ở 55533 (container `ati-w404-pg`), không dùng DB của `.env`. Sandbox, tài khoản CI, `PLANNER_READ_ANSWERS=off`.
- **RED:** `batch.test.ts` khi chưa có `batch.ts`: fail vì không tìm thấy module. Mã và test viết trong cùng lượt, nên bằng chứng chính là đột biến dưới đây.
- **GREEN:**
  - `batch.test.ts` 23/23. Gồm kiểm file câu, ánh xạ moment, tách thời gian, percentile, tổng hợp, và 3 test trên PostgreSQL thật (schema riêng dựng từ migration `db/v3`): kế hoạch bị hủy, phản hồi đầu là câu hỏi lại kèm 1 bước đã thực thi, hội thoại đang lập kế hoạch.
  - Browser nhóm default (`--grep 'W4-04:'`) 2/2: 3 câu → 3 hội thoại riêng, mọi kế hoạch `rejected`, 0 `execution_steps`, `frontendMs = visibleMs − serverMs`; kế hoạch đến sau lượt hết giờ 1 ms vẫn bị hủy.
  - Browser nhóm clarification (`--grep 'clarification before plan|W4-04 clarification'`) 3/3.
- **Đột biến:** 13 đột biến vào `batch.ts`, mỗi lần khôi phục và kiểm SHA-256. Mỗi lần chạy test đơn vị, rồi nhóm browser default, rồi nhóm clarification. **13/13 bị bắt:** 8 bởi test đơn vị, 4 bởi browser default, 1 bởi browser clarification.
  - Các đột biến: lượt không hủy kế hoạch; không chờ kế hoạch đến muộn; đổi moment 3/4; bỏ moment 3 khỏi bộ chọn; cộng thay vì trừ thời gian frontend; thời gian planner tính tới phản hồi; lấy phản hồi cuối thay vì đầu; tính 15 s là dưới 15 s; percentile làm tròn xuống; nhận dịch vụ lạ; không đếm bước đã thực thi; dùng lại hội thoại cũ; không đếm kế hoạch còn mở.
  - Bước kiểm lại cuối lượt chạy là lưới an toàn thêm, không có test nào tạo được tình huống cần tới nó.
- **Typecheck chặt** năm file mới (`strict`, `noUncheckedIndexedAccess`, `module: ESNext`) exit 0. Spec browser còn được `typecheck:v3` kiểm qua tsconfig của chat-web.
- `npm run check` (worktree, `DATABASE_URL` trỏ database tạm 55533, `RUNTIME_MODE=sandbox`, không có `.env`): exit 0, **1.953 v3** (63 schema + 408 adapter + 291 planner + 42 executor + 464 API + 685 web) **+ 196 eval** (173 + 23 test mới).
- Toàn bộ `npm run test:browser:v3` không chạy ở máy; CI chạy.

## Giới hạn

- **Chưa chạy phép đo live**, nên tiêu chí ≥ 20 lượt live và tỉ lệ dưới 15 s còn mở. Lượt đo chính thức chạy sau mốc chốt catalog 20/10, trên app live với `ag/gemini-3.8-flash` và đủ 8 dịch vụ đã kết nối. Lượt chạy không ghi lên dịch vụ, nhưng gọi model thật nên cần nhóm trưởng đồng ý.
- **Thời gian model chưa tách được** khỏi phần còn lại của planner: chat-api không ghi thời gian từng lời gọi model, mà muốn ghi thì phải sửa mã sản phẩm. Theo W3-10 (đo planner trực tiếp), model chiếm 99,96% thời gian lập kế hoạch.
- Thời điểm "thấy phản hồi" là lúc Playwright thấy phần tử, có thêm độ trễ dò của Playwright.
- Cần review độc lập: reviewer là bên thi công.
