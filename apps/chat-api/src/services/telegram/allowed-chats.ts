import type { TelegramUpdateClient } from './update-inbox.js';
import { decryptCredentials } from '@wap/tool-adapters';
import { normalizeTelegramChatId, TELEGRAM_CHAT_ID_PATTERN } from '@wap/tool-schemas';

export async function loadActiveTelegramChatAllowlist(
  db: TelegramUpdateClient,
  encryptionKey: string,
): Promise<Set<string>> {
  const res = await db.query<{ config: string }>(
    `SELECT config FROM service_credentials
     WHERE service = 'telegram' AND user_id IS NOT NULL AND workspace_id IS NULL AND status = 'active'`,
  );

  const chats = new Set<string>();
  for (const row of res.rows) {
    try {
      const dec = decryptCredentials<Record<string, any>>(row.config, encryptionKey);
      if (Array.isArray(dec?.selectedChats)) {
        for (const item of dec.selectedChats) {
          const id = typeof item === 'string' ? item : item?.chatId;
          if (typeof id === 'string' && TELEGRAM_CHAT_ID_PATTERN.test(id.trim())) {
            chats.add(normalizeTelegramChatId(id));
          }
        }
      } else if (Array.isArray(dec?.allowedScope?.chats)) {
        for (const id of dec.allowedScope.chats) {
          if (typeof id === 'string' && TELEGRAM_CHAT_ID_PATTERN.test(id.trim())) {
            chats.add(normalizeTelegramChatId(id));
          }
        }
      }
    } catch {
      // Skip unreadable credentials for a single user without failing polling.
    }
  }

  return chats;
}
