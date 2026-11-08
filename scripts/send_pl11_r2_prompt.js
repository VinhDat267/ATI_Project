const { execFileSync } = require('child_process');

const prompt = [
  'Bạn là reviewer độc lập trong Antigravity, dùng Gemini 4 Argon (High) để tái thẩm định Round 2 cho PL-11 trên HEAD b4f42665.',
  'Worktree review: C:/Users/Admin/orca/workspaces/ATI_Project/review-planora-pl-11.',
  'Target branch: codex/planora-ui. Base SHA: 89deb95ce3de0f3708c3d07d7184c335b65f61b5.',
  'Đối chiếu trực tiếp với các findings trong báo cáo Round 1: docs/handoff/log/2026-11-07-argon-review-pl-11.md và nhật ký khắc phục: docs/handoff/log/2026-11-07-gemini-pl-11-review-fixes.md.',
  'Kiểm tra kỹ lưỡng:',
  '1. Finding F1: Đã thêm variant="planora" vào WorkflowFlowCanvas ở ScheduleMoment và ScheduleSection; đã gỡ bỏ vi.mock trong test và kiểm tra rendering thật của PlanoraWorkflowSteps, 0% rò rỉ palette cũ, 100% SVG aria-hidden="true".',
  '2. Finding F2: Câu mô tả phê duyệt động theo approvalMode và đã có id radio ở nhánh Sheets.',
  '3. Finding F3: SHA tài liệu đã được đính chính.',
  '4. Chạy đầy đủ: typecheck:v3, vitest (sched và toàn bộ web), build:v3, build-security.',
  '5. Thực thi các phép thử đột biến mutation verification.',
  'Ghi báo cáo review Round 2 tại docs/handoff/log/2026-11-07-argon-review-pl-11-r2.md (hoặc cập nhật file báo cáo PL-11).',
  'Gửi worker_done qua Orca orchestration reply kèm kết luận nghiệm thu rõ ràng (ĐẠT hoặc CHƯA ĐẠT).'
].join('\n\n');

execFileSync('orca.exe', ['terminal', 'send', '--terminal', 'term_18ea0dbe-db99-423e-8c99-7adcb5f6f76c', '--text', prompt, '--enter'], { stdio: 'inherit' });
console.log('PL-11 Round 2 review prompt delivered successfully.');
