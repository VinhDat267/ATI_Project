# Product

<!-- impeccable:product-schema 1 -->

## Product direction — approved 21/09/2026

Tên hiện hành: **AI Automation Platform**. Loại sản phẩm: AI Automation Workflow
Platform; giữ định danh kỹ thuật `ATI_Project`, `ati-*`, `@wap/*`.

Người dùng đích: điều phối viên nhóm dịch vụ thiết kế/web. Bài toán: biến yêu
cầu thiếu rõ ràng thành công việc đủ thông tin, được xác nhận và truy vết được.
Pilot gồm Sheets read-only + Trello; kiểm yêu cầu, tạo task sau approval và tra
task đã tạo. Hai operator riêng nhưng run owner-only và một active run/DB;
board ngoài là nơi cộng tác. Không đồng nghĩa đã có multi-tenant platform.

Đặc tả đã được user duyệt; adapter/source preflight/dedupe v2 chưa được nghiệm
thu. Nghiên cứu web là bằng chứng thứ cấp về vấn đề, không thay phỏng vấn,
customer adoption hay doanh thu. Không cần người quen để làm prototype; nếu
rubric yêu cầu nghiên cứu sơ cấp thì ghi rõ phần còn thiếu.

[BASELINE](docs/BASELINE.md) điều khiển scope;
[đặc tả](docs/superpowers/specs/2026-09-21-workflow-platform-mvp-v2-design.md)
ghi chi tiết; [System Design](System%20Design/DESIGN.md) vẫn là visual đã duyệt.
Code/lịch sử evidence B/local tiếp tục được giữ; không nâng nhãn live vì đổi docs.

## Hồ sơ B/local lịch sử — không dùng làm positioning hiện hành

Các section phía dưới là snapshot cũ để truy vết. Đặc biệt các dòng ATI branding,
trưởng nhóm môn học, UI/AI chưa có và hướng DESIGN.md cũ không phải trạng thái
hiện hành. Không diễn giải phạm vi OUT của profile B thành lệnh cấm scope v2.

## Platform

web

## Users

**Người dùng chính (giả thuyết, đã xác nhận làm định hướng ngày 17/09/2026):** trưởng nhóm dự án môn học. Họ đã có bảng tiến độ nhóm trong một nguồn local, cần chép các dòng tiến độ sang bảng báo cáo, xem hoặc chuyển thẻ công việc, rồi gửi thông báo tới nhóm — và muốn biết chính xác thao tác nào sẽ ghi, ghi vào đâu, trước khi cho phép.

Nhu cầu này **chưa được phỏng vấn hay đo**: việc gặp một người dùng đại diện, 3 mẫu công việc thật và đo thời gian/lỗi khi làm tay vẫn là `OPEN`. Không gọi dữ liệu tổng hợp là bằng chứng nhu cầu.

B/local chỉ có một tài khoản demo, không có vai trò, nhóm hay đa người dùng.

## Product Purpose

Biến một mô tả công việc bằng tiếng Việt hoặc tiếng Anh thành kế hoạch gọi công cụ MCP có thể giải thích, rồi thực thi có kiểm soát: chọn công cụ → sinh kế hoạch → kiểm tra kế hoạch và chính sách → đọc dữ liệu cho bản xem trước → người dùng duyệt đúng bản xem trước → ghi tuần tự → xem kết quả, trace và thông tin đối chiếu.

Đây là prototype đồ án môn học (ATI), hai thành viên, kế hoạch 6 tuần. Thành công nghĩa là:

- luồng yêu cầu → xem trước → duyệt → chạy → chứng cứ hoạt động thật trên PostgreSQL và server MCP local, mỗi thành viên tự giải thích được;
- có số đo minh bạch cho retrieval/planner (tách đã đo và `NOT_RUN`);
- không có thao tác ghi ngoài phê duyệt, không ghi trong bước xem trước, không tự gửi lại thao tác ghi chưa rõ kết quả.

