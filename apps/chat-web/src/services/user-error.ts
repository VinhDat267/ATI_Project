export function userError(error: unknown): string {
  const message =
    error instanceof Error
      ? error.message
      : String(error || "Không thể hoàn tất yêu cầu.");
  if (/failed to fetch|networkerror|network request|load failed/i.test(message))
    return "Không kết nối được máy chủ. Hãy kiểm tra kết nối và thử lại.";
  if (/^Request failed with status (502|503|504)$/i.test(message))
    return "Tạm thời không thể kết nối đến máy chủ.";
  if (/invalid email or password/i.test(message))
    return "Email hoặc mật khẩu không chính xác. Hãy kiểm tra thông tin đăng nhập.";
  return message;
}
