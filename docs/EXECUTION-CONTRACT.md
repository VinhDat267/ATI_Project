# Hợp đồng thực thi B/local

Controller/engine CLI cho plan tay và ba tool local đã triển khai preview/decision/claim, trace, cancel, orphan recovery và receipt inspection; xem [trạng thái engine](ENGINE-STATUS-2026-09-13.md). DB/receiver được kiểm trước trong [G1 đợt đầu](G1-STATUS-2026-09-13.md). HTTP/session/UI/polling, LLM/replan, scheduler/BullMQ và registry tổng quát vẫn SPEC_ONLY. Các đoạn HTTP/planner dưới đây mô tả hợp đồng đích, không phải endpoint đã chạy.

## Vòng đời

POST /runs lưu workflow gốc (name tạm), source_prompt, user, inputs, timezone và runtime; tạo run planning với workflow_version_id=null. Status + event + outbox enqueue được commit cùng transaction. Trả 202 RunAccepted.

PlannerResult.kind=refusal → refused; clarification → needs_input. Cả hai kết thúc run, không có executable version hoặc write. Người dùng bổ sung thông tin tạo run mới. Lưu raw outcome để đánh giá. kind=plan → validating: parse WorkflowPlanSchema (defaults/refinements), validatePlanTools (tool/policy + graph), sau đó dry_running. Lỗi có cấu trúc được sửa tối đa tổng 3 lần planning, hết giới hạn → failed.

Dry-running lưu version đã validate, chạy read và lưu snapshot. Reference chưa resolve được chưa được tính là đã validate args: validatePlanTools.deferredStepIds phải được xử lý bằng validateToolCall trước mỗi read và trước khi tạo preview write. Input/output schema không hỗ trợ phải từ chối, không bỏ qua lỗi Ajv. Missing output hoặc nội suy object/mảng vào string là lỗi; không tự chuyển thành chuỗi [object Object].

CLI hiện nhận plan tay đã parse/validate, không gọi planner hoặc tăng số lần gọi AI. Nó từ chối read phụ thuộc vào write để giữ ngữ nghĩa một preview; condition false được skipped. Runtime, read outputs và write payload không được tính lại sau duyệt.

Run có write → awaiting_approval. Run chỉ đọc → succeeded sau khi kiểm outputs. dryrun.ready chỉ báo preview sẵn sàng; UI phải GET /runs/{runId}. Người dùng duyệt → running; từ chối → rejected; quá TTL → expired. Server quyết định thời gian, không tin đồng hồ client.

## Approval và snapshot

Snapshot hash = SHA-256 của JSON canonical xác định (keys object sắp xếp đệ quy, thứ tự array giữ nguyên, UTF-8, JSON numbers hữu hạn, không undefined). Nội dung gồm run/user/version, plan, inputs, runtime/timezone, read outputs, tool artifact + schema + policy versions, actions theo thứ tự thực thi với operation_id/target/resolved_args. Không chứa credential. Lưu bytes được hash; không dựa vào thứ tự key mặc định của object.

Decision request phải gửi approval_id, version_id, snapshot_hash và decision. Trong transaction lock run+approval, kiểm owner, awaiting_approval, pending, version/hash hiện hành và now < expires_at. Cập nhật decision+status+event+outbox nguyên tử. Double-click/lần gửi lại trả 409 nếu đã quyết định. Trước từng write kiểm approvalMatches và đối chiếu lại action/payload hash cùng registry version; helper không thay owner check hay lock.

Replan thay tool/args/condition/deps hoặc thay read data → supersede approval, tạo version mới, validate và tạo preview/approval mới cho các write còn lại. Không dùng approval cũ để tự chạy tiếp. Các write hoàn tất giữ nguyên trong trace và bị cấm lặp lại; plan mới chỉ được sửa đúng bước chưa thành công. Giới hạn local replan 2. Partial/full replan không thuộc B.

## Idempotency và kết quả không rõ

Mỗi ý định write được cấp operation_id ổn định trước dispatch; không để LLM chọn khóa bảo mật. Lưu tool_operations với version, tool/policy, args, payload_hash và intent_key (key DSL chỉ là nhãn). Unique(run,version,step) chống cấp trùng khi nhận job lặp. Replan được cấp operation mới chỉ khi operation cũ chắc chắn chưa commit; không thay id để vượt trạng thái unknown. Rerun có chủ ý là run và operation mới, cần duyệt lại; không dedupe theo user/tuần bất kể board/args.

Protocol và mức triển khai:

