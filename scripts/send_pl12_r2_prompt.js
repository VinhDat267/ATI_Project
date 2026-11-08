const { execFileSync } = require('child_process');

const prompt = [
  'Bạn là reviewer độc lập trong Antigravity, dùng Gemini 4 Argon (High) để tái thẩm định Round 2 cho PL-12 trên HEAD 5dc49c5e.',
  'Worktree review: C:/Users/Admin/orca/workspaces/ATI_Project/review-planora-pl-12.',
  'Target branch: codex/planora-ui. Base SHA: b4f42665ee5d05f20fc6d1465cad41111bcec4b3.',
  'Đối chiếu trực tiếp với các findings trong báo cáo Round 1: docs/handoff/log/2026-11-07-argon-review-pl-12.md và nhật ký khắc phục: docs/handoff/log/2026-11-07-gemini-pl-12-review-fixes.md.',
  'Kiểm tra kỹ lưỡng:',
  '1. Finding F1: Đã có generation race guard trong rename và reset editing/saving/error khi đổi workspaceId hoặc search trong SidebarHistory.tsx.',
  '2. Finding F2: Test timing async trong planora-pl-12-history.test.tsx đã đợi data mount trước khi query/assert và đã có unit test race condition.',
  '3. Finding F3: Empty state khi lọc statusFilter ra 0 kết quả trong HistoryPage.tsx và dọn notice khi đổi workspace trong useHistory.ts.',
  '4. Finding F4: Đính chính contract trong tài liệu bàn giao.',
  '5. Chạy đầy đủ: typecheck:v3, vitest (history và toàn bộ web), build:v3, build-security.',
  '6. Thực thi các phép thử đột biến mutation verification.',
  'Ghi báo cáo review Round 2 tại docs/handoff/log/2026-11-07-argon-review-pl-12-r2.md (hoặc cập nhật file báo cáo PL-12).',
  'Gửi worker_done qua Orca orchestration reply kèm kết luận nghiệm thu rõ ràng (ĐẠT hoặc CHƯA ĐẠT).'
].join('\n\n');

execFileSync('orca.exe', ['terminal', 'send', '--terminal', 'term_5668d962-cd9c-41f7-8a91-642f535583f3', '--text', prompt, '--enter'], { stdio: 'inherit' });
console.log('PL-12 Round 2 review prompt delivered successfully.');
