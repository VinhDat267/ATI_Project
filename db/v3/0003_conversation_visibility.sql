-- Presentation lifecycle is independent of workflow execution status.
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_conversations_visible_history
  ON conversations (user_id, updated_at DESC)
  WHERE archived_at IS NULL AND deleted_at IS NULL;
