const { execFileSync } = require('child_process');

const prompt = [
  'Bạn là lập trình viên chính trong Antigravity (Gemini 3.8 Flash High).',
  'Nhiệm vụ của bạn: Khắc phục triệt để các review findings F1, F2, F3 của Argon High cho PL-11.',
  'Worktree hiện tại: C:/Users/Admin/orca/workspaces/ATI_Project/feat-planora-pl-11.',
  'Hãy đọc ngay file chỉ thị chi tiết tại: fix-pl11-f1-f3-spec.txt',
  'Thực hiện sửa:',
  '- Thêm variant="planora" vào WorkflowFlowCanvas tại ScheduleMoment.tsx:165 và ScheduleSection.tsx:113-118.',
  '- Gỡ bỏ vi.mock WorkflowFlowCanvas trong planora-pl-11-schedules.test.tsx, render canvas thật và kiểm tra sạch không rò rỉ palette cũ, 100% SVG aria-hidden.',
  '- Cập nhật câu mô tả phê duyệt theo approvalMode tại ScheduleMoment.tsx:392-394 và thêm id radio tại dòng 402-425.',
  '- Sửa commit SHA trong task card và handoff log; tạo log docs/handoff/log/2026-11-07-gemini-pl-11-review-fixes.md.',
  'Chạy đầy đủ typecheck:v3, vitest (sched và toàn bộ web), build:v3, build-security.',
  'Commit thay đổi và gửi worker_done qua Orca orchestration reply kèm HEAD SHA mới.'
].join('\n\n');

execFileSync('orca.exe', ['terminal', 'send', '--terminal', 'term_1c8bea36-83f9-49a0-88d7-3cf235579cb9', '--text', prompt, '--enter'], { stdio: 'inherit' });
console.log('PL-11 fix prompt sent successfully.');