## Positioning

Hai trụ cột ngang nhau:

1. **Kiểm soát ghi có bằng chứng.** AI chỉ đề xuất kế hoạch; mọi thao tác ghi phải qua bản xem trước bất biến, một lần duyệt gắn đúng run/version/snapshot hash và có thời hạn (10 phút, server quyết định), thực thi tuần tự, không retry mù. Khi không chứng minh được kết quả ghi, run kết thúc ở trạng thái “cần đối chiếu” kèm receipt/trace thay vì đoán.
2. **Thí nghiệm AI có đo đạc.** So sánh all-tools, semantic retrieval và semantic + query expansion trên cùng catalog/model/prompt/ngân sách; tách plan validity, độ đúng tác vụ, từ chối/hỏi lại, recovery, chi phí và độ trễ; holdout được đóng băng trước khi đánh giá.

Không tuyên bố vượt trội Zapier (đã có Copilot tạo Zap bằng mô tả) hay n8n (đã có MCP Client Tool). Giá trị là một thí nghiệm có giới hạn, minh bạch về điều đã và chưa đo.

## Operating Context

- Chạy **local/loopback**: API Fastify-style trên `127.0.0.1`, frontend qua Vite dev/preview proxy, PostgreSQL 16 (+pgvector dự kiến), một worker tuần tự, polling 2 giây (không WebSocket).
- Công cụ: server `task_hub` 8 tool local (`read_sheet_range`, `append_sheet_rows`, `send_slack_message`, `list_cards`, `get_card`, `list_members`, `create_card`, `move_card`) và `filesystem` 2 tool (`read_file`, `write_file`, mặc định tắt). Tên Sheets/Slack/Cards chỉ là hợp đồng dữ liệu local, **không** gọi dịch vụ thật.
- Giao diện: 6 view / 4 mục điều hướng — Đăng nhập, Tổng quan, Tạo yêu cầu, Lần chạy, Chi tiết lần chạy (Kế hoạch & phê duyệt / Tiến trình & kết quả / Chứng cứ), Công cụ & kết nối.
- Múi giờ mặc định `Asia/Ho_Chi_Minh`; ngôn ngữ giao diện tiếng Việt, thuật ngữ kỹ thuật đặt trong phần mở rộng khi cần.
- Bối cảnh đánh giá: demo và báo cáo đồ án; mỗi thành viên phải tự trình bày luồng và kiến trúc.

## Capabilities and Constraints

**Đã có (theo báo cáo trạng thái của repo):** DSL/validation/policy; migrations và seed; 8 tool `task_hub` với ghi kiểm approval/owner/version trong transaction; controller hai server MCP (FS-05 technical pass); API loopback với session, nhận run, worker, approval/cancel, events/trace, recovery (`API_PARTIAL`); shell React fixture (`PROVISIONAL_IMPLEMENTATION`).

**Chưa có / chưa chứng minh:** planner LLM thật, semantic retrieval và query expansion đo được, local replan (AI hiện chỉ ở mức offline slice; planner đang chạy là `DEV_FIXTURE_PLANNER`); frontend 6 view nối API thật; browser E2E; rubric chính thức; nhu cầu người dùng thật.

**Ràng buộc bền vững:**

- Registry policy của ứng dụng quyết định đọc/ghi, không phải LLM hay annotation MCP. Không policy → không gọi.
- Bản xem trước chỉ chạy bước đọc; duyệt đúng snapshot; không âm thầm đọc lại rồi thay payload.
- Ghi timeout/mất phản hồi/crash sau dispatch → `reconciliation_required`; không retry, không resume tự động.
- Từ chối (`refused`) và hỏi lại (`needs_input`) là kết quả planner riêng, không tạo plan rỗng.
- Token chỉ trong bộ nhớ tab; không đăng ký tài khoản, không kho credential, không cấu hình server MCP tuỳ ý qua UI.
- Ngoài phạm vi B: workflow editor/library, rerun, lịch chạy, SaaS thật, GitHub, WebSocket, thực thi song song, hybrid/BM25.

