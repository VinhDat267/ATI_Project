# Đợt 1 — hoàn thiện 8 tool task_hub

**Status:** PROPOSED_FOR_IMPLEMENTATION. Người dùng đã chọn phạm vi 5 tool còn thiếu và giao việc viết plan; tài liệu này chưa phải kết quả triển khai. Code trước đợt này được mô tả trong ENGINE-STATUS-2026-09-13.md. Chỉ Antigravity triển khai khi được người dùng giao task.

**Goal:** Thêm list_cards/get_card/list_members/create_card/move_card vào receiver local hiện tại, đưa chúng qua controller/approval/trace thật và giữ các invariant đã kiểm cho read_sheet_range/append_sheet_rows/send_slack_message.

## 1. Phạm vi và ràng buộc

- Workspace Windows/PowerShell: D:\Môn học\ATI\ATI_Project. Không có Git tại lúc khảo sát; không tự init Git hoặc tạo branch/commit giả.
- Node >=22; dùng lock hiện có: TypeScript, Zod 4, MCP SDK 1.30.0, Drizzle 0.45.2, postgres.js 3.4.9, Vitest. Không thêm framework/dependency cho đợt 1.
- Dữ liệu và message chỉ local. Không gọi Trello/Slack/Google, không thêm HTTP/UI/LLM/filesystem/BullMQ.
- Một worker, tuần tự. Dry-run chỉ đọc. Cấm bước khác dùng output write trong args/condition/key; không mở rộng DSL để hỗ trợ create rồi move bằng ID mới trong cùng preview.
- Approval gắn owner/run/version/hash/expiry 10 phút. Trước mọi write vẫn kiểm operation, payload, policy, trạng thái và đồng hồ DB sau khi chờ khóa.
- Receiver mutation + receipt cùng một Drizzle transaction. Không trộn native postgres.js handle vào transaction này.
- Mỗi write engine dispatch tối đa một lần; timeout/mất reply/crash giữ unknown và reconciliation_required. Receiver replay không có nghĩa engine tự retry.
- Giữ migrations 0001–0003 byte-for-byte; thêm 0004_task_hub_cards.sql. Seed chỉ thêm dữ liệu thiếu, không reset dữ liệu hiện có.
- Tests chỉ tạo/dọn database g1_it_UUID/engine_it_UUID của chính suite. Không reset wap_g1, không docker down -v, không sửa service khác.
- Bằng chứng mới nằm dưới docs/task-hub-evidence/batch-01. Báo cáo G1/fix/engine trước là lịch sử.
- Không xem/tune theo holdout b07–b10. Case integration mới dùng test fixtures riêng; giữ experiment-manifest.status=NOT_RUN.

## 2. Hiện trạng đã đối chiếu trong code

| Vị trí | Hành vi hiện tại và hệ quả với đợt 1 |
|---|---|
| apps/mcp-task-hub/src/contracts.ts | 3 tool, readOnlyHint chỉ nhận read_sheet_range; cần tên/policy riêng cho read mới |
| apps/mcp-task-hub/src/service.ts | Một nhánh read_sheet_range, write else mặc định send_slack_message; phải phân nhánh rõ trước khi thêm tool |
| packages/engine/src/gateway.ts | Allowlist 3 tool, live catalog phải đúng số lượng/schema; thêm tool receiver mà không cập nhật gateway sẽ làm engine từ chối |
| packages/engine/src/attempts.ts | Có run row trong transaction trước dispatch nhưng chưa truyền timezone sang gateway |
| packages/db/src/connection.ts | Native SQL và Drizzle có pool riêng; giữ nguyên quyết định này |
| testdata/tools.json | 5 tool mới SPEC_ONLY; get_card description hứa mô tả/hạn/nhãn nhưng output chỉ có 4 field |
| testdata/test-cases.json dev | b01 và b03 cùng c1 nhưng title/list khác nhau; là fixture riêng từng case, không thể dùng một seed chung để khớp cả hai |
| tests/scripts evidence | Đường dẫn G1/engine đang cố định; cần override cho đợt mới trước khi chạy suite |

Baseline được ghi nhận trước đó là 39 DSL + 15 DB/MCP + 24 engine tests. Lần viết plan chỉ đọc log/source, không chạy lại 78 tests. Executor phải lấy baseline mới qua TH-01; không coi con số này là PASS hiện tại sau khi sửa.

