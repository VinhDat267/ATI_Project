const { execFileSync } = require('child_process');

const prompt = [
  'Bạn là lập trình viên chính trong Antigravity (Gemini 3.8 Flash High).',
  'Nhiệm vụ của bạn: Khắc phục triệt để các review findings F1, F2, F3, F4 của Argon High cho PL-12.',
  'Worktree hiện tại: C:/Users/Admin/orca/workspaces/ATI_Project/feat-planora-pl-12.',
  'Hãy đọc ngay file chỉ thị chi tiết tại: fix-pl12-f1-f4-spec.txt',
  'Thực hiện sửa:',
  '- F1: Bổ sung rename generation race guard và reset editing/saving/error khi đổi workspaceId hoặc search trong SidebarHistory.tsx.',
  '- F2: Cập nhật planora-pl-12-history.test.tsx dùng await findByText/waitFor trước khi kiểm tra tokens/SVGs trong mutation test và bổ sung unit test cho race rename SidebarHistory.',
  '- F3: Bổ sung empty state khi statusFilter lọc ra 0 kết quả trong HistoryPage.tsx và dọn notice khi đổi workspace trong useHistory.ts.',
  '- F4: Đính chính contract trong task card PL-12-planora-history-archive.md và handoff log; tạo docs/handoff/log/2026-11-07-gemini-pl-12-review-fixes.md.',
  'Chạy đầy đủ typecheck:v3, vitest (history và toàn bộ web), build:v3, build-security.',
  'Commit thay đổi và gửi worker_done qua Orca orchestration reply kèm HEAD SHA mới.'
].join('\n\n');

execFileSync('orca.exe', ['terminal', 'send', '--terminal', 'term_cb2e734b-f6c7-48fa-a979-65cf2cbf8034', '--text', prompt, '--enter'], { stdio: 'inherit' });
console.log('PL-12 fix prompt delivered successfully.');
