# Yêu cầu chức năng — scope MVP v2 / đối chiếu B/local

**SCOPE_APPROVED 21/09/2026; IMPLEMENTATION_NOT_VERIFIED.**
[Đặc tả](superpowers/specs/2026-09-21-workflow-platform-mvp-v2-design.md) có ưu
tiên khi khác profile B cũ bên dưới. 78 ID cũ giữ nguyên, không cộng với 11 ID
delta để tuyên bố tỷ lệ hoàn thành. Mọi ID v2 sau là MUST của phạm vi đích.

| ID | Yêu cầu v2 | Đối chiếu / nghiệm thu |
|---|---|---|
| V2-FR-01 | Sheets read-only + Trello read/create qua reviewed profile riêng; không giả SaaS bằng task_hub | Mở rộng FR-CON-02/03/04/06; UC2 live |
| V2-FR-02 | Đọc nguồn có giới hạn trước planning; snapshot/revision/checklist/provenance thống nhất | Mở rộng FR-PLN-11/12; V2-05–08/11/16/20 |
| V2-FR-03 | Planner chọn tool theo NL, có clarification/refusal; không template cố định giả AI | Giữ FR-PLN-01–03/05/09/10; UC1–3 |
| V2-FR-04 | Business confirmation tách platform approval; write phải qua cả hai | Mở rộng FR-APR-01–06; V2-09/15 |
| V2-FR-05 | Business intent key xuyên run/operator, lưu unknown để ngăn create trùng | Mở rộng FR-EXE-06; V2-17–19 |
| V2-FR-06 | Remote receipt/link có schema; read-only đối chiếu, không claim local atomic receipt áp cho SaaS | Giữ FR-EXE-05/15; UC3/V2-19 |
| V2-FR-07 | Hai principal pilot; owner-only read/approve; giữ một active run/DB | Thay scope demo FR-USR-01, giữ FR-USR-02; V2-14/18 |
| V2-FR-08 | Credential server-only, connection/target/principal allowlist, revocation chặn dispatch; redact lỗi | Mở NFR-10 cho SaaS; self-service vault FR-CON-07/USR-03 vẫn OUT; V2-12/13 |
| V2-FR-09 | Live mode rõ, không fallback fixture; source/preview/result/unknown dễ hiểu | Mở FR-TRC/UI; P4 review interaction riêng |
| V2-FR-10 | 20 case tổng hợp có nguồn và oracle, holdout riêng; đo manual/script/AI và semantic/QE | Mở FR-TRC-08; giữ evidence NOT_RUN tới khi đo |
| V2-FR-11 | Sau needs_input bổ sung bằng run mới; link source/run, không resume terminal | Giữ FR-PLN-12 và no-auto-resume |

V2 dùng adapter API được policy kiểm soát; giao thức nội bộ gateway có thể bọc
REST thay vì giả định mọi connector thật là subprocess MCP. FR-EXE-02 của B
vẫn áp cho tool local; không buộc cài arbitrary MCP server cho SaaS.

## Profile B/local trước v2 (yêu cầu nền và evidence lịch sử)

Nguồn scope: [BASELINE](BASELINE.md). Giữ 78 ID cũ để truy vết; cột B thay độ ưu tiên cũ, không cộng tất cả thành MVP. M = mục tiêu bắt buộc của B, S = tùy quỹ, OUT = ngoài scope. Đây là yêu cầu, không trạng thái implementation.

Phân loại: 78 FR = 59 M + 1 S + 18 OUT. Đã bỏ các tổng 45/44 sai. Các invariant ở EXECUTION-CONTRACT là bắt buộc, không được cắt để kịp lịch.

