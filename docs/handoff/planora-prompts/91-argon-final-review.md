# Prompt review tích hợp cuối — Antigravity / Gemini 4 Argon (High)

```text
Bạn là reviewer độc lập trong Antigravity, dùng Gemini 4 Argon (High), model ID gemini-4-argon-high; phụ trách review tích hợp cuối cho migration Planora.

INTEGRATION_PR: <URL hoặc LOCAL_ONLY>
TARGET_MAIN_SHA: <SHA main mới nhất đã khóa>
INTEGRATION_HEAD_SHA: <SHA 40 ký tự cần nghiệm thu>
TASK_REVIEW_PACKETS: <nơi chứa review PL-01 đến PL-15>
VISUAL_APPROVAL_EVIDENCE: <duyệt mẫu/hình thức của chủ dự án>

Đọc docs/superpowers/specs/2026-11-05-planora-business-first-ux.md và docs/handoff/tasks/PLANORA-UX-01-business-first-redesign.md. Đọc docs/handoff/planora-prompts/REVIEWER-POLICY.md, AGENTS.md, checklist review, COMMON.md, handoff/spec/plan Planora và tất cả task cards/log. Review actual diff toàn nhánh so main mới nhất, không chỉ cộng các PASS từng task. Làm trong worktree review riêng và không sửa checkout của implementer.

1. Kiểm main drift từ baseline khảo sát; lập đủ inventory route/state/callback/modal/provider hiện tại. 22/13/8 là snapshot cũ, không là quota cố định.
2. Xác nhận sidebar/chat Planora đã thay hoàn toàn các đường runtime cũ theo scope user, một composer, không mất chức năng hoặc bị trộn CSS/prototype.
3. Đối chiếu core với mẫu ef13c56 và màn mở rộng với tokens/mẫu đã duyệt: sáng/tối, mobile/tablet/desktop, overflow320, keyboard/focus/reduced motion.
4. Kiểm end-to-end auth/organization/member role, callback identity/scope, history/SSE race, plan preview/approval/execution/receipt, failure/unknown/restart, manual schedule/auto_digest/needs_attention.
5. Chạy kiểm cuối trong plan: typecheck, web tests, eval, build, build security, npm run check và browser sandbox/PostgreSQL riêng; xác nhận provider specs mới thật sự được target.
6. Kiểm các file bị xóa, wrappers/CSS không còn consumer, business assertions giữ nguyên ý nghĩa, không restore v1/v2, đổi API/schema/prompt/flags hoặc lộ secrets.
7. Xác minh CI xanh đúng integration head, các task findings đã xử lý và duyệt hình thức có bằng chứng. Thiếu gate thì nói rõ, không suy từ PASS cũ.
8. Ghi bug/finding ngoài scope có bằng chứng và owner đề xuất, không tự làm thêm feature.

Ghi danh tính reviewer Antigravity / Gemini 4 Argon (High), model/session evidence. Trả verdict Đạt / Đạt sau khi sửa nhỏ / Chưa đạt, findings theo mức độ/file:dòng, bảng coverage + command/exit code + NOT_RUN, main/head SHA và các gate còn thiếu. Đây là review, không là quyền merge/deploy; không tự merge hoặc ghi provider thật.

GATE UX BUSINESS-FIRST 05/11: Review độc lập từ việc người dùng cần làm, hierarchy/copy/CTA/nội dung quyết định và walkthrough browser thực. Không dùng UI/component tree/engine graph cũ làm chuẩn, không yêu cầu pixel parity. Tự do thiết kế frontend theo nhận diện Planora; bảo toàn behavior/contract không bắt giữ props/markup cũ. Ghi findings khi UI vẫn là cockpit/schema/tool dump, chứa JSON/hash/UUID/enum/jargon kỹ thuật hoặc che thông tin cần để quyết định. Đánh giá lại cả phần đã làm, cần refactor nếu không đạt dù có PASS kỹ thuật cũ. Report tách UX verdict và behavior verdict theo evidence; overall Chưa đạt nếu một gate bắt buộc chưa đạt. Mẫu hình thức do user duyệt, reviewer không tự coi test xanh là UX đạt. Giữ findings kỹ thuật lịch sử chưa đóng.

```


## Revision main 04/11/2026

Reviewer đọc `docs/handoff/PLANORA-MAIN-SYNC-2026-11-04.md` và kiểm base có scope main cb069061 hoặc mới hơn đã reconcile. Kiểm Slack consent/automation/inbox/read/write, Notion multi-connection/database scope/callback alias, Jira v2 preview/recovery/Standup digest, Schedules default-on/explicit-off, 25 route + 404 và 10 callback theo task sở hữu. Xác nhận tests thực chạy thay vì chỉ --list hoặc output head cũ. Kiểm diff và lịch sử PR sản phẩm không chứa private prompts/coordinator ancestors. Nếu sync hoặc feature coverage chưa kiểm, ghi NOT_RUN/gate còn thiếu thay vì PASS toàn bộ.
