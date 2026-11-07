// Dữ liệu chép nguyên văn từ docs/design/prototypes/guide.html bằng scripts/extract-data.mjs; kiểu khai thêm bằng tay.
import type { ReactNode } from 'react';

export interface GuideStep { num: number; title: string; desc: string; callout?: string; tags?: string[]; urlSample?: string }
export interface ServiceGuide { id: string; name: string; category: string; keys: string[]; scopeLabel: string; sampleScope: string; timeEstimate: string; summary: string; importantNotice: string; steps: GuideStep[] }
export interface SamplePrompt { id: string; category: string; categoryLabel: string; title: string; prompt: string; services: string[]; tools: string[]; workflow: string[]; badge?: string }
export interface Capability { id: string; name: string; role: string; canDo: string[]; cannotDo: string[] }

export const SERVICE_SVGS: Record<string, ReactNode> = {
  trello: (
    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none">
      <rect width="24" height="24" rx="4" fill="#0079BF" />
      <rect x="4" y="4" width="6.5" height="13" rx="1.5" fill="white" />
      <rect x="13.5" y="4" width="6.5" height="8.5" rx="1.5" fill="white" />
    </svg>
  ),
  slack: (
    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none">
      <path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zM6.313 15.165a2.528 2.528 0 0 1 2.521-2.52 2.528 2.528 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313z" fill="#E01E5A" />
      <path d="M8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zM8.834 6.313a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312z" fill="#36C5F0" />
      <path d="M18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zM17.688 8.834a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312z" fill="#2EB67D" />
      <path d="M15.165 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zM15.165 17.688a2.528 2.528 0 0 1-2.52-2.523 2.528 2.528 0 0 1 2.52-2.52h6.313A2.528 2.528 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z" fill="#ECB22E" />
    </svg>
  ),
  github: (
    <svg className="w-5 h-5 text-[#24292E]" fill="currentColor" viewBox="0 0 24 24">
      <path fillRule="evenodd" clipRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" />
    </svg>
  ),
  sheets: (
    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z" fill="#0F9D58" />
      <path d="M14 2v6h6l-6-6z" fill="#87CEAB" />
      <rect x="7" y="11" width="10" height="7" rx="0.5" fill="white" fillOpacity="0.3" />
      <line x1="7" y1="14" x2="17" y2="14" stroke="white" strokeWidth="1" />
      <line x1="11" y1="11" x2="11" y2="18" stroke="white" strokeWidth="1" />
    </svg>
  ),
  calendar: (
    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none">
      <rect x="3" y="4" width="18" height="17" rx="3" fill="#4285F4" />
      <rect x="3" y="4" width="18" height="5" fill="#1967D2" />
      <circle cx="7" cy="2.5" r="1.5" fill="#1967D2" />
      <circle cx="17" cy="2.5" r="1.5" fill="#1967D2" />
      <text x="12" y="17" fill="white" fontSize="8" fontFamily="sans-serif" fontWeight="bold" textAnchor="middle">
        31
      </text>
    </svg>
  ),
  notion: (
    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none">
      <path fillRule="evenodd" clipRule="evenodd" d="M4.222 3.125l13.774-1.12c1.38-.112 1.954.267 2.502.933l2.808 3.444c.433.533.693 1.155.693 1.777v12.22c0 1.2-.544 1.866-1.843 1.977l-14.88 1.111c-1.378.111-2.04-.333-2.589-1l-2.016-2.555c-.443-.555-.67-1.222-.67-1.778V4.88c0-1.111.66-1.666 2.22-1.755zm14.153 1.867L7.332 5.88c-.328.026-.453.18-.453.373v11.758c0 .24.125.4.375.373l11.043-.88c.328-.027.422-.24.422-.453V5.419c0-.24-.125-.4-.344-.427zM9.47 7.915l3.593-.24 3.03 5.467V7.435l2.25-.16v8.425l-3.375.24-3.25-5.653v5.626l-2.25.16V7.915z" fill="#111827" />
    </svg>
  ),
  telegram: (
    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="11" fill="#229ED9" />
      <path d="M17.5 7.5L5.5 12.1L9.5 13.6L14.7 10.3C14.9 10.2 15.1 10.4 15 10.6L10.8 14.4V17.5L12.9 15.5L16.2 17.9C16.8 18.2 17.2 17.9 17.4 17.2L19.4 8.2C19.6 7.3 18.9 6.8 17.5 7.5Z" fill="white" />
    </svg>
  ),
  jira: (
    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none">
      <path d="M11.53 2C11.53 7.26 7.26 11.53 2 11.53C7.26 11.53 11.53 15.8 11.53 21.06C11.53 15.8 15.8 11.53 21.06 11.53C15.8 11.53 11.53 7.26 11.53 2Z" fill="#0052CC" />
      <path d="M11.53 2C11.53 4.63 9.4 6.76 6.77 6.76C9.4 6.76 11.53 8.89 11.53 11.52C11.53 8.89 13.66 6.76 16.29 6.76C13.66 6.76 11.53 4.63 11.53 2Z" fill="#2684FF" />
    </svg>
  ),
};

