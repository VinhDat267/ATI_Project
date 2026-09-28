-- Explicit pilot-only subscription accounting. Existing grants and calls remain METERED.
ALTER TABLE pilot_ai_grants
  ADD COLUMN billing_mode TEXT NOT NULL DEFAULT 'METERED'
    CHECK (billing_mode IN ('METERED','INCLUDED_SUBSCRIPTION')),
  ADD COLUMN endpoint TEXT,
  ADD COLUMN no_paid_fallback BOOLEAN NOT NULL DEFAULT false,
  DROP CONSTRAINT pilot_ai_grants_max_estimated_cost_micros_check,
  ADD CONSTRAINT pilot_ai_grants_max_estimated_cost_micros_check CHECK (
    (billing_mode='METERED' AND max_estimated_cost_micros > 0 AND endpoint IS NULL AND NOT no_paid_fallback)
    OR (billing_mode='INCLUDED_SUBSCRIPTION' AND provider='openai'
      AND model='cx/gpt-5.6-sol' AND endpoint='http://localhost:20128/v1'
      AND no_paid_fallback AND max_calls=1 AND max_estimated_cost_micros=0)
  );
ALTER TABLE ai_provider_calls
  ADD COLUMN billing_mode TEXT NOT NULL DEFAULT 'METERED'
    CHECK (billing_mode IN ('METERED','INCLUDED_SUBSCRIPTION')),
  ADD COLUMN endpoint TEXT,
  ADD COLUMN no_paid_fallback BOOLEAN NOT NULL DEFAULT false,
  ADD CONSTRAINT ai_provider_calls_subscription_shape CHECK (
    (billing_mode='METERED' AND estimated_cost_micros >= 0 AND endpoint IS NULL AND NOT no_paid_fallback)
    OR (billing_mode='INCLUDED_SUBSCRIPTION' AND provider='openai'
      AND model='cx/gpt-5.6-sol' AND endpoint='http://localhost:20128/v1'
      AND no_paid_fallback AND estimated_cost_micros=0)
  );
-- A durable attempt references a call whose reserved policy fields cannot drift unnoticed.
