# AI Live Evaluation Readiness Runbook

Status: technical preparation implemented; live provider execution is still `NOT_RUN`.
This runbook is for an operator who has separately approved a bounded probe. It
does not create approval records, discover credentials, or authorize a paid call.

## Preconditions

- Work from the checked-out commit under review; do not run from an uncommitted
  tree for a paid phase.
- Docker PostgreSQL/pgvector is available. The evaluator database must be a
  separately prepared database and user; `wap_g1` is the application/demo DB
  and is rejected as an evaluator fallback.
- `testdata/ai-live-eval-config.json` and the checked-in B-local catalog are
  reviewed inputs. The four supported fake-tested combinations are
  `openai-only`, `google-only`, `openai-google`, and `google-openai`.
- An authorized human supplies an approval JSON whose campaign, profile, phase,
  raw config hash, provider/model scope, budget, and expiry match the command.
  Never commit that file.

Prepare a local evaluator database without resetting the shared volume:

```powershell
npm run db:up:g1
npm run db:migrate:g1
# Seed only the explicitly prepared evaluator database when it is not already seeded.
```

Set secrets only in the current process/session. The runtime reads only the
provider selected by the profile; it does not accept endpoint overrides:

```powershell
$env:AI_EVAL_USER_ID = '<prepared-evaluator-user-uuid>'
$env:AI_EVAL_DATABASE_URL = 'postgresql://<user>:<password>@<host>:<port>/<eval_db>'
$env:OPENAI_API_KEY = '<local-session-secret>'       # only for OpenAI roles
$env:GEMINI_API_KEY = '<local-session-secret>'       # only for Google roles
```

## Offline gates (safe to run without keys)

```powershell
npm run ai:eval:live -- preflight --offline
npm run test:unit -w @wap/engine
npm run test:integration -w @wap/engine -- ai-live-composition.integration.test.ts
```

The integration test uses fake HTTP transport and an isolated PostgreSQL
database. It is evidence of codec/composition/index safety, not model quality or
provider availability.

## Phase order

1. Create a human-approved `probe` approval outside the repository.
2. Probe one selected profile. Probe exercises planning, query expansion and
   query embedding; it does not claim quality.

```powershell
npm run ai:eval:live -- probe `
  --profile openai-only `
  --campaign <campaign-id> `
  --approval <approval-json> `
  --execute
```

3. Build/activate the reviewed 8+2 document index in the evaluator DB. The
   command validates host/port/database identity, writes ten 1536-dimensional
   rows, reads the active fingerprint back, and shares campaign accounting.

```powershell
npm run ai:eval:live -- index `
  --profile openai-only `
  --campaign <campaign-id> `
  --approval <index-approval-json> `
  --execute
```

4. Run smoke before any larger phase. Smoke is exactly nine trials: one dev
   plan, refusal and clarification case across `all_tools`, `semantic`, and
   `semantic_qe`, all at K=10.

```powershell
npm run ai:eval:live -- run `
  --phase smoke `
  --profile openai-only `
  --campaign <campaign-id> `
  --approval <smoke-approval-json> `
  --execute
```

5. `dev` schedules 126 trials (six dev cases × three cells × three
   repetitions). `legacy-regression` schedules 84 trials and additionally
   requires `--freeze <freeze.json>`. A proposed rubric or fake evidence keeps
   the report formally blocked even when all trials complete.

6. Render/recover a run without provider or database access:

```powershell
npm run ai:eval:live -- report --run <run-directory>
```

Recovery replays the journal only. It never retries an ambiguous provider call
or relabels missing evidence as success. `run_started` stores campaign/run,
budget, freeze hash and fingerprints so a missing summary is not authoritative.

## Cancellation and incident handling

Ctrl+C propagates one abort signal through probe/index/run and provider HTTP.
The journal is flushed before resources are closed. A campaign lock is not
released by age: verify the original process is gone before removing a stale
lock, then start a new authorized run. Held/ambiguous reservations remain part
of the campaign cap.

## Readiness boundary

The following remain explicit operator inputs and are not closed by fake tests:

- actual OpenAI/Gemini account access, model compatibility, pricing and latency;
- human-approved rubric and fresh sealed holdout;
- independent read-only review of locking, credentials, DB identity, snapshot
  completeness, oracle separation, currentness and replay;
- formal quality acceptance.

Until those inputs and the independent review are recorded, keep the status
`READY_FOR_LIVE_PROBE_PENDING_REVIEW`; provider/profile quality and cost remain
`NOT_RUN`.
