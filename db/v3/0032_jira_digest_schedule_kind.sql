-- 0032_jira_digest_schedule_kind.sql: Support kind = 'myjira_digest' for read-only Jira OAuth 3LO standup digests.
ALTER TABLE schedules DROP CONSTRAINT IF EXISTS schedules_kind_check;
ALTER TABLE schedules ADD CONSTRAINT schedules_kind_check
  CHECK (kind IN ('plan', 'sheets_digest', 'calendar_digest', 'github_digest', 'telegram_digest', 'trello_digest', 'notion_digest', 'myjira_digest'));

ALTER TABLE schedules DROP CONSTRAINT IF EXISTS schedules_kind_digest_check;
ALTER TABLE schedules ADD CONSTRAINT schedules_kind_digest_check CHECK (
  (kind = 'plan' AND digest_config IS NULL AND digest_config_hash IS NULL AND digest_approved_at IS NULL)
  OR (
    kind IN ('sheets_digest', 'calendar_digest', 'github_digest', 'telegram_digest', 'trello_digest', 'notion_digest', 'myjira_digest')
    AND digest_config IS NOT NULL
    AND jsonb_typeof(digest_config) = 'object'
    AND digest_config_hash IS NOT NULL
    AND digest_config_hash ~ '^[0-9a-f]{64}$'
    AND digest_approved_at IS NOT NULL
  )
);
