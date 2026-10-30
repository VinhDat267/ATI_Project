-- Server-owned coverage certificate. NULL is legacy/unclassified, never proof of no Slack dependency.
ALTER TABLE messages ADD COLUMN IF NOT EXISTS slack_lineage_manifest JSONB;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='messages'::regclass AND conname='chk_slack_message_manifest') THEN
    ALTER TABLE messages ADD CONSTRAINT chk_slack_message_manifest
      CHECK (slack_lineage_manifest IS NULL OR jsonb_typeof(slack_lineage_manifest)='array');
  END IF;
END $$;

-- Queue selection only. Authorization and physical mutation use the TypeScript selector implementation.
CREATE OR REPLACE FUNCTION slack_selector_decode(v TEXT) RETURNS TEXT LANGUAGE plpgsql IMMUTABLE STRICT AS $$
DECLARE result BYTEA := ''::bytea; i INT := 1;
BEGIN
  WHILE i <= length(v) LOOP
    IF substr(v,i,1)='%' THEN result := result || decode(substr(v,i+1,2),'hex'); i := i+3;
    ELSE result := result || convert_to(substr(v,i,1),'UTF8'); i := i+1; END IF;
  END LOOP;
  RETURN convert_from(result,'UTF8');
END $$;
CREATE OR REPLACE FUNCTION slack_message_selector_value(content TEXT, metadata JSONB, kind TEXT, selector TEXT)
RETURNS JSONB LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE path TEXT[]; bits TEXT[]; values_json JSONB; element JSONB; selected JSONB; hits INT := 0; k TEXT;
BEGIN
  IF kind='chat_history_message' THEN
    IF selector='content' THEN RETURN to_jsonb(content); END IF;
    IF selector LIKE 'metadata.resourceLabels/%' THEN RETURN metadata #> ARRAY['resourceLabels',slack_selector_decode(substr(selector,25))]; END IF;
    IF selector LIKE 'metadata.clarification.%' OR selector LIKE 'metadata.refusal.%' THEN RETURN metadata -> split_part(selector,'.',3); END IF;
    RETURN metadata #> string_to_array(substr(selector,10),'.');
  END IF;
  IF kind<>'working_memory_entity' OR left(selector,7)<>'state:/' THEN RETURN NULL; END IF;
  bits := string_to_array(substr(selector,8),'#id=');
  path := string_to_array(bits[1],'/');
  FOR i IN 1..array_length(path,1) LOOP path[i] := slack_selector_decode(path[i]); END LOOP;
  values_json := metadata->'state' #> path;
  IF array_length(bits,1)=1 THEN RETURN values_json; END IF;
  IF values_json IS NULL THEN RETURN NULL; END IF;
  IF jsonb_typeof(values_json)<>'array' THEN RETURN '{"__invalid_selector":true}'::jsonb; END IF;
  k := slack_selector_decode(bits[2]);
  FOR element IN SELECT value FROM jsonb_array_elements(values_json) LOOP
    IF element->>'id'=k THEN selected := element; hits := hits+1; END IF;
  END LOOP;
  IF hits>1 THEN RETURN '{"__ambiguous_selector":true}'::jsonb; END IF;
  RETURN selected;
END $$;
