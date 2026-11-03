# Bộ prompt Planora — Antigravity/Gemini triển khai, Codex review

Cập nhật 03/11/2026 theo lựa chọn của chủ dự án: **Codex sẽ review**. Bộ này chỉ chuẩn bị lệnh giao việc, chưa khởi chạy agent hoặc triển khai UI.

## Cách sử dụng

1. Đọc [quy ước chung](COMMON.md). Mỗi prompt worker yêu cầu agent tự đọc file này từ repo, nên không cần dán lại lịch sử chat.
2. Khi đã giao thực hiện kế hoạch, dùng [prompt điều phối](00-antigravity-coordinator.md) trong Antigravity với Gemini được chọn.
3. Điều phối chuẩn bị card/base/dependency cho task hiện tại rồi dán prompt PL-xx vào một Gemini subagent. Không chạy đồng thời cả 15 task.
4. Gemini trả packet -> dùng [prompt Codex review task](90-codex-task-review.md) trong Codex thực, độc lập với implementer.
5. Có finding thì trả lại Gemini bằng [prompt sửa review](92-gemini-review-fixes.md); Codex kiểm SHA mới. Task tiếp theo chỉ nhận sau gate review/CI/integration.
6. Cuối migration dùng [prompt Codex review toàn nhánh](91-codex-final-review.md). Merge/deploy vẫn theo quyền được giao, không suy ra từ review Đạt.

**Model:** worker/điều phối dùng Gemini đã chọn trong Antigravity. Reviewer chạy trong Codex; đổi tên một Gemini agent thành Codex không tạo review Codex. Không khóa phiên bản model hay bịa công cụ/API không có.

## Prompt từng subagent

| Task | Prompt | Card dự kiến do điều phối chuẩn bị | Codex |
| --- | --- | --- | --- |
| PL-01 | [Baseline, design tokens và component nền](PL-01.md) | `docs/handoff/tasks/PL-01-planora-foundation.md` | Review task trước bước kế |
| PL-02 | [Shell, sidebar và workspace](PL-02.md) | `docs/handoff/tasks/PL-02-planora-shell-workspaces.md` | Review task trước bước kế |
| PL-03 | [Landing, login và signup](PL-03.md) | `docs/handoff/tasks/PL-03-planora-public-auth.md` | Review task trước bước kế |
| PL-04 | [Xác thực nâng cao và Google login callback](PL-04.md) | `docs/handoff/tasks/PL-04-planora-auth-lifecycle.md` | Review task trước bước kế |
| PL-05 | [Feed hội thoại và một composer](PL-05.md) | `docs/handoff/tasks/PL-05-planora-chat-feed.md` | Review task trước bước kế |
| PL-06 | [Plan, preview, execution và receipt](PL-06.md) | `docs/handoff/tasks/PL-06-planora-workflow-cards.md` | Review task trước bước kế |
| PL-07 | [Answer, clarification, refusal, errors và recovery](PL-07.md) | `docs/handoff/tasks/PL-07-planora-responses-recovery.md` | Review task trước bước kế |
| PL-08 | [Settings, Gmail, Calendar và Sheets](PL-08.md) | `docs/handoff/tasks/PL-08-planora-google-connections.md` | Review task trước bước kế |
| PL-09 | [Trello, GitHub và Telegram](PL-09.md) | `docs/handoff/tasks/PL-09-planora-trello-github-telegram.md` | Review task trước bước kế |
| PL-10 | [Jira workspace, site/project và yêu cầu quyền](PL-10.md) | `docs/handoff/tasks/PL-10-planora-jira-ui.md` | Review task trước bước kế |
| PL-11 | [Lịch chạy và bản tin tự động](PL-11.md) | `docs/handoff/tasks/PL-11-planora-schedules-digests.md` | Review task trước bước kế |
| PL-12 | [Nhật ký, lịch sử và lưu trữ hội thoại](PL-12.md) | `docs/handoff/tasks/PL-12-planora-history-archives.md` | Review task trước bước kế |
| PL-13 | [Tài khoản và quản trị thành viên](PL-13.md) | `docs/handoff/tasks/PL-13-planora-account-users.md` | Review task trước bước kế |
| PL-14 | [Cẩm nang, chính sách, 404 và trạng thái chung](PL-14.md) | `docs/handoff/tasks/PL-14-planora-guide-privacy-errors.md` | Review task trước bước kế |
| PL-15 | [Cutover, visual QA và gate tích hợp cuối](PL-15.md) | `docs/handoff/tasks/PL-15-planora-cutover-validation.md` | Review task trước bước kế |

## Thứ tự và ranh giới

Mặc định tuần tự theo dependency trong plan. PL-13 có thể tách sau PL-02/04 nếu coordinator khóa được ownership; không để hai agent sửa shell/global CSS/callback frame cùng lúc. Chưa có đủ 15 task card: coordinator chuẩn bị card hiện tại, worker chỉ điền Kết quả card mình.

Thi công phải cập nhật main mới nhất; snapshot main 1977ec7 của bản kế hoạch đã cũ. Mọi số route/state/provider là inventory cần kiểm lại, không là mục tiêu giảm chức năng.

## Tài liệu gốc

- [Handoff chi tiết](../PLANORA-MIGRATION-HANDOFF.md)
- [Spec và inventory](../../superpowers/specs/2026-11-02-planora-migration-design.md)
- [Kế hoạch 15 task](../../superpowers/plans/2026-11-02-planora-migration.md)
- [Task tài liệu PLANORA-00](../tasks/PLANORA-00-ui-migration-plan.md)

Tạo prompt không thay thế duyệt thiết kế/dark palette/bốn mẫu PL-01. Nếu quyền đã được người dùng cấp trong phiên nhận việc, dùng quyền đó và không xin lại.
