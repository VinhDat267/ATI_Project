// Static evaluator-only SQL ships in dist; no production migration is altered.
export const EVALUATION_SCHEMA_VERSION = "pilot-eval-1" as const;
export const EVALUATION_SCHEMA_SQL = `
CREATE SCHEMA pilot_eval;
CREATE TABLE pilot_eval.campaigns (
 measurement_id uuid PRIMARY KEY, manifest_json jsonb NOT NULL, manifest_hash text NOT NULL CHECK (manifest_hash ~ '^[0-9a-f]{64}$'),
 state text NOT NULL DEFAULT 'frozen' CHECK (state IN ('frozen','running','completed','incomplete','blocked')),
 sealed_hash text, created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE pilot_eval.slots (
 measurement_id uuid NOT NULL REFERENCES pilot_eval.campaigns(measurement_id),
 slot_id text NOT NULL, ordinal integer NOT NULL, principal_id uuid NOT NULL REFERENCES users(id),
 input_hash text NOT NULL, eligibility text NOT NULL,
 run_id uuid UNIQUE REFERENCES runs(id), call_id uuid UNIQUE REFERENCES ai_provider_calls(call_id), precleanup_status text, cleanup_status text,
 PRIMARY KEY(measurement_id,slot_id), UNIQUE(measurement_id,ordinal)
);
CREATE TABLE pilot_eval.events (
 measurement_id uuid NOT NULL, seq integer NOT NULL CHECK(seq > 0), slot_id text NOT NULL,
 event_type text NOT NULL CHECK(event_type IN ('slot_intent','callback_entered','fake_return','fake_error','http_outcome','cleanup','late_return')),
 run_id uuid REFERENCES runs(id), call_id uuid REFERENCES ai_provider_calls(call_id),
 duration_ms double precision NOT NULL CHECK(duration_ms >= 0 AND duration_ms <= 86400000),
 payload jsonb NOT NULL, previous_hash text NOT NULL, event_hash text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(measurement_id,seq),
 FOREIGN KEY(measurement_id,slot_id) REFERENCES pilot_eval.slots(measurement_id,slot_id)
);
CREATE TABLE pilot_eval.seals (
 measurement_id uuid NOT NULL, slot_id text NOT NULL,
 event_start integer NOT NULL, event_end integer NOT NULL, event_hash text NOT NULL,
 ledger_snapshot_hash text NOT NULL, completeness text NOT NULL CHECK(completeness IN ('complete','incomplete')),
 reason text NOT NULL, seal_hash text NOT NULL,
 PRIMARY KEY(measurement_id,slot_id),
 FOREIGN KEY(measurement_id,slot_id) REFERENCES pilot_eval.slots(measurement_id,slot_id)
);
CREATE TABLE pilot_eval.grades (
 measurement_id uuid NOT NULL, slot_id text NOT NULL, rubric_hash text NOT NULL,
 seal_hash text NOT NULL, grade text NOT NULL, reason text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(measurement_id,slot_id,rubric_hash,created_at),
 FOREIGN KEY(measurement_id,slot_id) REFERENCES pilot_eval.seals(measurement_id,slot_id)
);
CREATE FUNCTION pilot_eval.immutable() RETURNS trigger LANGUAGE plpgsql
 SET search_path = pg_catalog AS $$ BEGIN RAISE EXCEPTION 'IMMUTABLE_OBSERVATION'; END $$;
CREATE TRIGGER immutable_events BEFORE UPDATE OR DELETE ON pilot_eval.events FOR EACH ROW EXECUTE FUNCTION pilot_eval.immutable();
CREATE TRIGGER immutable_seals BEFORE UPDATE OR DELETE ON pilot_eval.seals FOR EACH ROW EXECUTE FUNCTION pilot_eval.immutable();
CREATE TRIGGER immutable_grades BEFORE UPDATE OR DELETE ON pilot_eval.grades FOR EACH ROW EXECUTE FUNCTION pilot_eval.immutable();
CREATE FUNCTION pilot_eval.protect_slot() RETURNS trigger LANGUAGE plpgsql
 SET search_path = pg_catalog AS $$ BEGIN
 IF EXISTS(SELECT 1 FROM pilot_eval.seals WHERE measurement_id=OLD.measurement_id AND slot_id=OLD.slot_id)
 THEN RAISE EXCEPTION 'SEALED_SLOT'; END IF;
 RETURN NEW; END $$;
CREATE TRIGGER protect_slot BEFORE UPDATE OR DELETE ON pilot_eval.slots FOR EACH ROW EXECUTE FUNCTION pilot_eval.protect_slot();
REVOKE ALL ON FUNCTION pilot_eval.immutable() FROM PUBLIC;
REVOKE ALL ON FUNCTION pilot_eval.protect_slot() FROM PUBLIC;
`;