export const SERVICE_GUIDES: Record<string, ServiceGuide> = {
      trello: {
        id: 'trello',
        name: 'Trello',
        category: 'Quản lý công việc dạng bảng',
        keys: ['Liên kết tài khoản Trello', 'Chọn bảng công việc'],
        scopeLabel: 'Bảng Trello được chọn',
        sampleScope: '1–10 bảng công việc của nhóm',
        timeEstimate: 'Khoảng 30 giây',
        summary: 'Tạo và cập nhật thẻ công việc, phân công thành viên, thêm danh sách kiểm tra trên bảng của nhóm.',
        importantNotice: 'Planora chỉ đọc và ghi trên đúng các bảng Trello bạn đã tích chọn. Thẻ đã hoàn thành được lưu trữ an toàn chứ không bao giờ bị xoá vĩnh viễn.',
        steps: [
          {
            num: 1,
            title: 'Liên kết tài khoản Trello trực tiếp',
            desc: 'Mở trang Kết nối dịch vụ trên Planora, tại mục Trello bấm nút <strong>Kết nối Trello</strong> và xác nhận cho phép truy cập trên màn hình Trello.',
            callout: 'Không cần tự tạo khoá kỹ thuật hay tìm mã bảng thủ công.'
          },
          {
            num: 2,
            title: 'Tích chọn các bảng công việc được phép dùng',
            desc: 'Chọn Không gian làm việc Trello và tích chọn từ 1 đến 10 bảng (Board) bạn muốn sử dụng rồi bấm <strong>Lưu bảng được dùng</strong>. Bạn có thể bấm <strong>Đổi bảng</strong> bất cứ lúc nào để cập nhật phạm vi.',
            callout: 'Mỗi bảng hiển thị rõ trạng thái thành viên và liên kết mở nhanh sang Trello.'
          }
        ]
      },
      slack: {
        id: 'slack',
        name: 'Slack',
        category: 'Giao tiếp & Kênh thông báo nhóm',
        keys: ['Liên kết tài khoản Slack', 'Chọn kênh nhận thông báo'],
        scopeLabel: 'Kênh Slack làm việc',
        sampleScope: '#du-an-chung, #thong-bao-sprint',
        timeEstimate: 'Khoảng 30 giây',
        summary: 'Đọc tin nhắn tóm tắt thảo luận và gửi thông báo tiến độ vào các kênh làm việc khi công việc hoàn thành.',
        importantNotice: 'Planora luôn hiển thị bản xem trước nội dung tin nhắn và kênh nhận để bạn kiểm tra trước khi gửi.',
        steps: [
          {
            num: 1,
            title: 'Liên kết tài khoản Slack của bạn',
            desc: 'Trong trang Kết nối dịch vụ, tại mục Slack của bạn bấm nút <strong>Kết nối Slack</strong> và xác nhận đăng nhập vào không gian làm việc Slack của nhóm.',
            callout: 'Liên kết trực tiếp với tài khoản của bạn mà không cần tạo ứng dụng hay sao chép mã token.'
          },
          {
            num: 2,
            title: 'Sử dụng kênh Slack trong câu lệnh hàng ngày',
            desc: 'Khi giao việc hoặc lập báo cáo, chỉ cần nêu tên kênh (ví dụ <code>#general</code> hoặc <code>#ati-test</code>). Bạn cũng có thể đặt kênh Slack mặc định ngay trên màn hình Không gian làm việc.',
            callout: 'Có thể kiểm tra hoặc ngắt kết nối bất cứ lúc nào trong trang Kết nối dịch vụ.'
          }
        ]
      },
      github: {
        id: 'github',
        name: 'GitHub',
        category: 'Kho mã nguồn & Quản lý Issue / Pull Request',
        keys: ['Liên kết tài khoản GitHub', 'Chọn kho mã (Repository)'],
        scopeLabel: 'Repository được chọn',
        sampleScope: 'VinhDat267/ati-test (1–10 kho)',
        timeEstimate: 'Khoảng 30 giây',
        summary: 'Đọc danh sách Pull Request đang mở, kiểm tra Issue tồn đọng, tạo Issue mới và gắn nhãn phân loại.',
        importantNotice: 'Planora không bao giờ xoá kho mã, không tự động gộp nhánh (merge code), và chỉ thao tác trên các kho mã bạn đã tích chọn.',
        steps: [
          {
            num: 1,
            title: 'Liên kết tài khoản GitHub trực tiếp',
            desc: 'Mở trang Kết nối dịch vụ, tại thẻ GitHub bấm nút <strong>Kết nối GitHub</strong> và xác nhận cấp quyền trên trang đăng nhập GitHub.',
            callout: 'Không cần vào Developer Settings hay tạo Personal Access Token thủ công.'
          },
          {
            num: 2,
            title: 'Chọn các kho mã (Repository) được phép sử dụng',
            desc: 'Tích chọn từ 1 đến 10 kho mã trong danh sách tự động tải về rồi bấm <strong>Lưu repository được dùng</strong>. Bạn có thể bấm <strong>Đổi repository</strong> bất cứ lúc nào khi có dự án mới.',
            urlSample: 'VinhDat267/ati-test',
            callout: 'Hệ thống hiển thị rõ nhãn Private / Public để bạn kiểm soát phạm vi an toàn.'
          }
        ]
      },
      sheets: {
        id: 'sheets',
        name: 'Google Sheets',
        category: 'Bảng tính trực tuyến & Tài liệu Google Drive',
        keys: ['Liên kết tài khoản Google', 'Chọn tệp từ Google Drive'],
        scopeLabel: 'Bảng tính & Thư mục Drive',
        sampleScope: 'Bảng theo dõi công việc · Thư mục dự án',
        timeEstimate: 'Khoảng 30 giây',
        summary: 'Đọc số liệu đối chiếu, thêm dòng dữ liệu mới, tạo tài liệu Google Docs và thư mục Google Drive.',
        importantNotice: 'Planora chỉ truy cập đúng các tệp bảng tính bạn đã chọn qua cửa sổ Google Drive hoặc bảng tính do chính bạn khởi tạo trên ứng dụng.',
        steps: [
          {
            num: 1,
            title: 'Liên kết tài khoản Google & Chọn bảng tính trên Google Drive',
            desc: 'Trong trang Kết nối dịch vụ, tại thẻ Google Sheets của bạn bấm <strong>Kết nối Google Sheets</strong>, sau đó bấm <strong>Chọn từ Google Drive</strong> để tích chọn các tệp bảng tính cần dùng.',
            callout: 'Hoàn tất nhanh chóng mà không cần cấu hình tài khoản dịch vụ kỹ thuật hay tải tệp khoá JSON.'
          },
          {
            num: 2,
            title: 'Tạo bảng tính mặc định mới chỉ với 1 bước',
            desc: 'Nếu chưa có sẵn tệp, bạn có thể bấm nút <strong>Tạo bảng tính mặc định mới</strong> ngay trên thẻ Google Sheets để hệ thống khởi tạo sẵn bảng theo dõi công việc và gắn quyền tự động.',
            callout: 'Hỗ trợ tạo tài liệu Google Docs và thư mục Google Drive đi kèm trong các quy trình họp nhóm.'
          }
        ]
      },
      calendar: {
        id: 'calendar',
        name: 'Google Calendar',
        category: 'Lịch họp & Phòng họp Google Meet',
        keys: ['Liên kết tài khoản Google', 'Chọn lịch làm việc'],
        scopeLabel: 'Lịch làm việc được chọn',
        sampleScope: 'Lịch chính (Primary) hoặc lịch dự án',
        timeEstimate: 'Khoảng 30 giây',
        summary: 'Tra cứu lịch biểu, kiểm tra khung giờ trống, đặt lịch họp kèm liên kết Google Meet và gửi lời mời.',
        importantNotice: 'Planora chỉ xem và đặt lịch trên đúng lịch làm việc bạn đã chọn, đồng thời luôn cho bạn duyệt trước thông tin cuộc họp.',
        steps: [
          {
            num: 1,
            title: 'Liên kết tài khoản Google & Chọn lịch họp trực tiếp',
            desc: 'Mở trang Kết nối dịch vụ, tại thẻ Google Calendar của bạn bấm <strong>Kết nối Google Calendar</strong>, sau đó bấm <strong>Dùng ngay Lịch chính</strong> hoặc chọn các lịch làm việc cụ thể từ danh sách.',
            callout: 'Tự động liệt kê các lịch của bạn mà không cần tra cứu mã Calendar ID thủ công.'
          },
          {
            num: 2,
            title: 'Tạo lịch họp Google Meet & nhận Bản tin lịch sáng',
            desc: 'Yêu cầu Planora tạo cuộc họp kèm phòng họp Google Meet tự động, mời thành viên qua email và bật lịch gửi bản tóm tắt lịch họp mỗi sáng sang Slack hoặc Telegram.',
            callout: 'Bạn có thể bấm Chọn lại lịch được dùng bất cứ lúc nào để thêm hoặc bớt lịch.'
          }
        ]
      },
      notion: {
        id: 'notion',
        name: 'Notion',
        category: 'Tài liệu, Wiki, CRM & Biên bản cuộc họp',
        keys: ['Liên kết tài khoản Notion', 'Chọn bảng dữ liệu (Database)'],
        scopeLabel: 'Database được chọn',
        sampleScope: 'Roadmap 2026 · Biên bản họp (1–10 database)',
        timeEstimate: 'Khoảng 30 giây',
        summary: 'Liên kết tài khoản Notion, truy vấn bảng dữ liệu, đọc chi tiết trang, tạo hoặc cập nhật trạng thái trang và tự gửi Bản tin mỗi sáng.',
        importantNotice: 'Khi cấp quyền trên Notion, hãy tích chọn các trang/database bạn muốn Planora truy cập. Planora tự động khoá phạm vi an toàn vào đúng các database đó!',
        steps: [
          {
            num: 1,
            title: 'Liên kết tài khoản Notion trong 30 giây',
            desc: 'Mở trang Kết nối dịch vụ trên Planora, tại mục Notion bấm nút <strong>Kết nối Notion</strong>. Đăng nhập Notion, bấm <strong>Select pages</strong> để tích chọn các Database cần dùng rồi nhấn <strong>Allow access</strong>.',
            callout: 'Không cần tạo mã Integration Secret thủ công.'
          },
          {
            num: 2,
            title: 'Tích chọn hoặc Dán nhanh đường dẫn Database Notion',
            desc: 'Bạn có thể bấm nút <strong>Đổi database</strong> bất cứ lúc nào để tích chọn lại danh sách Database (tối đa 10 database) hoặc dán trực tiếp đường dẫn URL của Database Notion vào ô nhập nhanh:',
            urlSample: 'https://www.notion.so/workspace/Roadmap-11111111222233334444555555555555',
            callout: 'Planora tự động nhận diện mã định danh từ đường dẫn Notion bạn dán vào.'
          },
          {
            num: 3,
            title: 'Đọc/Cập nhật thuộc tính & Lên lịch Bản tin Notion',
            desc: 'Yêu cầu Planora lọc các trang theo trạng thái, đọc toàn văn nội dung trang, cập nhật tiến độ trang hoặc bật <strong>Bản tin Notion tự động</strong> gửi sang Telegram/Slack mỗi sáng.',
            callout: 'Bản tin tự động ưu tiên phân nhóm các mục Quá hạn/Bị chặn lên đầu để bạn xử lý ngay.'
          }
        ]
      },
      telegram: {
        id: 'telegram',
        name: 'Telegram',
        category: 'Nhắn tin nhanh, Đọc tin nhóm & Bản tin tự động',
        keys: ['Ghép nối qua ứng dụng Telegram', 'Chọn nhóm làm việc'],
        scopeLabel: 'Chat / Nhóm được chọn',
        sampleScope: 'Telegram của tôi · Đội Sản Phẩm',
        timeEstimate: 'Khoảng 30 giây',
        summary: 'Ghép nối nhanh với bot chính thức của Planora, đọc tin nhắn gần đây trong nhóm, gửi thông báo tiến độ và nhận bản tin tổng hợp tự động mỗi ngày.',
        importantNotice: 'Không cần tự tạo bot với @BotFather hay tra cứu mã Chat ID thủ công. Planora chỉ truy cập đúng cuộc trò chuyện và nhóm bạn tích chọn.',
        steps: [
          {
            num: 1,
            title: 'Ghép nối tài khoản Telegram trong 15 giây',
            desc: 'Mở trang Kết nối dịch vụ trên Planora, tại mục Telegram bấm nút <strong>Kết nối Telegram</strong>. Hệ thống sẽ mở ứng dụng Telegram tới bot chính thức của Planora — bạn chỉ cần nhấn nút <strong>Start</strong> rồi quay lại bấm xác nhận.',
            callout: 'Tự động nhận diện tài khoản và kích hoạt ngay cuộc trò chuyện cá nhân mà không cần nhập khoá kỹ thuật.'
          },
          {
            num: 2,
            title: 'Thêm Bot vào Nhóm công việc',
            desc: 'Nếu muốn Planora gửi báo cáo hoặc đọc tin nhắn trong nhóm làm việc, bấm liên kết <strong>+ Thêm bot vào nhóm mới</strong> ngay trên thẻ Telegram.',
            callout: 'Planora tự động phát hiện các nhóm mới mà bạn là thành viên và hiển thị ngay trong danh sách chọn phạm vi.'
          },
          {
            num: 3,
            title: 'Tích chọn Phạm vi Chat & Bật Bản tin Tự động',
            desc: 'Tích chọn tối đa 10 cuộc trò chuyện/nhóm được phép sử dụng rồi bấm <strong>Lưu danh sách chat</strong>. Khi lập lịch báo cáo hàng ngày từ Google Calendar, Sheets, Trello hoặc GitHub, bạn có thể bật chế độ gửi tự động thẳng về Telegram.',
            callout: 'Mọi bản tin tự động đều kiểm tra quyền thành viên nhóm theo thời gian thực trước khi gửi.'
          }
        ]
      },
      jira: {
        id: 'jira',
        name: 'Jira',
        category: 'Quản lý dự án & Điều phối Sprint',
        keys: ['Liên kết tài khoản Atlassian', 'Tự đồng bộ Site URL & Dự án'],
        scopeLabel: 'Project key',
        sampleScope: 'ATI',
        timeEstimate: 'Khoảng 30 giây',
        summary: 'Liên kết tài khoản Atlassian Jira, tạo/cập nhật công việc, chuyển trạng thái tiến độ, phân công thành viên, đặt mức ưu tiên và nhận Bản tin Standup mỗi sáng.',
        importantNotice: 'Liên kết trực tiếp tài khoản Atlassian trong Không gian làm việc để tự động đồng bộ Site URL & Dự án mà không cần tạo mã khoá thủ công.',
        steps: [
          {
            num: 1,
            title: 'Tạo Không gian làm việc Jira & Liên kết tài khoản Atlassian',
            desc: 'Trong trang Kết nối dịch vụ, tại mục Atlassian Jira Cloud bấm <strong>Kết nối Jira</strong> và nhấn <strong>Accept</strong> trên màn hình Atlassian để cấp quyền truy cập.',
            callout: 'Planora tự động đồng bộ danh sách Site (.atlassian.net) và các Project bạn có quyền truy cập.'
          },
          {
            num: 2,
            title: 'Tích chọn Dự án (Project) & Cấp quyền thao tác',
            desc: 'Chọn các dự án Jira cho phép sử dụng trong Không gian làm việc. Bạn có thể tạo công việc mới kèm mức độ ưu tiên, người phụ trách, hạn chót, hoặc chuyển trạng thái tiến độ trực tiếp.',
            callout: 'Mọi bước ghi đều hiển thị thẻ xem trước rõ ràng trước khi bạn bấm Phê duyệt.'
          },
          {
            num: 3,
            title: 'Lên lịch Bản tin Tiến độ & Vướng mắc Jira mỗi sáng',
            desc: 'Yêu cầu Planora tổng hợp các đầu việc ưu tiên cao và tiến độ Sprint định kỳ mỗi sáng để gửi thẳng vào kênh Slack hoặc nhóm Telegram của đội.',
            callout: 'Bản tin tự động chỉ thực hiện truy vấn đọc an toàn và kiểm tra quyền truy cập thực tế ở mỗi lượt chạy.'
          }
        ]
      }
    };

