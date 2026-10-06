// Dữ liệu chép nguyên văn từ docs/design/prototypes/settings.html bằng scripts/extract-data.mjs; kiểu khai thêm bằng tay.
import type { ReactNode } from 'react';

export interface KeyInput { id: string; label: string; type: string; placeholder: string }
export interface Service { id: string; name: string; configured: boolean; statusType: 'untested' | 'ok' | 'failed'; lastCheckTime: string | null; capabilities: string; keyHelp: string; hint: string | null; scopeLabel: string; scopeItems: string[]; keyInputs: KeyInput[] }

export const SERVICE_SVGS: Record<string, ReactNode> = {
  trello: (
    <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none">
      <rect width="24" height="24" rx="4" fill="#0079BF" />
      <rect x="4" y="4" width="6.5" height="13" rx="1.5" fill="white" />
      <rect x="13.5" y="4" width="6.5" height="8.5" rx="1.5" fill="white" />
    </svg>
  ),
  slack: (
    <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none">
      <path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zM6.313 15.165a2.528 2.528 0 0 1 2.521-2.52 2.528 2.528 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313z" fill="#E01E5A" />
      <path d="M8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zM8.834 6.313a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312z" fill="#36C5F0" />
      <path d="M18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zM17.688 8.834a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312z" fill="#2EB67D" />
      <path d="M15.165 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zM15.165 17.688a2.528 2.528 0 0 1-2.52-2.523 2.528 2.528 0 0 1 2.52-2.52h6.313A2.528 2.528 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z" fill="#ECB22E" />
    </svg>
  ),
  github: (
    <svg className="w-6 h-6 text-[#24292E]" fill="currentColor" viewBox="0 0 24 24">
      <path fillRule="evenodd" clipRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" />
    </svg>
  ),
  sheets: (
    <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z" fill="#0F9D58" />
      <path d="M14 2v6h6l-6-6z" fill="#87CEAB" />
      <rect x="7" y="11" width="10" height="7" rx="0.5" fill="white" fillOpacity="0.3" />
      <line x1="7" y1="14" x2="17" y2="14" stroke="white" strokeWidth="1" />
      <line x1="11" y1="11" x2="11" y2="18" stroke="white" strokeWidth="1" />
    </svg>
  ),
  calendar: (
    <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none">
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
    <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none">
      <path fillRule="evenodd" clipRule="evenodd" d="M4.222 3.125l13.774-1.12c1.38-.112 1.954.267 2.502.933l2.808 3.444c.433.533.693 1.155.693 1.777v12.22c0 1.2-.544 1.866-1.843 1.977l-14.88 1.111c-1.378.111-2.04-.333-2.589-1l-2.016-2.555c-.443-.555-.67-1.222-.67-1.778V4.88c0-1.111.66-1.666 2.22-1.755zm14.153 1.867L7.332 5.88c-.328.026-.453.18-.453.373v11.758c0 .24.125.4.375.373l11.043-.88c.328-.027.422-.24.422-.453V5.419c0-.24-.125-.4-.344-.427zM9.47 7.915l3.593-.24 3.03 5.467V7.435l2.25-.16v8.425l-3.375.24-3.25-5.653v5.626l-2.25.16V7.915z" fill="#111827" />
    </svg>
  ),
  telegram: (
    <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="11" fill="#229ED9" />
      <path d="M17.5 7.5L5.5 12.1L9.5 13.6L14.7 10.3C14.9 10.2 15.1 10.4 15 10.6L10.8 14.4V17.5L12.9 15.5L16.2 17.9C16.8 18.2 17.2 17.9 17.4 17.2L19.4 8.2C19.6 7.3 18.9 6.8 17.5 7.5Z" fill="white" />
    </svg>
  ),
  jira: (
    <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none">
      <path d="M11.53 2C11.53 7.26 7.26 11.53 2 11.53C7.26 11.53 11.53 15.8 11.53 21.06C11.53 15.8 15.8 11.53 21.06 11.53C15.8 11.53 11.53 7.26 11.53 2Z" fill="#0052CC" />
      <path d="M11.53 2C11.53 4.63 9.4 6.76 6.77 6.76C9.4 6.76 11.53 8.89 11.53 11.52C11.53 8.89 13.66 6.76 16.29 6.76C13.66 6.76 11.53 4.63 11.53 2Z" fill="#2684FF" />
    </svg>
  ),
};

