-- Display metadata stays outside immutable executable plan_json/plan_text/hash.
ALTER TABLE plans ADD COLUMN IF NOT EXISTS resource_labels jsonb NOT NULL DEFAULT '{}'::jsonb;
