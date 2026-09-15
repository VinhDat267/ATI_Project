# Quyết định hiện hành

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
| QĐ-09 | React + TypeScript + Vite, CSS thuần; hash routes, runtime Zod validation | [ADR-001](ADR-001-FRONTEND-STACK.md), DECIDED_FOR_PLAN ở WEB-00; chưa cài hoặc triển khai frontend |

Quỹ giờ là giả định khả dụng do kế hoạch trước ghi: khoảng 14h/người/tuần, 2 người. Không dùng các ước lượng 230h/145h cũ làm số đo. Lịch mới phân bổ 112h công việc + 23h dự phòng trong trần xây dựng 135h; cần hiệu chỉnh sau tuần 1. 6×2×14 = 168h, trong đó 28h tuần 6 và 5h đệm chung ngoài trần xây dựng. Không coi trần này là bằng chứng hoàn thành chắc chắn.

OPEN: nguồn rubric chính thức; người dùng đại diện và kết quả phỏng vấn; commit/package pin của filesystem; model/provider đã kiểm structured output; owner/account triển khai; số liệu baseline. Những mục này là đầu việc có cổng ở lịch, không phải lý do dừng sửa lỗi đã được phép.
