# task_hub local — 3 tool đã triển khai

MCP stdio dùng SDK 1.30.0, PostgreSQL + Drizzle. Dữ liệu bảng/kênh/thông báo đều local; tên tool giữ tương thích với catalog của [B/local](../../docs/BASELINE.md).

| Tool | Hành vi |
|---|---|
| read_sheet_range | Đọc `spreadsheet_id` và range hữu hạn như `Progress!A1:B2`, tối đa 1000 dòng × 100 cột. Ô trống trong dòng hiện có trả `""`; không thêm dòng vượt dữ liệu. |
| append_sheet_rows | Thêm nguyên `string[][]` vào workbook/sheet đã tồn tại; tối đa 1000 dòng × 100 ô mỗi call. |
| send_slack_message | Lưu thông báo vào channel local đã tồn tại; `thread_ts` nếu có là UUID thông báo cùng principal và channel. |

Từ root project, chạy `npm ci`, `npm run db:up:g1`, `npm run db:migrate:g1`, `npm run db:seed:g1`, `npm run build`. Client MCP phải khởi chạy **Node trực tiếp**, không dùng npm làm stdio command vì npm có thể in log vào stdout:

```json
{
  "command": "C:\\Program Files\\nodejs\\node.exe",
  "args": ["D:\\Môn học\\ATI\\ATI_Project\\apps\\mcp-task-hub\\dist\\server.js"],
  "cwd": "D:\\Môn học\\ATI\\ATI_Project"
}
```

Đường dẫn trên là máy đã kiểm; đổi sang đường dẫn tuyệt đối của bản build nếu chuyển máy. Server mặc định dùng PostgreSQL demo `127.0.0.1:55432/wap_g1` và principal `00000000-0000-4000-8000-000000000001`. Có thể truyền biến môi trường `G1_DATABASE_URL`, `G1_USER_ID` từ launcher. Server không tự đọc `.env`, không lấy principal từ tool arguments và chưa có HTTP login/session. Seed mặc định tạo `source/Progress` hai dòng, `dest/Report` rỗng, kênh `#team`/`#ops`, không ghi đè dữ liệu đã tồn tại.

Read gọi được ngay sau seed. Write cần `_meta["ati/authorization"]={approval_id,operation_id,snapshot_hash}` và các row run/approval/action/operation tương ứng do controller tin cậy lưu trước. Server kiểm approved/running, owner, version, expiry, tool/policy và resolved payload; thiếu một điều kiện thì từ chối. [Controller CLI](../../packages/engine/README.md) tạo preview, xử lý approve và execute; không có lệnh bypass approval. `tests/tools.integration.test.ts` vẫn dùng fixture để kiểm receiver độc lập; engine suite dùng controller thật.

Mutation + receipt commit cùng transaction. Cùng operation/payload được replay khi approval còn hợp lệ; khác payload bị chặn. Engine CLI có read-only reconciliation sau expiry/cancel và explicit orphan recovery không resume; 5 task_hub tool còn lại và filesystem chưa làm.

`npm run check:g1` chạy cả kiểm offline và PostgreSQL/MCP thật trên database thử nghiệm riêng. [Báo cáo và bằng chứng](../../docs/G1-STATUS-2026-09-13.md) phân biệt phần đã kiểm với phần còn thiếu. Redis chỉ được khởi động/health-check; BullMQ chưa tích hợp. `config/mcp-presets.json` vẫn deny-all vì ConnectionManager chung chưa có; launch này không phải bằng chứng preset enforcement hoặc plugin đã được cài vào Codex.

`npm run check:engine` chạy thêm controller integration và ghi [evidence engine](../../docs/engine-evidence/2026-09-13/README.md) riêng để giữ đợt G1 cũ là lịch sử.