export const INITIAL_SERVICES_DATA: Service[] = [
      {
        id: 'trello',
        name: 'Trello',
        configured: true,
        statusType: 'ok', // 'untested' | 'ok' | 'failed'
        lastCheckTime: '14:05',
        capabilities: 'Tìm bảng, danh sách, thành viên, card; tạo/cập nhật card, gán thành viên, thêm checklist.',
        keyHelp: 'Đăng nhập Trello, truy cập trello.com/power-ups/admin để tạo Power-Up và lấy API key, sau đó tạo API token kèm theo.',
        hint: null,
        scopeLabel: 'Board ID',
        scopeItems: ['board_todo_demo_8f'],
        keyInputs: [
          { id: 'key_1', label: 'API key', type: 'text', placeholder: 'Đã lưu · nhập lại nếu muốn thay' },
          { id: 'key_2', label: 'API token', type: 'password', placeholder: 'Đã lưu · nhập lại nếu muốn thay' }
        ]
      },
      {
        id: 'slack',
        name: 'Slack',
        configured: true,
        statusType: 'ok',
        lastCheckTime: '14:05',
        capabilities: 'Tìm kênh; gửi tin nhắn.',
        keyHelp: 'Truy cập api.slack.com/apps, tạo App trong Workspace, vào OAuth & Permissions để cấp quyền và sao chép Bot User OAuth Token (xoxb-).',
        hint: 'Gợi ý: Mời bot vào kênh Slack trước khi thực hiện gửi tin.',
        scopeLabel: 'Channel ID',
        scopeItems: ['C07DEMO9X1'],
        keyInputs: [
          { id: 'key_1', label: 'Bot token', type: 'password', placeholder: 'Đã lưu · nhập lại nếu muốn thay' }
        ]
      },
      {
        id: 'github',
        name: 'GitHub',
        configured: true,
        statusType: 'ok',
        lastCheckTime: '14:05',
        capabilities: 'Tìm kho, xem/tìm issue; tạo issue, gắn nhãn.',
        keyHelp: 'Vào github.com/settings/tokens (Personal access tokens), chọn Tokens (classic) hoặc Fine-grained, cấp quyền "repo" để tạo token.',
        hint: null,
        scopeLabel: 'Repository (chủ/tên-kho)',
        scopeItems: ['VinhDat267/ati-test'],
        keyInputs: [
          { id: 'key_1', label: 'Personal access token', type: 'password', placeholder: 'Đã lưu · nhập lại nếu muốn thay' }
        ]
      },
      {
        id: 'sheets',
        name: 'Google Sheets',
        configured: true,
        statusType: 'ok',
        lastCheckTime: '14:05',
        capabilities: 'Xem bảng tính, tab, đọc vùng ô; thêm dòng.',
        keyHelp: 'Truy cập Google Cloud Console, tạo Service Account trong IAM & Admin, tạo khoá định dạng JSON rồi sao chép Email và Private key (PEM).',
        hint: 'Gợi ý: Nhớ chia sẻ bảng tính cho Email Service Account với quyền Chỉnh sửa (Editor).',
        scopeLabel: 'Spreadsheet ID',
        scopeItems: ['1BxiMVs0XRA5nFMdKvBIIl_demo'],
        keyInputs: [
          { id: 'key_1', label: 'Email service account', type: 'email', placeholder: 'Đã lưu · nhập lại nếu muốn thay' },
          { id: 'key_2', label: 'Private key (PEM)', type: 'textarea', placeholder: 'Đã lưu · nhập lại nếu muốn thay' }
        ]
      },
      {
        id: 'calendar',
        name: 'Google Calendar',
        configured: false,
        statusType: 'untested',
        lastCheckTime: null,
        capabilities: 'Xem lịch và sự kiện; tạo sự kiện (không mời người khác).',
        keyHelp: 'Dùng chung Service Account với Google Sheets trong Google Cloud Console, bật Google Calendar API và chia sẻ lịch cho Email Service Account.',
        hint: 'Gợi ý: Chia sẻ lịch Google cho Email Service Account với quyền Make changes to events.',
        scopeLabel: 'Calendar ID',
        scopeItems: [],
        keyInputs: [
          { id: 'key_1', label: 'Email service account', type: 'email', placeholder: 'service-account@project.iam.gserviceaccount.com' },
          { id: 'key_2', label: 'Private key (PEM)', type: 'textarea', placeholder: '-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQC...\n-----END PRIVATE KEY-----' }
        ]
      },
      {
        id: 'notion',
        name: 'Notion',
        configured: false,
        statusType: 'untested',
        lastCheckTime: null,
        capabilities: 'Tìm database, đọc page; tạo page, nối văn bản.',
        keyHelp: 'Truy cập notion.so/my-integrations, tạo Internal integration để lấy token bí mật, sau đó mở database trong Notion và thêm connection này.',
        hint: 'Gợi ý: Mở trang hoặc database trong Notion > chọn nút ⋯ > Connections > Thêm integration bạn vừa tạo.',
        scopeLabel: 'Database ID',
        scopeItems: [],
        keyInputs: [
          { id: 'key_1', label: 'Internal integration token', type: 'password', placeholder: 'secret_...' }
        ]
      },
      {
        id: 'telegram',
        name: 'Telegram',
        configured: false,
        statusType: 'untested',
        lastCheckTime: null,
        capabilities: 'Đọc thông tin chat; gửi tin nhắn văn bản.',
        keyHelp: 'Mở ứng dụng Telegram, nhắn tin cho tài khoản @BotFather bằng lệnh /newbot để tạo bot và nhận Bot token dạng số:chuỗi.',
        hint: 'Gợi ý: Thêm bot vào nhóm chat Telegram của bạn và gán quyền gửi tin nhắn.',
        scopeLabel: 'Chat ID',
        scopeItems: [],
        keyInputs: [
          { id: 'key_1', label: 'Bot token (BotFather)', type: 'password', placeholder: '123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ' }
        ]
      },
      {
        id: 'jira',
        name: 'Jira',
        configured: false,
        statusType: 'untested',
        lastCheckTime: null,
        capabilities: 'Tìm project, issue; tạo issue, thêm bình luận.',
        keyHelp: 'Đăng nhập id.atlassian.com/manage-profile/security/api-tokens để tạo API token, dùng cùng email Atlassian và đường dẫn trang Jira dạng https://ten-site.atlassian.net.',
        hint: null,
        scopeLabel: 'Project key',
        scopeItems: [],
        keyInputs: [
          { id: 'key_1', label: 'Site URL (https://ten-site.atlassian.net)', type: 'url', placeholder: 'https://cong-ty.atlassian.net' },
          { id: 'key_2', label: 'Email Atlassian', type: 'email', placeholder: 'user@company.com' },
          { id: 'key_3', label: 'API token', type: 'password', placeholder: 'ATATT3xFfGF0...' }
        ]
      }
    ];
