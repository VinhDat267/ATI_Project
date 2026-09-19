-- T4: persisted embedding identity for currentness checks.
-- Columns remain nullable so historical 0007 rows stay identifiable, but the
-- live activation path refuses rows/indexes that do not carry these fields.
ALTER TABLE reviewed_embedding_indexes
  ADD COLUMN vector_hash TEXT
    CHECK (vector_hash IS NULL OR vector_hash ~ '^[a-f0-9]{64}$'),
  ADD COLUMN policy_manifest JSONB
    CHECK (policy_manifest IS NULL OR jsonb_typeof(policy_manifest) = 'object');

ALTER TABLE reviewed_tool_embeddings
  ADD COLUMN purpose TEXT
    CHECK (purpose IS NULL OR purpose = 'document'),
  ADD COLUMN embedding_text_hash TEXT
    CHECK (
      embedding_text_hash IS NULL OR
      embedding_text_hash ~ '^[a-f0-9]{64}$'
    );
