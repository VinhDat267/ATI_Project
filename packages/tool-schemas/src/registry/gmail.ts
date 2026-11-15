import type { ServiceDefinition } from '../types.js';
import { GMAIL_MODIFY_SCOPE } from '../gmail.js';

/** Opt-in (GMAIL_ENABLED): deliberately not part of SERVICE_REGISTRY. */
export const GMAIL_SERVICE: ServiceDefinition = {
  id: 'gmail', name: 'Gmail', connection: 'personal',
  description: 'Tìm, đọc, soạn, gửi, gắn nhãn và chuyển vào thùng rác thư trong hộp thư Gmail của chính bạn; không xoá vĩnh viễn',
  scopes: [GMAIL_MODIFY_SCOPE], scopeKey: 'mailbox', scopeLabel: 'Hộp thư Gmail của bạn',
  credentialFields: [],
  intentKeywords: ['gmail', 'email', 'e-mail', 'hộp thư', 'thư điện tử'],
  // Phrases only: a bare "thư" also appears in "thư viện", "thư ký", "thư giãn", "thư mục".
  intentPatterns: [
    /(?<![\p{L}\p{N}_])(?:gửi|trả\s+lời|phản\s+hồi|hồi\s+âm|chuyển\s+tiếp|soạn|viết|tạo|sửa|cập\s+nhật|xóa|xoá)\s+(?:một\s+|các\s+|những\s+)?(?:bức\s+|lá\s+|luồng\s+)?thư(?:\s+nháp|\s+mới|\s+điện\s+tử)?(?!(?:\s*(?:viện|ký|kí|giãn|mục|ngỏ))|[\p{L}\p{N}_])/iu,
    /(?<![\p{L}\p{N}_])(?:đọc|xem|tìm(?:\s+kiếm)?|kiểm\s+tra|tra\s+cứu|tóm\s+tắt|liệt\s+kê|lọc|quét|mở|lưu\s+trữ|gắn\s+nhãn|đổi\s+nhãn|bỏ\s+nhãn|gắn\s+sao|đánh\s+dấu)\s+(?:các\s+|những\s+|mọi\s+|toàn\s+bộ\s+|tất\s+cả\s+)?(?:luồng\s+|bức\s+|lá\s+)?thư(?!(?:\s*(?:viện|ký|kí|giãn|mục))|[\p{L}\p{N}_])/iu,
    /(?<![\p{L}\p{N}_])(?:thư\s+nháp|thư\s+chưa\s+đọc|thư\s+đã\s+đọc|thư\s+đến|thư\s+mới|thư\s+rác|luồng\s+thư|nhãn\s+thư|chủ\s+đề\s+thư)(?![\p{L}\p{N}_])/iu,
    /(?<![\p{L}\p{N}_])thư\s+(?:từ|của|gửi\s+từ|có\s+tiêu\s+đề|có\s+đính\s+kèm|đính\s+kèm|hóa\s+đơn|hoá\s+đơn|báo\s+giá|hợp\s+đồng|khẩn)(?![\p{L}\p{N}_])/iu,
    /(?<![\p{L}\p{N}_])(?:tệp|file)\s+đính\s+kèm\s+(?:trong\s+)?thư(?![\p{L}\p{N}_])/iu,
    /(?<![\p{L}\p{N}_])chuyển\s+(?:các\s+|những\s+|mọi\s+|luồng\s+)?thư(?!(?:\s*(?:viện|ký|kí|giãn|mục))|[\p{L}\p{N}_])(?:[^\n]{0,60})?\bvào\s+thùng\s+rác(?![\p{L}\p{N}_])/iu,
  ],
};
