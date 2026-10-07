# 2026-10-07 · Claude Code · merge #96, đóng PROTO-01, kế hoạch đưa bản React vào app

## Merge #96

- **Yêu cầu:** người dùng nói "merge #96 rồi tiếp tục đi".
- **Trước merge:** CI `v3` của #96 xanh đúng head `841e674` ([run](https://github.com/VinhDat267/ATI_Project/actions/runs/37585664606)), PR mergeable, trạng thái CLEAN.
- **Merge:** `gh pr merge 96 --merge --match-head-commit 841e674…`, merge commit `581addd` lúc 14:14:47 ngày 07/10 (Việt Nam). `git diff --exit-code 841e674 581addd` không có khác biệt. [CI main](https://github.com/VinhDat267/ATI_Project/actions/runs/37586153208) xanh đúng `581addd`.
- **Dọn:** xoá nhánh `feat/proto-react-04` trên GitHub và ở local, gỡ worktree bước 4, `main` local fast-forward tới `581addd`. Các file riêng của người dùng (`DESIGN.md`, `PRODUCT.md`, `.github/agents/`, `.github/hooks/`, `docs/reports/`, `skills-lock.json`) giữ nguyên.
- **So lại cả 12 trang trên `main` `581addd`:** 459/464 trường hợp, exit 1 (`index` 43/44, `app-stage` 57/58, `auth-action` 47/50, chín trang còn lại đạt hết; 9 trường hợp đạt ở lần chạy lại). Cả 5 trường hợp lệch đều là trạng thái chụp giữa chừng một hẹn giờ: `auth-action` "Đang gửi lại" (2 khổ) và đồng hồ đếm ngược, `index` trả focus sau Esc, `app-stage` gợi ý tự chuyển khoảnh khắc. Chạy riêng từng trạng thái đều đạt (2 trong 4 lần cần chạy lại). Chưa có lần so toàn bộ 12 trang nào exit 0.

## Review kế hoạch

- **Yêu cầu:** người dùng nói "hãy review kiểm tra xem kế hoạch xem có hợp lý không có điều chỉnh gì không", rồi "tiếp tục review kế hoạch đi" (sau khi tạm dừng).
- **Đã đọc:** ROADMAP, CURRENT-STATE, FE-05b → FE-10, W3-10, W3-11, W4-00 → W4-04, đặc tả giao diện mục 1 → 12, README `react/`, `apps/chat-web` (`index.css`, `use-theme.ts`, `routes.ts`, danh sách test), hai PR draft #47 và #87.
- **Kết luận đưa người dùng:**
  - thứ tự và phạm vi hợp lý;
  - hai quyết định chỉ người dùng chốt được:
    - app theo đặc tả 1.1 (Agentic cộng các điều chỉnh riêng cho app: chữ ≥ 14px, nền `#F6F6F1`, token suy ra) hay theo đúng bản mẫu (PROTO-01 ghi người dùng muốn giữ design system của bản mẫu);
    - hai PR "Planora";
  - năm chỗ nên chỉnh:
    1. FE lấy JSX từ bản React thay vì HTML;
    2. đặc tả 1.2 thiếu các bẫy v3 → v4 mà PROTO-01 đã gặp (app chạy Tailwind v4 thuần, không có lớp tương thích);
    3. công cụ chụp ảnh đặt cạnh nhau;
    4. FE-05b mốc 11/10 quá sát và W3-10 chưa có người nhận;
    5. tuần 5 chưa có task card, các việc của con người chưa có ngày.
- **Người dùng chốt:**
  - **đưa thẳng bản React vào app**;
  - Planora: người dùng tự xử lý;
  - chỉ làm phần "sửa kế hoạch (PR tài liệu)". Không làm task card tuần 5 và script chụp ảnh trong đợt này.

- **Người dùng chỉnh cách diễn đạt** (sau khi mở PR): "đâu, design system dùng Agentic như bản 12 HTML đã convert sang React mà". 12 bản mẫu được làm theo Agentic, nên bản đầu của PR ghi sai là "dùng design system của bản mẫu thay cho token Agentic". Đã sửa ở mọi chỗ thành: app theo Agentic đúng như 12 bản mẫu thể hiện; thứ bị bỏ là các điều chỉnh riêng cho app của đặc tả (3.2 điểm 3–4: chữ tối thiểu 14px, nền `#F6F6F1`; bộ token suy ra 3.3 của FE-04).

## Thay đổi kế hoạch (PR này)

- **Đặc tả giao diện:**
  - mục 1, 1.1, 1.2 viết lại: nguồn là bản React; app dùng design system bản mẫu; 1.1 bỏ điểm 4 (cỡ chữ) và 5 (token màu/nền/chế độ tối theo token), thêm điểm route và dải thử nghiệm; 1.2 là quy trình chép trang, bỏ JS demo, nối dữ liệu, không import từ `docs/`;
  - mục 3, 7, 8, 10, 11, 12: ghi chú phần bị thay từ 07/10, thêm FE-04b vào bảng mốc, thêm ba rủi ro: lớp tương thích áp cho cả app trong lúc chuyển dần, trang lớn phải tách và nạp theo route, giới hạn trợ năng.
- **Task card mới [FE-04b](../tasks/FE-04b-prototype-foundation.md):** lớp nền (CSS tương thích, bảng màu, token theo trang, `theme.css`, `usePrototypePage`, một cơ chế sáng/tối), trang 404 làm thử; mốc 09/10.
- **FE-05b:** đổi cách làm sang chép `AppStagePage.tsx`; mốc 13/10 (dời từ 11/10), phụ thuộc FE-04b, được tách 2 PR; thanh trên của cockpit lấy từ bản React, `AppShell` không dựng thanh thứ hai; bỏ tiêu chí tương phản token/14px.
- **FE-06 → FE-10:**
  - thêm đoạn "Cách làm 07/10" với trang nguồn của bản React; tiêu chí "giống bản mẫu" so với bản React; FE-07 → FE-10 phụ thuộc FE-04b;
  - FE-10: 404 chuyển sang FE-04b, tương phản chỉ đo và ghi, bỏ kiểm cỡ chữ 14px.
- **ROADMAP:**
  - thêm dòng FE-04b, sửa dòng FE-05b, FE-07, PROTO-01;
  - thứ tự, phần tối thiểu để demo và thứ tự cắt có FE-04b;
  - đoạn "Bổ sung 07/10": W3-10 trên đường găng, các việc của con người chưa có ngày, đề xuất buổi thử W4-03 ngày 23–25/10, tuần 5 chưa có task card, Planora.
- **CURRENT-STATE:**
  - đầu file và mục 4 ghi #96;
  - dòng frontend theo quyết định 07/10;
  - mục 7 thêm "Chốt 07/10/2026";
  - mục 5 thêm hai hạn chế: trợ năng của design system bản mẫu; các trạng thái hẹn giờ của script so.
- **PROTO-01:** trạng thái "xong cả 4 bước", mục "Ngoài phạm vi" ghi quyết định 07/10, thêm kết quả so lại sau merge.

## Không làm

Không sửa mã. Không đóng hay sửa #47, #87. Không lập task card tuần 5, không viết script chụp ảnh (người dùng không chọn). Kế hoạch tự review, nên có review độc lập trước khi giao FE-04b.
