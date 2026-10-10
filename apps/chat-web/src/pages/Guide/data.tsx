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
        keys: ['API key', 'API token'],
        scopeLabel: 'Board ID',
        sampleScope: '5f1a2b3c4d5e6f7a8b9c0d1e',
        timeEstimate: 'Khoảng 2 phút',
        summary: 'Tạo và cập nhật card, gán thành viên, thêm checklist trên bảng công việc của nhóm.',
        importantNotice: 'ATI chỉ đọc và ghi trên đúng Board ID bạn cấp. Card đã xong được lưu trữ chứ không bao giờ bị xoá mất.',
        steps: [
          {
            num: 1,
            title: 'Truy cập cổng quản lý Trello Power-Up',
            desc: 'Đăng nhập vào Trello, sau đó mở trang quản lý tích hợp tại <a href="https://trello.com/power-ups/admin" target="_blank" rel="noopener noreferrer" class="text-[#0079BF] font-medium underline">trello.com/power-ups/admin</a> (hoặc trello.com/app-key).',
            callout: 'Nếu bạn chưa có Power-Up nào, bấm "New" và đặt tên là "ATI Automation".'
          },
          {
            num: 2,
            title: 'Sao chép API Key',
            desc: 'Tại mục "API Key", bạn sẽ thấy một chuỗi ký tự 32 chữ số. Bấm nút sao chép và dán vào ô "API key" trong Cài đặt của ATI.',
            callout: 'Khoá này dùng để nhận diện ứng dụng của bạn với máy chủ Trello.'
          },
          {
            num: 3,
            title: 'Tạo và lấy API Token',
            desc: 'Ngay cạnh ô API Key, bấm vào liên kết có chữ "Token" (hoặc Generate a Token). Một màn hình xin quyền mở ra, cuộn xuống và bấm nút "Allow".',
            callout: 'Sao chép chuỗi mã Token dài hiển thị trên màn hình và dán vào ô "API token" của ATI.'
          },
          {
            num: 4,
            title: 'Lấy Board ID (Nơi được phép dùng)',
            desc: 'Mở bảng Trello, thêm .json vào cuối địa chỉ (ví dụ https://trello.com/b/AbCd1234/to-do.json), tìm trường "id" đầu tiên (24 ký tự chữ và số) và dán vào danh sách Board ID.',
            callout: 'Ví dụ ID mẫu: 5f1a2b3c4d5e6f7a8b9c0d1e'
          }
        ]
      },
      slack: {
        id: 'slack',
        name: 'Slack',
        category: 'Giao tiếp & Kênh thông báo nhóm',
        keys: ['Bot token'],
        scopeLabel: 'Channel ID',
        sampleScope: 'C07DEMO9X1 (#ati-test)',
        timeEstimate: 'Khoảng 3 phút',
        summary: 'Gửi tin nhắn thông báo vào các kênh công khai hoặc riêng tư khi việc trên các công cụ khác hoàn thành.',
        importantNotice: 'Bắt buộc mời bot vào kênh trước! Sau khi tạo, hãy gõ lệnh /invite @ATI trong kênh bạn muốn gửi tin.',
        steps: [
          {
            num: 1,
            title: 'Tạo ứng dụng Slack mới',
            desc: 'Truy cập trang nhà phát triển Slack tại <a href="https://api.slack.com/apps" target="_blank" rel="noopener noreferrer" class="text-[#36C5F0] font-medium underline">api.slack.com/apps</a>. Bấm nút "Create New App" > chọn "From scratch". Đặt tên "ATI Bot" và chọn Workspace nhóm.',
            callout: 'Chọn đúng không gian làm việc của công ty bạn.'
          },
          {
            num: 2,
            title: 'Cấp quyền hạn tối thiểu (Bot Scopes)',
            desc: 'Ở menu bên trái, bấm vào "OAuth & Permissions". Cuộn xuống mục "Scopes" > "Bot Token Scopes" và bấm "Add an OAuth Scope". Thêm các quyền:',
            tags: ['chat:write (gửi tin)', 'channels:read (xem kênh chung)', 'groups:read (xem kênh riêng)'],
            callout: 'Chỉ cần quyền chat:write là đủ để bot gửi tin. Không cấp thêm quyền quản trị.'
          },
          {
            num: 3,
            title: 'Cài đặt vào Workspace & lấy Bot Token',
            desc: 'Cuộn lên đầu trang "OAuth & Permissions", bấm nút "Install to Workspace" và bấm "Allow". Sau đó sao chép chuỗi "Bot User OAuth Token" bắt đầu bằng chữ "xoxb-".',
            callout: 'Dán chuỗi bắt đầu bằng xoxb- vào ô "Bot token" trong ATI.'
          },
          {
            num: 4,
            title: 'Lấy Channel ID & Mời bot vào kênh',
            desc: 'Mở ứng dụng Slack trên máy tính, chuột phải vào tên kênh (ví dụ #ati-test) > chọn "View channel details" (Xem chi tiết kênh). Cuộn xuống đáy cùng để thấy "Channel ID" (bắt đầu bằng chữ C, ví dụ C07DEMO9X1).',
            callout: 'Đừng quên: Gõ lệnh /invite @ATI Bot trong kênh đó để bot có quyền gửi tin!'
          }
        ]
      },
      github: {
        id: 'github',
        name: 'GitHub',
        category: 'Kho mã nguồn & Quản lý Issue lỗi',
        keys: ['Personal access token'],
        scopeLabel: 'Repository (chủ/tên-kho)',
        sampleScope: 'VinhDat267/ati-test',
        timeEstimate: 'Khoảng 2 phút',
        summary: 'Tìm kho mã, đọc và tạo issue lỗi, gắn nhãn (bug, defect), liên kết chéo với card Trello.',
        importantNotice: 'ATI không bao giờ xoá repository, không merge code, và chỉ thao tác trên issue thuộc kho bạn cho phép.',
        steps: [
          {
            num: 1,
            title: 'Vào cài đặt mã truy cập cá nhân',
            desc: 'Đăng nhập GitHub, bấm vào ảnh đại diện góc trên cùng bên phải > chọn "Settings". Ở menu bên trái, cuộn xuống dưới cùng chọn "Developer settings" > "Personal access tokens" > "Tokens (classic)".',
            callout: 'Đường dẫn trực tiếp: github.com/settings/tokens'
          },
          {
            num: 2,
            title: 'Tạo mã truy cập mới (Token)',
            desc: 'Bấm nút "Generate new token" (chọn Generate new token classic). Đặt tên ghi chú (Note) là "ATI Automation". Chọn thời hạn (Expiration) theo nhu cầu.',
            callout: 'Tích chọn đúng phạm vi quyền duy nhất: "repo" (toàn quyền quản lý issue và đọc kho mã).'
          },
          {
            num: 3,
            title: 'Sao chép mã ghp_...',
            desc: 'Cuộn xuống cuối trang bấm "Generate token". GitHub sẽ hiển thị chuỗi mã bắt đầu bằng "ghp_". Hãy sao chép ngay lập tức.',
            callout: 'GitHub chỉ hiển thị mã này MỘT LẦN duy nhất. Dán ngay vào ô "Personal access token" trên ATI.'
          },
          {
            num: 4,
            title: 'Điền tên Repository được phép',
            desc: 'Nhập tên kho mã dưới định dạng "tên_chủ_sở_hữu/tên_kho_mã". Ví dụ tài khoản là VinhDat267 và kho là ati-test thì điền:',
            urlSample: 'VinhDat267/ati-test',
            callout: 'Bạn có thể thêm nhiều kho mã bằng cách bấm "Thêm nơi được dùng".'
          }
        ]
      },
      sheets: {
        id: 'sheets',
        name: 'Google Sheets',
        category: 'Bảng tính trực tuyến & Lưu trữ công việc',
        keys: ['Email service account', 'Private key (PEM)'],
        scopeLabel: 'Spreadsheet ID',
        sampleScope: '1BxiMVs0XRA5nFMdKvBIIl_demo',
        timeEstimate: 'Khoảng 4 phút',
        summary: 'Xem danh sách tab, đọc dữ liệu các vùng ô và thêm dòng mới vào bảng tính nhiệm vụ.',
        importantNotice: 'Bắt buộc chia sẻ bảng tính cho Email Service Account và cấp quyền "Người chỉnh sửa" (Editor)!',
        steps: [
          {
            num: 1,
            title: 'Tạo tài khoản dịch vụ trên Google Cloud',
            desc: 'Mở Google Cloud Console tại <a href="https://console.cloud.google.com" target="_blank" rel="noopener noreferrer" class="text-[#0F9D58] font-medium underline">console.cloud.google.com</a>. Bật thư viện "Google Sheets API" trong mục "APIs & Services".',
            callout: 'Vào "IAM & Admin" > "Service Accounts", bấm "Create Service Account", đặt tên "ati-sheets-bot" và bấm Done.'
          },
          {
            num: 2,
            title: 'Tạo file khoá JSON và lấy Private Key',
            desc: 'Bấm vào tài khoản dịch vụ vừa tạo > chọn tab "Keys" > "Add Key" > "Create new key" > chọn định dạng JSON và tải về máy.',
            callout: 'Mở file JSON bằng Notepad: sao chép giá trị "client_email" vào ô Email, và toàn bộ khối "private_key" (kể cả -----BEGIN PRIVATE KEY-----) vào ô Private key.'
          },
          {
            num: 3,
            title: 'Lấy Spreadsheet ID từ đường link',
            desc: 'Mở bảng tính Google Sheets bạn muốn dùng trên trình duyệt (ví dụ ATI Test Tracker). Nhìn lên thanh địa chỉ:',
            urlSample: 'https://docs.google.com/spreadsheets/d/[MÃ_SPREADSHEET_ID]/edit',
            callout: 'Sao chép đoạn ký tự dài giữa "/d/" và "/edit" dán vào ô "Spreadsheet ID" trên ATI.'
          },
          {
            num: 4,
            title: 'Chia sẻ bảng tính cho Email Service Account',
            desc: 'Bấm nút "Chia sẻ" (Share) màu xanh góc phải bảng tính Google Sheets. Dán địa chỉ email dạng "...@...iam.gserviceaccount.com" vào và cấp quyền "Người chỉnh sửa" (Editor).',
            callout: 'Nếu không chia sẻ, Google sẽ từ chối và báo lỗi không có quyền ghi.'
          }
        ]
      },
      calendar: {
        id: 'calendar',
        name: 'Google Calendar',
        category: 'Lịch họp & Sự kiện nhóm',
        keys: ['Email service account', 'Private key (PEM)'],
        scopeLabel: 'Calendar ID',
        sampleScope: 'team-calendar@group.calendar.google.com',
        timeEstimate: 'Khoảng 2 phút (dùng chung khoá Sheets)',
        summary: 'Xem lịch, kiểm tra thời gian trống và tạo sự kiện lịch họp cho các mốc sprint.',
        importantNotice: 'Dùng chung Email Service Account và Private Key của Google Sheets. Chỉ cần chia sẻ thêm Lịch của bạn.',
        steps: [
          {
            num: 1,
            title: 'Bật Google Calendar API trên Google Cloud',
            desc: 'Trong cùng dự án Google Cloud Console đã tạo ở bước Google Sheets, vào thư viện API và bật thêm "Google Calendar API".',
            callout: 'Bạn dùng lại đúng Email Service Account và Private Key (PEM) đã có từ Google Sheets.'
          },
          {
            num: 2,
            title: 'Lấy Calendar ID từ Google Calendar',
            desc: 'Mở Google Calendar trên máy tính (<a href="https://calendar.google.com" target="_blank" rel="noopener noreferrer" class="text-[#4285F4] font-medium underline">calendar.google.com</a>). Ở cột trái, rê chuột vào Lịch của bạn > bấm dấu ba chấm > "Cài đặt và chia sẻ" (Settings and sharing).',
            callout: 'Cuộn xuống mục "Tích hợp lịch" (Integrate calendar) để sao chép "Mã lịch" (Calendar ID).'
          },
          {
            num: 3,
            title: 'Chia sẻ Lịch cho Email Service Account',
            desc: 'Tại trang Cài đặt lịch đó, cuộn lên mục "Chia sẻ với những người hoặc nhóm cụ thể", bấm "Thêm người", dán Email Service Account vào và chọn quyền "Thực hiện thay đổi cho các sự kiện".',
            callout: 'Điều này cho phép ATI tạo sự kiện mới vào lịch của bạn mà không cần hỏi lại mật khẩu.'
          }
        ]
      },
      notion: {
        id: 'notion',
        name: 'Notion',
        category: 'Tài liệu, Wiki & Biên bản cuộc họp',
        keys: ['Internal integration token'],
        scopeLabel: 'Database ID',
        sampleScope: '1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d',
        timeEstimate: 'Khoảng 3 phút',
        summary: 'Tìm database, đọc page, tạo page biên bản họp mới và nối nội dung tóm tắt.',
        importantNotice: 'Sau khi tạo Integration, bắt buộc phải vào Database Notion bấm dấu ba chấm > "Connect to" > chọn ATI!',
        steps: [
          {
            num: 1,
            title: 'Tạo Integration mới trên Notion',
            desc: 'Đăng nhập tài khoản Notion, mở trang quản lý tích hợp tại <a href="https://www.notion.so/profile/integrations" target="_blank" rel="noopener noreferrer" class="text-neutral-900 font-medium underline">notion.so/profile/integrations</a>. Bấm "New integration", đặt tên là "ATI Notion", chọn đúng Workspace của nhóm và bấm Save.',
            callout: 'Chọn quyền mặc định: Read content, Update content, Insert content.'
          },
          {
            num: 2,
            title: 'Sao chép Internal Integration Secret',
            desc: 'Sau khi lưu, Notion hiển thị chuỗi "Internal Integration Secret" bắt đầu bằng "secret_" hoặc "ntn_". Bấm nút Show rồi Copy chuỗi này.',
            callout: 'Dán chuỗi này vào ô "Internal integration token" trong Cài đặt của ATI.'
          },
          {
            num: 3,
            title: 'Lấy Database ID từ URL',
            desc: 'Mở Database bạn muốn dùng trên Notion dưới dạng trang đầy đủ (Full page). Nhìn lên thanh địa chỉ trình duyệt:',
            urlSample: 'https://notion.so/workspace/[MÃ_DATABASE_ID_32_KÝ_TỰ]?v=...',
            callout: 'Sao chép chuỗi 32 ký tự nằm giữa tên workspace và dấu hỏi chấm "?".'
          },
          {
            num: 4,
            title: 'Kết nối Integration vào Database',
            desc: 'Tại trang Database đó trên Notion, bấm vào dấu ba chấm (...) ở góc trên cùng bên phải > cuộn xuống mục "Connections" (hoặc "Connect to") > tìm và bấm chọn "ATI Notion".',
            callout: 'Nếu không làm bước này, Notion sẽ chặn và báo lỗi "Object not found" vì lý do bảo mật.'
          }
        ]
      },
      telegram: {
        id: 'telegram',
        name: 'Telegram',
        category: 'Thông báo tin nhắn nhanh & Nhóm chat',
        keys: ['Bot token (BotFather)'],
        scopeLabel: 'Chat ID',
        sampleScope: '-1002489102931',
        timeEstimate: 'Khoảng 2 phút',
        summary: 'Gửi tin nhắn văn bản thông báo tiến độ vào nhóm chat hoặc kênh Telegram của nhóm.',
        importantNotice: 'Bot phải được thêm vào nhóm chat trước thì mới gửi tin vào nhóm đó được.',
        steps: [
          {
            num: 1,
            title: 'Nói chuyện với BotFather trên Telegram',
            desc: 'Mở Telegram và tìm kiếm tài khoản chính thức <code class="bg-neutral-100 px-1 py-0.5 rounded font-mono">@BotFather</code> (có tích xanh). Bấm Start và gửi lệnh <code class="bg-neutral-100 px-1 py-0.5 rounded font-mono">/newbot</code>.',
            callout: 'Làm theo hướng dẫn: Đặt tên cho bot (ví dụ: ATI Alert) và username kết thúc bằng _bot (ví dụ: ati_alert_bot).'
          },
          {
            num: 2,
            title: 'Sao chép Bot Token từ tin nhắn phản hồi',
            desc: 'BotFather sẽ gửi lại một tin nhắn chúc mừng kèm chuỗi mã HTTP API Token (dạng <code class="bg-neutral-100 px-1 py-0.5 rounded font-mono">123456789:ABCdef...</code>). Sao chép chuỗi này dán vào ô "Bot token" của ATI.',
            callout: 'Không chia sẻ token này cho người lạ.'
          },
          {
            num: 3,
            title: 'Thêm bot vào nhóm chat của bạn',
            desc: 'Mở nhóm chat Telegram của bạn, bấm vào tên nhóm > "Add Members" > tìm username của bot vừa tạo và thêm bot vào nhóm.',
            callout: 'Bot cần có quyền gửi tin nhắn văn bản cơ bản trong nhóm.'
          },
          {
            num: 4,
            title: 'Lấy Chat ID của nhóm',
            desc: 'Thêm bot <code class="bg-neutral-100 px-1 py-0.5 rounded font-mono">@getmyid_bot</code> hoặc <code class="bg-neutral-100 px-1 py-0.5 rounded font-mono">@userinfobot</code> vào nhóm, bot đó sẽ gửi tin nhắn báo mã Chat ID (thường là số âm có dạng <code class="bg-neutral-100 px-1 py-0.5 rounded font-mono">-100...</code>).',
            callout: 'Dán mã số âm đó vào danh sách "Chat ID" trên ATI, sau đó bạn có thể xoá bot lấy ID ra khỏi nhóm.'
          }
        ]
      },
      jira: {
        id: 'jira',
        name: 'Jira',
        category: 'Quản lý dự án phát triển phần mềm',
        keys: ['Site URL', 'Email Atlassian', 'API token'],
        scopeLabel: 'Project key',
        sampleScope: 'ATI',
        timeEstimate: 'Khoảng 3 phút',
        summary: 'Tìm project, tạo issue task/bug mới và thêm bình luận vào issue của nhóm.',
        importantNotice: 'Site URL bắt buộc phải có dạng https://ten-site.atlassian.net. Không điền link phụ.',
        steps: [
          {
            num: 1,
            title: 'Tạo Atlassian API Token',
            desc: 'Đăng nhập tài khoản Atlassian của bạn tại <a href="https://id.atlassian.com/manage-profile/security/api-tokens" target="_blank" rel="noopener noreferrer" class="text-[#0052CC] font-medium underline">id.atlassian.com/manage-profile/security/api-tokens</a>. Bấm "Create API token", đặt nhãn "ATI Automation" và bấm Create.',
            callout: 'Sao chép chuỗi token được sinh ra và dán vào ô "API token" trên ATI.'
          },
          {
            num: 2,
            title: 'Điền Site URL & Email tài khoản',
            desc: 'Điền địa chỉ website Jira của công ty bạn (dạng: <code class="bg-neutral-100 px-1 py-0.5 rounded font-mono">https://ten-cong-ty.atlassian.net</code>) vào ô "Site URL", và email đăng nhập Atlassian vào ô "Email Atlassian".',
            callout: 'Hệ thống tự động kiểm tra định dạng .atlassian.net hợp lệ.'
          },
          {
            num: 3,
            title: 'Lấy Project Key của dự án',
            desc: 'Mở dự án của bạn trên Jira. Project key chính là mã chữ in hoa viết tắt đứng trước các số issue (ví dụ issue có mã là <code class="bg-neutral-100 px-1 py-0.5 rounded font-mono">ATI-42</code> thì Project key là <code class="bg-neutral-100 px-1 py-0.5 rounded font-mono">ATI</code>).',
            callout: 'Thêm mã Project key này vào danh sách nơi được phép trên ATI.'
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
        title: 'Gửi thông báo tiến độ vào nhóm Telegram',
        prompt: 'Gửi tin nhắn Telegram vào nhóm Vận hành thông báo hệ thống đã cập nhật xong các báo cáo tuần',
        services: ['telegram'],
        tools: ['telegram.list_chats', 'telegram.send_message'],
        workflow: [
          'Telegram: Gửi tin nhắn văn bản thuần vào đúng Chat ID nhóm vận hành'
        ]
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
        role: 'Không gian tài liệu & Biên bản làm việc',
        canDo: [
          'Tìm database trong danh sách đã cấp quyền kết nối',
          'Đọc các page trong database (thuộc tính dạng chữ)',
          'Tạo trang mới trong database (ví dụ: Biên bản họp)',
          'Thêm các đoạn văn bản tóm tắt nội dung'
        ],
        cannotDo: [
          'Database có nhiều nguồn dữ liệu',
          'Sửa page ngoài việc nối thêm văn bản'
        ]
      },
      {
        id: 'telegram',
        name: 'Telegram',
        role: 'Nhóm chat & Thông báo tin tức nhanh',
        canDo: [
          'Đọc thông tin nhóm chat đã thêm bot',
          'Gửi tin nhắn văn bản thông báo tiến độ vào nhóm'
        ],
        cannotDo: [
          'Định dạng chữ (đậm, nghiêng, link xem trước)'
        ]
      },
      {
        id: 'jira',
        name: 'Jira',
        role: 'Quản lý dự án & Quy trình phát triển',
        canDo: [
          'Tìm project và issue trong phạm vi cấp phép',
          'Tạo issue mới (loại Task, Bug, Story)',
          'Thêm bình luận (comment) cập nhật tiến độ vào issue'
        ],
        cannotDo: [
          'Chuyển trạng thái issue',
          'Xoá issue'
        ]
      }
    ];
