export type ClientErrorKind = "http" | "network" | "protocol" | "aborted";

export interface ClientErrorOptions {
  message: string;
  kind: ClientErrorKind;
  status?: number;
  code?: string;
  requestId?: string;
  uncertain?: boolean;
  cause?: unknown;
}

export class ClientError extends Error {
  readonly kind: ClientErrorKind;
  readonly status?: number;
  readonly code?: string;
  readonly requestId?: string;
  readonly uncertain: boolean;

  constructor(options: ClientErrorOptions) {
    super(options.message, { cause: options.cause });
    this.name = "ClientError";
    this.kind = options.kind;
    this.status = options.status;
    this.code = options.code;
    this.requestId = options.requestId;
    this.uncertain = options.uncertain ?? false;
  }
}

export function isClientError(error: unknown): error is ClientError {
  return error instanceof ClientError;
}

const BUSINESS_FIELD_LABELS: Record<string, string> = {
  request_id: "Mã yêu cầu",
  client_ref: "Đơn vị / Khách hàng yêu cầu",
  request_type: "Phân loại công việc",
  raw_request: "Mô tả nội dung công việc",
  deliverable: "Sản phẩm bàn giao dự kiến",
  due_date: "Thời hạn hoàn thành",
  decision_status: "Xác nhận phê duyệt từ đơn vị yêu cầu",
  source_note: "Ghi chú bổ sung",
  dimensions: "Thông số kích thước thiết kế",
  target_url: "Đường dẫn trang đích (URL)",
};

export function formatBusinessFieldName(field: string): string {
  const clean = field.trim();
  if (clean in BUSINESS_FIELD_LABELS) {
    return BUSINESS_FIELD_LABELS[clean]!;
  }
  const conflictMatch = /Detected conflict indicator:\s*"([^"]+)"/i.exec(clean);
  if (conflictMatch) {
    return `Thông tin chưa thống nhất trong mô tả (“${conflictMatch[1]}”)`;
  }
  return clean;
}

export function formatRequestType(requestType?: string | null): string {
  if (!requestType) return "Chưa phân loại";
  switch (requestType.trim().toLowerCase()) {
    case "design_asset":
      return "Thiết kế ấn phẩm (Design Asset)";
    case "web_change":
      return "Cập nhật trang web (Web Change)";
    case "task_create":
    case "create_work_item":
      return "Tạo công việc mới";
    default:
      return requestType;
  }
}

export function formatDecisionStatus(status?: string | null): string {
  if (!status) return "Chưa xác nhận";
  switch (status.trim().toLowerCase()) {
    case "confirmed":
    case "approved":
    case "yes":
    case "xác nhận":
    case "đã duyệt":
    case "chấp thuận":
      return "Đã xác nhận thực hiện";
    case "unconfirmed":
    case "pending":
    case "draft":
    case "chờ duyệt":
      return "Chờ xác nhận";
    case "rejected":
    case "từ chối":
      return "Đã từ chối";
    default:
      return status;
  }
}

export function formatErrorClass(errorClass?: string | null): string {
  if (!errorClass) return "—";
  switch (errorClass.trim().toLowerCase()) {
    case "bad_args":
      return "Thông tin nơi nhận hoặc tham số chưa hợp lệ";
    case "transient":
      return "Gián đoạn kết nối tạm thời với dịch vụ đích";
    case "bad_tool":
      return "Công cụ thực thi chưa được hỗ trợ";
    case "fatal":
      return "Sự cố hệ thống trong quá trình thực thi";
    default:
      return errorClass;
  }
}

