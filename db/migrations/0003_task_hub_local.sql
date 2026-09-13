-- Local receiver data. These tables never send to Slack or Google Sheets.
CREATE TABLE hub_sheets (
  user_id UUID NOT NULL REFERENCES users(id),
  workbook_id TEXT NOT NULL,
  sheet_name TEXT NOT NULL,
  cells JSONB NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(cells) = 'array'),
  PRIMARY KEY (user_id, workbook_id, sheet_name)
);
CREATE TABLE hub_channels (
  user_id UUID NOT NULL REFERENCES users(id),
  channel TEXT NOT NULL,
  PRIMARY KEY (user_id, channel)
);
CREATE TABLE hub_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  channel TEXT NOT NULL,
  text TEXT NOT NULL,
  thread_id UUID REFERENCES hub_messages(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (user_id, channel) REFERENCES hub_channels(user_id, channel)
);
CREATE TABLE hub_receipts (
  user_id UUID NOT NULL REFERENCES users(id),
  operation_id UUID NOT NULL,
  tool_name TEXT NOT NULL,
  policy_version TEXT NOT NULL,
  payload_hash TEXT NOT NULL CHECK (payload_hash ~ '^[a-f0-9]{64}$'),
  result JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, operation_id)
);
