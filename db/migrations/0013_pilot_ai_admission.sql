-- Offline pilot AI admission. Existing B/local provider campaigns/calls remain intact.
CREATE TABLE pilot_ai_grants (
  campaign_id TEXT PRIMARY KEY,
  principal_id UUID NOT NULL UNIQUE REFERENCES users(id),
  provider TEXT NOT NULL CHECK (provider IN ('google','openai')),
  model TEXT NOT NULL CHECK (length(btrim(model)) > 0),
  max_calls INTEGER NOT NULL CHECK (max_calls > 0),
  max_estimated_cost_micros BIGINT NOT NULL CHECK (max_estimated_cost_micros > 0),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT pilot_ai_grant_campaign_key CHECK (campaign_id = 'pilot-v2:' || principal_id::text),
  CONSTRAINT pilot_ai_grant_owner_fk FOREIGN KEY (campaign_id,principal_id)
    REFERENCES ai_provider_campaigns(campaign_id,user_id),
  CONSTRAINT pilot_ai_grant_owner_pair UNIQUE (campaign_id,principal_id)
);

CREATE TABLE pilot_ai_attempts (
  run_id UUID PRIMARY KEY REFERENCES runs(id) ON DELETE CASCADE,
  principal_id UUID NOT NULL,
  campaign_id TEXT NOT NULL,
  call_id UUID UNIQUE REFERENCES ai_provider_calls(call_id),
  state TEXT NOT NULL CHECK (state IN ('reserved','dispatch_claimed','settled','uncertain')),
  dispatch_claimed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT pilot_ai_attempt_grant_fk FOREIGN KEY (campaign_id,principal_id)
    REFERENCES pilot_ai_grants(campaign_id,principal_id),
  CONSTRAINT pilot_ai_attempt_claim_shape CHECK (
    (state <> 'reserved' OR dispatch_claimed_at IS NULL) AND
    (state NOT IN ('dispatch_claimed','uncertain') OR (dispatch_claimed_at IS NOT NULL AND call_id IS NOT NULL))
  )
);
CREATE INDEX pilot_ai_attempts_principal_idx ON pilot_ai_attempts (principal_id,created_at);

CREATE TABLE pilot_planner_outcomes (
  run_id UUID PRIMARY KEY REFERENCES runs(id) ON DELETE CASCADE,
  principal_id UUID NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL CHECK (kind IN ('plan','clarification','refusal','failure')),
  reason_code TEXT NOT NULL CHECK (reason_code IN (
    'PLAN_PROPOSED','CLARIFICATION_REQUIRED','REFUSED','PLANNING_FAILED'
  )),
  message TEXT CHECK (message IS NULL OR char_length(message) <= 500),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT pilot_planner_outcome_kind_code CHECK (
    (kind='plan' AND reason_code='PLAN_PROPOSED' AND message IS NULL) OR
    (kind='clarification' AND reason_code='CLARIFICATION_REQUIRED' AND message IS NOT NULL) OR
    (kind='refusal' AND reason_code='REFUSED' AND message IS NOT NULL) OR
    (kind='failure' AND reason_code='PLANNING_FAILED' AND message IS NOT NULL)
  )
);
CREATE INDEX pilot_planner_outcomes_principal_idx ON pilot_planner_outcomes (principal_id,created_at);
