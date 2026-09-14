# Codex review FS-01 — 2026-09-14

**Verdict: REQUEST_CHANGES. Chưa nghiệm thu FS-01, chưa chuyển FS-02.**

Review đối chiếu FS-01/spec với checkout thực, đọc code/tests/lockfile và evidence, chạy lại gate và live read probe, tái hiện riêng bằng native Windows filesystem. Không sửa implementation/test suite, không giao task mới cho Antigravity, không stage/commit. Đây là review functionality/contract của FS-01, không phải chứng nhận OS sandbox hoặc security scan toàn repo.

## Findings cần sửa

### R1 — [P1] Root junction được canonicalize trước khi bị kiểm tra

**Location:** `packages/engine/src/filesystem-paths.ts:103–106`.

`realpath(root)` theo junction rồi `lstat(canonicalRoot)` kiểm directory đích, nên mất dấu link tại root và ancestor. Native repro tạo root junction trỏ tới một directory có marker hợp lệ: helper trả `REVIEW_SENTINEL`; một junction ở parent cũng trả `ANCESTOR_SENTINEL`. Đây là vi phạm static root confinement đã cam kết, không cần race hoặc hostile concurrent process. Khi FS-03 dùng helper này làm gate, root thực được chấp nhận dù đường dẫn cấu hình có link.

**Fix/acceptance:** kiểm `lstat` đường root được cung cấp và các ancestor thuộc root strategy trước canonicalization; từ chối junction/symlink; kiểm containment bằng realpath của parent/final theo spec. Thêm native root-junction và ancestor-junction tests cho read/write. Không đổi threat model để hợp thức hóa PASS.

### R2 — [P2] `existsSync` làm dangling link trông giống leaf chưa tồn tại

**Location:** `packages/engine/src/filesystem-paths.ts:158–168,210–231`.

`existsSync` follow target và trả false cho dangling link, nên cả vòng kiểm component lẫn nhánh existing write target đều bỏ qua `lstat`. Native dangling junction có `existsSync=false` và `lstat.isSymbolicLink=true` vẫn được `inspectFilesystemPath(...,'write',...)` ACCEPT. FS-01 chưa có public write và repro không gọi upstream write; finding là gate chấp nhận object bị spec cấm, không phải claim đã ghi thoát root.

**Fix/acceptance:** dùng `lstat` trực tiếp, chỉ ENOENT thực mới là absent; không nuốt permission/IO errors; từ chối dangling file link/junction ngay cả mode write. Test leaf thiếu thật vẫn được chấp nhận, dangling leaf bị từ chối và sentinel không đổi.

### R3 — [P1] Test tạo link lỗi vẫn được tính PASS, báo cáo đánh giá quá mức

**Location:** `packages/engine/tests/filesystem-paths.test.ts:186–238`; `FS-01/FS-01.md:7–10,128`.

P11/P12/P13/P14 `catch { return; }` khi tạo link lỗi, vì vậy không chạy assertion mà Vitest vẫn báo pass. Review native hiện tại: file symlink **UNAVAILABLE / EPERM**, junction và hardlink AVAILABLE. Suite vẫn ghi 42 passed, 0 skipped. Không thể dùng số này để kết luận mọi native-link oracle đã chạy. Không suy ngược rằng permissions ở lần chạy cũ giống hệt hiện tại; evidence cũ không ghi capability nên không chứng minh coverage đó.

Ngoài ra P24 chỉ `toThrow()` với tên NFD chứa combining marks; lexical regex đã từ chối trước khi chạy alias branch. Case này chứng minh path bị từ chối, không chứng minh alias-collision branch. P22/P23 cũng thiếu root replacement/strict marker cases.

**Fix/acceptance:** ghi từng capability/case với status và OS error, không trả thành công khi fixture thất bại. Required case thiếu phải NOT_RUN và confinement verdict PARTIAL, không đổi Windows security settings. Assert đúng error/stage cho alias policy và thêm root/marker/dangling-write cases từ review. Đính chính cả hai bản FS-01.md và checkbox hoàn tất theo kết quả thật; không tự gọi implementation report là independent acceptance.

### R4 — [P2] Root marker chưa được kiểm theo strict UUID contract

**Location:** `packages/engine/src/filesystem-paths.ts:115–134`.

Helper chỉ yêu cầu `root_id` là string, so `user_id`, và không kiểm extra keys hay hardlink marker. Native repro đều ACCEPT: `root_id: ''`, object có extra field, marker regular file nhưng `nlink=2`. Root ID dùng làm launch/snapshot identity ở task sau cần đúng strict `{format,root_id:UUID,user_id:UUID}`.

**Fix/acceptance:** parse strict schema, kiểm UUID cả hai IDs và principal; marker là regular non-link file với nlink policy như spec. Thêm valid marker, empty/invalid UUID, extra keys, null/array và hardlink cases. Không đưa marker vào public tool path.

### R5 — [P2] Bounded read coi một lần đọc ngắn là EOF

**Location:** `packages/engine/src/filesystem-paths.ts:65–71`.

Một `handle.read` không đảm bảo trả toàn bộ requested length. Repro dùng file thật `abcdef`, chỉ giới hạn mỗi handle read tối đa 3 bytes (fault injection, không claim OS tự short-read ở lượt này): helper trả `abc` thành công. Tương tự short read có thể bỏ qua suffix vượt size/NUL/invalid UTF-8. Adapter ở task sau có thể reject mismatch, nhưng helper hiện tại không thực hiện contract đọc toàn bộ tới EOF/limit.

