import type { Capability, SamplePrompt, ServiceGuide } from './data';

export const MYSHEETS_GUIDE: ServiceGuide = {
  id: 'mysheets',
  name: 'Google Sheets của bạn',
  category: 'Của riêng bạn',
  keys: [],
  scopeLabel: 'Bảng tính của bạn',
  sampleScope: 'Bảng tính bạn chọn trong cửa sổ Google',
  timeEstimate: '2 phút',
  summary: 'Tự kết nối Google Sheets của bạn bằng Google, không cần nhập khoá.',
  importantNotice: 'ATI chỉ đọc và thêm dòng mới vào các bảng tính bạn chọn trong cửa sổ Google Picker. Không xoá, không sửa ô có sẵn. Nội dung ô tính đi qua 9router để lập kế hoạch. Chỉ bạn dùng được kết nối này.',
  steps: [
    { num: 1, title: 'Mở Kết nối dịch vụ', desc: 'Đăng nhập ATI, mở nhóm Của riêng bạn và chọn Kết nối Google Sheets.' },
    { num: 2, title: 'Cấp quyền Google', desc: 'Chọn tài khoản Google của bạn và đồng ý cấp quyền truy cập tệp Drive (drive.file).' },
    { num: 3, title: 'Chọn bảng tính trong cửa sổ Google', desc: 'Mở Google Picker, đánh dấu chọn các bảng tính bạn muốn ATI dùng và bấm Chọn.' },
    { num: 4, title: 'Kiểm tra trước khi duyệt', desc: 'Trước khi thêm dòng, kiểm tra kỹ tên bảng tính, tab và dữ liệu từng cột tại màn duyệt.' },
  ],
};

export const MYSHEETS_BASE_PROMPTS: SamplePrompt[] = [
  {
    id: 'mysheets-append-todo',
    category: 'mysheets',
    categoryLabel: 'Bảng tính',
    title: 'Thêm việc vào bảng tính cá nhân',
    prompt: "Thêm việc 'Chuẩn bị slide bảo vệ', hạn 05/11, vào bảng tính Việc của tôi.",
    services: ['mysheets'],
    tools: ['mysheets.append_rows'],
    workflow: ['Tìm bảng tính', 'Xem trước hàng dữ liệu', 'Duyệt rồi thêm dòng'],
  },
  {
    id: 'mysheets-jira-sync',
    category: 'mysheets',
    categoryLabel: 'Bảng tính',
    title: 'Lưu issue Jira vào bảng tính',
    prompt: 'Lấy các issue Jira giao cho tôi tuần này rồi ghi từng cái thành một dòng trong bảng Báo cáo tuần của tôi.',
    services: ['jira', 'mysheets'],
    tools: ['jira.search_issues', 'mysheets.append_rows'],
    workflow: ['Tìm issue Jira', 'Tạo danh sách dòng dữ liệu', 'Duyệt rồi ghi vào bảng tính'],
  },
  {
    id: 'mysheets-slack-summary',
    category: 'mysheets',
    categoryLabel: 'Bảng tính',
    title: 'Tóm tắt bảng tính lên Slack',
    prompt: 'Đọc 5 dòng cuối trong bảng Tiến độ cá nhân của tôi rồi gửi tóm tắt lên Slack #ati-test.',
    services: ['mysheets', 'slack'],
    tools: ['mysheets.read_range', 'slack.send_message'],
    workflow: ['Đọc dữ liệu bảng tính', 'Tóm tắt nội dung', 'Xem trước tin nhắn', 'Duyệt rồi gửi Slack'],
  },
];

export const MYSHEETS_SCHEDULE_PROMPT: SamplePrompt = {
  id: 'mysheets-schedule-telegram',
  category: 'mysheets',
  categoryLabel: 'Bảng tính',
  title: 'Lịch nhắc việc từ bảng tính qua Telegram',
  prompt: 'Mỗi sáng thứ Hai, đọc bảng Việc của tôi và nhắn Telegram những việc sắp tới hạn.',
  services: ['mysheets', 'telegram'],
  tools: ['mysheets.read_range', 'telegram.send_message'],
  workflow: ['Tạo lịch chạy định kỳ', 'Đọc bảng tính mỗi sáng thứ Hai', 'Duyệt từng lượt gửi Telegram'],
};

export const MYSHEETS_PROMPTS: SamplePrompt[] = MYSHEETS_BASE_PROMPTS;

export const MYSHEETS_CAPABILITY: Capability = {
  id: 'mysheets',
  name: 'Google Sheets của bạn',
  role: 'Bảng tính riêng',
  canDo: [
    'Đọc dữ liệu ô trong phạm vi các bảng tính bạn đã chọn',
    'Thêm dòng mới vào bảng tính sau khi bạn duyệt',
    'Liệt kê danh sách bảng tính và các trang tính (tab) đã cấp quyền',
  ],
  cannotDo: [
    'Sửa hoặc xoá ô tính có sẵn',
    'Tạo bảng tính mới hoặc xoá bảng tính',
    'Truy cập các tệp Google Drive khác ngoài bảng tính bạn chọn',
  ],
};
