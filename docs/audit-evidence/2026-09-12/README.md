# Bằng chứng audit ngày 12/09/2026

Báo cáo: [AUDIT-DOCS-2026-09-12.md](<D:/Môn học/ATI/ATI_Project/docs/AUDIT-DOCS-2026-09-12.md>).

- `audit-runtime-results.json`: kết quả 17 phép quan sát bằng dữ liệu tổng hợp, 5 lệnh kiểm tra, stdout/stderr và exit code.
- `audit-document-results.json`: thống kê tài liệu, đối chiếu enum, case, `$ref`; hash SHA-256 của 40 file gốc và xác nhận source package trong bản sao giống bản gốc.
- `reproduce.mjs`: harness gọi trực tiếp các hàm DSL. Không gọi LLM, MCP, Slack hay API ngoài.
- `inspect_documents.py`: cách đếm và đối chiếu tài liệu; đọc hai workbook đăng ký nhóm để tìm nguồn rubric, không ghi workbook.
- `package-lock.json`: dependency lock của bản sao tạm trong lần kiểm tra, không phải lock đã chốt cho dự án.
- `workflow-plan.schema.json`, `llm-plan-draft.schema.json`: output nguyên trạng của generator, đều có definition rỗng.

## Cách tái hiện runtime

Thực hiện trong một thư mục tạm mới; không chạy các lệnh reset DB. Dùng bản source có hash tương ứng trong `audit-document-results.json` nếu muốn tái hiện đúng snapshot.

1. Chép `package.json` gốc và thư mục `packages/` vào thư mục tạm.
2. Chép `package-lock.json` và `reproduce.mjs` từ đây vào gốc thư mục tạm đó.
3. Chạy `npm ci --ignore-scripts --no-audit --no-fund`.
4. Chạy `npm run build -w @wap/dsl` và `npm run schema:json -w @wap/dsl`.
5. Chạy `node reproduce.mjs`. File `audit-runtime-results.json` được ghi tại thư mục làm việc.

Harness hiện dùng đường dẫn Node/npm trên máy đã audit: `C:/Program Files/nodejs/`. Nếu máy khác có đường dẫn khác, chỉnh riêng đường dẫn công cụ trong harness; không sửa source cần kiểm tra.

Các lỗi typecheck/test trong kết quả là kết quả mong đợi khi tái hiện snapshot này, không phải kiểm thử đã pass. Phép thử side-effect chỉ xác nhận schema/graph chấp nhận kế hoạch gắn nhãn sai; tuyệt đối không gửi tin nhắn.

## Giới hạn

Đã kiểm tra trên Node 24.19.0 và dependency resolve tại thời điểm audit, chưa kiểm ma trận Node 22. Chưa có engine/API/web/MCP task_hub để kiểm end-to-end, nên các nhận xét về DB lifecycle, approval và idempotency là đối chiếu thiết kế và phản ví dụ, không phải log thực thi những hệ thống đó. Không dùng số đếm enum hoặc exit 0 của generator làm bằng chứng rằng toàn bộ hệ thống đúng.
