# Giao Antigravity — Đợt 2: filesystem + G1

**Điều phối hiện hành — 2026-09-14:** theo yêu cầu mới của người dùng, **Codex trực tiếp sửa code và kiểm thử**, không giao Antigravity. Các prompt/model Antigravity bên dưới là hướng dẫn của quy trình trước, chỉ dùng lại khi người dùng yêu cầu rõ. FS-01 đã được triển khai và sửa; gate còn PARTIAL do native file symlink EPERM. Xem [báo cáo Codex trực tiếp](../task-hub-evidence/batch-02/codex-direct-FS-01-20260914/README.md). Việc có plan không cho phép tự chạy cả đợt.

Đọc theo thứ tự:

1. [Spec thiết kế](../superpowers/specs/2026-09-13-filesystem-g1-design.md).
2. [Plan FS-01 đến FS-06](../superpowers/plans/2026-09-13-filesystem-g1-completion.md).
3. [Baseline/hash/provenance](filesystem-handoff-baseline.json).
4. [Review TH-07](../task-hub-evidence/batch-01/review-TH-07-20260913/README.md).

## Quy trình Antigravity trước đây (không còn mặc định)

- Model **Gemini 3.8 Flash High**, một agent, một task/lần. Codex review độc lập sau từng task. Không bật thêm plugin/sub-agent hoặc đổi model để làm task.
- Conversation “Audit Dự Án Task Hub” đã khảo sát repo; dùng tiếp thì đọc delta + các file trên. Nếu mở conversation mới: đọc và nghiên cứu toàn bộ authored source/docs/config/tests, bỏ vendor/build/binary/secrets, tóm tắt mục đích/phạm vi/invariants/unknown và **dừng chờ Codex review trước implementation**.
- Giữ working tree TH-03–07 chưa commit. Không git add/commit/push/reset/clean, không chuyển nhánh làm mất delta. Không tự làm FS-02 khi chỉ được giao FS-01.
- Mỗi task: đọc inputs/spec -> test đỏ theo oracle -> sửa tối thiểu -> test cần thiết -> báo cáo artifact -> dừng. Lỗi implementation nằm trong task thì tự sửa, không hỏi lại việc đã được giao.
- Evidence ở `docs/task-hub-evidence/batch-02/FS-xx/<fresh-run>/`; capture thời gian/exit code trực tiếp. Giữ lần fail/incomplete, không suy đoán thời gian. Đừng chạy suite đồng thời hoặc viết lại observation đợt cũ.
- Bộ 142 test TH-07 là regression floor, không phải test filesystem. 8+2 là public catalog cuối; upstream filesystem còn nhiều tool không được publish.

## Điểm không được làm sai

1. Route theo `{server,name}`, không theo tên tool đơn lẻ.
2. Giữ receipt transaction của task_hub. Filesystem `non_idempotent`: dispatch marker **không phải receipt**, không chứng minh file đã ghi.
3. Filesystem mất reply/crash -> unknown, dừng, không retry/resume; reconcile không nâng thành confirmed chỉ vì thấy nội dung file giống.
4. Root chỉ dành cho demo principal. No traversal, symlink/junction/hardlink, ADS hoặc arbitrary path/executable. Không tuyên bố chống mọi hostile-local-process TOCTOU.
5. Dùng raw `read_text_file` rồi normalize `{content}` thành public `{text}`. Không sửa global DSL normalizer thành parser text tùy ý.
6. CLI prepare trả `approval.id` và `approval.snapshot_hash` lồng; dùng Node trực tiếp khi parse JSON. Không tự bịa flags approve.
7. Giữ 4 migration cũ; chỉ đề xuất 0005 marker. Không migrate/seed/reset `wap_g1` cho test.
8. Rubric chính thức chưa có nguồn trong repo. Có thể đạt technical PASS; overall G1 vẫn PARTIAL nếu thiếu nguồn/tiêu chí cần thiết.

## Prompt giao FS-01 — chỉ gửi khi người dùng yêu cầu triển khai

```text
Triển khai RIÊNG FS-01 trong D:\Môn học\ATI\ATI_Project bằng Gemini 3.8 Flash High.
Conversation này đã audit toàn repo: không tạo agent hoặc conversation khác.
Đọc docs/antigravity/FILESYSTEM-G1-HANDOFF.md, spec và toàn section FS-01 trong plan 2026-09-13-filesystem-g1-completion.md. Đối chiếu filesystem-handoff-baseline.json trước khi sửa.
Làm đủ artifact pin/provenance, path/UTF-8 policy tests, read-only upstream probe thật, capture-command và regression. Chưa bật preset hoặc triển khai filesystem write. Dùng DB/root test do task tự tạo, giữ evidence cũ. Ghi thời gian/exit codes ngay từ process, giữ failures/retries. Không đổi schema/policy tám task_hub tools, không skip/delete regression tests.
Hoàn tất báo cáo FS-01 với actual counts, real-versus-double scope, raw discovery/read và cleanup; dừng chờ Codex review. Không stage/commit/push hoặc tự sang FS-02.
```

Nếu cần conversation mới, chỉ gửi đoạn audit sau trước, chưa gửi prompt triển khai:

```text
Chỉ khảo sát và nghiên cứu toàn bộ repo D:\Môn học\ATI\ATI_Project để hiểu project làm gì, B/local scope, implementation hiện tại, DSL/approval/receipt/unknown invariants, trạng thái TH-07 và plan đợt 2. Đọc authored source/docs/config/tests, bỏ vendor/build/binary và không đọc/hiển thị secrets. Dùng Gemini 3.8 Flash High, một agent. Chưa sửa file, cài package, chạy write hoặc implement. Tóm tắt điều đã xác minh, điểm chưa rõ và đường dẫn bằng chứng rồi dừng chờ Codex review.
```

## Mẫu báo cáo mỗi task

- Task ID, thời điểm báo cáo, status VERIFIED / PARTIAL / FAILED; checkbox hoàn tất thật.
- Files changed theo scope; baseline/protected hash check; lý do mỗi drift dự kiến.
- Command, actual start/end, exit/signal, log path. Retrospective time -> null + provenance.
- Case IDs đạt/fail/NOT_RUN; unit/double/live MCP/real DB/real process crash phân biệt rõ.
- Before/after file bytes hoặc hashes, normalized output, marker count và receipt count tách riêng.
- Root/DB/process teardown; dữ liệu demo thật có được tác động hay không.
- Finding còn lại và điều kiện task tiếp theo. Không gọi toàn G1 PASS khi chỉ xong một phần.

Báo cáo review của Codex và câu trả lời người dùng mới quyết định task kế tiếp. Kế hoạch API/session/UI/AI vẫn là các đợt sau, không nhập vào batch này.
