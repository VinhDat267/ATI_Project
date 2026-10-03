export interface ConversationPageOptions { limit?: number; cursor?: string; search?: string }
export interface ConversationCursor { updatedAt: string; id: string }
export class HistoryValidationError extends Error { readonly status = 400 }

export function decodeConversationCursor(value: string): ConversationCursor {
  try {
    if (value.length > 512 || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error();
    const cursor = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    if (typeof cursor?.updatedAt !== 'string' || typeof cursor?.id !== 'string'
      || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/.test(cursor.updatedAt)
      || !Number.isFinite(Date.parse(cursor.updatedAt))
      || new Date(cursor.updatedAt).toISOString().slice(0, 19) !== cursor.updatedAt.slice(0, 19)
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(cursor.id)) throw new Error();
    return { updatedAt: cursor.updatedAt, id: cursor.id };
  } catch { throw new HistoryValidationError('Cursor hội thoại không hợp lệ.'); }
}

export function encodeConversationCursor(cursor: ConversationCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString('base64url');
}

export function validateConversationPage(options: ConversationPageOptions = {}) {
  const limit = options.limit ?? 50;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new HistoryValidationError('Số hội thoại mỗi trang phải từ 1 đến 100.');
  if (options.search !== undefined && (typeof options.search !== 'string' || options.search.length > 200)) throw new HistoryValidationError('Từ khóa tìm kiếm không hợp lệ.');
  return { limit, search: options.search?.trim() ?? '', cursor: options.cursor ? decodeConversationCursor(options.cursor) : null };
}

export function validateConversationTitle(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || Array.from(value.trim()).length > 60) throw new HistoryValidationError('Tên hội thoại cần từ 1 đến 60 ký tự.');
  return value.trim();
}
