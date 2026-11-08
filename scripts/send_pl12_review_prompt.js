const { execFileSync } = require('child_process');

const prompt = [
  'Bạn là reviewer độc lập trong Antigravity, dùng Gemini 4 Argon (High) để thẩm định độc lập PL-12: Nhật ký, lịch sử và lưu trữ hội thoại (History & Archives UI) trên HEAD e2e0d064.',
  'Worktree review: C:/Users/Admin/orca/workspaces/ATI_Project/review-planora-pl-12.',
  'Target branch: codex/planora-ui. Base SHA: b4f42665ee5d05f20fc6d1465cad41111bcec4b3.',
  'Đọc kỹ các tài liệu đối chiếu:',
  '- docs/handoff/REVIEW-CHECKLIST.md',
  '- docs/superpowers/specs/2026-11-05-planora-design-brief.md',
  '- docs/superpowers/specs/2026-11-05-planora-business-first-ux.md',
  '- docs/handoff/tasks/PL-12-planora-history-archive.md',
  '- docs/handoff/log/2026-11-07-gemini-pl-12.md',
  'Kiểm tra nghiêm ngặt:',
  '1. CSS tokens Planora, typography editorial font-serif, 0% #FF5701, 0% class prototype cũ đè token trong stylesheet, 0% ATI, 0% raw emojis.',
  '2. Tương phản WCAG AA >= 4.5:1 cả Light và Dark mode cho chữ, nhãn thời gian, trạng thái và badges.',
  '3. 100% SVG vector icons có aria-hidden="true".',
  '4. Trình bày công việc tự nhiên; mở hội thoại đúng /c/:id; đồng bộ rename giữa HistoryPage và SidebarHistory.',
  '5. Bảo vệ phân tách dữ liệu workspace: dọn sạch và huỷ bỏ phản hồi GET muộn khi đổi workspace giữa chừng.',
  '6. SidebarHistory đóng vai trò tóm tắt nhanh, không quảng cáo tìm kiếm vượt dữ liệu thật đã nạp.',
  '7. Chạy đầy đủ các lệnh kiểm thử thật: typecheck:v3, vitest (history và toàn bộ web), build:v3, build-security.',
  '8. Thực hiện tối thiểu 3 phép thử đột biến (mutation testing) chứng minh test bắt lỗi thật.',
  'Ghi báo cáo review độc lập tại docs/handoff/log/2026-11-07-argon-review-pl-12.md.',
  'Gửi worker_done qua Orca orchestration reply kèm kết luận nghiệm thu rõ ràng (ĐẠT hoặc CHƯA ĐẠT).'
].join('\n\n');

execFileSync('orca.exe', ['terminal', 'send', '--terminal', 'term_dad65338-8495-4244-a599-a650e7d80100', '--text', prompt, '--enter'], { stdio: 'inherit' });
console.log('PL-12 review prompt delivered successfully.');