export function formatChecklistSummary(
  summary?: string | null,
  missingFields: string[] = [],
  conflicts: string[] = [],
): string {
  if (!summary) return "";
  const trimmed = summary.trim();
  if (/^Checklist passed for/i.test(trimmed)) {
    return "Tất cả thông tin bắt buộc đã đầy đủ và hợp lệ để lập kế hoạch.";
  }
  if (/^Unsupported request type:/i.test(trimmed)) {
    return "Phân loại công việc này chưa nằm trong danh mục nghiệp vụ được hỗ trợ tự động.";
  }
  if (/^Checklist requires input for/i.test(trimmed)) {
    const items = [...missingFields, ...conflicts].map(formatBusinessFieldName);
    if (items.length > 0) {
      return `Cần bổ sung hoặc làm rõ trước khi thực hiện: ${items.join(", ")}.`;
    }
    return "Cần bổ sung thêm thông tin bắt buộc trong bảng dữ liệu trước khi thực hiện.";
  }
  return trimmed;
}

export function formatClarificationQuestion(
  question?: string | null,
  missingFields: string[] = [],
  conflicts: string[] = [],
): string {
  if (!question) return "";
  if (
    /^Vui lòng bổ sung hoặc xác nhận:/i.test(question) ||
    /due_date|dimensions|target_url|decision_status|Detected conflict indicator/i.test(question)
  ) {
    const items = [...missingFields, ...conflicts].map(formatBusinessFieldName);
    if (items.length > 0) {
      return `Vui lòng bổ sung hoặc xác nhận các thông tin sau trên bảng Google Sheets: ${items.join(", ")}.`;
    }
  }
  return question;
}

/**
 * Translates any technical error code, raw English backend message, HTTP status,
 * or intake validation token into a clear, business-friendly Vietnamese message.
 */
