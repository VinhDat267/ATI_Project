# Quyết định hiện hành

## Quyết định có hiệu lực mới nhất

| ID | Quyết định | Trạng thái |
|---|---|---|
| QĐ-11 | Đặc tả MVP v2: nhóm dịch vụ thiết kế/web, Sheets read-only + Trello, UC1–3, hai principal owner-only, một active run/DB | APPROVED_BY_PROJECT_OWNER 21/09/2026 qua phản hồi “duyệt”; chưa cho phép execution plan hoặc live spend |
| QĐ-12 | Nghiên cứu nguồn công khai + tình huống tái dựng; customer validation vẫn NOT_RUN | Phương pháp prototype đã duyệt; không giả lập kết quả phỏng vấn |
| QĐ-13 | Giữ AI Automation Platform và System Design đã duyệt 21/09; không chọn lại visual | Đồng bộ quyết định branding/visual hiện có, không là thiết kế mới |

Nguồn: [đặc tả v2](superpowers/specs/2026-09-21-workflow-platform-mvp-v2-design.md),
[baseline](BASELINE.md), [System Design](../System%20Design/DESIGN.md).
Phạm vi OUT của QĐ-03/04 trước đó chỉ là B/local; giới hạn preview, unknown,
owner, không auto-resume vẫn giữ. QĐ-10 hướng Airbnb bên dưới đã bị thay bằng
visual đã approved tại System Design, không dùng để triển khai UI mới.

## Sổ quyết định B/local trước v2 — snapshot lịch sử

Nguồn scope: [BASELINE](BASELINE.md). Thay thế các quyết định A/B chưa chốt trong bản trước ngày 13/09.

| ID | Quyết định | Trạng thái / lý do |
|---|---|---|
| QĐ-01 | TypeScript, SQL + Drizzle 0.45.2; Fastify dự kiến | DB package đã chạy trong G1; API chưa triển khai |
| QĐ-02 | Embedding 1536 chiều theo schema hiện có | Model trong env là ứng viên; phải pin và đo chất lượng/chi phí trước thí nghiệm |
| QĐ-03 | B: semantic + query expansion, local replan, polling 2s | CONFIRMED bởi người dùng 13/09/2026 |
| QĐ-04 | task_hub local 8 tool, filesystem local 2 tool | task_hub không bao gồm bốn kết nối SaaS thật; filesystem cần adapter/schema/pin trước call |
| QĐ-05 | Một preview bất biến; không write-output dataflow giữa steps | Tránh preview không resolve được; staged approval là ngoài scope |
| QĐ-06 | Unknown write → reconciliation; bỏ resume tự động | Không suy ra exactly-once từ bảng key; xem EXECUTION-CONTRACT |
| QĐ-07 | PlannerResult = plan/refusal/clarification | Version chỉ lưu plan thực thi hợp lệ |
| QĐ-08 | Sáu view/bốn mục điều hướng, một worker tuần tự; không WS/hybrid/GitHub | UI cập nhật 15/09 theo UX platform; không mở scope editor/reuse |
| QĐ-09 | React + TypeScript + Vite; hash routes, runtime Zod validation. Styling/component/data layer: Tailwind CSS v4 + shadcn/ui (Radix) + TanStack Query theo [ADR-002](ADR-002-FRONTEND-UI-DATA-LAYER.md), thay CSS thuần ngày 17/09/2026 | [ADR-001](ADR-001-FRONTEND-STACK.md), DECIDED_FOR_PLAN ở WEB-00; WEB-01B là fixture shell provisional, chưa tích hợp live API |
| QĐ-10 | Hướng thị giác “kiểu Airbnb, nhấn navy”: nền trắng, ink #222, hairline, bo 8/14px, nút 48px, một mức bóng, thẻ quyết định dính phải, font Be Vietnam Pro tự host; giữ 7 họ màu ngữ nghĩa cho 14 RunStatus; không dùng tài sản thương hiệu Airbnb | `DIRECTION_SELECTED` 17/09/2026 sau so sánh 3 phương án V05 trên canvas review; [DESIGN.md](../DESIGN.md) lint 0 error/0 warning. Thay hướng navy/slate có sidebar cùng ngày. Airtable `WITHDRAWN_BY_USER` 16/09/2026 (lịch sử git `652531a`) |

Quỹ giờ là giả định khả dụng do kế hoạch trước ghi: khoảng 14h/người/tuần, 2 người. Không dùng các ước lượng 230h/145h cũ làm số đo. Lịch mới phân bổ 112h công việc + 23h dự phòng trong trần xây dựng 135h; cần hiệu chỉnh sau tuần 1. 6×2×14 = 168h, trong đó 28h tuần 6 và 5h đệm chung ngoài trần xây dựng. Không coi trần này là bằng chứng hoàn thành chắc chắn.

OPEN: nguồn rubric chính thức; người dùng đại diện và kết quả phỏng vấn; commit/package pin của filesystem; model/provider đã kiểm structured output; owner/account triển khai; số liệu baseline. Những mục này là đầu việc có cổng ở lịch, không phải lý do dừng sửa lỗi đã được phép.
