import type pg from 'pg';
import { decryptCredentials } from '@wap/tool-adapters';
import { normalizeTelegramChatId, TELEGRAM_CHAT_ID_PATTERN } from '@wap/tool-schemas';

const ALLOWLIST_CACHE_TTL_MS = 60_000;
const allowlistCache = new WeakMap<pg.Pool, { chats: Set<string>; expiresAt: number }>();

export function invalidateTelegramAllowlistCache(pool?: pg.Pool): void {
  if (pool) {
    allowlistCache.delete(pool);
  }
}

export async function loadActiveTelegramChatAllowlist(
  pool: pg.Pool,
  encryptionKey: string,
): Promise<Set<string>> {
  const now = Date.now();
  const cached = allowlistCache.get(pool);
  if (cached && cached.expiresAt > now) {
    return new Set(cached.chats);
  }

  const res = await pool.query<{ config: string }>(
    `SELECT config FROM service_credentials
     WHERE service = 'telegram' AND user_id IS NOT NULL AND status = 'active'`,
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

  allowlistCache.set(pool, { chats, expiresAt: now + ALLOWLIST_CACHE_TTL_MS });
  return new Set(chats);
}