| ID | Yêu cầu trong profile B | B |
|---|---|---|
| FR-CON-01 | Cấu hình server tùy ý qua UI: ngoài B; dùng preset developer-reviewed. | OUT |
| FR-CON-02 | Kiểm kết nối hai preset local và hiển thị lỗi; không dùng fixture làm bằng chứng live. | M |
| FR-CON-03 | Discovery input/output schema; chỉ publish tool sau khi gắn local policy/version; tool mới unreviewed bị chặn. | M |
| FR-CON-04 | Xem 8 task_hub tool + 2 filesystem adapter tool, schema và reviewed read/write policy. | M |
| FR-CON-05 | Người dùng ngắt kết nối / xóa một MCP Server; tool của server đó bị gỡ khỏi Registry | OUT |
| FR-CON-06 | Allow-list exact executable/package version/args hoặc endpoint; mặc định chặn; không cho chung node/npx. | M |
| FR-CON-07 | Thông tin xác thực được mã hóa khi lưu và không bao giờ được đưa vào prompt gửi tới LLM | OUT |
| FR-CON-08 | Nhúng tên/mô tả tool theo model/version được pin trong experiment manifest. | M |
| FR-CON-09 | Hệ thống kiểm tra sức khỏe kết nối định kỳ và hiển thị trạng thái (connected / disconnected / error) | OUT |
| FR-CON-10 | Người dùng làm mới (refresh) danh sách tool của một server khi server có thay đổi | OUT |
| FR-CON-11 | Hệ thống tự động thử kết nối lại khi mất kết nối tạm thời | OUT |
| FR-PLN-01 | Người dùng nhập mô tả công việc bằng ngôn ngữ tự nhiên (tiếng Việt và tiếng Anh) | M |
| FR-PLN-02 | Hệ thống thực hiện Tool Retrieval để chọn top-K tool liên quan thay vì đưa toàn bộ tool vào context | M |
| FR-PLN-03 | Có semantic + query expansion và đo đối chứng; tính chi phí cả lời gọi mở rộng. | M |
| FR-PLN-04 | Retrieval kết hợp semantic search và keyword matching (hybrid) | OUT |
| FR-PLN-05 | PlannerResult có plan/refusal/clarification; executable plan 1–30 bước, demo ≤5. | M |
| FR-PLN-06 | side_effect do model đề xuất phải khớp trusted registry; nhãn read không tự cấp quyền. | M |
| FR-PLN-07 | Write có intent key; engine cấp operation id ổn định và fingerprint từ tool/target/args. | M |
| FR-PLN-08 | Runtime lưu UTC timestamp và ngày theo IANA timezone; mặc định Asia/Ho_Chi_Minh. | M |
| FR-PLN-09 | Tối đa tổng 3 lần planning gồm lần đầu; lỗi trả path/layer/message. Refusal/clarification không đi repair. | M |
| FR-PLN-10 | Hết 3 lần planning → failed, lưu lỗi và chi phí; không ép sinh plan thiếu tool. | M |
| FR-PLN-11 | Hệ thống lưu lại mô tả gốc của người dùng cùng với kế hoạch để phục vụ trace và replan | M |
| FR-PLN-12 | Thiếu target/input → clarification; unsupported tool/capability → refusal. Confidence không là độ đúng. | M |
| FR-PLN-13 | Inputs scalar, required/default đúng kiểu; run nhận giá trị explicit; chưa có UI rerun. | M |
| FR-PLN-14 | Người dùng chọn được chiến lược planning (one-shot / incremental) để phục vụ thí nghiệm so sánh | OUT |
| FR-VAL-01 | **Tầng 1 — Schema**: kiểm tra kế hoạch đúng cấu trúc DSL, đủ trường bắt buộc, đúng kiểu dữ liệu | M |
| FR-VAL-02 | Tra exact server/name trong registry đã duyệt, so policy/version; unknown bị chặn. | M |
| FR-VAL-03 | Args literal validate khi lập plan; có reference ghi deferred. Resolve rồi validate toàn bộ trước từng call và preview write. | M |
| FR-VAL-04 | **Tầng 3 — Graph**: kiểm tra đồ thị phụ thuộc không có chu trình | M |
| FR-VAL-05 | Kiểm syntax và dependency của references trong args/condition/key/outputs; lỗi có path, cảnh báo read dư không chặn. | M |
| FR-VAL-06 | Write có key hợp lệ; key refs cũng validate; key không thay receipt/payload gate. | M |
| FR-VAL-07 | Biểu thức điều kiện được phân tích bằng parser riêng theo grammar hẹp; **không** dùng bất kỳ cơ chế thực thi động nào trên chuỗi do LLM sinh ra | M |
| FR-VAL-08 | Lỗi validate được trả về dưới dạng có cấu trúc (vị trí lỗi, loại lỗi, mô tả) để phục vụ vòng sửa | M |
| FR-VAL-09 | Hệ thống ghi nhận số vòng validate cho mỗi lần tạo workflow để phục vụ đo đạc | M |
| FR-APR-01 | Dry-run chỉ gọi trusted-read; lưu read output/timezone/version snapshot. | M |
| FR-APR-02 | Hệ thống **không** thực thi bất kỳ bước `write` nào trong chế độ dry-run | M |
| FR-APR-03 | Preview chứa từng write operation/tool/target/args thật đã resolve; cấm downstream dataflow từ write trong MVP. | M |
| FR-APR-04 | Duyệt/từ chối theo approval_id + version + snapshot_hash, có owner check và lock. | M |
| FR-APR-05 | Trước mỗi write kiểm approval, payload, policy, operation claim; snapshot đổi phải duyệt lại. | M |
| FR-APR-06 | TTL 10 phút theo đồng hồ server; hết hạn → expired; replan → superseded approval cũ. | M |
| FR-APR-07 | Người dùng sửa tay tham số của một bước trước khi duyệt; kế hoạch sau khi sửa phải validate lại | OUT |
| FR-APR-08 | Người dùng tắt bỏ (skip) một bước không cần thiết trước khi duyệt | OUT |
| FR-EXE-01 | Một worker thực thi tuần tự theo thứ tự topo; lớp DAG dùng cho validation/hiển thị. | M |
| FR-EXE-02 | Engine gọi tool qua MCP (`tools/call`) với tham số đã resolve | M |
| FR-EXE-03 | Engine resolve biểu thức tham chiếu (`inputs`, `steps`, `runtime`) trước khi gọi tool | M |
| FR-EXE-04 | Retry read tối đa 3; write chỉ retry nếu receiver idempotent cùng op/hash hoặc chắc chắn chưa side-effect. | M |
| FR-EXE-05 | Phân loại MCP tool error/transport cùng certainty; write timeout/lost response → unknown, không blind retry. | M |
| FR-EXE-06 | Persist/claim operation trước dispatch; receipt local atomic với mutation; payload conflict bị chặn; unknown cần reconciliation. | M |
| FR-EXE-07 | Status/event seq/outbox commit cùng transaction; phát hiện orphan sau crash, không tự resume. | M |
| FR-EXE-08 | B hỗ trợ fail hoặc local replan; continue nằm ngoài profile dù schema tổng quát còn enum. | M |
| FR-EXE-09 | Condition grammar hẹp; bước skip không cung cấp output; consumer thiếu output phải dừng, không bịa null. | M |
| FR-EXE-10 | Resume tự động sau crash ngoài B; startup phải chặn orphan/unknown bằng trạng thái rõ ràng. | OUT |
| FR-EXE-11 | Các bước không phụ thuộc nhau được thực thi song song | OUT |
| FR-EXE-12 | Local replan khi chắc chắn bước lỗi chưa tạo side-effect; unknown write không được replan. | M |
| FR-EXE-13 | Chỉ sửa đúng bước lỗi chưa thành công; giữ nguyên bước thành công; validate và reapprove writes còn lại. | M |
| FR-EXE-14 | Tối đa 2 local replan/run, không partial/full replan. | M |
| FR-EXE-15 | Cooperative cancel ngăn call kế tiếp; không hứa rollback call đang diễn ra. | M |
| FR-EXE-16 | Timeout mỗi call, mặc định 30s; timeout write không chứng minh thất bại trước commit. | M |
| FR-EXE-17 | Engine giới hạn số lượng lời gọi đồng thời tới cùng một MCP Server | OUT |
| FR-TRC-01 | Attempt lưu version/tool/policy/schema snapshot, args/output/error/certainty, operation id, timestamps; không suy từ plan mới. | M |
| FR-TRC-02 | UI polling 2s, seq pagination/reconnect; không WebSocket trong B. | M |
| FR-TRC-03 | Giao diện hiển thị rõ khi một bước đang retry, kèm lý do và lần thử thứ mấy | M |
| FR-TRC-04 | UI hiển thị local replan, phiên bản và preview mới; yêu cầu duyệt lại. | M |
| FR-TRC-05 | Xem lại events/attempt snapshot của run; app chưa triển khai. | M |
| FR-TRC-06 | Trace hiển thị được ở dạng timeline theo thứ tự thời gian | M |
| FR-TRC-07 | Thông tin nhạy cảm (credential, token) bị che trong trace | M |
| FR-TRC-08 | Báo riêng plan validity, task correctness, refusal/clarification, recovery, latency và tổng tokens/cost. | M |
| FR-TRC-09 | Người dùng xuất trace của một run ra file để phục vụ báo cáo | S |
| FR-WFM-01 | Hệ thống lưu lại kế hoạch đã sinh cùng mô tả gốc | M |
| FR-WFM-02 | Người dùng xem danh sách các run đã thực hiện kèm trạng thái và thời điểm | M |
| FR-WFM-03 | Replay trên snapshot cố định là phép đo offline; rerun dịch vụ thật không hứa kết quả giống hệt. | OUT |
| FR-WFM-04 | Người dùng đặt tên và lưu workflow để tái sử dụng | OUT |
| FR-WFM-05 | Người dùng chạy lại workflow đã lưu với bộ `inputs` khác | OUT |
| FR-WFM-06 | Người dùng xóa workflow và lịch sử run tương ứng | OUT |
| FR-USR-01 | Một tài khoản demo đăng nhập, không signup hay production account management. | M |
| FR-USR-02 | Owner check trên mọi query/run/approval, ngay cả bản demo một tài khoản. | M |
| FR-USR-03 | Credential của mỗi người dùng được lưu tách biệt và mã hóa | OUT |
| FR-USR-04 | Chỉ local preset/root được phép, path confinement, không arbitrary executable/args. | M |

