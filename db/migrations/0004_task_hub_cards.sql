CREATE TABLE hub_boards (
  user_id UUID NOT NULL REFERENCES users(id),
  board_id TEXT NOT NULL CHECK (char_length(board_id) BETWEEN 1 AND 200),
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 200),
  PRIMARY KEY (user_id, board_id)
);
CREATE TABLE hub_lists (
  user_id UUID NOT NULL,
  board_id TEXT NOT NULL,
  list_name TEXT NOT NULL CHECK (char_length(list_name) BETWEEN 1 AND 200),
  position INTEGER NOT NULL DEFAULT 0 CHECK (position >= 0),
  is_done BOOLEAN NOT NULL DEFAULT false,
  PRIMARY KEY (user_id, board_id, list_name),
  FOREIGN KEY (user_id, board_id) REFERENCES hub_boards(user_id, board_id)
);
CREATE TABLE hub_members (
  user_id UUID NOT NULL,
  board_id TEXT NOT NULL,
  member_id TEXT NOT NULL CHECK (char_length(member_id) BETWEEN 1 AND 200),
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 200),
  PRIMARY KEY (user_id, board_id, member_id),
  FOREIGN KEY (user_id, board_id) REFERENCES hub_boards(user_id, board_id)
);
CREATE TABLE hub_cards (
  user_id UUID NOT NULL,
  card_id TEXT NOT NULL DEFAULT gen_random_uuid()::text CHECK (char_length(card_id) BETWEEN 1 AND 200),
  board_id TEXT NOT NULL,
  list_name TEXT NOT NULL,
  title TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 500 AND title ~ '[^[:space:]]'),
  description TEXT NOT NULL DEFAULT '' CHECK (char_length(description) <= 16000),
  due_date DATE,
  assignee_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (user_id, card_id),
  FOREIGN KEY (user_id, board_id, list_name) REFERENCES hub_lists(user_id, board_id, list_name),
  FOREIGN KEY (user_id, board_id, assignee_id) REFERENCES hub_members(user_id, board_id, member_id)
);
CREATE INDEX hub_cards_board_updated ON hub_cards(user_id, board_id, updated_at, card_id);
CREATE INDEX hub_cards_board_assignee ON hub_cards(user_id, board_id, assignee_id);