## 3. Chọn kiến trúc

**Chọn:** giữ TaskHub.call làm facade; tách ToolError sang errors.ts và 5 handler card/member sang cards.ts. Giữ nguyên approval/operation/receipt transaction của receiver trong service.ts; truyền transaction đã mở cho handler write. Không nhân bản authorization gate cho create/move.

Hai phương án đã cân nhắc: thêm toàn bộ vào service.ts ít file nhưng làm nhánh dispatch/gate khó review; xây registry/handler framework tổng quát nhiều hạ tầng vượt phạm vi 5 tool. Thiết kế chọn chỉ tách business logic mới, không refactor engine hoặc dựng plugin framework.

File mới/đổi được liệt kê chính xác trong plan. Không thêm task API board/list/member: board/list/member được seed hoặc tạo bằng fixture trong DB test, không cần CRUD ứng dụng ở đợt này.

## 4. Mô hình dữ liệu và seed

| Bảng mới | Khóa / dữ liệu | Ràng buộc |
|---|---|---|
| hub_boards | (user_id, board_id), name | user_id FK users; board_id/name không rỗng và có giới hạn |
| hub_lists | (user_id, board_id, list_name), position, is_done | FK board cùng owner; position >=0; is_done dùng tính workload |
| hub_members | (user_id, board_id, member_id), name | FK board cùng owner; một người có thể có ID trùng ở board khác |
| hub_cards | (user_id, card_id), board_id, list_name, title, description, due_date, assignee_id, created_at, updated_at | FK list cùng owner/board; FK assignee cùng owner/board nếu khác NULL |

card_id là TEXT vì fixture hiện dùng c1; card mới dùng UUID được DB tạo rồi cast text. card_id duy nhất trong một owner, không chỉ trong board, để get_card/move_card không mơ hồ. Hai owner có thể cùng c1 mà không lẫn dữ liệu. Không đưa owner vào tool args/output.

create_card lưu description mặc định chuỗi rỗng, due_date/assignee_id mặc định NULL. Không thêm labels hoặc enrich get_card output. Timestamps được lưu bằng TIMESTAMPTZ; create và move có thay đổi dùng clock_timestamp() của DB. Move sang đúng list hiện tại không đổi updated_at nhưng vẫn cần approval và receipt riêng cho ý định đó.

Seed cho mỗi principal do seedDemo nhận, dùng ON CONFLICT DO NOTHING cho từng bảng:

| Loại | Giá trị |
|---|---|
| Board | board_a / ATI Project |
| Lists | Backlog position0 is_done=false; Doing position1 false; Done position2 true |
| Members | m1 / An; m2 / Bình |
| Card c1 | board_a, title Viết API, Doing, assignee m1, description API demo local, due_date NULL, created_at=updated_at=2026-09-14T02:00:00Z |
| Card c2 | board_a, title Kiểm thử, Done, assignee m1, description rỗng, due_date NULL, created_at=updated_at=2026-09-15T03:00:00Z |

Seed giữ b02 sheets/channels như cũ. Nó không tự “sửa” c1 nếu người dùng đã đổi title/list. Fixture b01 phải UPDATE c1 thành title API/list Done và điều chỉnh c2 ngoài window ngay trong DB test riêng; b03 dùng seed nguyên bản. Không sửa oracle để vừa seed.

## 5. Hợp đồng tools

Giữ tên/shape trong catalog, chỉ bổ sung giới hạn/format cho 5 schema chưa triển khai. Không đổi input/output của 3 tool đang chạy. Policy_version giữ b-local-1; artifact hash thay đổi sẽ làm snapshot cũ stale, không sửa preview để cứu run cũ.

Schema Zod phải strict; cấm extra fields. ID/list: string 1–200 ký tự, không trim/normalize ngầm. title: string 1–500 và chứa ít nhất một ký tự không-whitespace. description: tối đa 16000. since/until/due_date: ISO calendar date YYYY-MM-DD hợp lệ, không datetime, không null. Arrays trả tối đa 1000, không âm với count/task_count. date range since>until trả BAD_ARGS. Không thêm default vào input schema gây lệch payload hash giữa controller và receiver.

