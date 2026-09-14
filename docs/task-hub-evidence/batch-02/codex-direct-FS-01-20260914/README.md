# FS-01 — Codex trực tiếp sửa, 2026-09-14

Theo yêu cầu mới, Codex tự sửa code/kiểm thử; không điều khiển hoặc gửi task cho Antigravity trong lượt này. Phạm vi là các tồn tại của FS-01, chưa FS-02.

**Kết quả: sửa xong các lỗi artifact được kiểm trong lượt này; FS-01 vẫn PARTIAL do native file symlink EPERM.**

## Thay đổi

- `scripts/emit-candidate-artifact.mjs`: bắt buộc truyền path của probe đã review, bỏ hoàn toàn fallback theo run IDs lịch sử. Khi thiếu path, không sinh evidence hay cập nhật current pointer.
- Chặn duplicate tool names và input/output schema không phải object; không âm thầm lấy tool trùng cuối cùng.
- Ghi run artifact bằng exclusive create (`wx`): chạy lại cùng evidence directory bị từ chối, giữ artifact cũ và current pointer hiện có. Current pointer chỉ cập nhật sau khi đã ghi thành công run mới.
- Thêm sáu regression cases, gồm CLI process thật với package fixtures riêng. Không thay đổi bytes package đang cài và không dùng fixtures làm bằng chứng MCP live.
- Bỏ `@ts-nocheck`; khai báo typed API của script trong `.d.mts`, kiểm type cho test file. Runtime script vẫn được xác minh bằng assertions/CLI; không tuyên bố declaration đồng nghĩa đã typecheck toàn JS implementation.
- Cập nhật handoff để Codex trực tiếp triển khai theo yêu cầu mới; giữ hướng dẫn Antigravity như quy trình trước.

## Verification

| Bằng chứng | Kết quả |
|---|---|
| [RED](../FS-01/1789363778502-codex-direct-red/output.log) | 6 test mới fail đúng nguyên nhân; 10 test cũ pass. CLI cũ vẫn chọn historical probe và overwrite run artifact. |
| [GREEN unit](../FS-01/1789363827647-codex-direct-green/output.log) | 68 passed, 1 skipped: filesystem 52 passed/1 skipped + artifact validation 16 passed. |
| [Typecheck](../FS-01/1789363830589-codex-direct-types/command.json) | Exit 0, sau khi bỏ file-wide suppression. |
| [Live upstream probe](../FS-01/1789363870921-codex-direct-live-probe/filesystem-candidate-probe.json) | PASS: 14 raw tools, strict text/structured result khớp fixture, root cleanup true. |
| [Live artifact emission](../FS-01/1789363872414-codex-direct-artifact/candidate-artifact.json) | PASS: chỉ định probe mới bằng CLI arg, 7 files khớp baseline và đủ selected schema hashes; provenance trỏ đúng run. |
| [Native capabilities](native-capabilities.json) | File symlink UNAVAILABLE/EPERM; junction + hardlink AVAILABLE. Temp fixture cleanup thành công. |
| [Preservation](final.json) | Hash bảo toàn baseline; ghi hash nguồn đã sửa để ràng buộc verification. |

Lần full gate trước đó: 190 passed/1 skipped tại `FS-01/1789362927729-check/`. Lượt này chỉ sửa emitter/tests/docs, nên chạy checks liên quan và live probe/artifact, không chạy lại integration hoặc gộp các lượt thành một full-gate count mới.

## Cách dùng emitter

Từ repository root, chạy `node scripts/emit-candidate-artifact.mjs <path-to-reviewed-probe.json>`. Với capture runner, truyền path này sau script; runner cung cấp `ATI_EVIDENCE_DIR` mới. Đường dẫn phải chỉ ra bằng chứng thật được chọn; không còn tự lấy run lịch sử. Thiếu path/file, probe FAIL, schema thiếu/sai/trùng hoặc artifact khác baseline đều bị từ chối.

Gate PARTIAL phản ánh P11 chưa chạy native được trên Windows hiện tại. Không đổi security settings, không tính skip là PASS, không commit hoặc tự chuyển FS-02. Các file/báo cáo trong run và review cũ được giữ nguyên.
