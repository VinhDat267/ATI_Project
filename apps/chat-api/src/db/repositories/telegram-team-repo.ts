import type pg from 'pg';

export type TelegramChatType = 'private' | 'group' | 'supergroup' | 'channel';

export interface TelegramTeamChatItem {
  chatId: string;
  title: string;
  type: TelegramChatType;
}

export interface TelegramTeamScope {
  chosenBy: string;
  chats: TelegramTeamChatItem[];
}

export interface ReplaceTelegramTeamScopeInput {
  chosenBy: string;
  chats: TelegramTeamChatItem[];
}

export class TelegramTeamRepo {
  constructor(private pool: pg.Pool) {}

  async get(): Promise<TelegramTeamScope | null> {
    const scopeRes = await this.pool.query<{ chosen_by: string }>(
      "SELECT chosen_by FROM telegram_team_scope WHERE id = 'default'",
    );
    const scope = scopeRes.rows[0];
    if (!scope) return null;

    const chatsRes = await this.pool.query<{ chat_id: string; title: string; chat_type: TelegramChatType }>(
      "SELECT chat_id, title, chat_type FROM telegram_team_chats WHERE scope_id = 'default' ORDER BY position ASC, created_at ASC",
    );

    return {
      chosenBy: scope.chosen_by,
      chats: chatsRes.rows.map((r) => ({
        chatId: r.chat_id,
        title: r.title,
        type: r.chat_type,
      })),
    };
  }

  async replace(input: ReplaceTelegramTeamScopeInput): Promise<TelegramTeamScope> {
    if (!input.chats || input.chats.length > 10) {
      throw new Error('Cannot select more than 10 Telegram chats');
    }
    if (!input.chosenBy?.trim()) {
      throw new Error('chosenBy is required');
    }

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("DELETE FROM telegram_team_chats WHERE scope_id = 'default'");

      await client.query(
        `INSERT INTO telegram_team_scope (id, chosen_by, updated_at)
         VALUES ('default', $1, now())
         ON CONFLICT (id) DO UPDATE SET
           chosen_by = EXCLUDED.chosen_by,
           updated_at = now()`,
        [input.chosenBy],
      );

      for (let i = 0; i < input.chats.length; i++) {
        const c = input.chats[i]!;
        await client.query(
          `INSERT INTO telegram_team_chats (scope_id, chat_id, title, chat_type, position)
           VALUES ('default', $1, $2, $3, $4)`,
          [c.chatId, c.title, c.type, i + 1],
        );
      }

      await client.query('COMMIT');
      return {
        chosenBy: input.chosenBy,
        chats: input.chats.map((c) => ({ chatId: c.chatId, title: c.title, type: c.type })),
      };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
}
