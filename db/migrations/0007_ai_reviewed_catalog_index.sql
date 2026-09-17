-- AI-01: reviewed catalog snapshots and exact pgvector retrieval.
-- This is intentionally separate from the historical raw `tools` registry:
-- planner retrieval may consume only a validated reviewed snapshot.
CREATE TABLE reviewed_catalog_snapshots (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  catalog_hash TEXT NOT NULL CHECK (catalog_hash ~ '^[a-f0-9]{64}$'),
  catalog JSONB NOT NULL CHECK (jsonb_typeof(catalog) = 'array'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, catalog_hash)
);

CREATE TABLE reviewed_embedding_indexes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  catalog_hash TEXT NOT NULL,
  provider TEXT NOT NULL CHECK (char_length(btrim(provider)) > 0),
  model TEXT NOT NULL CHECK (char_length(btrim(model)) > 0),
  dimensions SMALLINT NOT NULL CHECK (dimensions = 1536),
  preprocessing_version TEXT NOT NULL CHECK (char_length(btrim(preprocessing_version)) > 0),
  state TEXT NOT NULL CHECK (state IN ('building', 'active', 'superseded')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  activated_at TIMESTAMPTZ,
  FOREIGN KEY (user_id, catalog_hash)
    REFERENCES reviewed_catalog_snapshots(user_id, catalog_hash)
    ON DELETE CASCADE
);

-- Exactly one queryable space per reviewed snapshot/user. A model change writes
-- a complete replacement index and atomically supersedes this one.
CREATE UNIQUE INDEX reviewed_embedding_indexes_one_active_idx
  ON reviewed_embedding_indexes(user_id, catalog_hash)
  WHERE state = 'active';

CREATE INDEX reviewed_embedding_indexes_lookup_idx
  ON reviewed_embedding_indexes(user_id, catalog_hash, state);

CREATE TABLE reviewed_tool_embeddings (
  index_id UUID NOT NULL REFERENCES reviewed_embedding_indexes(id) ON DELETE CASCADE,
  tool_server TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  content_hash TEXT NOT NULL CHECK (content_hash ~ '^[a-f0-9]{64}$'),
  embedding VECTOR(1536) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (index_id, tool_server, tool_name)
);

-- Do not add HNSW/IVFFlat here: B/local has at most ten tools and AI-01 uses
-- an exact cosine scan. Approximate search needs a separate approved change.
