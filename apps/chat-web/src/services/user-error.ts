export function userErrorMessage(error: unknown, fallback = 'Không thể hoàn tất yêu cầu. Hãy thử lại.'): string {
  const code = (error as any)?.data?.code;
  if (code === 'ACCOUNT_PENDING') return 'Tài khoản đang chờ quản trị viên duyệt.';
  if (code === 'ACCOUNT_DISABLED') return 'Tài khoản đã bị vô hiệu hóa. Hãy liên hệ quản trị viên.';
  const message = error instanceof Error ? error.message : '';
  if (/failed to fetch|fetch failed|networkerror|network request failed|load failed/i.test(message) || (error as any)?.status >= 500) {
    return 'Không thể kết nối máy chủ. Hãy kiểm tra mạng và thử lại.';
  }
  return message || fallback;
}
