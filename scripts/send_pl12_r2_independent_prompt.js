const { execFileSync } = require('child_process');

const prompt = [
  'Bạn là reviewer độc lập trong Antigravity (Gemini 3.8 Flash High) thực hiện tái thẩm định Round 2 cho PL-12 trên HEAD 5dc49c5e.',
  'Worktree review: C:/Users/Admin/orca/workspaces/ATI_Project/review-planora-pl-12.',
  'Target branch: codex/planora-ui. Base SHA: b4f42665ee5d05f20fc6d1465cad41111bcec4b3.',
  'Đối chiếu trực tiếp với các findings trong báo cáo Round 1: docs/handoff/log/2026-11-07-argon-review-pl-12.md và nhật ký khắc phục: docs/handoff/log/2026-11-07-gemini-pl-12-review-fixes.md.',
  'Kiểm tra nghiêm ngặt theo REVIEW-CHECKLIST.md và AGENTS.md (bằng chứng thực tế, không chấp nhận mock ảo giác):',
  '1. Finding F1: Đã có rename generation race guard trong SidebarHistory.tsx và reset editing/saving/error khi đổi workspaceId hoặc search.',
  '2. Finding F2: Test timing async trong planora-pl-12-history.test.tsx đã đợi data mount trước khi query/assert và đã có unit test race condition cho rename.',
  '3. Finding F3: Empty state khi lọc statusFilter ra 0 kết quả trong HistoryPage.tsx và dọn notice khi đổi workspace trong useHistory.ts.',
  '4. Finding F4: Đính chính contract trong tài liệu bàn giao.',
  '5. Chạy đầy đủ các lệnh kiểm thử thật: typecheck:v3, vitest (history và toàn bộ web), build:v3, build-security.',
  '6. Thực thi tối thiểu 3 phép thử đột biến mutation verification trên mã nguồn thật (đổi token primary, xóa SVG aria-hidden, v.v.) và ghi nhận RED -> GREEN.',
  'Ghi báo cáo review Round 2 tại docs/handoff/log/2026-11-07-argon-review-pl-12-r2.md (hoặc cập nhật file báo cáo PL-12).',
  'Gửi worker_done qua Orca orchestration reply kèm kết luận nghiệm thu rõ ràng (ĐẠT hoặc CHƯA ĐẠT).'
].join('\n\n');

execFileSync('orca.exe', ['terminal', 'send', '--terminal', 'term_e9e97f33-58b9-4d19-b0c9-e35f4844279d', '--text', prompt, '--enter'], { stdio: 'inherit' });
console.log('PL-12 Round 2 prompt sent successfully.');