export function toBusinessErrorMessage(
  rawMessage?: string | null,
  code?: string | null,
  status?: number,
): string {
  const msg = (rawMessage ?? "").trim();
  const errCode = (code ?? "").trim().toUpperCase();

  // 1. Specific Intake / Source Row errors (Google Sheets -> Pilot)
  if (
    msg === "NOT_FOUND" ||
    errCode === "REQUEST_NOT_FOUND" ||
    /REQUEST_NOT_FOUND/i.test(msg)
  ) {
    return "Không tìm thấy Mã yêu cầu này trong bảng dữ liệu Google Sheets. Vui lòng kiểm tra lại mã yêu cầu hoặc chọn một mẫu kịch bản có sẵn.";
  }
  if (
    msg === "HEADERS" ||
    /HEADER_MISMATCH|EMPTY_SHEET|VALUES_TYPE|ROW_TYPE|EXTRA_COLUMNS|CELL_TYPE/i.test(msg) ||
    /HEADER_MISMATCH|EMPTY_SHEET/i.test(errCode)
  ) {
    return "Cấu trúc bảng Google Sheets chưa đúng biểu mẫu chuẩn. Vui lòng kiểm tra lại các cột tiêu đề của trang tính.";
  }
  if (msg === "DUPLICATE_ID" || /DUPLICATE_ID|DUPLICATE_REQUEST_ID/i.test(msg)) {
    return "Mã yêu cầu này đang bị trùng lặp trên nhiều dòng trong bảng Google Sheets. Vui lòng kiểm tra lại dữ liệu nguồn.";
  }
  if (msg === "INVALID_ID" || /INVALID_ID/i.test(msg)) {
    return "Mã yêu cầu trong bảng dữ liệu bị bỏ trống hoặc chưa đúng quy chuẩn.";
  }
  if (msg === "REQUEST_TYPE" || /Unsupported request type/i.test(msg)) {
    return "Phân loại công việc này chưa nằm trong danh mục nghiệp vụ được hỗ trợ tự động.";
  }
  if (
    msg === "ROW_LIMIT" ||
    msg === "TEXT_LIMIT" ||
    errCode === "BODY_TOO_LARGE" ||
    status === 413 ||
    /exceeds 64 KiB/i.test(msg)
  ) {
    return "Nội dung yêu cầu vượt quá dung lượng xử lý cho phép. Vui lòng rút gọn nội dung và thử lại.";
  }

  // 2. Specific Pilot & Workflow Lifecycle Conflicts (409)
  if (
    errCode === "ACTIVE_RUN" ||
    /A run is already active|Request conflicts with current state/i.test(msg)
  ) {
    return "Hệ thống đang xử lý một công việc khác. Để đảm bảo an toàn dữ liệu, vui lòng đợi công việc hiện tại hoàn tất hoặc duyệt xong trước khi gửi yêu cầu mới.";
  }
  if (
    errCode === "APPROVAL_EXPIRED" ||
    errCode === "EXPIRED" ||
    /Pilot approval expired/i.test(msg)
  ) {
    return "Thời hạn phê duyệt (10 phút) đã kết thúc. Không có thay đổi nào được ghi nhận — vui lòng tạo lại yêu cầu mới để cập nhật dữ liệu mới nhất.";
  }
  if (
    errCode === "APPROVAL_NOT_PENDING" ||
    errCode === "INVALID_RUN_STATE" ||
    /Pilot approval is unavailable|Run is not awaiting approval|Synthetic approval conflict/i.test(
      msg,
    )
  ) {
    return "Yêu cầu phê duyệt này đã được xử lý trước đó hoặc trạng thái công việc đã thay đổi.";
  }
  if (
    errCode === "SNAPSHOT_MISMATCH" ||
    errCode === "VERSION_MISMATCH" ||
    /Pilot preview changed|workflow version changed/i.test(msg)
  ) {
    return "Dữ liệu nguồn đã thay đổi so với bản xem trước. Hệ thống đã dừng thao tác để tránh cập nhật sai lệch dữ liệu.";
  }
  if (errCode === "MISSING_SNAPSHOT" || /Source snapshot missing/i.test(msg)) {
    return "Không tìm thấy bản chụp dữ liệu nguồn của công việc này. Vui lòng khởi tạo lại yêu cầu.";
  }

  // 3. Remote SaaS Connectors & Safety Locks (502 / 503)
  if (errCode === "LIVE_WRITE_BLOCKED" || /Pilot live writes are disabled/i.test(msg)) {
    return "Chế độ ghi dữ liệu trực tiếp lên Trello đang tạm khóa để bảo vệ an toàn. Bạn vẫn có thể kiểm tra điều kiện và xem trước kế hoạch.";
  }
  if (
    errCode === "TARGET_NOT_BOUND" ||
    /Pilot Trello list ID is not configured|LIST_NOT_FOUND/i.test(msg)
  ) {
    return "Chưa xác định được danh sách đích (List) trên bảng Trello để tạo thẻ công việc. Vui lòng kiểm tra lại cấu hình bảng Trello.";
  }
  if (
    errCode === "DISPATCH_UNCERTAIN" ||
    /Pilot dispatch requires reconciliation|Run changed during dispatch/i.test(msg)
  ) {
    return "Kết nối đến Trello bị gián đoạn trong lúc tạo thẻ. Để tránh tạo thẻ trùng lặp, hệ thống không tự động gửi lại — vui lòng mở bảng Trello để kiểm tra.";
  }
  if (
    errCode === "CONFIG_ERROR" ||
    /CONFIG_ERROR|Missing Google credentials|Service account private key/i.test(msg)
  ) {
    return "Chưa hoàn tất cấu hình kết nối đến Google Sheets hoặc Trello. Vui lòng kiểm tra lại thông tin kết nối.";
  }
  if (errCode === "INTAKE_UNAVAILABLE") {
    return "Tạm thời chưa thể đọc dữ liệu từ bảng Google Sheets. Vui lòng kiểm tra lại mã yêu cầu và thử lại sau ít giây.";
  }
  if (errCode === "LOOKUP_UNAVAILABLE") {
    return "Tạm thời chưa thể kết nối với Trello để tra cứu thẻ. Vui lòng thử lại sau ít giây.";
  }

  // 4. Authentication, Rate Limiting & Permissions (401, 403, 429)
  if (/Invalid credentials/i.test(msg)) {
    return "Email hoặc mật khẩu chưa chính xác. Vui lòng kiểm tra lại.";
  }
  if (
    errCode === "UNAUTHENTICATED" &&
    (!msg || /Authentication required|Authentication principal/i.test(msg))
  ) {
    return "Phiên làm việc đã hết hạn. Vui lòng đăng nhập lại để tiếp tục.";
  }
  if (
    errCode === "RATE_LIMITED" ||
    status === 429 ||
    /Too many login attempts|rate limited|Too many active sessions/i.test(msg)
  ) {
    return "Bạn đã thao tác quá nhiều lần trong thời gian ngắn. Vui lòng đợi ít phút rồi thử lại.";
  }
  if (
    errCode === "ORIGIN_NOT_ALLOWED" ||
    errCode === "CSRF_REQUIRED" ||
    /Origin is not allowed|CSRF validation failed/i.test(msg)
  ) {
    return "Phiên bảo mật của trình duyệt đã thay đổi. Vui lòng tải lại trang (F5) và thử lại.";
  }
  if (
    errCode === "ACCESS_DENIED" ||
    errCode === "FORBIDDEN" ||
    status === 403 ||
    /Principal is unauthorized|Principal is not enabled|ACCESS_DENIED/i.test(msg)
  ) {
    return "Tài khoản của bạn chưa được cấp quyền thực hiện thao tác này.";
  }

  // 5. Resource Not Found (404)
  if (
    status === 404 ||
    errCode === "NOT_FOUND" ||
    /^(Run|Resource|Route|Synthetic run) not found$/i.test(msg)
  ) {
    return "Không tìm thấy thông tin công việc này, hoặc công việc thuộc về tài khoản khác.";
  }

  // 6. Schema / Input validation (400)
  if (
    /Request does not match the API schema|Request is invalid|Invalid pilot check request|Invalid pilot lookup request|Invalid JSON|JSON request body required/i.test(
      msg,
    )
  ) {
    return "Thông tin gửi lên chưa đầy đủ hoặc chưa đúng định dạng. Vui lòng kiểm tra lại các mục đã nhập.";
  }

  // 7. Network / Gateway / Server availability (500, 502, 503, 504)
  if (
    /mã lỗi\s*(502|503|504)|Failed to fetch|NetworkError|ECONNREFUSED|Service unavailable|Reviewed server catalog is unavailable/i.test(
      msg,
    ) ||
    status === 502 ||
    status === 503 ||
    status === 504
  ) {
    return "Dịch vụ xử lý trung tâm đang khởi động hoặc tạm thời chưa kết nối. Vui lòng đợi vài giây rồi thử lại.";
  }
  if (/mã lỗi\s*500|Internal server error/i.test(msg) || status === 500) {
    return "Hệ thống gặp sự cố tạm thời khi xử lý yêu cầu. Vui lòng thử lại sau.";
  }

  // 8. Clean up raw uppercase prefixes in tool/step error messages (e.g. "CHANNEL_NOT_FOUND: ...")
  if (/^[A-Z0-9_]{3,}:\s*/.test(msg)) {
    return msg
      .replace(/^[A-Z0-9_]{3,}:\s*/, "")
      .replace(/trong dữ liệu local/gi, "trên hệ thống");
  }

  if (msg) {
    return msg.replace(/trong dữ liệu local/gi, "trên hệ thống");
  }

  return "Không thể hoàn tất yêu cầu vào lúc này. Vui lòng kiểm tra lại thông tin và thử lại.";
}

export function formatBusinessError(error: unknown, fallback?: string): string {
  if (isClientError(error)) {
    return toBusinessErrorMessage(error.message, error.code, error.status);
  }
  if (error instanceof Error) {
    return toBusinessErrorMessage(error.message);
  }
  return (
    fallback ??
    "Không thể hoàn tất yêu cầu vào lúc này. Vui lòng kiểm tra lại kết nối và thử lại."
  );
}

