const { execFileSync } = require('child_process');

const prompt = [
  'Bạn là lập trình viên chính trong Antigravity (Gemini 3.8 Flash High).',
  'Nhiệm vụ của bạn: Triển khai PL-11: Lịch chạy và bản tin tự động (Schedules & Auto-Digest UI) theo Business-First UX v2.0 và Design Brief v2.0.',
  'Worktree hiện tại: C:/Users/Admin/orca/workspaces/ATI_Project/feat-planora-pl-11.',
  'Hãy đọc ngay file chỉ thị chi tiết tại: worker-pl11-spec.txt',
  'Thực hiện chuyển đổi các file trong phạm vi:',
  '- apps/chat-web/src/pages/Cockpit/ScheduleMoment.tsx',
  '- apps/chat-web/src/pages/Cockpit/ScheduleActions.tsx',
  '- apps/chat-web/src/pages/Cockpit/ScheduleRunRecovery.tsx',
  '- apps/chat-web/src/pages/History/ScheduleSection.tsx',
  '- Tạo mới test: apps/chat-web/tests/planora-pl-11-schedules.test.tsx',
  'Đảm bảo: 100% token Planora, loại bỏ sạch #FF5701 và ATI, 100% SVG aria-hidden, WCAG AA >= 4.5:1, không auto-resend khi delivery_unknown, giữ nguyên contracts ScheduleView/ScheduleRunView/SSE.',
  'Chạy đầy đủ typecheck:v3, vitest (sched và toàn bộ web), build:v3, build-security.',
  'Thực hiện mutation test có bằng chứng thật.',
  'Commit thay đổi, cập nhật task card PL-11-planora-schedules-digest.md, tạo handoff log docs/handoff/log/2026-11-07-gemini-pl-11.md.',
  'Khi xong, gửi worker_done qua Orca orchestration reply kèm HEAD SHA mới.'
].join('\n\n');

execFileSync('orca.exe', ['terminal', 'send', '--terminal', 'term_50950f56-faf1-4178-a9c2-01b9c030b6cb', '--text', prompt, '--enter'], { stdio: 'inherit' });
console.log('Prompt delivered successfully to PL-11 worker.');
