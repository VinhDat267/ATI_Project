# Quy ước chung — Antigravity/Gemini thi công, Codex review

Ngày 03/11/2026. File này là context bắt buộc cho mọi prompt PL-xx, không phải lệnh chạy tất cả task.

## Vai trò và quyền thực hiện

- Điều phối: Antigravity với Gemini; khóa baseline, chuẩn bị đúng card hiện tại, phân file, theo dõi dependency và tập hợp bằng chứng.
- Thi công: một subagent Antigravity/Gemini cho một PL-xx; không tự nhận task tiếp theo hoặc spawn thêm worker.
- Review: **Codex độc lập**, không phải Gemini tự review hoặc một Gemini agent được đặt tên “Codex”. Có review từng task và review toàn nhánh cuối.
- Chỉ thi công khi task cụ thể đã được giao và các điều kiện duyệt/dependency đã đáp ứng. Bộ prompt được viết không có nghĩa các agent đã được khởi chạy.
- Không tự merge main, deploy, bật flag runtime hoặc ghi provider thật. Việc merge task vào nhánh tích hợp cũng cần quyền đã được cấp; đủ CI/review là điều kiện kỹ thuật, không tự tạo quyền merge.

## Đọc trước khi sửa

Đọc AGENTS.md, docs/handoff/CURRENT-STATE.md, docs/handoff/README.md, ba log mới nhất, docs/team-workflow.md; sau đó đọc:
- docs/handoff/PLANORA-MIGRATION-HANDOFF.md
- docs/superpowers/specs/2026-11-02-planora-migration-design.md
- docs/superpowers/plans/2026-11-02-planora-migration.md
- Task card PL-xx mà điều phối đã giao.

Quyết định đã chốt: **khôi phục cả bố cục Planora cũ**, gồm sidebar, hội thoại trung tâm, nền kem/xanh rừng. Các màn mới phải cùng phong cách và giữ đủ chức năng main.

Nguồn thị giác đúng: ef13c56:apps/chat-web/DESIGN.md và source liên quan ở Frontend_UXUI. Root DESIGN.md trên nhánh cũ và System Design/ không phải mẫu Planora này. Không merge PR #262 hoặc khôi phục v1/v2 để lấy UI.

Mốc khảo sát là main 1977ec7. Nền bộ prompt ngày 03/11 đã fast-forward tới main 6c235837efa6811064c652b570e8c91bf8f77ab6, gồm GitHub #260 và tài liệu #263; đây cũng không phải cam kết main sẽ đứng yên. Điều phối phải cập nhật inventory theo SHA mới nhất. 22 route/13 moment/8 callback là số liệu lịch sử, không được xóa chức năng mới để ép khớp số đó.

## Git, ownership và dependency

1. Chạy git status và git log -5 trước khi làm. Không checkout, stash, reset, stage hoặc sửa thay đổi của người khác.
2. Dùng worktree/nhánh riêng theo công cụ nền tảng. Base phải chứa dependency đã review/tích hợp; không bắt đầu từ main cũ nếu task cần kết quả PL trước.
3. Chỉ sửa apps/chat-web trong phạm vi card, Kết quả của card mình và một log mới của phiên. Root DESIGN.md, tài liệu dùng chung hoặc scripts shared chỉ khi card đã giao rõ và coordinator đã giải quyết ownership.
4. Không sửa apps/chat-api, packages, db/v3, prompts hoặc evaluations để làm test UI đạt. Nếu phát hiện thiếu contract/backend bug, nêu bằng chứng và interface cần thỏa thuận cho coordinator.
5. Nếu card chưa có: báo coordinator chuẩn bị card; worker không tự sửa mục tiêu/tiêu chí để nới task. Không sửa CURRENT-STATE.md, ROADMAP.md hoặc log của phiên khác.
6. Chỉ git add đúng tên file của task, Conventional Commits. Không force-push hoặc merge khi chưa được giao.

## Những điều không được làm mất

Giữ route/deep link/Back-Forward, AuthGate, controller Workspace, store/hooks/API contract và source of truth hiện tại. Giữ:
- Isolation theo user/workspace; GET/SSE muộn không ghi lên ngữ cảnh mới.
- Plan/proposal/run identity, approval hash/binding, pending locking và state priority.
- OAuth code/state một lần, returnTo an toàn; kết nối xong không tự gửi lại hoặc duyệt.
- Manual/auto_digest theo eligibility/policy thật; unknown/reconciliation/needs_attention không tự retry/resend.
- Một composer, IME, khả năng đọc lịch sử, focus, keyboard, dark mode và reduced motion.
- Tên/ID/timestamp/trạng thái/kết quả thật; không tạo progress/success/connected giả.
- Theme key ati-theme và identifiers kỹ thuật; đổi brand hiển thị không có nghĩa đổi URL/API/invite-code.

## Bằng chứng và kiểm thử

- Với thay đổi hành vi trình bày/integration: test fail đúng hành vi trước, rồi sửa và chạy lại. Lỗi thiếu module/interpreter/quyền không tính là RED hành vi.
- Với đổi palette/CSS thuần: dùng regression hiện có, kiểm ảnh/contrast/build; không viết mock test phản chiếu implementation.
- Theo card chạy nhóm test liên quan, typecheck/build phù hợp; ghi command, SHA, exit code, pass/fail và NOT_RUN có lý do. Chỉ báo PASS từ output đã thực chạy.
- Database/concurrency cần DB/pool/truy vấn thật; timeout cần AbortSignal thật. Test UI async có thể dùng deferred response để chứng minh stale-response guard.
- Browser dùng sandbox và PostgreSQL16/port/container riêng theo harness; không copy .env live hoặc dùng DB/server của người khác. Không thêm bí mật vào log/PR.
- Ảnh đối chiếu Planora core: 1440x900/375x812. Màn mới sáng/tối 1440/1024/768/375, overflow320. Chỉ claim viewport/state đã thực kiểm.
- Không xóa assertion nghiệp vụ để đổi layout. Ghi rõ assertion hình thức prototype cũ được thay bằng reference mới đã duyệt.

## Bàn giao cho Codex

Sau task, điền Kết quả card và thêm log mới; tạo/cập nhật task PR theo template nếu được giao. Trả packet sau trong chat, không tự nhận Đạt:

TASK:
CARD:
BRANCH / WORKTREE:
TARGET BRANCH:
BASE_SHA (40 ký tự):
HEAD_SHA (40 ký tự):
PR_URL hoặc LOCAL_ONLY:
FILES:
BEHAVIOR / VISUAL CHANGES:
TEST COMMANDS + EXIT CODE + PASS/FAIL:
RED EVIDENCE nếu có thay đổi hành vi:
SCREENSHOTS / TRACE / LOG PATHS:
ENVIRONMENT (sandbox/DB riêng, không secrets):
NOT_RUN / LIMITATIONS:
KNOWN RISKS / INTERFACE NOTES:
STATUS: READY_FOR_CODEX_REVIEW

Nếu dependency thiếu, trả WAITING_DEPENDENCY và ID/SHA thiếu. Nếu cần contract ngoài scope, trả NEEDS_INTERFACE_DECISION và bằng chứng. Sau khi nhận finding từ Codex, dùng prompt sửa review; không tự miễn finding hoặc nhảy task.