export const SAMPLE_PROMPTS: SamplePrompt[] = [
      // Nhóm 1: Quản lý lỗi Sprint
      {
        id: 'p1',
        category: 'sprint-bug',
        categoryLabel: 'Lỗi Sprint & Kỹ thuật',
        title: 'Tạo thẻ lỗi, issue GitHub, ghi Sheets và báo Slack',
        prompt: 'Tạo card Trello cho lỗi đăng nhập Google, tạo issue GitHub trong ati-test, ghi vào Google Sheets Tasks và báo kênh Slack #ati-test',
        services: ['trello', 'github', 'sheets', 'slack'],
        tools: ['trello.search_boards', 'trello.search_lists', 'trello.create_card', 'github.search_repos', 'github.create_issue', 'sheets.list_spreadsheets', 'sheets.list_sheets', 'sheets.append_rows', 'slack.search_channels', 'slack.send_message'],
        workflow: [
          'Trello: Tạo card "Sửa lỗi đăng nhập Google" trong danh sách Doing',
          'GitHub: Tạo issue mới trong kho ati-test và gắn link card Trello',
          'Google Sheets: Thêm 1 dòng mới vào tab Tasks của bảng tính ATI Test Tracker',
          'Slack: Soạn và gửi tin thông báo kèm đầy đủ đường dẫn tới #ati-test'
        ],
        badge: 'Được dùng nhiều nhất'
      },
      {
        id: 'p2',
        category: 'sprint-bug',
        categoryLabel: 'Lỗi Sprint & Kỹ thuật',
        title: 'Gán người phụ trách card Trello và gắn nhãn issue GitHub',
        prompt: 'Gán người phụ trách @tuan cho card lỗi giỏ hàng trên Trello và đặt nhãn bug cho issue tương ứng trên GitHub',
        services: ['trello', 'github'],
        tools: ['trello.search_cards', 'trello.search_members', 'trello.add_member', 'github.search_issues', 'github.add_label'],
        workflow: [
          'Trello: Tìm card lỗi giỏ hàng trên bảng To Do và gán thành viên Tuấn Đặng',
          'GitHub: Tìm issue liên quan trong kho mã và gán nhãn "bug"'
        ]
      },
      {
        id: 'p3',
        category: 'sprint-bug',
        categoryLabel: 'Lỗi Sprint & Kỹ thuật',
        title: 'Tạo issue GitHub cho lỗi giao diện và báo Slack',
        prompt: 'Tạo issue GitHub cho lỗi hiển thị nút bấm trên Safari màn hình nhỏ và gửi tin báo vào kênh #ati-test',
        services: ['github', 'slack'],
        tools: ['github.search_repos', 'github.create_issue', 'github.add_label', 'slack.search_channels', 'slack.send_message'],
        workflow: [
          'GitHub: Tạo issue "Lỗi hiển thị nút bấm trên Safari 375px" có nhãn defect',
          'Slack: Gửi tin nhắn thông báo issue vừa mở kèm liên kết mở nhanh'
        ]
      },
      {
        id: 'p4',
        category: 'sprint-bug',
        categoryLabel: 'Lỗi Sprint & Kỹ thuật',
        title: 'Lưu trữ một card đã hoàn thành trên Trello',
        prompt: 'Lưu trữ card "Phát hành v1.2" trong danh sách Done trên bảng To Do',
        services: ['trello'],
        tools: ['trello.search_boards', 'trello.search_cards', 'trello.update_card'],
        workflow: [
          'Trello: Tìm đúng card "Phát hành v1.2" trên bảng To Do và chuyển sang trạng thái lưu trữ'
        ]
      },

      // Nhóm 2: Đồng bộ bảng tính & Vận hành
      {
        id: 'p5',
        category: 'sheet-sync',
        categoryLabel: 'Đồng bộ bảng tính',
        title: 'Đọc một issue GitHub và bổ sung vào Google Sheets',
        prompt: 'Đọc issue #42 trong GitHub ati-test và ghi một dòng gồm tiêu đề, người tạo, ngày tạo vào bảng tính ATI Test Tracker tab Tasks',
        services: ['github', 'sheets'],
        tools: ['github.get_issue', 'sheets.list_spreadsheets', 'sheets.list_sheets', 'sheets.append_rows'],
        workflow: [
          'GitHub: Đọc thông tin issue #42 trong kho ati-test',
          'Google Sheets: Ghi thêm một dòng vào cuối tab Tasks (tiêu đề, người tạo, ngày tạo)'
        ],
        badge: 'Tự động hoá vận hành'
      },
      {
        id: 'p6',
        category: 'sheet-sync',
        categoryLabel: 'Đồng bộ bảng tính',
        title: 'Ghi nhiệm vụ mới vào Google Sheets với người phụ trách',
        prompt: 'Ghi vào Google Sheets một dòng công việc mới: Kiểm thử tính năng xuất báo cáo tuần, người phụ trách Lan Nguyễn, hạn chót thứ 6',
        services: ['sheets'],
        tools: ['sheets.list_spreadsheets', 'sheets.list_sheets', 'sheets.append_rows'],
        workflow: [
          'Google Sheets: Tìm bảng tính ATI Test Tracker tab Tasks và chèn dòng mới với đầy đủ các cột dữ liệu'
        ]
      },
      {
        id: 'p7',
        category: 'sheet-sync',
        categoryLabel: 'Đồng bộ bảng tính',
        title: 'Tạo một card Trello từ một dòng Google Sheets',
        prompt: 'Đọc dòng A2:D2 trong tab Tasks của Google Sheets ATI Test Tracker rồi tạo một card Trello tương ứng trong danh sách To Do của bảng To Do',
        services: ['sheets', 'trello'],
        tools: ['sheets.list_spreadsheets', 'sheets.list_sheets', 'sheets.read_range', 'trello.search_boards', 'trello.search_lists', 'trello.create_card'],
        workflow: [
          'Google Sheets: Đọc đúng vùng A2:D2 trong tab Tasks',
          'Trello: Tạo một card tương ứng trong danh sách To Do kèm mô tả tóm tắt'
        ]
      },
      {
        id: 'p8',
        category: 'sheet-sync',
        categoryLabel: 'Đồng bộ bảng tính',
        title: 'Tạo Issue Jira từ một dòng Google Sheets',
        prompt: 'Đọc dòng A2:D2 trong tab Bugs của Google Sheets ATI Test Tracker rồi tạo một issue Jira loại Bug trong project ATI',
        services: ['sheets', 'jira'],
        tools: ['sheets.list_spreadsheets', 'sheets.list_sheets', 'sheets.read_range', 'jira.search_projects', 'jira.create_issue'],
        workflow: [
          'Google Sheets: Đọc nội dung mô tả lỗi trong vùng A2:D2 của tab Bugs',
          'Jira: Tạo issue loại Bug với tiêu đề và mô tả tương ứng'
        ]
      },

      // Nhóm 3: Báo cáo tiến độ & Giao tiếp
      {
        id: 'p9',
        category: 'reporting',
        categoryLabel: 'Báo cáo & Giao tiếp',
        title: 'Tạo page Notion biên bản họp và gửi link lên Slack',
        prompt: 'Tạo page Notion ghi biên bản họp sprint ngày hôm nay và gửi thông báo kèm link page vào kênh Slack #ati-test',
        services: ['notion', 'slack'],
        tools: ['notion.search_databases', 'notion.create_page', 'slack.search_channels', 'slack.send_message'],
        workflow: [
          'Notion: Tạo một trang mới trong Database với tiêu đề "Biên bản họp Sprint" và khung nội dung',
          'Slack: Gửi tin nhắn vào kênh #ati-test kèm đường dẫn trực tiếp tới trang Notion vừa tạo'
        ],
        badge: 'Phổ biến cho PM'
      },
      {
        id: 'p10',
        category: 'reporting',
        categoryLabel: 'Báo cáo & Giao tiếp',
        title: 'Thông báo xử lý xong issue từ GitHub sang Slack',
        prompt: 'Gửi tin vào kênh #ati-test báo issue #42 trên ati-test đã xử lý xong, kèm link issue',
        services: ['github', 'slack'],
        tools: ['github.get_issue', 'slack.search_channels', 'slack.send_message'],
        workflow: [
          'GitHub: Lấy thông tin issue #42 từ kho ati-test',
          'Slack: Gửi thông báo kèm link issue vào kênh #ati-test'
        ]
      },
      {
        id: 'p11',
        category: 'reporting',
        categoryLabel: 'Báo cáo & Giao tiếp',
        title: 'Tạo sự kiện họp Google Calendar và báo kênh Slack',
        prompt: 'Tạo sự kiện Google Calendar Họp review Sprint vào 15:00 thứ 6 này và báo vào kênh Slack #ati-test',
        services: ['calendar', 'slack'],
        tools: ['calendar.list_calendars', 'calendar.create_event', 'slack.search_channels', 'slack.send_message'],
        workflow: [
          'Google Calendar: Đặt lịch sự kiện vào 15:00 thứ 6',
          'Slack: Đăng thông báo lịch họp để mọi người chuẩn bị'
        ]
      },
      {
        id: 'p12',
        category: 'reporting',
        categoryLabel: 'Báo cáo & Giao tiếp',
        title: 'Tổng hợp tiến độ bảng tính & Trello rồi báo nhóm Telegram',
        prompt: 'Đọc bảng tính Google Sheets ATI Test Tracker, kiểm tra các card trên bảng Trello To Do và gửi báo cáo tiến độ vào nhóm Telegram Vận hành',
        services: ['sheets', 'trello', 'telegram'],
        tools: ['sheets.list_spreadsheets', 'sheets.read_range', 'trello.search_boards', 'trello.search_cards', 'telegram.list_chats', 'telegram.send_message'],
        workflow: [
          'Google Sheets & Trello: Đọc tiến độ công việc và danh sách thẻ đang thực hiện',
          'Telegram: Gửi bản tổng hợp tiến độ vào đúng nhóm Telegram Vận hành đã cấp quyền'
        ],
        badge: 'Liên dịch vụ'
      },
      {
        id: 'p13',
        category: 'sprint-bug',
        categoryLabel: 'Lỗi Sprint & Kỹ thuật',
        title: 'Ứng cứu sự cố P1: Tạo Bug Jira, đặt lịch War-room Calendar và báo Slack',
        prompt: 'Tạo issue Bug khẩn cấp trong project Jira ATI cho sự cố thanh toán, đặt lịch họp War-room trên Google Calendar và gửi cảnh báo kèm link vào kênh Slack #ati-test',
        services: ['jira', 'calendar', 'slack'],
        tools: ['jira.search_projects', 'jira.create_issue', 'calendar.list_calendars', 'calendar.create_event', 'slack.search_channels', 'slack.send_message'],
        workflow: [
          'Jira: Tạo issue Bug mới trong dự án ATI và lấy đường dẫn trực tiếp',
          'Google Calendar: Tạo lịch họp khẩn cấp để đội kỹ thuật xử lý sự cố',
          'Slack: Gửi thông báo vào kênh #ati-test kèm link issue Jira và lịch họp'
        ],
        badge: 'Điều phối sự cố'
      },
      {
        id: 'p14',
        category: 'reporting',
        categoryLabel: 'Báo cáo & Giao tiếp',
        title: 'Tổng hợp các issue Jira trong Sprint sang trang báo cáo Notion và Slack',
        prompt: 'Tìm các issue trong project Jira ATI, tạo trang báo cáo Sprint Review trên Notion và gửi thông báo tóm tắt vào kênh Slack #ati-test',
        services: ['jira', 'notion', 'slack'],
        tools: ['jira.search_projects', 'jira.search_issues', 'notion.search_databases', 'notion.create_page', 'slack.search_channels', 'slack.send_message'],
        workflow: [
          'Jira: Tìm và đọc danh sách các issue trong dự án ATI',
          'Notion: Tạo trang tổng kết Sprint Review với danh sách đầu việc từ Jira',
          'Slack: Đăng thông báo kèm liên kết báo cáo Notion vào kênh #ati-test'
        ],
        badge: 'Tự động hoá PM'
      },
      {
        id: 'p15',
        category: 'sprint-bug',
        categoryLabel: 'Lỗi Sprint & Kỹ thuật',
        title: 'Điều phối War-Room toàn diện qua 8 công cụ (Calendar, Jira, GitHub, Trello, Notion, Sheets, Telegram, Slack)',
        prompt: 'Tạo lịch họp khẩn trên Google Calendar, tạo ticket sự cố trên Jira kèm link lịch họp, mở issue trên GitHub tham chiếu mã Jira, tạo thẻ theo dõi trên Trello, lập trang biên bản sự cố trên Notion tổng hợp các liên kết, ghi dòng nhật ký vào bảng tính Google Sheets, gửi cảnh báo trực ca qua Telegram và đăng tổng hợp toàn bộ vào kênh Slack #general',
        services: ['calendar', 'jira', 'github', 'trello', 'notion', 'sheets', 'telegram', 'slack'],
        tools: [
          'calendar.create_event',
          'jira.create_issue',
          'github.create_issue',
          'trello.create_card',
          'notion.create_page',
          'sheets.append_rows',
          'telegram.send_message',
          'slack.send_message'
        ],
        workflow: [
          'Google Calendar & Jira: Đặt lịch họp War-room và tạo ticket sự cố P1 đính kèm liên kết cuộc họp',
          'GitHub & Trello: Tạo issue kỹ thuật tham chiếu mã Jira và tạo thẻ theo dõi trên bảng Sprint',
          'Notion & Google Sheets: Lập trang biên bản tổng hợp tất cả liên kết và ghi dòng kiểm toán vào bảng tính',
          'Telegram & Slack: Gửi cảnh báo trực ca qua Telegram và đăng thông báo toàn diện vào kênh Slack #general'
        ],
        badge: 'Liên thông toàn diện'
      },
      {
        id: 'p16',
        category: 'sprint-bug',
        categoryLabel: 'Lỗi Sprint & Kỹ thuật',
        title: 'Đồng bộ phát hành Sprint qua 5 dịch vụ (Jira, GitHub, Trello, Sheets, Slack)',
        prompt: 'Tạo ticket phát hành trên Jira, mở issue checklist trên GitHub tham chiếu mã Jira, tạo thẻ triển khai trên Trello đính kèm link GitHub, ghi nhật ký phát hành vào bảng tính Google Sheets và gửi thông báo tổng hợp vào kênh Slack #general',
        services: ['jira', 'github', 'trello', 'sheets', 'slack'],
        tools: [
          'jira.create_issue',
          'github.create_issue',
          'trello.create_card',
          'sheets.append_rows',
          'slack.send_message'
        ],
        workflow: [
          'Jira & GitHub: Tạo ticket phát hành và mở checklist kiểm tra trên kho mã',
          'Trello & Google Sheets: Tạo thẻ theo dõi triển khai và ghi dòng nhật ký phát hành',
          'Slack: Đăng thông báo tổng hợp kèm toàn bộ đường dẫn phát hành vào #general'
        ],
        badge: 'Chuỗi 5 dịch vụ'
      },
      {
        id: 'p17',
        category: 'sprint-bug',
        categoryLabel: 'Lỗi Sprint & Kỹ thuật',
        title: 'Ứng cứu sự cố P1 qua 4 dịch vụ (Jira, Notion, Telegram, Slack)',
        prompt: 'Tạo ticket sự cố thanh toán P1 trên Jira, lập trang biên bản sự cố trên Notion kèm mã và liên kết Jira, gửi cảnh báo trực ca qua Telegram kèm liên kết biên bản và đăng tổng hợp vào kênh Slack #general',
        services: ['jira', 'notion', 'telegram', 'slack'],
        tools: [
          'jira.create_issue',
          'notion.create_page',
          'telegram.send_message',
          'slack.send_message'
        ],
        workflow: [
          'Jira: Tạo ticket sự cố P1 và lấy mã cùng liên kết trực tiếp',
          'Notion: Khởi tạo trang biên bản sự cố đính kèm thông tin từ Jira',
          'Telegram & Slack: Phát cảnh báo trực ca qua Telegram và đăng báo cáo tổng hợp vào Slack'
        ],
        badge: 'Chuỗi 4 dịch vụ'
      },
      {
        id: 'p18',
        category: 'reporting',
        categoryLabel: 'Báo cáo & Giao tiếp',
        title: 'Đặt lịch tự động mỗi sáng 08:00 điểm danh lịch họp Calendar và gửi bản tin Slack',
        prompt: 'Mỗi sáng 08:00 từ thứ 2 đến thứ 6, kiểm tra lịch họp Google Calendar trong ngày và gửi bản tóm tắt vào kênh Slack #general',
        services: ['calendar', 'slack'],
        tools: ['calendar.list_events', 'slack.send_message'],
        workflow: [
          'Lịch chạy tự động (0 8 * * 1-5): Kích hoạt mỗi sáng 08:00 các ngày làm việc theo múi giờ Asia/Ho_Chi_Minh',
          'Google Calendar & Slack: Đọc danh sách lịch họp trong ngày và tự động gửi bản tin tổng hợp vào kênh Slack'
        ],
        badge: 'Lịch chạy định kỳ'
      }
    ];