## Nghiệm thu theo năng lực

- Connection: hai preset local thật discovery/call, 8+2 tool. Text-only filesystem có adapter outputSchema kiểm được; thiếu adapter/pin thì gate chưa đạt.
- Planning: dev/holdout theo EVALUATION; không chỉ kiểm tools có mặt. Query expansion là thí nghiệm có đối chứng.
- Validation: phản ví dụ schema/policy/reference; input reference deferred được kiểm sau resolve; output isError hoặc sai schema không được tính success.
- Approval/engine: exact preview, đổi version/hash, duplicate approval, payload conflict, lost response/crash, cooperative cancel và local replan phải có trace quan sát được.
- UI: sáu view (đăng nhập, tổng quan, tạo yêu cầu, lịch sử lần chạy, chi tiết lần chạy, công cụ & kết nối), bốn mục điều hướng; poll/reconnect theo seq, fetch preview, hiển thị refused/needs_input/reconciliation_required. [UX platform](superpowers/specs/2026-09-15-platform-ux-design.md) tổ chức lại các FR hiện có; không thêm workflow editor/reuse hoặc CRUD ngoài B. Tool catalog live đã có DTO/API riêng; nghiệm thu FR-CON-04 vẫn cần kiểm tra discovery thật và reviewed 8+2 tool.

