CREATE TABLE IF NOT EXISTS oauth_states (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  state_hash TEXT NOT NULL UNIQUE CHECK (state_hash ~ '^[a-f0-9]{64}$'),
  browser_binding_hash TEXT NOT NULL CHECK (browser_binding_hash ~ '^[a-f0-9]{64}$'),
  code_verifier TEXT NOT NULL,
  nonce TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('login', 'link')),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  session_id UUID REFERENCES auth_sessions(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((mode='login' AND user_id IS NULL AND session_id IS NULL)
      OR (mode='link' AND user_id IS NOT NULL AND session_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_oauth_states_expiry ON oauth_states(expires_at);