export const CAPABILITIES_DATA: Capability[] = [
      {
        id: 'trello',
        name: 'Trello',
        role: 'Quản lý bảng Kanban & Thẻ công việc',
        canDo: [
          'Tìm bảng, danh sách (list), thành viên và card',
          'Tạo card mới trong danh sách mong muốn',
          'Cập nhật card: đổi tên, mô tả, chuyển cột danh sách',
          'Lưu trữ card cũ an toàn (archive)',
          'Gán thành viên vào card',
          'Thêm checklist và các mục con cần làm'
        ],
        cannotDo: [
          'Xoá card',
          'Bình luận trên card'
        ]
      },
      {
        id: 'slack',
        name: 'Slack',
        role: 'Kênh giao tiếp & Thông báo tức thời',
        canDo: [
          'Tìm kênh công khai hoặc riêng tư (đã mời bot)',
          'Gửi tin nhắn văn bản',
          'Chèn liên kết trực tiếp tới các công cụ khác'
        ],
        cannotDo: [
          'Đọc lại tin đã gửi',
          'Gửi vào luồng thảo luận'
        ]
      },
      {
        id: 'github',
        name: 'GitHub',
        role: 'Quản lý kho mã & Theo dõi Issue lỗi',
        canDo: [
          'Tìm kiếm kho mã trong danh sách cho phép',
          'Xem và tìm kiếm các issue đang mở hoặc đã đóng',
          'Tạo issue mới với tiêu đề và mô tả chi tiết',
          'Gắn nhãn đã có sẵn trong kho',
          'Dẫn liên kết chéo tới card Trello và bảng tính'
        ],
        cannotDo: [
          'Đọc lịch sử thay đổi mã / pull request',
          'Đóng issue',
          'Gán người phụ trách'
        ]
      },
      {
        id: 'sheets',
        name: 'Google Sheets',
        role: 'Bảng tính trực tuyến & Lưu trữ bảng biểu',
        canDo: [
          'Xem danh sách các trang tính (tabs)',
          'Đọc dữ liệu trong các vùng ô xác định',
          'Thêm dòng mới vào cuối bảng tính (append row)',
          'Điền dữ liệu đúng theo thứ tự các cột sẵn có'
        ],
        cannotDo: [
          'Sửa hoặc xoá dòng đã có',
          'Mỗi lần thêm tối đa 20 dòng'
        ]
      },
      {
        id: 'calendar',
        name: 'Google Calendar',
        role: 'Lịch họp & Quản lý thời gian',
        canDo: [
          'Xem lịch và các sự kiện đã lên lịch',
          'Tạo sự kiện mới: đặt tiêu đề, thời gian bắt đầu, kết thúc',
          'Thêm mô tả và liên kết cuộc họp vào sự kiện'
        ],
        cannotDo: [
          'Mời người khác',
          'Sự kiện dài quá 24 giờ',
          'Sửa hoặc xoá sự kiện'
        ]
      },
      {
        id: 'notion',
        name: 'Notion',
        role: 'Không gian tài liệu, Database công việc & Biên bản họp',
        canDo: [
          'Kết nối OAuth 2.0 1-Click và chuyển đổi linh hoạt giữa nhiều Workspace Notion',
          'Tìm và truy vấn database theo từ khoá hoặc lọc theo cột trạng thái (Status / Select)',
          'Đọc chi tiết toàn văn nội dung trang (notion.get_page) cùng đầy đủ thuộc tính (status, multi_select, checkbox, date, number)',
          'Tạo trang mới, nối thêm đoạn văn bản và cập nhật trạng thái/thuộc tính trang (notion.update_page)',
          'Lên lịch Bản tin Notion tự động (Auto-Digest) phân loại mục Quá hạn/Bị chặn gửi qua Telegram hoặc Slack'
        ],
        cannotDo: [
          'Truy cập trang hoặc database nằm ngoài danh sách bạn đã cấp quyền',
          'Xoá vĩnh viễn database hoặc xoá khối nội dung đã viết'
        ]
      },
      {
        id: 'telegram',
        name: 'Telegram',
        role: 'Ghép đôi 1-Click, Đọc thảo luận nhóm & Bản tin tự động',
        canDo: [
          'Kết nối 1 chạm không cần tự tạo BotFather hay tìm Chat ID',
          'Tự động liệt kê chat cá nhân và các nhóm công việc bạn tham gia',
          'Đọc tin nhắn văn bản và tin nhắn ghim gần đây trong nhóm được cấp quyền',
          'Gửi báo cáo tiến độ liên dịch vụ và nhận Bản tin tự động (Auto-Digest) theo lịch'
        ],
        cannotDo: [
          'Đọc tin nhắn ở nhóm chưa cấp quyền hoặc bạn không phải thành viên',
          'Định dạng HTML/Markdown phức tạp hoặc quảng cáo trả phí'
        ]
      },
      {
        id: 'jira',
        name: 'Jira',
        role: 'Quản lý dự án, Điều phối Sprint & Vòng đời Issue (OAuth 3LO)',
        canDo: [
          'Kết nối OAuth 2.0 (3LO) 1-Click và tự khởi tạo Jira Workspace ngay trên giao diện',
          'Tìm project, lọc issue theo trạng thái/độ ưu tiên/loại và đọc chi tiết toàn văn issue (myjira.get_issue)',
          'Tạo issue mới (Task, Bug, Story) kèm Priority, Labels, Due Date, Assignee và Epic/Parent',
          'Chuyển trạng thái workflow (myjira.transition_issue: To Do → In Progress → Done) và cập nhật trường issue (myjira.update_issue)',
          'Thêm bình luận tiến độ và đặt lịch Bản tin Standup/Blocker chỉ đọc gửi sang Slack/Telegram'
        ],
        cannotDo: [
          'Xoá vĩnh viễn issue hoặc xoá project',
          'Thao tác trên site hoặc project ngoài phạm vi Workspace đã cấp phép'
        ]
      }
    ];

