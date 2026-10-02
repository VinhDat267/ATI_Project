export function userErrorMessage(error: unknown, fallback = 'Không thể hoàn tất yêu cầu. Hãy thử lại.'): string {
  const message = error instanceof Error ? error.message : '';
  if (/failed to fetch|fetch failed|networkerror|network request failed|load failed/i.test(message) || (error as any)?.status >= 500) {
    return 'Không thể kết nối máy chủ. Hãy kiểm tra mạng và thử lại.';
  }
  return message || fallback;
}
