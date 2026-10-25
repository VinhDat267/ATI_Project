-- SCHED-01: workflows that run on a schedule. Each run plans afresh and waits for approval.
-- Every migration file runs again on each migrate, so each step is idempotent.

-- 1. One schedule per conversation that created it. Only an active schedule has a next run.
CREATE TABLE IF NOT EXISTS schedules (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES users(id),
  conv_id          UUID NOT NULL CONSTRAINT schedules_conv_unique UNIQUE REFERENCES conversations(id),
  name             TEXT NOT NULL CONSTRAINT schedules_name_check CHECK (char_length(name) BETWEEN 1 AND 80),
  request          TEXT NOT NULL CONSTRAINT schedules_request_check CHECK (char_length(request) BETWEEN 1 AND 1000),
  recurrence       JSONB NOT NULL,
  services         TEXT[] NOT NULL,
  status           TEXT NOT NULL CONSTRAINT schedules_status_check CHECK (status IN ('active', 'paused', 'cancelled', 'completed')),
  pause_reason     TEXT,
  version          INTEGER NOT NULL DEFAULT 1,
  next_run_at      TIMESTAMPTZ,
  -- The proposal message applied last, so confirming it twice changes nothing.
  last_proposal_id UUID REFERENCES messages(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT schedules_next_run_check CHECK ((status = 'active') = (next_run_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS schedules_due ON schedules (next_run_at) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS schedules_owner ON schedules (user_id);

-- 2. One row per run. A planned run has its first plan; later plans are read from its conversation.
CREATE TABLE IF NOT EXISTS schedule_runs (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id      UUID NOT NULL REFERENCES schedules(id),
  schedule_version INTEGER NOT NULL,
  trigger          TEXT NOT NULL CONSTRAINT schedule_runs_trigger_check CHECK (trigger IN ('scheduled', 'manual', 'replan')),
  due_at           TIMESTAMPTZ NOT NULL,
  status           TEXT NOT NULL CONSTRAINT schedule_runs_status_check CHECK (status IN
                     ('planning', 'planned', 'needs_attention', 'planning_failed', 'interrupted', 'discarded', 'missed', 'blocked')),
  missed_count     INTEGER NOT NULL DEFAULT 0,
  conv_id          UUID REFERENCES conversations(id),
  plan_id          UUID REFERENCES plans(id),
  error            TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT schedule_runs_plan_check CHECK ((status = 'planned') = (plan_id IS NOT NULL))
);
-- A scheduled time is recorded once, even when two processes tick together.
CREATE UNIQUE INDEX IF NOT EXISTS schedule_runs_slot ON schedule_runs (schedule_id, due_at) WHERE trigger = 'scheduled';
CREATE UNIQUE INDEX IF NOT EXISTS schedule_runs_one_planning ON schedule_runs (schedule_id) WHERE status = 'planning';
CREATE INDEX IF NOT EXISTS schedule_runs_recent ON schedule_runs (schedule_id, created_at DESC);
