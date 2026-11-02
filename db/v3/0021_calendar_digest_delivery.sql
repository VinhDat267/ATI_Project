-- Written before Calendar digest dispatch. A crash cannot turn an uncertain
-- external write into a retryable planning failure.
ALTER TABLE schedule_runs ADD COLUMN IF NOT EXISTS delivery_started_at TIMESTAMPTZ;
