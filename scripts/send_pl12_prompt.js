const { execFileSync } = require('child_process');

const prompt = [
  'Bạn là lập trình viên chính trong Antigravity (Gemini 3.8 Flash High).',
  'Nhiệm vụ của bạn: Triển khai PL-12: Nhật ký, lịch sử và lưu trữ hội thoại (History & Archives UI) theo Business-First UX v2.0 và Design Brief v2.0.',
  'Worktree hiện tại: C:/Users/Admin/orca/workspaces/ATI_Project/feat-planora-pl-12.',
  'Hãy đọc ngay file chỉ thị chi tiết tại: worker-pl12-spec.txt',
  'Thực hiện chuyển đổi các file trong phạm vi:',
  '- apps/chat-web/src/pages/History/HistoryPage.tsx',
  '- apps/chat-web/src/pages/History/page.css',
  '- apps/chat-web/src/pages/History/useHistory.ts',
  '- apps/chat-web/src/components/layout/SidebarHistory.tsx',
  '- Tạo mới test: apps/chat-web/tests/planora-pl-12-history.test.tsx',
  'Đảm bảo: 100% token Planora, loại bỏ sạch #FF5701 và ATI, 100% SVG aria-hidden, WCAG AA >= 4.5:1, bảo toàn các thao tác archive/delete/restore và đồng bộ với SidebarHistory, chống rò rỉ dữ liệu khi đổi workspace.',
  'Chạy đầy đủ typecheck:v3, vitest (history và toàn bộ web), build:v3, build-security.',
  'Thực hiện mutation test có bằng chứng thật.',
  'Commit thay đổi, cập nhật task card PL-12-planora-history-archive.md, tạo handoff log docs/handoff/log/2026-11-07-gemini-pl-12.md.',
  'Khi xong, gửi worker_done qua Orca orchestration reply kèm HEAD SHA mới.'
].join('\n\n');

execFileSync('orca.exe', ['terminal', 'send', '--terminal', 'term_2aced605-45bc-4ddf-8507-4224f9eddb0f', '--text', prompt, '--enter'], { stdio: 'inherit' });
console.log('PL-12 prompt sent successfully.');
