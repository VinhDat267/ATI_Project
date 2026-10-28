import { authStorage } from './auth-storage';
import { sharesAuthSession } from './api-client';

export function gmailSessionOwner() {
  const initial = authStorage.getStoredTokens();
  return () => {
    const latest = authStorage.getStoredTokens();
    return !!initial.accessToken && latest.user?.id === initial.user?.id &&
      ((latest.accessToken === initial.accessToken && latest.refreshToken === initial.refreshToken) ||
        sharesAuthSession(initial.accessToken, latest.accessToken));
  };
}
/** A conversation of this app, `/c/<uuid>`, or null: the only place a connection may return to (OAUTH-01). */
export function conversationReturnPath(value: unknown): string | null {
  return typeof value === 'string' && /^\/c\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value) ? value : null;
}
export function redirectToGmail(url: string) {
  const target = new URL(url);
  if (target.protocol !== 'https:' && !(target.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(target.hostname))) {
    throw new Error('Không thể mở trang kết nối.');
  }
  window.location.assign(target.href);
}
let notice: { userId?: string; email: string } | undefined;
export const gmailConnectionNotice = {
  set(email: string) { notice = { userId: authStorage.getStoredTokens().user?.id, email }; },
  take(userId?: string) { const own = notice; notice = undefined; return own?.userId === userId ? own?.email : undefined; },
};
export const gmailCallbackError = (code?: string) => ({
  GMAIL_STATE_INVALID: 'Link kết nối đã hết hạn, đã dùng hoặc không thuộc phiên này. Hãy bắt đầu kết nối lại.',
  GMAIL_SCOPE_MISSING: 'Chưa cấp đủ quyền Gmail. Hãy kết nối lại và cấp quyền đọc, soạn, gửi và quản lý thư.',
  GMAIL_REFRESH_TOKEN_MISSING: 'Google chưa cấp quyền truy cập dài hạn. Hãy thu hồi quyền cũ rồi kết nối lại.',
  GMAIL_CONNECT_FAILED: 'Không thể hoàn tất kết nối Gmail. Hãy thử kết nối lại từ trang dịch vụ.',
  INVALID_SESSION: 'Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại rồi kết nối Gmail.',
}[code ?? ''] ?? 'Không thể hoàn tất kết nối Gmail. Hãy trở về trang dịch vụ để kết nối lại.');

export const mycalendarSessionOwner = gmailSessionOwner;
export const redirectToMyCalendar = redirectToGmail;

let mycalNotice: { userId?: string; email: string } | undefined;
export const mycalendarConnectionNotice = {
  set(email: string) { mycalNotice = { userId: authStorage.getStoredTokens().user?.id, email }; },
  take(userId?: string) { const own = mycalNotice; mycalNotice = undefined; return own?.userId === userId ? own?.email : undefined; },
};

export const mycalendarCallbackError = (code?: string) => ({
  MYCALENDAR_STATE_INVALID: 'Yêu cầu kết nối Google Calendar đã hết hạn hoặc không còn hợp lệ. Hãy bắt đầu kết nối lại.',
  MYCALENDAR_SCOPE_MISSING: 'Google chưa cấp quyền quản lý sự kiện lịch cho ATI. Hãy kết nối lại và đồng ý quyền Google Calendar.',
  MYCALENDAR_REFRESH_TOKEN_MISSING: 'Google không trả quyền truy cập lâu dài. Hãy kết nối lại.',
  MYCALENDAR_CONNECT_FAILED: 'Không thể hoàn tất kết nối Google Calendar. Hãy thử kết nối lại từ trang dịch vụ.',
  MYCALENDAR_FETCH_FAILED: 'Không tải được danh sách lịch từ Google Calendar. Hãy thử lại.',
  MYCALENDAR_SCOPE_INVALID: 'Vui lòng chọn ít nhất một lịch hợp lệ.',
  MYCALENDAR_NOT_CONNECTED: 'Google Calendar của bạn chưa được kết nối hoặc cần kết nối lại.',
  INVALID_SESSION: 'Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại rồi kết nối Google Calendar.',
}[code ?? ''] ?? 'Không thể hoàn tất kết nối Google Calendar. Hãy trở về trang dịch vụ để kết nối lại.');

export const mysheetsSessionOwner = gmailSessionOwner;
export const redirectToMySheets = redirectToGmail;

let mysheetsNotice: { userId?: string; email: string } | undefined;
export const mysheetsConnectionNotice = {
  set(email: string) { mysheetsNotice = { userId: authStorage.getStoredTokens().user?.id, email }; },
  take(userId?: string) { const own = mysheetsNotice; mysheetsNotice = undefined; return own?.userId === userId ? own?.email : undefined; },
};

export const mysheetsCallbackError = (code?: string) => ({
  MYSHEETS_STATE_INVALID: 'Yêu cầu kết nối Google Sheets đã hết hạn hoặc không còn hợp lệ. Hãy bắt đầu kết nối lại.',
  MYSHEETS_SCOPE_MISSING: 'Google chưa cấp quyền quản lý bảng tính cho ATI. Hãy kết nối lại và đồng ý quyền Google Drive / Sheets.',
  MYSHEETS_REFRESH_TOKEN_MISSING: 'Google không trả quyền truy cập lâu dài. Hãy kết nối lại.',
  MYSHEETS_CONNECT_FAILED: 'Không thể hoàn tất kết nối Google Sheets. Hãy thử kết nối lại từ trang dịch vụ.',
  MYSHEETS_FETCH_FAILED: 'Không tải được thông tin bảng tính từ Google. Hãy thử lại.',
  MYSHEETS_SCOPE_INVALID: 'Vui lòng chọn ít nhất một bảng tính hợp lệ.',
  MYSHEETS_NOT_CONNECTED: 'Google Sheets của bạn chưa được kết nối hoặc cần kết nối lại.',
  INVALID_SESSION: 'Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại rồi kết nối Google Sheets.',
}[code ?? ''] ?? 'Không thể hoàn tất kết nối Google Sheets. Hãy trở về trang dịch vụ để kết nối lại.');