export const GUIDE_HERO_FLOW_SERVICES: string[] = ['github', 'trello', 'slack'];

export interface GuideOAuthShowcaseCard {
  service: string;
  title: string;
  badge: string;
  badgeStyle: 'oauth' | 'workspace';
  iconClassName: string;
  description: string;
}

export const GUIDE_OAUTH_SHOWCASE_CARDS: GuideOAuthShowcaseCard[] = [
  {
    service: 'mycalendar',
    title: 'Google Calendar',
    badge: 'Liên kết trực tiếp',
    badgeStyle: 'oauth',
    iconClassName: 'w-4 h-4',
    description: 'Liên kết lịch cá nhân, đặt cuộc họp Google Meet & nhận bản tin lịch sáng tự động.',
  },
  {
    service: 'trello',
    title: 'Trello cá nhân',
    badge: 'Liên kết trực tiếp',
    badgeStyle: 'oauth',
    iconClassName: 'w-4 h-4 text-[#0079BF]',
    description: 'Liên kết tài khoản và chọn đúng các bảng Trello được phép thao tác.',
  },
  {
    service: 'sheets',
    title: 'Google Sheets',
    badge: 'Chọn tệp từ Drive',
    badgeStyle: 'oauth',
    iconClassName: 'w-4 h-4 text-[#16A34A]',
    description: 'Chọn bảng tính từ Google Drive hoặc tạo bảng mặc định mới để đọc/ghi và lập báo cáo.',
  },
  {
    service: 'telegram',
    title: 'Telegram cá nhân & Nhóm',
    badge: 'Bản tin tự động',
    badgeStyle: 'oauth',
    iconClassName: 'w-4 h-4 text-[#229ED9]',
    description: 'Ghép nối nhanh với bot chính thức, đọc tin nhắn nhóm và nhận Bản tin sáng.',
  },
  {
    service: 'notion',
    title: 'Notion cá nhân & Wiki',
    badge: 'Chọn đúng phạm vi',
    badgeStyle: 'oauth',
    iconClassName: 'w-4 h-4 text-[#111827]',
    description: 'Liên kết tài khoản, đọc/cập nhật trang database và nhận Bản tin tiến độ mỗi sáng.',
  },
  {
    service: 'jira',
    title: 'Atlassian Jira Cloud',
    badge: 'Theo dự án nhóm',
    badgeStyle: 'oauth',
    iconClassName: 'w-4 h-4 text-[#0052CC]',
    description: 'Liên kết tài khoản Atlassian, tạo/chuyển trạng thái công việc và nhận Bản tin Standup sáng.',
  },
  {
    service: 'slack',
    title: 'Slack & GitHub',
    badge: 'Liên kết trực tiếp',
    badgeStyle: 'workspace',
    iconClassName: 'w-4 h-4 text-[#E11D48]',
    description: 'Liên kết kênh thảo luận nhóm và các kho mã dự án được phép sử dụng.',
  },
];
