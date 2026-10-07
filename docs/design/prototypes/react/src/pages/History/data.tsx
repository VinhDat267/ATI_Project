// Dữ liệu chép nguyên văn từ docs/design/prototypes/history.html bằng scripts/extract-data.mjs; kiểu và SAMPLE_REQUEST thêm bằng tay.
import type { ReactNode } from 'react';

export interface RequestStep { service: string; serviceName: string; actionTitle: string; targetLoc: string; badge: string; linkText: string; linkUrl: string }
export interface HistoryRequest {
  id: string; title: string; prompt: string; status: 'completed' | 'paused' | 'cancelled'; statusLabel: string;
  author: string; authorEmail: string; authorKey: string; timeStr: string; dateGroup: 'today' | 'yesterday' | 'earlier'; durationStr: string;
  services: string[]; summaryResult: string; safetyNotice: { type: 'success' | 'warn' | 'neutral'; text: string };
  steps: RequestStep[]; dataFlow: string; timelineLogs: string[];
}

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

export const INITIAL_REQUESTS: HistoryRequest[] = [
      {
        id: 'CV-042',
        title: 'Tạo card Trello, issue GitHub, cập nhật Sheets và Slack',
        prompt: 'Tạo card Trello cho lỗi đăng nhập Google, tạo issue GitHub, ghi vào Google Sheets và báo kênh Slack',
        status: 'completed', // 'completed' | 'paused' | 'cancelled'
        statusLabel: '✓ Hoàn tất',
        author: 'Lan Nguyễn',
        authorEmail: 'lan.nguyen@congty.vn',
        authorKey: 'lan_nguyen',
        timeStr: '14:02 · Hôm nay',
        dateGroup: 'today',
        durationStr: '3,8 giây',
        services: ['trello', 'github', 'sheets', 'slack'],
        summaryResult: 'Đã tạo card Doing · Issue #42 · Dòng 104 · Đã gửi kênh #ati-test',
        safetyNotice: {
          type: 'success',
          text: '✓ Kế hoạch được duyệt lúc 14:02 bởi Lan Nguyễn. Không ghi dữ liệu gì trước khi duyệt. Toàn bộ 4 đường dẫn biên nhận đã được xác nhận trực tiếp.'
        },
        steps: [
          {
            service: 'trello',
            serviceName: 'Trello',
            actionTitle: 'Tạo card "Sửa lỗi đăng nhập Google" trong danh sách Doing',
            targetLoc: 'Bảng To Do · Danh sách Doing',
            badge: '✓ Đã tạo card',
            linkText: 'Mở card ↗',
            linkUrl: '#trello-card'
          },
          {
            service: 'github',
            serviceName: 'GitHub',
            actionTitle: 'Tạo issue #42: Sửa lỗi đăng nhập Google (kèm link card Trello)',
            targetLoc: 'Kho VinhDat267/ati-test · Nhãn bug',
            badge: '✓ Đã tạo issue',
            linkText: 'Mở issue #42 ↗',
            linkUrl: '#github-issue-42'
          },
          {
            service: 'sheets',
            serviceName: 'Google Sheets',
            actionTitle: 'Thêm Dòng 104 vào trang Tasks với mã issue #42 và card Trello',
            targetLoc: 'Bảng tính ATI Test Tracker · Trang Tasks',
            badge: '✓ Đã ghi dòng',
            linkText: 'Mở trang tính ↗',
            linkUrl: '#google-sheets-104'
          },
          {
            service: 'slack',
            serviceName: 'Slack',
            actionTitle: 'Gửi tin nhắn thông báo vào kênh #ati-test có link card và issue',
            targetLoc: 'Kênh #ati-test (Slack Workspace)',
            badge: '✓ Đã gửi tin',
            linkText: 'Xem tin ↗',
            linkUrl: '#slack-msg'
          }
        ],
        dataFlow: 'Link card Trello được tạo trước → tự động truyền vào mô tả Issue GitHub #42 → cả hai đường dẫn được ghi vào Dòng 104 Google Sheets và gửi nguyên văn vào kênh Slack #ati-test.',
        timelineLogs: [
          '14:01:45 — Lan Nguyễn gửi câu yêu cầu tiếng Việt qua ô nhập.',
          '14:01:48 — ATI tìm đúng 4 công cụ (Bảng To Do, kho ati-test, bảng tính ATI Test Tracker, kênh #ati-test).',
          '14:02:10 — Lan Nguyễn bấm nút "Duyệt kế hoạch ✓".',
          '14:02:11 — Bước 1 hoàn thành trên Trello (đã tạo card Doing).',
          '14:02:12 — Bước 2 hoàn thành trên GitHub (đã tạo Issue #42).',
          '14:02:13 — Bước 3 hoàn thành trên Google Sheets (đã thêm Dòng 104).',
          '14:02:14 — Bước 4 hoàn thành trên Slack (đã gửi tin nhắn #ati-test).',
          '14:02:14 — Hoàn tất trọn vẹn trong 3,8 giây. Lưu trữ 4 biên nhận.'
        ]
      },
      {
        id: 'CV-041',
        title: 'Ghi biên bản họp sprint tuần 40 vào Notion và thông báo Slack',
        prompt: 'Ghi biên bản họp sprint tuần 40 vào Notion và thông báo kênh #ati-test',
        status: 'completed',
        statusLabel: '✓ Hoàn tất',
        author: 'Lan Nguyễn',
        authorEmail: 'lan.nguyen@congty.vn',
        authorKey: 'lan_nguyen',
        timeStr: '10:15 · Hôm nay',
        dateGroup: 'today',
        durationStr: '2,4 giây',
        services: ['notion', 'slack'],
        summaryResult: 'Đã tạo trang Sprint 40 trong Database Meetings · Đã gửi tin Slack #ati-test',
        safetyNotice: {
          type: 'success',
          text: '✓ Kế hoạch được duyệt lúc 10:15 bởi Lan Nguyễn. Không có thay đổi nào diễn ra trước lúc duyệt.'
        },
        steps: [
          {
            service: 'notion',
            serviceName: 'Notion',
            actionTitle: 'Tạo trang mới "Biên bản họp Sprint 40" trong database Sprint Notes',
            targetLoc: 'Database Sprint Notes (ID: db_sprint_notes)',
            badge: '✓ Đã tạo trang',
            linkText: 'Mở trang Notion ↗',
            linkUrl: '#notion-page'
          },
          {
            service: 'slack',
            serviceName: 'Slack',
            actionTitle: 'Gửi tin nhắn kèm đường dẫn trang Notion vào kênh #ati-test',
            targetLoc: 'Kênh #ati-test',
            badge: '✓ Đã gửi tin',
            linkText: 'Xem tin ↗',
            linkUrl: '#slack-msg-sprint'
          }
        ],
        dataFlow: 'Trang Notion tạo xong trả về đường dẫn URL → ATI đính kèm đường dẫn này vào tin nhắn gửi tới kênh Slack #ati-test.',
        timelineLogs: [
          '10:14:50 — Lan Nguyễn gửi yêu cầu tạo trang Notion và báo Slack.',
          '10:14:52 — ATI tìm đúng database Sprint Notes và kênh #ati-test.',
          '10:15:05 — Lan Nguyễn duyệt kế hoạch.',
          '10:15:06 — Tạo trang Notion thành công.',
          '10:15:07 — Gửi tin nhắn Slack thành công.',
          '10:15:07 — Kế hoạch hoàn tất.'
        ]
      },
      {
        id: 'CV-040',
        title: 'Tạo issue GitHub cho tính năng xuất PDF và cập nhật Sheets',
        prompt: 'Tạo issue GitHub cho tính năng xuất báo cáo PDF và cập nhật dòng 98 trên Sheets',
        status: 'paused',
        statusLabel: '⚠ Đã dừng khi đang ghi',
        author: 'Lan Nguyễn',
        authorEmail: 'lan.nguyen@congty.vn',
        authorKey: 'lan_nguyen',
        timeStr: '16:40 · Hôm qua',
        dateGroup: 'yesterday',
        durationStr: 'Đang tạm dừng',
        services: ['github', 'sheets'],
        summaryResult: 'Bước 1 GitHub #41 đã tạo xong · Bước 2 Sheets bị gián đoạn mạng, ATI dừng lại hỏi',
        safetyNotice: {
          type: 'warn',
          text: '⚠ Đường truyền mạng bị ngắt đúng lúc đang ghi lên Google Sheets. ATI đã dừng lại để hỏi Lan Nguyễn, tuyệt đối không tự làm lại để tránh ghi trùng lặp dữ liệu.'
        },
        steps: [
          {
            service: 'github',
            serviceName: 'GitHub',
            actionTitle: 'Tạo issue #41: Tính năng xuất báo cáo PDF',
            targetLoc: 'Kho VinhDat267/ati-test',
            badge: '✓ Đã tạo issue #41',
            linkText: 'Mở issue #41 ↗',
            linkUrl: '#github-issue-41'
          },
          {
            service: 'sheets',
            serviceName: 'Google Sheets',
            actionTitle: 'Cập nhật trạng thái tại Dòng 98 bảng tính Tasks',
            targetLoc: 'Bảng tính ATI Test Tracker',
            badge: '⚠ Đang dừng hỏi người dùng',
            linkText: 'Kiểm tra trên Sheets ↗',
            linkUrl: '#sheets-verify'
          }
        ],
        dataFlow: 'Issue GitHub #41 đã tạo an toàn. Dữ liệu sang Sheets bị ngắt kết nối giữa chừng và đang đợi người dùng kiểm tra xác nhận.',
        timelineLogs: [
          '16:39:50 — Lan Nguyễn duyệt kế hoạch gồm 2 bước.',
          '16:40:02 — Bước 1 hoàn thành: tạo issue #41 trên GitHub.',
          '16:40:12 — Bước 2 Google Sheets: mất kết nối đường truyền với máy chủ Sheets.',
          '16:40:13 — ATI kích hoạt cơ chế bảo vệ an toàn: dừng kế hoạch và gửi thông báo hỏi người dùng.'
        ]
      },
      {
        id: 'CV-039',
        title: 'Xoá hết các card cũ trong bảng To Do',
        prompt: 'Xoá hết các card cũ trong bảng To Do',
        status: 'cancelled',
        statusLabel: '✕ Đã từ chối',
        author: 'Lan Nguyễn',
        authorEmail: 'lan.nguyen@congty.vn',
        authorKey: 'lan_nguyen',
        timeStr: '11:20 · Hôm qua',
        dateGroup: 'yesterday',
        durationStr: 'Không ghi',
        services: ['trello'],
        summaryResult: 'Từ chối: ATI chưa có thao tác xoá card trên Trello. Đã gợi ý lưu trữ thay vì xoá.',
        safetyNotice: {
          type: 'neutral',
          text: '✕ Yêu cầu bị từ chối trước khi lập kế hoạch do thao tác chưa hỗ trợ. Chưa có bất kỳ dữ liệu nào bị thay đổi trên Trello.'
        },
        steps: [
          {
            service: 'trello',
            serviceName: 'Trello',
            actionTitle: 'Thao tác xoá card',
            targetLoc: 'Bảng To Do',
            badge: '✕ Chưa hỗ trợ thao tác xoá',
            linkText: 'Xem trợ giúp Trello ↗',
            linkUrl: 'responses.html'
          }
        ],
        dataFlow: 'Không có dữ liệu nào được gửi đi hoặc thay đổi.',
        timelineLogs: [
          '11:20:10 — Lan Nguyễn gửi yêu cầu "Xoá hết các card cũ trong bảng To Do".',
          '11:20:11 — Hệ thống kiểm tra danh mục quyền cho phép: Trello không hỗ trợ lệnh xoá hủy vĩnh viễn.',
          '11:20:11 — Trả lời từ chối và gợi ý lệnh thay thế: "Lưu trữ các card cũ trong bảng To Do".'
        ]
      },
      {
        id: 'CV-038',
        title: 'Ghi nhận phản hồi kiểm thử vào Sheets và tạo lịch review',
        prompt: 'Ghi nhận phản hồi kiểm thử vào Google Sheets và tạo sự kiện lịch review sprint',
        status: 'completed',
        statusLabel: '✓ Hoàn tất',
        author: 'Lan Nguyễn',
        authorEmail: 'lan.nguyen@congty.vn',
        authorKey: 'lan_nguyen',
        timeStr: '09:30 · 3 ngày trước',
        dateGroup: 'earlier',
        durationStr: '3,1 giây',
        services: ['sheets', 'calendar'],
        summaryResult: 'Đã thêm Dòng 103 trên Sheets · Đã tạo sự kiện "Review Sprint" vào Google Calendar',
        safetyNotice: {
          type: 'success',
          text: '✓ Kế hoạch được duyệt lúc 09:30 bởi Lan Nguyễn. Chỉ tác động vào bảng tính Tasks và Lịch nhóm được cấp phép.'
        },
        steps: [
          {
            service: 'sheets',
            serviceName: 'Google Sheets',
            actionTitle: 'Thêm Dòng 103 ghi nhận phản hồi kiểm thử hệ thống',
            targetLoc: 'Bảng tính ATI Test Tracker · Trang Tasks',
            badge: '✓ Đã ghi dòng',
            linkText: 'Mở trang tính ↗',
            linkUrl: '#sheets-103'
          },
          {
            service: 'calendar',
            serviceName: 'Google Calendar',
            actionTitle: 'Tạo sự kiện "Review Sprint 40" lúc 15:00 thứ Sáu',
            targetLoc: 'Lịch công việc ATI Team',
            badge: '✓ Đã tạo sự kiện',
            linkText: 'Mở lịch Google ↗',
            linkUrl: '#calendar-event'
          }
        ],
        dataFlow: 'Nội dung phản hồi được ghi vào Sheets trước → lấy tiêu đề nhiệm vụ để tạo sự kiện họp đánh giá trên Google Calendar.',
        timelineLogs: [
          '09:29:40 — Lan Nguyễn gửi câu yêu cầu.',
          '09:30:05 — Lan Nguyễn bấm duyệt kế hoạch.',
          '09:30:06 — Ghi dòng Google Sheets thành công.',
          '09:30:08 — Tạo sự kiện Google Calendar thành công.',
          '09:30:08 — Kế hoạch hoàn tất.'
        ]
      },
      {
        id: 'CV-037',
        title: 'Gửi tin nhắn thông báo bản build phát hành v2.4 lên Slack',
        prompt: 'Gửi tin nhắn thông báo bản build phát hành v2.4 lên kênh Slack #ati-test',
        status: 'completed',
        statusLabel: '✓ Hoàn tất',
        author: 'Lan Nguyễn',
        authorEmail: 'lan.nguyen@congty.vn',
        authorKey: 'lan_nguyen',
        timeStr: '17:15 · 4 ngày trước',
        dateGroup: 'earlier',
        durationStr: '1,2 giây',
        services: ['slack'],
        summaryResult: 'Đã gửi tin nhắn thông báo vào kênh #ati-test kèm ghi chú phát hành',
        safetyNotice: {
          type: 'success',
          text: '✓ Đã xem trước nguyên văn tin nhắn trước khi gửi. Đã gửi thành công vào kênh được cấp phép.'
        },
        steps: [
          {
            service: 'slack',
            serviceName: 'Slack',
            actionTitle: 'Gửi tin nhắn phát hành bản build v2.4',
            targetLoc: 'Kênh #ati-test',
            badge: '✓ Đã gửi tin',
            linkText: 'Xem tin ↗',
            linkUrl: '#slack-build-msg'
          }
        ],
        dataFlow: 'Tin nhắn gửi trực tiếp đến kênh Slack đã cấp phép.',
        timelineLogs: [
          '17:14:50 — Lan Nguyễn gửi yêu cầu thông báo bản build.',
          '17:15:02 — Lan Nguyễn xem trước nguyên văn tin nhắn và duyệt.',
          '17:15:03 — Tin nhắn xuất hiện trong kênh #ati-test.'
        ]
      }
    ];

