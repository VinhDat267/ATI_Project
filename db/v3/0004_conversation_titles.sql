-- Backfill only when the column is first introduced; repeated migrations keep renames.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid = 'conversations'::regclass AND attname = 'title' AND NOT attisdropped
  ) THEN
    ALTER TABLE conversations ADD COLUMN title TEXT;
    UPDATE conversations c SET title = (
      SELECT left(m.content, 60) FROM messages m
      WHERE m.conv_id = c.id AND m.role = 'user'
      ORDER BY m.created_at, m.id LIMIT 1
    );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_conversations_owner_history
  ON conversations(user_id, updated_at DESC, id DESC);
