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
    /(?<![\p{L}\p{N}_])(?:gửi|trả lời|chuyển tiếp)\s+thư(?![\p{L}\p{N}_])/iu,
    /(?<![\p{L}\p{N}_])thư\s+(?:mới|chưa đọc)(?![\p{L}\p{N}_])/iu,
  ],
};