// Hội thoại mẫu của addSampleRequest (id sinh ngẫu nhiên khi thêm).
export const SAMPLE_REQUEST: Omit<HistoryRequest, 'id'> = {
  title: 'Tạo thẻ Trello và gửi thông báo hoàn tất Slack',
  prompt: 'Tạo thẻ Trello trong danh sách Doing và gửi thông báo hoàn tất vào Slack #ati-test',
  status: 'completed',
  statusLabel: '✓ Hoàn tất',
  author: 'Lan Nguyễn',
  authorEmail: 'lan.nguyen@congty.vn',
  authorKey: 'lan_nguyen',
  timeStr: 'Vừa xong · Hôm nay',
  dateGroup: 'today',
  durationStr: '1,8 giây',
  services: ['trello', 'slack'],
  summaryResult: 'Đã tạo card Trello · Đã gửi tin nhắn xác nhận kênh #ati-test',
  safetyNotice: {
    type: 'success',
    text: '✓ Kế hoạch vừa hoàn thành an toàn. Toàn bộ các bước đều tuân thủ nguyên tắc chỉ làm sau khi duyệt.'
  },
  steps: [
    {
      service: 'trello',
      serviceName: 'Trello',
      actionTitle: 'Tạo card "Cập nhật tài liệu kỹ thuật"',
      targetLoc: 'Bảng To Do · Danh sách Doing',
      badge: '✓ Đã tạo card',
      linkText: 'Mở card ↗',
      linkUrl: '#trello-new'
    },
    {
      service: 'slack',
      serviceName: 'Slack',
      actionTitle: 'Gửi tin nhắn vào kênh #ati-test',
      targetLoc: 'Kênh #ati-test',
      badge: '✓ Đã gửi tin',
      linkText: 'Xem tin ↗',
      linkUrl: '#slack-new'
    }
  ],
  dataFlow: 'Tạo card Trello thành công rồi chuyển đường dẫn sang gửi kênh Slack #ati-test.',
  timelineLogs: [
    'Vừa xong — Lan Nguyễn gửi câu yêu cầu.',
    'Vừa xong — Lan Nguyễn duyệt kế hoạch hành động.',
    'Vừa xong — Hoàn tất 2/2 việc liên dịch vụ.'
  ]
};
