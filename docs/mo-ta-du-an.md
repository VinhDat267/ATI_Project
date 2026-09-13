# Mô tả dự án — B/local

Dự án nghiên cứu cách biến mô tả công việc thành workflow gọi MCP có preview và kiểm soát hành động. Phạm vi chính thức là [BASELINE](BASELINE.md); các con số/luồng lớn hơn trong bản trước đã được lưu archive.

## Vấn đề và giá trị giả định

Một trưởng nhóm cần chép bảng tiến độ đã chuẩn bị sang bảng báo cáo, hoặc xem task rồi gửi thông báo đúng nội dung/đích. Prototype giúp xem rõ tool, dữ liệu và hành động trước khi duyệt. Nhu cầu này chưa được phỏng vấn; cần một người dùng đại diện, 3 mẫu công việc và đo thời gian/lỗi thao tác tay ở tuần 1. Không gọi synthetic fixture là bằng chứng thị trường.

## Đóng góp cần đo

- Tool retrieval: semantic so với semantic + query expansion và all-tools control trên cùng catalog.
- Plan: tách validity, độ đúng tác vụ, từ chối/hỏi lại và chi phí repair.
- Kiểm soát: chặn sai policy, payload thay đổi, write chưa rõ kết quả; trace giúp giải thích thất bại.

Zapier đã có Copilot hỗ trợ tạo/chỉnh workflow bằng mô tả; n8n có MCP Client Tool cho server ngoài. Vì thế không dùng luận điểm đối thủ chỉ tạo workflow thủ công hoặc không dùng được MCP. Giá trị đồ án là một thí nghiệm có giới hạn và minh bạch, không tuyên bố ưu thế chưa đo. Nguồn: [Zapier Copilot](https://help.zapier.com/hc/en-us/articles/15703650952077-Use-the-power-of-AI-to-generate-Zaps), [n8n MCP](https://docs.n8n.io/integrations/builtin/cluster-nodes/sub-nodes/n8n-nodes-langchain.toolmcp/).

## Kiến trúc

UI polling → Fastify/API → retrieval/planner → WorkflowPlan Zod + graph + trusted policy → dry-run read snapshot → approval → worker → MCP adapter. PostgreSQL giữ version, attempts, approval, operations, events/outbox. Đây là kiến trúc dự kiến, không sơ đồ hệ thống đang hoạt động.

Plan không chứa workflow_id; DB/envelope quản lý identity. JSON ví dụ có thể kiểm nằm trong testdata/test-cases.json. Demo dùng read_sheet_range.values truyền nguyên mảng string[][] sang append_sheet_rows.rows; thông báo dùng literal hoặc scalar row_count. Không yêu cầu DSL tự map card objects sang rows, tự chọn người ít task nhất hay tự tóm tắt bằng LLM.

Plan-then-execute xác định thứ tự và biểu thức; kết quả chỉ lặp lại khi inputs/runtime/tool/data snapshots cố định. [BullMQ Flows](https://docs.bullmq.io/guide/flows/) đã có dependencies; lớp custom tập trung DSL/approval/policy. [PostgreSQL text search](https://www.postgresql.org/docs/16/textsearch-controls.html) không mặc nhiên là BM25.

## Giới hạn và nguồn học phần

Hai workbook Final Project đã kiểm trong audit chỉ cung cấp đăng ký/nhóm; chưa xác minh rubric hoặc các trọng số điểm. Những tỷ lệ ghi ở bản cũ không được dùng làm nguồn ưu tiên. Mang rubric chính thức vào tuần 1, ghi URL/file/trang và mapping deliverable. Chưa có thí nghiệm live model, MCP interoperability hay latency số đo; xem EVALUATION và FIX-REPORT để phân biệt mục tiêu với kết quả.
