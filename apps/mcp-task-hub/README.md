# task_hub local — 8 tool đã triển khai

MCP stdio dùng SDK 1.30.0, PostgreSQL 16 + Drizzle. Dữ liệu bảng/kênh/thông báo/boards/cards đều local; tên tool và schema giữ tương thích với catalog của [B/local](../../docs/BASELINE.md).

| Tool | Loại | Hành vi & Ràng buộc |
|---|---|---|
| `read_sheet_range` | Read | Đọc `spreadsheet_id` và range hữu hạn như `Progress!A1:B2`, tối đa 1000 dòng × 100 cột. Ô trống trong dòng hiện có trả `""`; không thêm dòng vượt dữ liệu. |
| `append_sheet_rows` | Write | Thêm nguyên `string[][]` vào workbook/sheet đã tồn tại; tối đa 1000 dòng × 100 ô mỗi call. Yêu cầu approval trước; mutation + receipt commit cùng transaction. |
| `send_slack_message` | Write | Lưu thông báo vào channel local đã tồn tại; `thread_ts` nếu có là UUID thông báo cùng principal và channel. Yêu cầu approval trước; mutation + receipt cùng transaction. |
| `list_cards` | Read | Lấy danh sách card trong board; hỗ trợ lọc `list_name`, `assignee_id`, `since`, `until`. Giới hạn 1000 card (1001 báo `LIMIT_EXCEEDED`). Ngày được lọc theo `updated_at` dưới dạng khoảng nửa mở `[since, until + 1 ngày)` theo timezone được giải quyết từ metadata `_meta["ati/runtime"].time_zone` (mặc định `Asia/Ho_Chi_Minh`). |
| `get_card` | Read | Lấy chi tiết card theo `card_id` thuộc quyền owner của principal. Trả về object `{ id, board_id, title, list_name }`. Card không tồn tại hoặc khác owner trả về `NOT_FOUND`. |
| `list_members` | Read | Lấy danh sách thành viên board kèm `task_count` — tính theo **active workload semantics**: đếm số lượng card được gán cho member trên các list chưa hoàn thành (`is_done = false`). Giới hạn tối đa 1000 kết quả (1001 báo `LIMIT_EXCEEDED`). |
| `create_card` | Write | Tạo card mới với `card_id` sinh tự động bởi DB (`gen_random_uuid()::text`, không prefix `c_`). Ràng buộc composite FK `(user_id, board_id, list_name)` và `(user_id, board_id, assignee_id)`. Yêu cầu approval; ghi card và receipt trong cùng transaction; chờ khóa danh sách quá hạn trả `NOT_AUTHORIZED`; rollback nếu receipt lỗi. |
| `move_card` | Write | Chuyển card sang cột khác trong cùng board: `SELECT FOR UPDATE` trên card, `FOR KEY SHARE` trên target list. Khác target thì đổi `list_name` và `updated_at = clock_timestamp()`; cùng target thì giữ nguyên timestamp nhưng vẫn cần approval và receipt cho intent mới. Trả về `{ id, list_name }`. |

### Ràng buộc Schema (Zod Contracts)
- **Strict extra fields:** Toàn bộ schemas input và output đều cấu hình `.strict()`; từ chối mọi trường không được định nghĩa trước.
- **Tiêu đề (`title`):** `min(1).max(500).regex(/\S/)` — chuỗi 1–500 ký tự và không được toàn khoảng trắng.
- **Mô tả (`description`):** Chuỗi tối đa 16000 ký tự (tùy chọn).
- **Ngày lịch (`calendarDate`):** Chuỗi `YYYY-MM-DD`, chuẩn Gregorian từ `0001-01-01` đến `9999-12-31`.
- **Trường optional không nhận `null`:** Các trường tùy chọn (`description`, `due_date`, `assignee_id`, `list_name`, `since`, `until`, `thread_ts`) chỉ nhận `undefined` (vắng mặt), từ chối nhận `null`.

Từ root project, chạy `npm ci`, `npm run db:up:g1`, `npm run db:migrate:g1`, `npm run db:seed:g1`, `npm run build`. Client MCP phải khởi chạy **Node trực tiếp**, không dùng npm làm stdio command vì npm có thể in log vào stdout:

```json
{
  "command": "C:\\Program Files\\nodejs\\node.exe",
  "args": ["D:\\Môn học\\ATI\\ATI_Project\\apps\\mcp-task-hub\\dist\\server.js"],
  "cwd": "D:\\Môn học\\ATI\\ATI_Project"
}
```

Đường dẫn trên là máy đã kiểm; đổi sang đường dẫn tuyệt đối của bản build nếu chuyển máy. Server mặc định dùng PostgreSQL demo `127.0.0.1:55532/wap_g1` và principal `00000000-0000-4000-8000-000000000001`. Có thể truyền biến môi trường `G1_DATABASE_URL`, `G1_USER_ID` từ launcher. Server không tự đọc `.env`, không lấy principal từ tool arguments và chưa có HTTP login/session.

Seed mặc định tạo:
- `source/Progress` hai dòng (`["API", "Done"]`, `["UI", "Doing"]`), `dest/Report` rỗng.
- Kênh `#team` và `#ops`.
- Board `board_a` ("ATI Project") với 3 list (`Backlog`, `Doing`, `Done`) và 2 member (`m1` An, `m2` Bình).
- Card `c1` ("Viết API", Doing, assignee `m1`) và `c2` ("Kiểm thử", Done, assignee `m1`).

`seedDemo` sử dụng `ON CONFLICT DO NOTHING`, không ghi đè dữ liệu đã tồn tại và không đặt lại card đã move về Doing.

Read gọi được ngay sau seed. Cả 4 write tools đều qua **một shared receiver gate duy nhất là `TaskHub.call` trong `src/service.ts`** (với `writeCardTool` trong `src/cards.ts` là nhánh xử lý card bên trong gate), yêu cầu `_meta["ati/authorization"]={approval_id,operation_id,snapshot_hash}` và các row run/approval/action/operation tương ứng do controller tin cậy lưu trước. Server kiểm approved/running, owner, version, expiry, tool/policy và resolved payload; thiếu một điều kiện thì từ chối. [Controller CLI](../../packages/engine/README.md) tạo preview, xử lý approve (`npm run engine -- approve $runId $approvalId $versionId $snapshotHash`) và execute; không có lệnh bypass approval.

Mutation + receipt commit cùng transaction. Cùng operation/payload được replay khi approval còn hợp lệ; khác payload bị chặn. Engine CLI có read-only reconciliation sau expiry/cancel và explicit orphan recovery không resume. Toàn bộ 8 tool `task_hub` đã hoàn tất. Composite engine hiện nối thêm 2 public `filesystem` tools qua process MCP thứ hai; filesystem dùng dispatch marker riêng, không dùng hoặc giả lập `hub_receipts`.

FS-05 đạt **TECHNICAL PASS** cho E01–E14. Fresh FS-06 `npm run check:engine` đạt **258 passed, 1 skipped**: 39 DSL, 92 engine unit pass + 1 skip, 64 PostgreSQL/MCP receiver và 63 engine integration. G1 overall vẫn **PARTIAL** vì rubric chính thức và công việc nhóm đại diện `OPEN`; HTTP/session/UI, polling và AI evaluation `NOT_RUN`. Xem [filesystem status](../../docs/G1-FILESYSTEM-STATUS-2026-09-13.md), [FS-05 evidence](../../docs/task-hub-evidence/batch-02/FS-05/FS-05.md) và [trạng thái task_hub lịch sử](../../docs/TASK-HUB-STATUS-2026-09-13.md).
