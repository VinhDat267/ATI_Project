import type { ServiceInfo } from '../../types';

// Service help/format hints are presentation metadata; generic behavior follows
// the catalogue's credential field patterns and these declarative scope rules.
import settingsMetadata from '../../assets/settings-services.json';
interface SettingsMetadata { text: string; url: string; hint?: string; scopePattern?: string; scopeError?: string; fieldHints?: Record<string, { pattern?: string; message: string }> }
const guides = settingsMetadata as Record<string, SettingsMetadata>;
const toolLabels: Record<string, string> = {
  search_boards: 'Tìm bảng', list_boards: 'Tìm bảng', list_lists: 'Xem danh sách', get_board: 'Xem bảng',
  list_members: 'Xem thành viên', search_lists: 'Tìm danh sách', search_members: 'Tìm thành viên', search_cards: 'Tìm card', get_card: 'Xem card', create_card: 'Tạo card', update_card: 'Cập nhật card', add_member: 'Gán thành viên', add_checklist: 'Thêm checklist',
  list_channels: 'Tìm kênh', search_channels: 'Tìm kênh', send_message: 'Gửi tin nhắn', post_message: 'Gửi tin nhắn',
  list_repos: 'Tìm kho', search_repos: 'Tìm kho', search_issues: 'Tìm issue', get_issue: 'Xem issue', create_issue: 'Tạo issue', add_labels: 'Gắn nhãn', add_label: 'Gắn nhãn',
  get_spreadsheet: 'Xem bảng tính', list_spreadsheets: 'Tìm bảng tính', list_sheets: 'Xem tab', read_range: 'Đọc vùng ô', append_rows: 'Thêm dòng',
  list_calendars: 'Xem lịch', list_events: 'Xem sự kiện', create_event: 'Tạo sự kiện (không mời người khác)',
  search: 'Tìm tài nguyên', search_databases: 'Tìm database', query_database: 'Đọc database', get_page: 'Đọc page', create_page: 'Tạo page', append_blocks: 'Nối văn bản', append_text: 'Nối văn bản',
  get_chat: 'Xem thông tin chat', list_chats: 'Xem thông tin chat', list_projects: 'Tìm project', search_projects: 'Tìm project', add_comment: 'Thêm bình luận',
};
export function serviceView(service: ServiceInfo) {
  const guide = guides[service.id];
  return {
    ...service,
    statusType: service.connectionStatus === 'healthy' ? 'ok' : service.connectionStatus === 'unhealthy' ? 'failed' : 'untested',
    lastCheckTime: service.lastCheckedAt ? new Date(service.lastCheckedAt).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) : null,
    capabilities: [...new Set((service.tools ?? []).map(tool => toolLabels[tool.split('.').at(-1)!] ?? 'Thao tác với tài nguyên được cấp quyền'))].join('; ') || 'Chưa có thao tác trong danh mục.',
    keyHelp: guide?.text ?? 'Xem hướng dẫn chính thức của dịch vụ để lấy khoá.',
    guideUrl: guide?.url, hint: guide?.hint ?? null, scopePattern: guide?.scopePattern, scopeError: guide?.scopeError,
    scopeLabel: service.scopeLabel ?? 'tài nguyên',
    keyInputs: (service.credentialFields ?? []).map(field => ({ id: `${service.id}-${field.key}`, key: field.key, label: field.label, pattern: field.pattern ?? guide?.fieldHints?.[field.key]?.pattern, formatHint: guide?.fieldHints?.[field.key]?.message ?? 'Định dạng không hợp lệ.', type: field.type === 'multiline' ? 'textarea' : field.type ?? 'password', placeholder: 'Nhập khoá truy cập' })),
  };
}
export type Service = ReturnType<typeof serviceView>;
