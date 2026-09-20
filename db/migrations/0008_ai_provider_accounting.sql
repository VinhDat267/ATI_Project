-- Durable provider accounting for API AI calls.

CREATE TABLE ai_provider_campaigns (
  campaign_id       TEXT PRIMARY KEY,
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  limit_micros      BIGINT NOT NULL CHECK (limit_micros > 0),
  held_micros       BIGINT NOT NULL DEFAULT 0 CHECK (held_micros >= 0),
  committed_micros  BIGINT NOT NULL DEFAULT 0 CHECK (committed_micros >= 0),
  halted            BOOLEAN NOT NULL DEFAULT false,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ai_provider_campaigns_identity_unique UNIQUE (campaign_id, user_id)
);

CREATE TABLE ai_provider_calls (
  call_id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id       TEXT NOT NULL REFERENCES ai_provider_campaigns(campaign_id) ON DELETE CASCADE,
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  run_id            UUID NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  profile_id        TEXT NOT NULL,
  trial_id          TEXT,
  provider          TEXT NOT NULL CHECK (provider IN ('openai','google')),
  purpose           TEXT NOT NULL CHECK (purpose IN ('planning','repair','replan','query_expansion','embedding')),
  model             TEXT NOT NULL,
  request_hash      TEXT NOT NULL,
  output_cap        INTEGER CHECK (output_cap IS NULL OR output_cap > 0),
  embedding_purpose TEXT CHECK (embedding_purpose IS NULL OR embedding_purpose IN ('document','query')),
  estimated_cost_micros BIGINT NOT NULL CHECK (estimated_cost_micros >= 0),
  status            TEXT NOT NULL DEFAULT 'reserved' CHECK (status IN ('reserved','succeeded','failed','invalid_output','ambiguous','cancelled')),
  usage             JSONB,
  cost_micros       BIGINT CHECK (cost_micros IS NULL OR cost_micros >= 0),
  error_code        TEXT,
  reservation_held  BOOLEAN NOT NULL DEFAULT true,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  settled_at        TIMESTAMPTZ,
  CONSTRAINT ai_provider_calls_user_campaign_fk
    FOREIGN KEY (campaign_id, user_id)
    REFERENCES ai_provider_campaigns(campaign_id, user_id)
    DEFERRABLE INITIALLY IMMEDIATE
);

CREATE INDEX ai_provider_calls_campaign_idx
  ON ai_provider_calls (campaign_id, created_at, call_id);

CREATE INDEX ai_provider_calls_run_idx
  ON ai_provider_calls (run_id, created_at, call_id);
