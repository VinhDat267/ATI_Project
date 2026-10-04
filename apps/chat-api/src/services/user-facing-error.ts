/** Translate fixed API failures at the response boundary, preserving statuses/codes. */
export function userFacingError(value: unknown): string {
  const text = typeof value === 'string' ? value : '';
  const rules: Array<[RegExp, string]> = [
    [/Unsupported service/i, 'Dịch vụ này chưa được hỗ trợ.'],
    [/Only a configured service administrator/i, 'Chỉ quản trị viên được phép đổi cấu hình dịch vụ dùng chung.'],
    [/Successfully connected/i, 'Kiểm tra kết nối thành công.'],
    [/Provider rejected|verification failed/i, 'Kiểm tra kết nối thất bại. Hãy kiểm tra thông tin kết nối dịch vụ.'],
    [/Email and password are required/i, 'Vui lòng nhập email và mật khẩu.'],
    [/Invalid email or password/i, 'Email hoặc mật khẩu không đúng.'],
    [/Too many login attempts/i, 'Bạn đã thử đăng nhập quá nhiều lần. Hãy thử lại sau.'],
    [/Account is not active/i, 'Tài khoản chưa được kích hoạt.'],
    [/refreshToken is required/i, 'Thiếu thông tin để gia hạn phiên đăng nhập.'],
    [/rotated by another request/i, 'Phiên đăng nhập đã được gia hạn bởi yêu cầu khác.'],
    [/Missing or invalid Authorization|Invalid.*token|Token expired|Invalid or revoked session|Unauthorized|Malformed.*token|Token type mismatch/i, 'Phiên đăng nhập không hợp lệ hoặc đã hết hạn. Hãy đăng nhập lại.'],
    [/PostgreSQL.*required|Authentication database|repository not configured|Ownership verification unavailable/i, 'Máy chủ chưa sẵn sàng. Hãy thử lại sau.'],
    [/Forbidden/i, 'Bạn không có quyền thực hiện thao tác này.'],
    [/Conversation not found/i, 'Không tìm thấy hội thoại.'],
    [/Plan not found|No active pending plan/i, 'Không tìm thấy kế hoạch đang chờ duyệt.'],
    [/No execution|No active execution/i, 'Không tìm thấy lần thực thi.'],
    [/No messages found/i, 'Hội thoại chưa có tin nhắn.'],
    [/content string is required/i, 'Vui lòng nhập nội dung tin nhắn.'],
    [/Plan.*expired|already approved|already decided/i, 'Kế hoạch đã được xử lý hoặc hết hạn. Hãy tải lại hội thoại.'],
    [/integrity/i, 'Kế hoạch đã duyệt không vượt qua kiểm tra toàn vẹn. Hãy dừng và kiểm tra lại.'],
    [/Cannot retry/i, 'Chỉ được thử lại bước đã xác nhận thất bại.'],
    [/Cannot skip/i, 'Chỉ được bỏ qua bước thất bại hoặc chưa rõ kết quả.'],
    [/Cannot continue|Cannot recover|Reconciliation required|only be stopped/i, 'Cần đối chiếu trạng thái thực thi trước khi chạy tiếp. Bạn vẫn có thể dừng.'],
    [/Cannot stop a terminal|Cannot continue a terminal/i, 'Lần thực thi đã kết thúc.'],
    [/already running/i, 'Quy trình đang chạy.'],
    [/Valid service credentials/i, 'Vui lòng nhập thông tin kết nối dịch vụ hợp lệ.'],
    [/non-empty allowed scope/i, 'Vui lòng cấu hình phạm vi tài nguyên được phép và khóa mã hóa.'],
  ];
  for (const [pattern, translation] of rules) if (pattern.test(text)) return translation;
  // Existing Vietnamese errors and newly added account routes keep their wording.
  if (/[À-ỹ]/u.test(text)) return text;
  return 'Không thể hoàn tất yêu cầu. Hãy thử lại.';
}
