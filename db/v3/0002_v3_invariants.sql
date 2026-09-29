-- Refuse duplicate pending approvals and duplicate credential slots at the database boundary.
-- If existing rows conflict, this migration fails without deleting user data.
CREATE UNIQUE INDEX IF NOT EXISTS ux_plans_one_pending_per_conversation
  ON plans (conv_id) WHERE status = 'pending';

CREATE UNIQUE INDEX IF NOT EXISTS ux_service_credentials_service_owner
  ON service_credentials (service, user_id) NULLS NOT DISTINCT;
