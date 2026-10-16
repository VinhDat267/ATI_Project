import type { Capability, SamplePrompt, ServiceGuide } from './data';

export const GMAIL_GUIDE: ServiceGuide = {
  id: 'gmail', name: 'Gmail', category: 'Của riêng bạn', keys: [], scopeLabel: 'Hộp thư của bạn', sampleScope: 'Tài khoản bạn tự kết nối', timeEstimate: '2 phút',
  summary: 'Tự kết nối hộp thư Gmail của bạn bằng Google, không cần nhập khoá.',
  importantNotice: 'ATI được đọc, soạn, gửi và quản lý thư, không xoá vĩnh viễn. Nội dung thư có thể đi qua 9router tới tài khoản model bên thứ ba. Chỉ bạn dùng được kết nối này.',
  steps: [
    { num: 1, title: 'Mở Kết nối dịch vụ', desc: 'Đăng nhập ATI, mở nhóm Của riêng bạn và chọn Kết nối Gmail.' },
    { num: 2, title: 'Chọn hộp thư và cấp quyền', desc: 'Chọn đúng tài khoản Google, cấp quyền Gmail rồi trở lại ATI. Hộp thư có thể khác email đăng nhập ATI.' },
    { num: 3, title: 'Kiểm tra trước khi duyệt', desc: 'Xem địa chỉ Gửi từ, Tới, Cc và Bcc. Kiểm lại mọi địa chỉ lấy từ luồng thư.' },
    { num: 4, title: 'Kết nối lại khi cần', desc: 'Ở chế độ thử nghiệm của Google, quyền có thể hết hạn sau 7 ngày. Có thể ngắt kết nối ở bất kỳ lúc nào; hội thoại cũ vẫn còn.' },
  ],
};
export const GMAIL_PROMPTS: SamplePrompt[] = [{
  id: 'gmail-reply', category: 'email', categoryLabel: 'Email', title: 'Trả lời thư nhóm ATI',
  prompt: 'Trả lời email mới nhất trong luồng Họp nhóm ATI: Tôi đã nhận được lịch họp, cảm ơn nhóm.', services: ['gmail'], tools: ['gmail.search_threads', 'gmail.get_thread', 'gmail.reply'],
  workflow: ['Tìm luồng thư', 'Đọc người tham gia', 'Xem trước người gửi và người nhận', 'Duyệt rồi trả lời'],
}];
export const GMAIL_CAPABILITY: Capability = { id: 'gmail', name: 'Gmail', role: 'Hộp thư riêng',
  canDo: ['Tìm và đọc thư', 'Gửi, trả lời, chuyển tiếp, soạn nháp', 'Gắn nhãn, lưu trữ, chuyển vào thùng rác'],
  cannotDo: ['Xoá vĩnh viễn', 'Gửi kèm tệp', 'Dùng hộp thư của người khác'],
};