1. Transaction reserve operation và claim row bằng compare-and-set reserved → in_flight. Chỉ một worker thắng; payload/tool/policy không khớp → conflict, không dispatch. Engine hiện không reclaim known_failed; mỗi write được dispatch tối đa một lần.
2. Gọi đúng args/snapshot. Succeeded chỉ khi có kết quả hợp lệ và bằng chứng receiver đã hoàn thành. Retry đọc tối đa 3, exponential backoff, delay tối đa 30 giây. Nếu sau này thêm retry write, chỉ được dùng cùng operation/payload khi receiver hỗ trợ idempotency hoặc lỗi được adapter xác nhận xảy ra trước side-effect; hiện engine không tự retry write.
3. Local task_hub ghi mutation và receipt operation_id+hash+result **cùng transaction của chính receiver**; replay cùng hash trả receipt khi approval vẫn hợp lệ, khác hash trả lỗi. Hai write receiver append/send đã triển khai và kiểm concurrency, rollback khi insert receipt thất bại, replay sau restart. Engine có kiểm riêng mất response và subprocess dừng sau receiver commit; không suy rộng sang arbitrary MCP.
4. Nếu response mất/crash sau dispatch: trạng thái unknown. Có receiver receipt thì query/reconcile read-only; không có → reconciliation_required và yêu cầu kiểm tra kết quả. Hết timeout không chứng minh rollback. B không tự resume job cũ hoặc đổi operation id để chạy lại.
5. CLI `recover` đánh dấu run đã claim nhưng mất worker: chưa có write in_flight/unknown → failed với lý do; có call in_flight/unknown → reconciliation_required. Run chưa claim vẫn chờ execute kiểm expiry. Scheduler tự gọi khi startup chưa triển khai. Cancel ngăn call kế tiếp; không hứa hủy được remote call đang diễn ra.

Không hứa exactly-once cho arbitrary MCP. Bảo đảm local transaction receipt cần kiểm ở server thật; filesystem write chưa có receipt phải dùng chế độ non_idempotent và không blind retry.

Payload fingerprint cho task_hub hiện tại là SHA-256 canonical JSON `{server:"task_hub",tool,policy_version:"b-local-1",args}`. MCP write nhận `_meta["ati/authorization"]` với approval_id, operation_id, snapshot_hash; đây là dữ liệu do controller chuyển vào, không phải tool args/model được quyền tạo. Server đối chiếu persisted run/approval/action/operation với principal cấu hình lúc khởi chạy. Receipt replay qua tools/call vẫn kiểm approval/status/version/expiry. CLI `reconcile` chỉ đọc DB, dùng được sau expiry/cancel; đối chiếu snapshot bytes, run/user/version/step/tool/policy, args và payload/result rồi báo confirmed/conflict/not_observed. Không đổi trace hoặc tự chạy tiếp; chưa có HTTP endpoint. Thời hạn receiver được kiểm lại sau khóa tài nguyên và trước commit; hết hạn trong khi chờ DB thì rollback cả mutation và receipt.

## MCP adapter và trace

Raw tools/list là dữ liệu chưa tin cậy. Chỉ publish reviewed registry entry có server identity/version, inputSchema, outputSchema, sideEffect và policyVersion. validateToolCall(execution) chỉ kiểm policy/args, không tự cấp quyền write.

Baseline nhận structuredContent khớp outputSchema. isError=true luôn là lỗi tool kể cả JSON-RPC/HTTP thành công. Text-only output cần adapter cụ thể; không parse text tùy ý như JSON hay xem stderr là output. Phân loại lỗi dựa transport, tool error, dispatch stage và outcome certainty; timeout write là unknown, không chỉ transient.

Seq cấp bằng lock/update runs.next_event_seq trong cùng transaction ghi status+run_events+run_outbox. Outbox có unique job id, consumer xử lý at-least-once với state guards. Events không mất vì process chết giữa DB commit và enqueue. B không tự resume không có nghĩa bỏ kiểm tra orphan/outbox.

CLI claim prepare/execute outbox trực tiếp bằng PostgreSQL, chưa có BullMQ dispatcher. Khóa worker dùng connection riêng; mất khóa đóng MCP và kiểm lại trước dispatch. Controller không chuyển trạng thái terminal hoặc thêm event sau run.finished. Outcome attempt chỉ hoàn thiện một lần; lỗi lưu outcome khiến các attempt còn mở được đóng trong transaction kết thúc/recovery, giữ certainty unknown cho write chưa được xác nhận.

Mỗi attempt mới lưu version_id, tool/policy/input/output snapshot, resolved args, operation_id nếu write, thời gian, raw outcome đã che bí mật và error class/certainty. Không ghi đè attempt hoặc suy diễn tool cũ từ plan hiện tại. Các cột NULL trên attempt legacy nghĩa là không biết, không phải đủ trace.

Profile B còn áp max_attempts ≤3 và exponential backoff ở validatePlanTools cho mọi step. Read được dùng retry theo giới hạn này; write vẫn cần certainty/receiver gate, không tự retry chỉ vì DSL cho phép 3 lần. Trace API xuất đầy đủ attempt snapshots qua GET /runs/{runId}/trace; không dựa vào output_preview của event để tái dựng output đầy đủ.