**Fix/acceptance:** đọc vòng lặp tới EOF hoặc đủ 65,537 bytes, cập nhật offset/position, giữ total memory bound và close trong finally. Test chunks ngắn, multibyte UTF-8 bị chia giữa chunks, exact limit/over limit và invalid suffix. Đọc trước/sau phải giữ regular-file/hardlink checks.

### R6 — [P2] Cả 7 SHA-256 trong báo cáo không phải hash thực

**Location:** `docs/task-hub-evidence/batch-02/FS-01/FS-01.md:144–151` (và bản sao trong `1789319491600-check/FS-01.md`).

Báo cáo nói tất cả hash khớp tarball nhưng 7/7 giá trị được in đều khác installed bytes và baseline. Ví dụ `dist/index.js` thực tế là `729dc8511e779e5cd6640851a74b25283e3af1ca3a7106722f993e864a1d9935`; báo cáo in `729dc851eb3c4c9545ce1e6798b030fb41d13db982ff4c575a7fc4d97fdf45ae`.

**Installed package 7/7 thực tế khớp baseline**; chưa có dấu hiệu package bị thay thế. Lỗi là bằng chứng provenance sai, không được dùng để tạo approved artifact FS-03.

**Fix/acceptance:** xuất artifact JSON từ bytes thật, so baseline bằng code, ghi resolved dependencies/selected raw schema hashes và dẫn link từ Markdown thay vì chép tay. Giữ báo cáo cũ như lịch sử, thêm correction rõ ràng hoặc thay các claim hiện hành có ghi lý do; không sửa baseline cho khớp giá trị sai. Evidence review đã lưu đầy đủ hash đúng.

## Bổ sung cho probe trước khi dùng làm gate FS-03

`scripts/probe-filesystem-candidate.mjs:120–122` fallback sang text khi thiếu `structuredContent.content`, trái exact oracle FS-01; thiếu structured field phải fail. Evidence hiện tại có đúng cả hai field, nên đây chưa phải lỗi live output được quan sát. Entry đang hard-code `dist/index.js` thay vì derive từ package bin. Nếu connect/list/read throw, finally cleanup chạy nhưng exception thoát trước ghi `probeRecord` tại dòng 156: không lưu structured failure/cleanup evidence. Nên giữ error, ghi record trong outer finally và thoát nonzero; close error không được nuốt thành cleanup success. Kiểm tra bằng failure injection có nhãn rõ, không sửa installed package thật để tạo drift.

## Verification thực hiện trong review

| Check | Kết quả mới |
|---|---|
| Typecheck, build, JSON Schema/OpenAPI generation | PASS qua `npm run check` |
| DSL tests | 39 passed |
| Engine unit suite | Vitest báo 42 passed; không đồng nghĩa tất cả native link assertions đã chạy — R3 |
| Full `check:engine` | Exit 1: PostgreSQL `127.0.0.1:55432` ECONNREFUSED; MCP/DB 63 skipped do suite setup fail; engine integration chưa được chạy |
| Docker check | Linux engine named pipe không tồn tại; không khởi động/thay cấu hình trong review |
| Live upstream MCP read | PASS: `secure-filesystem-server@0.2.0`, 14 raw tools, exact Vietnamese structured/text content, root cleanup true |
| Native root/junction/marker repro | R1/R2/R4 tái hiện được; không raw write, root/fixtures riêng đã cleanup |
| Short-read repro | R5 tái hiện bằng bounded handle-read injection trên file thật |
| Installed candidate hashes | 7/7 khớp tarball baseline; 7/7 giá trị in trong báo cáo sai |
| Preservation | 180/180 protected files khớp; 56 baseline sources có đúng 4 drift trong scope: package-lock, engine package.json, check-engine.mjs, tsconfig.json |
| Git/public scope | Không stage/commit; preset/task_hub contract không drift so baseline |

Lần full gate cũ có log 184 passed; giữ như **prior evidence**, không gọi là fresh PASS trong review này. DB failure mới là môi trường, không kết luận FS-01 làm hỏng PostgreSQL.

## Evidence và cách tái hiện

- [Script reviewer](reproduce.mjs): compile source hiện tại trong bộ nhớ, chạy helpers trên temp fixtures riêng. Short-read injection chỉ trong process reviewer, không sửa production.
- [Kết quả reviewer](reproduction.json): timestamps, source hash, từng expected/actual, native capability, checksum comparison và cleanup.
- [Fresh gate command](../FS-01/1789362117217-review-check/command.json), [log](../FS-01/1789362117217-review-check/output.log).
- [Fresh probe command](../FS-01/1789362231168-review-probe/command.json), [raw probe](../FS-01/1789362231168-review-probe/filesystem-candidate-probe.json).
- [Manifest review](manifest.json): hashes source/evidence được review, dependency versions và bảo toàn baseline sau verification.

Chạy từ repository root: `node docs/task-hub-evidence/batch-02/review-FS-01-20260914/reproduce.mjs`. Script exit 0 nghĩa là hoàn tất quan sát, **không** nghĩa các actual ACCEPT trái oracle đã được sửa.

**Next:** sửa riêng FS-01 theo R1–R6 + bổ sung probe, chạy lại verification/capability matrix, rồi Codex review lại. Chưa FS-02; thiếu native link capability vẫn phải giữ PARTIAL theo plan dù các lỗi code khác đã sửa.