**Thuật ngữ:** yêu cầu, kế hoạch (plan), lần chạy (run), bản xem trước (preview/snapshot), phê duyệt (approval), trace, đối chiếu (reconciliation). 14 trạng thái run: `planning`, `validating`, `dry_running`, `awaiting_approval`, `running`, `replanning`, `succeeded`, `failed`, `rejected`, `cancelled`, `expired`, `refused`, `needs_input`, `reconciliation_required`.

**Chưa quyết:** nguồn rubric và trọng số điểm; người dùng đại diện và mẫu công việc thật; provider/model LLM và embedding.

## Brand Commitments

- Tên sản phẩm trong giao diện: **ATI** (ATI Workflow). Chưa có logo chính thức; logo trên mockup là tạm.
- Giọng văn tiếng Việt, rõ ràng, trung thực về giới hạn: không hứa “AI đúng”, không gọi `succeeded` là đúng nghiệp vụ, luôn gắn nhãn “Dữ liệu mô phỏng” khi dùng fixture.
- Hướng thị giác và hệ token do [DESIGN.md](DESIGN.md) quản lý; PRODUCT.md không định nghĩa giao diện.

## Evidence on Hand

- Dữ liệu tổng hợp: `testdata/test-cases.json` (b01–b10; b01–b06 phát triển, b07–b10 holdout), `testdata/tools.json`, `testdata/dev-hand-plans/`, `testdata/experiment-manifest.json`.
- Bằng chứng kỹ thuật: `docs/*-evidence/` (task_hub, engine, filesystem FS-05/FS-06, API-05), các báo cáo `docs/*-STATUS-*.md`.
- Thiết kế: `docs/BASELINE.md` (nguồn chuẩn phạm vi), `docs/functional-requirements.md`, `docs/EXECUTION-CONTRACT.md`, UX spec và system design trong `docs/superpowers/specs/`.
- **Không có:** kết quả thí nghiệm AI, phỏng vấn/đo người dùng, rubric chính thức, testimonial hay số liệu sử dụng. Không được bịa các mục này trong giao diện hoặc tài liệu.

## Product Principles

1. **Ghi luôn có sự đồng ý đúng bản xem trước.** Người dùng thấy đích, payload và thời hạn trước khi quyết định; không có đường tắt.
2. **Trung thực hơn trơn tru.** Kết quả chưa rõ được nói rõ là chưa rõ; không suy trạng thái, không phần trăm giả, không nhãn thành công trước khi server xác nhận.
3. **Server là nguồn sự thật.** Trạng thái, thời hạn và quyền duyệt đến từ server; giao diện chỉ hiển thị và gửi lệnh.
4. **Đo trước khi tuyên bố.** Mọi khả năng AI hoặc nhu cầu người dùng chỉ được trình bày khi có bằng chứng; phần còn lại gắn `NOT_RUN`/`OPEN`.
5. **Giải thích được bởi hai thành viên.** Ưu tiên luồng và kiến trúc rõ ràng, phạm vi nhỏ, hơn tính năng rộng.

## Accessibility & Inclusion

- Giao diện tiếng Việt đầy đủ dấu; nhập yêu cầu bằng tiếng Việt hoặc tiếng Anh.
- Tiêu chí UX-A10: không tràn ngang ở 1280px, 390px, 320px; điều khiển được bằng bàn phím tới điều hướng, hành động và phần mở rộng; màu không phải tín hiệu duy nhất.
- Form đăng nhập có label, trạng thái gửi và lỗi đọc được bằng trình đọc màn hình.
- Chữ đạt WCAG AA; kiểm tự động bằng axe trong browser tests (WEB-03), không thay kiểm bàn phím và trình đọc màn hình thủ công.
