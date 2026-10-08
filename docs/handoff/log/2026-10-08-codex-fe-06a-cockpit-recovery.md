# 2026-10-08 · codex · FE-06 phần A: khôi phục trong Cockpit

## Phạm vi và trạng thái

- Task: `docs/handoff/tasks/FE-06-cockpit-recovery-and-responses.md`, mục 1–4, 8, 10. Phần B chưa làm; chưa merge, chờ CI exact head và reviewer repository.
- Nhánh `feat/fe-06-cockpit-recovery-a`, base `eb48f0b5d201bdf7bce73e14ccf8ed1ed5d56da7` (#106).
- Worktree `C:/Users/VinhDat/orca/workspaces/ATI_Project/fe-06-cockpit-recovery-a`, tạo qua Orca, giữ để reviewer kiểm ảnh và sửa theo review.
- Đã đọc CURRENT-STATE/README/ROADMAP/task, PROJECT-REPORT/spec/workflow và ba log mới nhất trước khi làm; không sửa CURRENT-STATE/ROADMAP. Main có `.gitignore`, PRODUCT.md, docs/reports/, skills-lock.json của người dùng, vẫn giữ nguyên.
- Backend, planner, executor, catalog và policy không sửa. Presentation metadata có link recovery thay nhánh riêng từng dịch vụ.

## Thay đổi và giới hạn

Phần A đã triển khai trên `feat/fe-06-cockpit-recovery-a`, base `eb48f0b`. Chờ CI đúng head và reviewer repository nghiệm thu; chưa merge. Chỉ mục 1–4, 8, 10; phần B (5–7) chưa làm.

- Khoảnh khắc 7–9 dùng cấu trúc/class từ React AppStage; dữ liệu, lỗi, thời lượng, link và hành động lấy từ snapshot. Unknown không có retry/edit/continue kể cả snapshot trả actions sai. Dừng có xác nhận, Escape/hủy không gửi lệnh.
- Form sửa có trường nhãn theo schema, kiểm JSON/kiểu trước xác nhận, giữ tham số/đầu ra thành công đã lưu và resolve `$ref`/`$template`. API retry không nhận args: xác nhận dừng kế hoạch cũ → đọc snapshot stopped → gửi yêu cầu sửa mới, chờ duyệt mới; stop lỗi/conflict không gửi yêu cầu sửa. Không đổi API/policy executor.
- Stopped/rejected/failed có biên nhận việc đã làm/chưa hoàn thành và Nhờ việc khác, giữ unknown làm bằng chứng. Snapshot terminal đã retired không chiếm lại màn planning/clarification mới. Phản hồi recovery muộn, rời/quay lại hội thoại, đổi plan và SSE stopped trước HTTP đều có test.
- Đã bỏ PartialFailureModal/ReconciliationNotice, chuyển đủ 11 ca modal cũ sang incident/editor và giữ các ca W2-04/W2-05/reconciliation/safety. Frontend từ 475 lên 510 test.
- Cả 5 P3 #103: copy runtime trung thực; M chỉ đếm succeeded; skipped có output không link/title giả; đóng Sửa qua Chat khi owner đổi; SSE plan/plan_preview thêm tin hiển thị có dedup, không đổi lưu backend.
- `npm run check`: exit 0; v3 1.467 test + eval 165; `npm run test:browser:v3`: exit 0, 69/69 test qua 11 scenarios. Review agent độc lập 142/142 test liên quan, không còn P1/P2 phát hiện; chưa thay nghiệm thu reviewer repository.
- 32 ảnh app/React ở 1440×900 và 375×812, light/dark, và SHA256: [log FE-06A](../log/2026-10-08-codex-fe-06a-cockpit-recovery.md). Ảnh không commit, trang so sánh tại worktree `node_modules/.cache/fe06a/screenshots/comparison.html`.
- Khác mẫu có chủ đích: copy/nhãn dịch vụ tổng quát theo dữ liệu; moment7 liệt kê mỗi việc thành công thay gộp hai việc demo; thêm link thật và chi tiết đối chiếu thu gọn; nút sửa/xác nhận theo task; moment8 dùng nguyên lựa chọn/cảnh báo FE-06 nên nút dài hơn demo; restart hiển thị thời lượng đã lưu; terminal dùng bố cục6 với trạng thái đúng và connector chỉ khi có reference thật. Demo pill không đưa vào app. Các lớp khung, typography, màu, card và buttons lấy từ mẫu; các thay đổi min-width/wrap giữ không cuộn ngang ở 375px.
- Durable GET có thể trả execution reconciliation_required cho plan partial+unknown dù chưa restart; UI hiển thị8 khi plan vẫn partial, chỉ9 khi plan đã reconciliation_required. Unknown trong9 vẫn không Continue. Đây là nối dữ liệu thật, không sửa backend.
- NOT_RUN: provider live, nghiệm thu screen reader, phần B responses/errors, reviewer repository và nghiệm thu sản phẩm.

## Bằng chứng RED → GREEN

Lệnh Vitest dùng workspace `npm run test -w @wap/chat-web -- <file>`; log dưới đây không commit, nằm ở worktree.

| Log RED | Kết quả trước sửa | Điều được chứng minh |
| --- | --- | --- |
| fe06-red.log | 10 failed / 2 passed | rendering7–9, terminal, P3 chưa có |
| fe06-actions-red.log | 2 failed / 3 passed | unknown không thể gọi retry/continue; lỗi muộn A→B→A không đổi UI |
| fe06-ref-editor-red.log | 1 failed / 6 passed | editor phải dùng reference thành công đã lưu |
| fe06-durable-unknown-red.log | 1 failed / 14 skipped | durable partial unknown không được nói restart |
| fe06-retired-terminal-red.log | 3 failed / 14 skipped | hydrate terminal cũ không che planning/clarification mới |
| fe06-stop-sse-red.log | 1 failed / 7 skipped | SSE stopped trước HTTP vẫn cho phép gửi yêu cầu sửa |
| fe06-schema-red.log | 3 failed / 14 passed | malformed JSON/khác kiểu array trong form schema bị chặn trước Stop |
| fe06-refusal-ownership-red.log | 1 failed / 17 passed | refusal mới không che execution đang unsafe |

- Baseline `fe06-baseline.log`: 49 files, 475/475 test.
- GREEN cuối `fe06-check-final3.log`: typecheck exit0; schemas47 + adapters340 + planner196 + executor25 + API349 + FE510 = **1.467/1.467**, eval **165/165**, build và security build guard đạt; launcher1/1, env/fake OIDC10/10; toàn lệnh `npm run check` exit0.
- `fe06-check-final.log` có ba OAuth test timeout 5s (API346/349); chạy lại API349/349. `fe06-check-final2.log` bắt literal service branch trong link recovery; chuyển sang metadata, eval165/165 rồi full check cuối exit0. Không sửa/thay timeout backend.
- `fe06-browser-canonical.log` dừng trước test vì 3006 đang thuộc worktree FE-07; giữ nguyên tiến trình và DB FE-07. Chuyển FE-06 sang API3016/web5196.
- `fe06-browser-canonical2.log`: 51/52 default; assertion FE-03 còn đòi “ghi thật” ở sandbox. Sửa assertion theo mục10, vẫn giữ các kiểm tra grounding/reload/approval/link cũ.
- GREEN browser cuối `fe06-browser-canonical3.log`: **69/69**, exit0; 11 scenarios lần lượt `default, auth02, auth04, clarification, partial_failure, three_service, sheets_slack, calendar_slack, notion_slack, telegram_slack, jira_slack`; số pass `52, 2, 5, 2, 2, 1, 1, 1, 1, 1, 1`.
- PostgreSQL thật riêng `ati-fe06a-test-pg`, tmpfs16, port55535; HTTP API3016/web5196, sandbox. Không dùng DB dev15433, W3-10/FE cũ55533 hay FE-07 55536.
- Browser mới4 ca: 1440×900/375×812 × light/dark; mỗi ca seed thật 4 bước, mở7/8/9/stopped; một composer; `scrollWidth<=innerWidth`; unknown không có retry/edit/continue; link HTTPS/rel; Escape không POST stop, xác nhận POST stop thật và DB còn unknown. Browser cũ vẫn kiểm skip/continue, saved output và reload qua DB.
- Review agent độc lập đọc diff và chạy lại7 file frontend, **142/142**, exit0. Hai P2 typed JSON/retired terminal và P3 impact/link đã sửa; P2 SSE-before-HTTP cũng sửa. Kết luận sơ bộ không còn P1/P2 phát hiện. Chưa thay review repository theo REVIEW-CHECKLIST.
- `git diff --check`: exit0. Không có screenshot, credential môi trường hay log private trong commit.

## Ảnh và đối chiếu

32 PNG không commit tại `C:/Users/VinhDat/orca/workspaces/ATI_Project/fe-06-cockpit-recovery-a/node_modules/.cache/fe06a/screenshots/`. Mở `comparison.html` trong cùng thư mục để xem app cạnh React reference. App lấy từ browser4 ca trong default scenario; prototype Vite5183 `/app-stage`, phím7/8/9/6, theme `ati-theme`; ảnh terminal đối chiếu bố cục6 (mẫu không có stopped).

Đã xem các cặp7 desktop light/mobile dark,8 mobile dark,9 desktop light/mobile dark,terminal desktop light; khác chữ/dữ liệu và độ cao được ghi ở task result. Ma trận screenshot/browser phủ cả16 trạng thái app và16 reference; không tuyên bố pixel-identical vì dữ liệu thật, nút theo actions, nội dung FE-06 và terminal khác demo. Không cuộn ngang ở4 tổ hợp. Các nút dưới fold cuộn theo vùng cockpit kế thừa FE-05b.

| Tệp | SHA256 |
| --- | --- |
| FE06-app-7-dark-1440.png | `f3aecf571d63698140c3058bb98f6297c40d498edac3cc4f9785f7586205601a` |
| FE06-app-7-dark-375.png | `e73a868853a58151d0ba845ba33129e1273a2d9694e9126db509eac673641a80` |
| FE06-app-7-light-1440.png | `cbdcf9f9a29ffe9b79b2c2bdbc6871b61f33049f85dd11f49d06a6bdf0bfdc49` |
| FE06-app-7-light-375.png | `e1c077f3425554051b58bf5b184347048b0d46eaa3b778f0e62439b7cd7b9dc4` |
| FE06-app-8-dark-1440.png | `6bd2cdc429863b26bc3bcae42d7b7961f8e12f2c68533952eda70180280b2543` |
| FE06-app-8-dark-375.png | `e424d0999c62fb348244b27b76f5e0ee2be91c6c7fc9433eef433627fc9da2b5` |
| FE06-app-8-light-1440.png | `4e1aff363ca2f230afb20cde0a637e735aa78804eb909bc32c3b506bc0367540` |
| FE06-app-8-light-375.png | `b96feadb7d8267f3593990e3afa12733ffdd0fa52d84ce4e6eec145cc47276ab` |
| FE06-app-9-dark-1440.png | `4505264b687f77ac1201f6d8cc56a49c82962f35c7e465893eee9340029b6a07` |
| FE06-app-9-dark-375.png | `43c5f392d28356df139f8a3ae26d5aa1fd089fca3938b78a955d98242a103092` |
| FE06-app-9-light-1440.png | `fc840ba0d2d8b04e815e55a61021e6c4c78119483c07985614250ecb43e95836` |
| FE06-app-9-light-375.png | `c56174312475596faaae541993c246293e228eb6530f47741a37769d8ea4e512` |
| FE06-app-unsuccessful-dark-1440.png | `6de01c8d77e52f2e3d256163628ddf10e8a8a883a5e5ce67779c99b5872d879e` |
| FE06-app-unsuccessful-dark-375.png | `5053dce7ffd54fc36e5ec4308add063237449d07ce46e16117e535a46f5ed5bb` |
| FE06-app-unsuccessful-light-1440.png | `a288b17310cc03444ac68e6cfbdf3523c1ecb85f36bcd5b022eebfcfd1f0c234` |
| FE06-app-unsuccessful-light-375.png | `9d0a4cb843b53d4725d2ca6b3a1e5969f5125fbee46358526e524ec72a31c9df` |
| FE06-prototype-7-dark-1440.png | `47b84cc59bc557cbd23f1ac0a3bdbb0243ad579d927cf478be70b3730e0ec117` |
| FE06-prototype-7-dark-375.png | `14ea75932defebf4495cf13a6a7622d23eabe3e846aee08ca8e52046038bdc05` |
| FE06-prototype-7-light-1440.png | `f78ded2ec099f46bd57d2c4e612ab03bc32bb81d36dbbf3de748c6a6e75003fd` |
| FE06-prototype-7-light-375.png | `d6a97d28555981441ffb6d81ea11eb5319f53faa67b511eed31b257c04d356af` |
| FE06-prototype-8-dark-1440.png | `17bdcf3a63dc76fe8b786c93732a9b7cbb3f6148d975d3441e029a0376484f38` |
| FE06-prototype-8-dark-375.png | `2ba90e42da4ddc4d7f704cedd9ebbc357af9b4e2d63a26819de1fe94f827d17d` |
| FE06-prototype-8-light-1440.png | `0b2f797604ca36298e9215deae12846127feab77c3bb1c0c0ea3c7e77783cef9` |
| FE06-prototype-8-light-375.png | `c60b2791a67479386db010def4840a257622a3ec68a5ca9318de367ef7e82667` |
| FE06-prototype-9-dark-1440.png | `fcc04eb8607df3961c8a5eda85ca4f2ad0de07c5e623d8c4c06cb5a1f8b698db` |
| FE06-prototype-9-dark-375.png | `0ba34ecf6afaa765529599bb9d9211eae3408b166beb99df22f5aa06d0a767d5` |
| FE06-prototype-9-light-1440.png | `de439a3cc75eec3e9301d9723b5e44ac5320f77bd6d67e8175ba8e6baa7e148a` |
| FE06-prototype-9-light-375.png | `7b6e4746bc58b4ec0ab701c59e20d94b01cec1498e44d9656f5e6726085849b3` |
| FE06-prototype-unsuccessful-dark-1440.png | `68f10fae4aaf2106e07ac804500a58c2635c6599153c79ef1335c3c433973835` |
| FE06-prototype-unsuccessful-dark-375.png | `0be6906c216d57631a12c02313ab2adcf6d3fb058ecf4c66eb7d9e0b28626ea4` |
| FE06-prototype-unsuccessful-light-1440.png | `dc2bfa5278340dda23baa99a9b5b659da7fd04163668ffe8c998d39c00a66d59` |
| FE06-prototype-unsuccessful-light-375.png | `571f60bd795301d39f9971b04a5184978c68eb9942309098839461cad2809bb1` |

## Bàn giao

Reviewer: đọc task/log và REVIEW-CHECKLIST, checkout đúng head trong PR, chạy lại check/browser bằng PostgreSQL riêng, xem comparison.html; chỉ reviewer cập nhật CURRENT-STATE/ROADMAP sau merge. Không auto-merge. NOT_RUN: live provider, screen reader acceptance, phần B và nghiệm thu sản phẩm.
