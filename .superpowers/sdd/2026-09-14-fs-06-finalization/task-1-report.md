# FS-06 Task 1 — scope, protected hashes, and provenance audit

## Owned files

- `scripts/fs06-scope-audit.mjs`
- `docs/task-hub-evidence/batch-02/FS-06/1789381765007-scope-audit/`
- `docs/task-hub-evidence/batch-02/FS-06/1789382197418-scope-audit-r2/`
- `docs/task-hub-evidence/batch-02/FS-06/1789382825105-scope-audit-r3/`
- `docs/task-hub-evidence/batch-02/FS-06/1789382892954-scope-audit-fixed2/`
- `docs/task-hub-evidence/batch-02/FS-06/1789383162088-scope-audit-fixed3/`
- `docs/task-hub-evidence/batch-02/FS-06/1789383515286-scope-audit-fixed4/`
- `docs/task-hub-evidence/batch-02/FS-06/1789383553778-scope-audit-fixed5/`
- `docs/task-hub-evidence/batch-02/FS-06/1789383831828-scope-audit-fixed6/`
- This report

## Fresh command and result

Executed from `D:\Môn học\ATI\ATI_Project`:

```powershell
node scripts/capture-command.mjs FS-06 scope-audit-fixed6 node scripts/fs06-scope-audit.mjs
```

The first capture remains preserved at [scope-audit](../../../docs/task-hub-evidence/batch-02/FS-06/1789381765007-scope-audit/); lexical-parser repairs remain preserved through [scope-audit-fixed3](../../../docs/task-hub-evidence/batch-02/FS-06/1789383162088-scope-audit-fixed3/), and the prior real-parser capture remains at [scope-audit-fixed5](../../../docs/task-hub-evidence/batch-02/FS-06/1789383553778-scope-audit-fixed5/). The audit no longer treats lexical grammar as authoritative: it creates a generated loopback database, invokes the existing `@wap/db` `migrate` runtime, checks the resulting `schema_migrations` rows, and drops the generated database. Before connecting, it rejects a nonempty URL query/fragment and requires the exact loopback PostgreSQL `wap_g1` admin target; it then clears query and fragment when constructing the generated-database URL and checks the resulting pathname. The final capture exited `0` with no signal or spawn error: [command record](../../../docs/task-hub-evidence/batch-02/FS-06/1789383831828-scope-audit-fixed6/command.json), [output log](../../../docs/task-hub-evidence/batch-02/FS-06/1789383831828-scope-audit-fixed6/output.log), [scope audit](../../../docs/task-hub-evidence/batch-02/FS-06/1789383831828-scope-audit-fixed6/scope-audit.json), and [migration apply](../../../docs/task-hub-evidence/batch-02/FS-06/1789383831828-scope-audit-fixed6/migration-apply.json). The final artifact reports `status: "PASS"`.

## Results

- Protected baseline count: `180`; protected mismatches: `[]`.
- Migration files: `0001_init.sql`, `0002_audit_contracts.sql`, `0003_task_hub_local.sql`, `0004_task_hub_cards.sql`, and `0005_filesystem_dispatches.sql`.
- Migration SHA-256 checksums:
  - `0001_init.sql`: `ed6a450a1ccc22e71679b952f7ae2ee5aa5cacb48aa9a6dc32bae3e96e4de5f8`
  - `0002_audit_contracts.sql`: `ab2ab84660539f1d559ae68c8d542202203c3d098dbd162c88311b9173641689`
  - `0003_task_hub_local.sql`: `18e1edc97a2a18b245a85b7814b3b65f4b42c04ca54f3b10fbb8fecf0cb8ebc3`
  - `0004_task_hub_cards.sql`: `7c566bedb2cb8e886bd9a2c116955af288ec3cd483bdbf4e39ac29166197ca4e`
  - `0005_filesystem_dispatches.sql`: `d7af10defa6c886d73edaf569e9326dae10932e9f8b47e7f7508f25866ba9521`
- Source drift: `17` of the baseline's source-hash paths differ. This is recorded in `source_sha256.changed` for later source-change explanation; it does not weaken or replace the protected-file comparison.
- Credential scan: `PASS`, with `matches: []` after scanning only the generated audit JSON.
- Authoritative PostgreSQL parser/apply: `PASS`. `migration-apply.json` records generated database `fs06_parse_13ff59a8587549cca34de1c543d2473f`, all five migration names and matching checksums in `schema_migrations`, `lexical_preflight: true`, `db_dropped: true`, and `error_kind: null`. The audit rejects URL query/fragment overrides and any target outside exact loopback PostgreSQL `wap_g1` before a connection is created; a configuration refusal is reported only as `DatabaseConfigurationRejected`, without the supplied URL or credential values. It validates the generated-name pattern and exact effective generated pathname before create and drop.
- Status-path review: `working_tree_paths` includes `README.md` and does not include `EADME.md`.
- Parser and scanner review: `node scripts/fs06-scope-audit.mjs --self-test` passed. The lexical grammar remains a cheap preflight and its fixtures reject malformed table, enum, index, update, and named-constraint forms. PostgreSQL application is the authoritative decision for arbitrary SQL validity. The self-test also verifies `README.md` status parsing, detects serialized `password`, `api_key`, and `authorization: Bearer ...` values, and keeps a generated-json-shaped clean fixture clean.

## Self-review

The script reads the handoff baseline without modifying it, hashes raw bytes with SHA-256, normalizes and sorts path-based output, and writes fresh `scope-audit.json` plus `migration-apply.json` only in its supplied evidence directory. It keeps source drift and protected mismatches in distinct groups, treats missing or changed protected bytes as a failing condition, and requires the actual PostgreSQL 16 parser to apply the five migrations to a unique generated database before returning `PASS`. It rejects nonempty database URL query/fragment fields before use, requires the exact loopback `wap_g1` admin target, clears query/fragment on the isolated URL, and verifies its exact generated pathname. It verifies the five resulting `schema_migrations` checksums, then drops and verifies absence of only the generated `fs06_parse_<32 lowercase hex>` database in `finally`; its lexical grammar is preflight only. Git status is parsed without trimming the whole output, preserving its two-character prefix and first path. Credential matching examines JSON key/value syntax and records only finding kinds rather than matched values. No production, schema, policy, catalog, historical, or `batch-01` file was edited.
