# Controller/engine local cho plan tay

Người dùng đã đồng ý bước đọc → preview → duyệt → ghi → trace sau G1 đợt đầu. Đây là module mới, thực hiện trong folder hiện có (không có Git); giữ BASELINE B/local và không nối HTTP/UI/LLM trong lần này.

## Lựa chọn và giao diện

Dùng package `@wap/engine`, PostgreSQL là nguồn state, CLI làm điểm vào. Một worker tuần tự, gọi đúng ba tool qua MCP stdio thực. So với ghép controller vào server MCP, cách này giữ receiver độc lập; so với triển khai API/BullMQ ngay, CLI giúp kiểm đầy đủ vòng đời trước khi thêm transport. Redis/BullMQ và HTTP/session tiếp tục là phần sau.

`WorkflowEngine(db, gateway, userId)` cung cấp `prepare(plan, options)`, `decide(runId, decision)`, `execute(runId)`, `detail(runId)`, `preview(runId)`, `events(runId, sinceSeq)`, `trace(runId)`, `cancel(runId)`, `recoverOrphans()` và `reconcile(runId)`. Inspector/cancel/recovery có thể truyền gateway=undefined để dùng khi MCP không chạy. UserId đến từ launcher tin cậy, không từ plan/args. `openLocalGateway` pin Node path, server path, package lock + built artifact hashes và reviewed input/output/policy của đúng ba tool; so sánh live discovery, không suy ra quyền từ annotation.

## Vòng đời và snapshot

prepare nhận plan tay, validate DSL/tool/graph/inputs rồi lưu workflow/run/version/step states và events. Chỉ gọi reads, resolve điều kiện và toàn bộ write args; không gọi write khi chuẩn bị. Read phụ thuộc điều khiển vào write bị từ chối vì không có ngữ nghĩa đúng trong một preview. Điều kiện false làm bước skipped; dependency chỉ điều khiển của write vẫn cho phép.

Lưu canonical bytes SHA-256 của snapshot gồm run/user/version/plan, inputs, runtime/timezone, tool artifact+schema+policy, read outputs và write actions theo thứ tự. Mỗi action được cấp operation_id bởi controller, state reserved. Một approval chung TTL 10 phút cho toàn bộ actions. Không đọc lại source sau duyệt. Read-only plan kết thúc mà không có approval.

Decision bắt buộc approval_id/version/hash; transaction khóa run+approval, kiểm owner/status/pending/hash/version/expiry và canonical bytes. Approved chuyển running và ghi execute job vào outbox cùng event/status; rejected/expired kết thúc. Gửi trùng, payload/version/policy thay đổi bị từ chối. API sau này map EngineError code CONFLICT thành HTTP409, NOT_FOUND thành404.

execute lấy khóa worker advisory trên connection riêng, claim run/job và từng operation reserved→in_flight nguyên tử trước dispatch. Guard đồng bộ chặn hai lệnh trên cùng instance trước await; mất connection giữ khóa sẽ đóng MCP và kiểm khóa lại trước dispatch. Mỗi write kiểm snapshot hiện tại/registry, args và expiry. Chỉ gọi actions đã duyệt, tuần tự; không tự replan. Read retry tối đa cấu hình DSL (≤3) với exponential backoff, delay tối đa 30 giây; write không tự retry trong slice này. Chỉ xác nhận write thành công khi structured output hợp lệ và receipt DB trùng operation/hash/result.

## Lỗi, trace và recovery

Lưu attempt với version, tool/artifact/input/output/policy snapshot và args trước call; outcome/result kết thúc được hoàn thiện một lần. Không ghi đè attempt đã hoàn thành. Status/event/seq được commit cùng transaction; outbox prepare/execute là hàng công việc bền vững được CLI worker claim, không giả là BullMQ đã chạy.

Controller không đổi terminal status hoặc ghi event sau run.finished. Khi lỗi lưu completion, transaction kết thúc/recovery đóng attempt còn mở và giữ unknown cho write chưa được xác nhận; cancellation trước dispatch không được tạo unknown giả. Reconciliation phải khớp cả run/user/version/step/tool/policy và payload được tính lại từ args đã duyệt.

Write response mất, timeout hoặc outcome không xác định → operation unknown, run reconciliation_required, không gọi bước tiếp. Cancel ngăn bước tiếp, không hứa ngắt mutation đang chạy. recoverOrphans chỉ chạy khi giữ được khóa worker; đánh dấu run dở failed nếu chưa dispatch write, reconciliation_required nếu đã in_flight/unknown, loại pending job cũ, không tự resume. reconcile chỉ đọc receipt đối chiếu owner/tool/policy/hash, không gọi lại write hoặc tự chạy tiếp.

CLI có prepare (file plan), preview/detail, approve/reject (đúng ba định danh), execute, events, trace, cancel, recover, reconcile. Không có auto-approve demo. CLI có thể dùng DB G1 hiện tại; bài kiểm tra dùng database engine_it_* riêng và fixture plan b02, không tạo approval bằng SQL.

## Kiểm chứng

TDD bằng Vitest/PostgreSQL/MCP: b02 chờ duyệt không có mutation; một approval tạo hai receipt và trace đúng dữ liệu; đổi source sau preview không đổi payload; sai owner/hash/version/double decision/expiry bị chặn; registry/preview bị sửa bị chặn; read-only/condition/unsupported tool; hai worker không dispatch trùng; read retry bounded; lost response sau mutation dừng trước notify, reconcile thấy receipt; subprocess engine crash rồi recovery không resume; events có seq liên tục và outbox nguyên tử. Giữ suite G1 cũ và ghi evidence mới riêng, không ghi đè ảnh chụp lịch sử.
