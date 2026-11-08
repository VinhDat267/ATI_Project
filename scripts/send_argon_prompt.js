const { execFileSync } = require('child_process');

const prompt = [
  'Bạn là reviewer độc lập trong Antigravity, dùng Gemini 4 Argon (High) để tái thẩm định Round 2 cho PL-10 trên HEAD 89deb95c.',
  'Worktree hiện tại: C:/Users/Admin/orca/workspaces/ATI_Project/review-planora-pl-10.',
  'Đối chiếu trực tiếp với các findings trong báo cáo Round 1: docs/handoff/log/2026-11-07-argon-review-pl-10.md và nhật ký khắc phục: docs/handoff/log/2026-11-07-gemini-pl-10-review-fixes.md.',
  'Kiểm tra kỹ lưỡng:',
  '1. Finding F1: Loại bỏ sạch class prototype cũ, không đè token Planora trong bundle CSS; toàn bộ 4 phân vùng con đã chuyển sang token Planora.',
  '2. Finding F2: Chuẩn hóa tương phản WCAG AA >= 4.5:1 trên nhãn mờ, placeholder, trạng thái, và badges cả Light/Dark modes.',
  '3. Finding F3: aria-label trên #link-site-select, disabled={busy} trên nút Huỷ và Đóng, mở rộng test SVG aria-hidden.',
  '4. Thực thi kiểm chứng mutation M3 (xoá aria-hidden="true" tại dòng 723 JiraConnection.tsx xem test có FAIL thật không).',
  '5. Chạy đầy đủ typecheck:v3, vitest (jira và toàn bộ web), build:v3, build-security.',
  'Ghi báo cáo review Round 2 tại docs/handoff/log/2026-11-07-argon-review-pl-10-r2.md.',
  'Gửi worker_done qua Orca orchestration reply kèm kết luận nghiệm thu rõ ràng (ĐẠT hoặc CHƯA ĐẠT).'
].join('\n\n');

execFileSync('orca.exe', ['terminal', 'send', '--terminal', 'term_25db8524-13e9-4a73-a213-8356c9ade270', '--text', prompt, '--enter'], { stdio: 'inherit' });
console.log('Prompt sent successfully to Argon High terminal.');