| Tool | Input | Output | Side effect |
|---|---|---|---|
| list_cards | board_id; optional list_name, assignee_id, since, until | {cards:[{id,board_id,title,list_name}],count} | read |
| get_card | card_id | {id,board_id,title,list_name} | read |
| list_members | board_id | {members:[{id,name,task_count}]} | read |
| create_card | board_id,list_name,title; optional description,due_date,assignee_id | {id} | write |
| move_card | card_id,target_list | {id,list_name} | write |

### Read semantics

- Mọi query lọc theo principal của server. Board/card/member/list không tồn tại hoặc thuộc owner khác trả NOT_FOUND, không tiết lộ tài nguyên khác owner.
- Board hợp lệ nhưng không có card phù hợp trả cards=[],count=0. Filter list_name/assignee_id được chỉ định nhưng không thuộc board trả NOT_FOUND. Không có filter thì không kiểm các tài nguyên không liên quan.
- list_cards AND mọi filter, dựa trên updated_at; sort updated_at ASC rồi card_id ASC COLLATE C. get_card không trả description/due_date/assignee/labels vì catalog không có các field đó; sửa description tool cho đúng.
- list_members trả tất cả member của board kể cả zero task; sort member_id ASC COLLATE C. task_count = số card được assign cho member trong chính board và list.is_done=false; card chưa assign hoặc đã Done không tính. Không tính card của board/owner khác.
- Read tối đa 1000 records: query LIMIT 1001; nếu nhiều hơn 1000 trả LIMIT_EXCEEDED, không cắt im lặng hay báo count=1000 như tổng thật. Không thêm pagination vào hợp đồng đợt này.

### Timezone và filter ngày

- Không thêm timezone vào tool arguments. Controller truyền metadata _meta["ati/runtime"]={time_zone:run.time_zone}; đây là context đọc, không phải quyền write hoặc principal.
- Gateway.call thêm tham số tùy chọn thứ năm `{timeZone:string}`. callStep lấy run.time_zone đã lưu trong transaction startAttempt và chuyển đúng giá trị qua gateway.
- TaskHub.call thêm tham số tùy chọn thứ tư runtimeMetadata:unknown; server chuyển request.params._meta?.["ati/runtime"]. Caller MCP trực tiếp thiếu metadata mặc định Asia/Ho_Chi_Minh. Metadata sai schema/timezone trả BAD_ARGS khi gọi list_cards.
- Kiểm timezone bằng Intl.DateTimeFormat và pg_timezone_names trước query AT TIME ZONE; không fallback im lặng khi DB không hỗ trợ tên đó.
- since là đầu ngày local bao gồm; until là hết ngày local bao gồm, được đổi thành `< đầu ngày local kế tiếp`. PostgreSQL thực hiện timezone conversion. Không cộng 86400000 ms vào UTC boundary vì ngày DST có thể dài 23/25 giờ.
- Ví dụ Asia/Ho_Chi_Minh, since=until=2026-09-14: [2026-09-13T17:00:00Z, 2026-09-14T17:00:00Z). New York 2026-03-08: [2026-03-08T05:00:00Z, 2026-03-09T04:00:00Z).
- Metadata này không tham gia write args/hash; run.time_zone đã nằm trong approved snapshot. Không lấy timezone từ arbitrary plan fields hoặc clock của frontend.

### Write semantics

- create_card yêu cầu board/list đã tồn tại; assignee nếu có phải thuộc board/owner đó. Không tự tạo board/list/member. Due_date là calendar date, không tự đổi timezone, không cấm ngày quá khứ.
- move_card chỉ chuyển trong board hiện tại của card; target_list ở board khác dù trùng tên không cấp quyền chuyển board. Không có cross-board move trong tool này.
- Hai operation khác nhau cùng move một card được serialize bằng khóa card; operation commit sau xác định vị trí cuối. Approval hiện cho phép target đã duyệt, không có expected_source_list hay optimistic version. Không tự thêm những field đó.
- Replay cùng operation/payload trả đúng receipt cũ khi approval vẫn hợp lệ, không tạo ID mới, không update timestamp lần nữa. Hai operation create khác nhau cùng title tạo hai card vì đó là hai ý định đã được duyệt riêng.
- Receipt xác nhận mutation ở thời điểm commit; không hứa card vẫn ở target đó sau một operation khác.

