const { execFileSync } = require('child_process');

const prompt = [
  'Bạn là reviewer độc lập trong Antigravity, dùng Gemini 4 Argon (High) để thẩm định độc lập PL-11: Lịch chạy và bản tin tự động (Schedules & Auto-Digest UI) trên HEAD f643a297.',
  'Worktree review: C:/Users/Admin/orca/workspaces/ATI_Project/review-planora-pl-11.',
  'Target branch: codex/planora-ui. Base SHA: 89deb95ce3de0f3708c3d07d7184c335b65f61b5.',
  'Đọc kỹ các tài liệu đối chiếu:',
  '- docs/handoff/REVIEW-CHECKLIST.md',
  '- docs/superpowers/specs/2026-11-05-planora-design-brief.md',
  '- docs/superpowers/specs/2026-11-05-planora-business-first-ux.md',
  '- docs/handoff/tasks/PL-11-planora-schedules-digest.md',
  '- docs/handoff/log/2026-11-07-gemini-pl-11.md',
  'Kiểm tra nghiêm ngặt:',
  '1. CSS tokens Planora, typography editorial font-serif, 0% #FF5701, 0% class prototype cũ đè token trong stylesheet, 0% ATI.',
  '2. Tương phản WCAG AA >= 4.5:1 cả Light và Dark mode cho chữ, nhãn mờ, placeholder, và các badges trạng thái.',
  '3. 100% SVG vector icons có aria-hidden="true".',
  '4. Ngôn ngữ công việc tự nhiên cho lịch chạy; phân biệt rõ duyệt thủ công và tự gửi; auto_digest chỉ cho phép chọn khi API eligibility hợp lệ.',
  '5. Vòng đời lượt chạy đầy đủ; khóa an toàn tuyệt đối khi delivery_unknown (needs_attention) không bao giờ render nút resend/replan.',
  '6. Bảo toàn đầy đủ hợp đồng kỹ thuật ScheduleView, ScheduleRunView, ScheduleApprovalMode, SSE events.',
  '7. Chạy đầy đủ các lệnh kiểm thử thật: typecheck:v3, vitest (sched và toàn bộ web), build:v3, build-security.',
  '8. Thực hiện tối thiểu 3 phép thử đột biến (mutation) chứng minh test bắt lỗi thật.',
  'Ghi báo cáo review độc lập tại docs/handoff/log/2026-11-07-argon-review-pl-11.md.',
  'Gửi worker_done qua Orca orchestration reply kèm kết luận nghiệm thu rõ ràng (ĐẠT hoặc CHƯA ĐẠT).'
].join('\n\n');

execFileSync('orca.exe', ['terminal', 'send', '--terminal', 'term_86c9edbc-3871-4b48-9fd9-2e2dbf03c167', '--text', prompt, '--enter'], { stdio: 'inherit' });
console.log('PL-11 review prompt delivered successfully.');
