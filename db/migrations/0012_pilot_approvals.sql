-- Pilot-specific, durable approval authority. One immutable preview hash per run.
CREATE TABLE pilot_approvals (
  id             UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  run_id         UUID PRIMARY KEY REFERENCES runs(id) ON DELETE CASCADE,
  owner_id       UUID NOT NULL REFERENCES users(id),
  version_id     UUID NOT NULL REFERENCES workflow_versions(id),
  snapshot_hash  TEXT NOT NULL CHECK (snapshot_hash ~ '^[a-f0-9]{64}$'),
  decision       TEXT NOT NULL DEFAULT 'pending'
                 CHECK (decision IN ('pending', 'approved', 'rejected', 'expired')),
  expires_at     TIMESTAMPTZ NOT NULL,
  decided_at     TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT pilot_approvals_decision_time CHECK (
    (decision = 'pending' AND decided_at IS NULL) OR
    (decision <> 'pending' AND decided_at IS NOT NULL)
  )
);

CREATE INDEX pilot_approvals_owner_idx ON pilot_approvals (owner_id, decision);

-- A confirmed dedupe receipt must retain the actual Trello destination.
ALTER TABLE business_reservations ADD COLUMN remote_list_id TEXT;