## Phi chức năng — mục tiêu, chưa có số đo

| ID | B/local |
|---|---|
| NFR-01 | Mục tiêu planning p95 ≤30s với ≤5 steps; báo số đo và chi phí thay vì hứa 15s chưa thử |
| NFR-02 | Retrieval p95 ≤500ms với catalog 10 tool, không quảng cáo 100 tool |
| NFR-03 | Poll 2s; hiển thị trạng thái mới p95 ≤3s trên local demo, đo gồm API/render |
| NFR-04 | Một run đang chạy; không mục tiêu 10 run đồng thời |
| NFR-05 | Giữ dữ liệu DB sau restart; orphan bị đánh dấu, không tự resume |
| NFR-06 | Local receipt chống duplicate theo operation/hash; unknown external write không blind retry, không exactly-once tổng quát |
| NFR-07 | Tool fail có error/trace; không làm process toàn hệ thống chết |
| NFR-08 | Tool metadata/output là untrusted data; marker escaping không là bằng chứng chống injection |
| NFR-09 | Không eval/dynamic code từ nội dung model/server |
| NFR-10 | Không credential trong prompt/log/trace; không SaaS credentials trong local mode |
| NFR-11 | Exact launch allow-list và local file root confinement |
| NFR-12 | Chỉ thêm server tương thích schema/adapter/policy đã hỗ trợ; arbitrary server ngoài scope |
| NFR-13 | Tool mới phải qua registry review và fixture; không hứa dùng ngay |
