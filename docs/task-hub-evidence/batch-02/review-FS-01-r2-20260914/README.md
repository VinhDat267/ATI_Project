# FS-01 — Review bản sửa lần 2

**Kết luận: các lỗi R1–R6 đã được sửa và kiểm chứng trong phạm vi đã chạy; gate FS-01 vẫn PARTIAL vì native file symlink EPERM. Chưa chuyển FS-02.**

Antigravity triển khai trong conversation “Audit Dự Án Task Hub”, model UI Gemini 3.8 Flash High. Codex đọc bản sửa và chạy các kiểm tra độc lập dưới đây. Không stage/commit/push. Không đổi Windows security để làm test xanh.

## Đã sửa và xác minh

| Finding | Kết quả kiểm tra lại |
|---|---|
| R1 root/ancestor junction | Native repro hiện REJECT cả hai trước khi trả nội dung; helper kiểm lstat các component root trước canonicalization. |
| R2 dangling link write | Native dangling junction hiện REJECT, thay existsSync bằng lstat và chỉ ENOENT được coi là absent. Test positive missing leaf/existing parent vẫn đạt. |
| R3 false PASS/coverage | File-symlink capability được kiểm thật và P11 skip công khai. Unit cuối: 62 pass, 1 skip. P24 Hangul Jamo đi qua lexical validation rồi bị UNICODE_ALIAS_CONFLICT; Vietnamese NFD được kiểm riêng là BAD_PATH. |
| R4 marker | Empty root ID, extra fields và hardlink marker đều REJECT trong native repro; UUID/object/owner checks được bổ sung. |
| R5 short read | Fault injection giới hạn handle.read 3 bytes vẫn trả đủ `abcdef`; unit có UTF-8 multibyte, over-limit và invalid suffix qua nhiều chunks. Buffer vẫn giới hạn 65,537 bytes, handle đóng trong finally. |
| R6 provenance | Candidate JSON được sinh từ bytes thật; 7/7 hashes khớp baseline. Báo cáo hiện hành hạ PARTIAL, dẫn correction; bản lịch sử trong run cũ và review cũ được bảo toàn. Exact artifact set/count/hash validation có tests thiếu/thừa/trùng/sai hash. |

Probe đã derive entry từ package bin, bắt buộc structuredContent và ghi lỗi connect/read/close cùng cleanup. Codex chạy live read thành công và ba fault injections độc lập: thiếu structuredContent sau raw call thật, connect throw, close throw sau real close. Cả ba trả probe FAIL/exit 1 như dự kiến, vẫn có JSON và temp root cleanup true. Wrapper verification exit 0 có nghĩa lỗi được xử lý đúng, không phải probe đã thành công.

## Bằng chứng mới

- [Native reproduction](reproduction.json), [script](reproduce.mjs): mọi expected REJECT đều REJECT; short read đầy đủ. Script exit 0 chỉ nghĩa quá trình quan sát hoàn tất.
- [Unit cuối — command](../FS-01/1789363493939-codex-final-unit/command.json), [log](../FS-01/1789363493939-codex-final-unit/output.log): **62 passed, 1 skipped (63)**, gồm 52 filesystem + 10 artifact validation passed.
- [Typecheck cuối](../FS-01/1789363496117-codex-final-typecheck/command.json): exit 0. Artifact validation test dùng JS imports và `@ts-nocheck`; coverage phần đó là runtime assertions, không phải TypeScript checking.
- [Live read probe](../FS-01/1789363214163-codex-r2-probe/filesystem-candidate-probe.json): PASS, 14 raw tools, strict content match, cleanup true.
- [Missing structuredContent](../FS-01/1789363214989-codex-r2-missing-structured/fault-verification.json), [connect failure](../FS-01/1789363215719-codex-r2-connect-fail/fault-verification.json), [close failure](../FS-01/1789363216085-codex-r2-close-fail/fault-verification.json); [fault script](probe-fault.mjs). Đây là fault injection có nhãn, không sửa installed package.
- [Full gate do Antigravity chạy trước delta cuối](../FS-01/1789362927729-check/command.json), [log](../FS-01/1789362927729-check/output.log): **190 passed, 1 skipped**, exit 0; 39 DSL + 48 engine unit + 63 MCP/DB + 40 engine integration. PostgreSQL 55432 đã khả dụng ở lượt này. Delta cuối chỉ emitter/tests/docs, nên không chạy lặp toàn integration và không gộp thành một full-run count mới.
- [Final hashes/preservation](final.json): 180/180 protected files không đổi; trong 25 evidence files tồn tại trước fix chỉ current FS-01.md được cập nhật như đã yêu cầu. Source helper/probe hash được ghi để ràng buộc kết quả.
- [Candidate artifact hiện hành](../FS-01/candidate-artifact.json), [correction](../FS-01/CORRECTION-FS-01-HASHES.md), [báo cáo implementation](../FS-01/FS-01.md).

`reproduction.json` còn trường `report_contains_actual:false`: check cũ tìm checksum literal trong FS-01.md; tài liệu hiện hành dẫn candidate JSON/correction thay vì lặp checksum. Đối chiếu trực tiếp JSON với installed bytes và baseline đã PASS trong `final.json`; đây không còn là checksum mismatch.

## Giới hạn và điểm dừng

- P11 native file symlink vẫn NOT_RUN do EPERM; junction/hardlink đã chạy thật. Không gọi toàn confinement PASS. Checklist FS-01 mục 5/8 đã để chưa hoàn tất với lý do PARTIAL.
- Filesystem chưa bật preset/public write. Không tuyên bố OS sandbox chống mọi local race.
- Khi dùng emitter ở task sau, truyền rõ path của probe đã review. Script hiện còn fallback các run IDs lịch sử khi bỏ arg; fallback này không chứng minh artifact/schema hiện tại và không được dùng làm approval evidence FS-03.
- Không tăng số test này thành AI evaluation; dataset/contract task_hub và bằng chứng đợt 1 được giữ.

Các sửa code được yêu cầu đã hoàn tất. Để đóng gate FS-01 đầy đủ còn cần chạy P11 trong môi trường đã có quyền tạo symlink và lưu evidence mới. Không tự bật quyền hoặc tự sang task tiếp theo.
