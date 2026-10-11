export function userErrorMessage(error: unknown, fallback = 'Không thể hoàn tất yêu cầu. Hãy thử lại.'): string {
  const code = (error as any)?.data?.code;
  if (code === 'ACCOUNT_PENDING') return 'Tài khoản đang chờ quản trị viên duyệt.';
  if (code === 'ACCOUNT_DISABLED') return 'Tài khoản đã bị vô hiệu hóa. Hãy liên hệ quản trị viên.';
  const message = error instanceof Error ? error.message : '';
  const status = (error as any)?.status;
  if (/failed to fetch|fetch failed|networkerror|network request failed|load failed/i.test(message) || [502, 503, 504].includes(status)) {
    return 'Không thể kết nối máy chủ. Hãy kiểm tra mạng và thử lại.';
  }
  if (status === 500) return 'Máy chủ gặp lỗi. Hãy thử lại.';
  return message || fallback;
}