Lock order write: run+approval → operation → receipt lookup → target board/list/member/card → assertLive → mutation → output validation → receipt insert → assertLive → commit. Với create khóa board/list/member FOR KEY SHARE. Với move khóa card FOR UPDATE rồi target list FOR KEY SHARE; mọi receiver code dùng cùng thứ tự trong cùng operation. Không gọi ngoài transaction bằng db.client để ghi nghiệp vụ.

Tool errors: BAD_ARGS (schema/ngày/timezone); NOT_FOUND (resource không thuộc owner/board hoặc thiếu); NOT_AUTHORIZED (gate/payload/expiry); LIMIT_EXCEEDED (read quá giới hạn); INTERNAL_ERROR (lỗi DB/schema output không dự kiến). Không biến mọi lỗi DB thành known_not_applied: lỗi response/write không rõ vẫn để engine xử lý unknown. Không thêm LIMIT_EXCEEDED vào known write errors vì chỉ dùng cho read.

## 6. Cách bật tool từng checkpoint

contracts.ts có ToolNameSchema cho đủ 8 tên, nhưng ENABLED_TOOL_NAMES chỉ chứa tool đã triển khai. EnabledToolNameSchema dùng tại server request handler; toolDefinitions chỉ publish enabled names. Đây là danh sách cố định theo build, không là feature flag người dùng/model tùy ý bật.

| Checkpoint | Enabled receiver/gateway | Evidence catalog |
|---|---|---|
| TH-02 | 3 tool cũ | 5 tool mới vẫn SPEC_ONLY; schemas đã được định nghĩa trong source |
| TH-03 | 3 cũ + list_cards/get_card/list_members = 6 | Chỉ nâng 3 read mới sau live receiver tests |
| TH-04 | Thêm create_card = 7 | Nâng create sau live create/gate/receipt tests |
| TH-05 | Thêm move_card = 8 | Nâng move sau live move/gate/receipt tests |

Mỗi lần bật: receiver tests xác nhận discovery + calls trước; đồng bộ catalog schemas từ Zod; sau đó cập nhật engine allowlist cùng số lượng và chạy engine tests. Không bỏ điều kiện exact live schema/count hay nới gateway nhận tool không được duyệt để qua test. Engine không import policy từ receiver hoặc tin annotations; giữ allowlist độc lập trong gateway, test equality ngăn drift.

## 7. Plan tay để nghiệm thu

- b02 cũ vẫn chạy y nguyên; một approval, hai receipt, ba attempts.
- b03: get_card c1 → notify Task: Viết API. Test thay title sau preview; notify vẫn dùng title đã xem.
- b04: create_card trực tiếp, không read; prepare không tạo card. Sau approve/execute có đúng một card/receipt với DB generated ID.
- th-members (fixture test mới, không holdout): list_members board_a chỉ đọc, không approval/receipt; m1.task_count=1, m2=0.
- th-move: get_card c1 → move_card c1 tới Done → send_slack_message với title từ read. Không đọc lại card sau write bằng engine; test query DB độc lập sau execute để kiểm đích cuối. Snapshot có hai write, một approval, hai receipt.
- Không có plan create_card → move_card(args.card_id=output.create.id) trong đợt này: DSL hiện cấm write-output reference. Test đảm bảo vẫn bị INVALID_PLAN.

## 8. Nghiệm thu và điểm dừng

Đợt 1 chỉ VERIFIED khi đủ 8 tên/schema live khớp catalog; các oracle read/write/owner/date/receipt/concurrency/expiry/unknown đều đạt; baseline tests không bị xóa/skip; full typecheck/build/DSL/receiver/engine checks exit0; evidence mới có log và manifest hashes. Không chốt một tổng test count trước khi executor viết/chạy các case.

G1 toàn dự án vẫn PARTIAL sau đợt 1 vì filesystem và rubric còn thiếu. Nếu phát hiện thay đổi public contract, scope hoặc invariant cần thiết mà spec chưa cho phép: executor nêu file/bằng chứng và phương án trong task report, không tự nới approval hoặc sửa expected để hợp thức hóa.

Nếu baseline runtime không chạy vì Docker/tài nguyên thiếu, báo BLOCKED cho runtime checks; có thể hoàn tất các đọc/thiết kế/static steps độc lập, không ghi MCP/DB VERIFIED từ static check. Không yêu cầu cài model/provider cho đợt 1.
