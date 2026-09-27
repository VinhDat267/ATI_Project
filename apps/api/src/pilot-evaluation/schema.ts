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
 payload jsonb NOT NULL CHECK (
   jsonb_typeof(payload)='object' AND octet_length(payload::text) <= 16384 AND
   payload - ARRAY['code','kind','valid','digest','usageKnown','costKnown',
     'costMicros','inputTokens','outputTokens','status','previewHash']::text[] = '{}'::jsonb
 ), previous_hash text NOT NULL, event_hash text NOT NULL,
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
CREATE FUNCTION pilot_eval.protect_campaign() RETURNS trigger LANGUAGE plpgsql
 SET search_path = pg_catalog AS $$ BEGIN
 IF NEW.measurement_id IS DISTINCT FROM OLD.measurement_id OR
    NEW.manifest_json IS DISTINCT FROM OLD.manifest_json OR
    NEW.manifest_hash IS DISTINCT FROM OLD.manifest_hash OR
    NEW.created_at IS DISTINCT FROM OLD.created_at OR
    OLD.state IN ('completed','incomplete','blocked') OR
    NOT ((OLD.state='frozen' AND NEW.state='running' AND NEW.sealed_hash IS NULL) OR
         (OLD.state='running' AND NEW.state IN ('completed','incomplete','blocked') AND
          NEW.sealed_hash ~ '^[0-9a-f]{64}$' AND OLD.sealed_hash IS NULL))
 THEN RAISE EXCEPTION 'IMMUTABLE_CAMPAIGN'; END IF;
 RETURN NEW; END $$;
CREATE TRIGGER protect_campaign BEFORE UPDATE ON pilot_eval.campaigns
 FOR EACH ROW EXECUTE FUNCTION pilot_eval.protect_campaign();
CREATE FUNCTION pilot_eval.protect_slot() RETURNS trigger LANGUAGE plpgsql
 SET search_path = pg_catalog AS $$ BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'IMMUTABLE_SLOT'; END IF;
 IF NEW.measurement_id IS DISTINCT FROM OLD.measurement_id OR NEW.slot_id IS DISTINCT FROM OLD.slot_id OR
    NEW.ordinal IS DISTINCT FROM OLD.ordinal OR NEW.principal_id IS DISTINCT FROM OLD.principal_id OR
    NEW.input_hash IS DISTINCT FROM OLD.input_hash OR NEW.eligibility IS DISTINCT FROM OLD.eligibility OR
    (OLD.run_id IS NOT NULL AND NEW.run_id IS DISTINCT FROM OLD.run_id) OR
    (OLD.call_id IS NOT NULL AND NEW.call_id IS DISTINCT FROM OLD.call_id) OR
    (NEW.call_id IS NOT NULL AND NEW.run_id IS NULL) OR
    EXISTS(SELECT 1 FROM pilot_eval.seals WHERE measurement_id=OLD.measurement_id AND slot_id=OLD.slot_id)
 THEN RAISE EXCEPTION 'IMMUTABLE_SLOT'; END IF;
 RETURN NEW; END $$;
CREATE TRIGGER protect_slot BEFORE UPDATE OR DELETE ON pilot_eval.slots FOR EACH ROW EXECUTE FUNCTION pilot_eval.protect_slot();
CREATE FUNCTION pilot_eval.guard_event_insert() RETURNS trigger LANGUAGE plpgsql
 SET search_path = pg_catalog AS $$ DECLARE
 campaign_state text; slot_run uuid; slot_call uuid; sealed_state text;
 BEGIN
 SELECT c.state,s.run_id,s.call_id INTO campaign_state,slot_run,slot_call
 FROM pilot_eval.campaigns c JOIN pilot_eval.slots s USING(measurement_id)
 WHERE s.measurement_id=NEW.measurement_id AND s.slot_id=NEW.slot_id
 FOR UPDATE OF c;
 IF campaign_state IS NULL OR
    (campaign_state <> 'running' AND NOT (campaign_state='incomplete' AND NEW.event_type='late_return')) OR
    (NEW.run_id IS NOT NULL AND NEW.run_id IS DISTINCT FROM slot_run) OR
    (NEW.call_id IS NOT NULL AND NEW.call_id IS DISTINCT FROM slot_call)
 THEN RAISE EXCEPTION 'INVALID_EVENT_LINKAGE'; END IF;
 SELECT completeness INTO sealed_state FROM pilot_eval.seals
 WHERE measurement_id=NEW.measurement_id AND slot_id=NEW.slot_id;
 IF sealed_state IS NOT NULL AND NOT (sealed_state='incomplete' AND
    campaign_state='incomplete' AND NEW.event_type='late_return')
 THEN RAISE EXCEPTION 'SEALED_SLOT'; END IF;
 RETURN NEW; END $$;
CREATE TRIGGER guard_event_insert BEFORE INSERT ON pilot_eval.events
 FOR EACH ROW EXECUTE FUNCTION pilot_eval.guard_event_insert();
REVOKE ALL ON FUNCTION pilot_eval.protect_campaign() FROM PUBLIC;
REVOKE ALL ON FUNCTION pilot_eval.guard_event_insert() FROM PUBLIC;
REVOKE ALL ON FUNCTION pilot_eval.immutable() FROM PUBLIC;
REVOKE ALL ON FUNCTION pilot_eval.protect_slot() FROM PUBLIC;
`;
