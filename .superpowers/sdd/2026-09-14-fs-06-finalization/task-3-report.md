# FS-06 Task 3 — isolated two-server runtime snapshot

## Owned files

- `scripts/fs06-final-snapshot.mjs`
- `docs/task-hub-evidence/batch-02/FS-06/1789385689123-final-snapshot/`
- This report

## Fresh command and result

Executed once from `D:\Môn học\ATI\ATI_Project` with the required command:

```powershell
node scripts/capture-command.mjs FS-06 final-snapshot node scripts/fs06-final-snapshot.mjs
```

The capture ran from `2026-09-14T11:34:49.126Z` through
`2026-09-14T11:34:58.538Z`, exited `0`, and recorded no signal or spawn error.
The generated snapshot reports `status: "PASS"` at
`2026-09-14T11:34:58.495Z`.

- [Command record](../../../docs/task-hub-evidence/batch-02/FS-06/1789385689123-final-snapshot/command.json)
- [Output log](../../../docs/task-hub-evidence/batch-02/FS-06/1789385689123-final-snapshot/output.log)
- [Final snapshot](../../../docs/task-hub-evidence/batch-02/FS-06/1789385689123-final-snapshot/final-snapshot.json)
- [Snapshot runner](../../../scripts/fs06-final-snapshot.mjs)

## Isolation and live servers

The runner generated principal
`23be81d7-fbb5-4116-8d49-71fc52087de9`, PostgreSQL database
`fs06_it_80f6387ff158454fbc8636e3ae4f69f6`, and root basename
`ati-fs06-H0qbV7`. It used the real `@wap/db` `migrate`, `openDatabase`, and
`seedDemo` exports against PostgreSQL `16.15 (Debian 16.15-1.pgdg12+2)`.
It did not migrate, seed, or open an application handle to `wap_g1`; that
database was used only as the loopback PostgreSQL administrative connection
for create/drop.

Two direct MCP clients observed these identities and launch basenames:

| Server | Identity | Launch |
| --- | --- | --- |
| `task_hub` | `ati-task-hub-local/0.1.0` | `node.exe` → `server.js` |
| `filesystem` | `secure-filesystem-server/0.2.0` | `node.exe` → `index.js` |

Both raw `tools/list` calls used cursor pagination with duplicate-name and
cursor-loop rejection. The direct task_hub surface contained exactly 8 tools;
the direct upstream filesystem surface contained exactly 14 tools, including
`read_text_file` and `write_file`. Every discovered tool had both input and
output schemas. The trusted composite gateway exposed exactly 10 normalized
tools: 8 `task_hub` plus `filesystem.read_file` and
`filesystem.write_file`. The complete raw and normalized schemas are preserved
in `final-snapshot.json`.

## Read oracles

The direct clients issued exactly four task_hub reads and one raw filesystem
read. No receiver write tool was called.

| Oracle | Exact observed value | Result |
| --- | --- | --- |
| `read_sheet_range` | `Progress!A1:B2 = [["API","Done"],["UI","Doing"]]`, `row_count = 2` | PASS |
| `get_card` | `c1`, `Viết API`, `board_a`, `Doing` | PASS |
| `list_cards` | one matching card `c1`, count `1` | PASS |
| `list_members` | `An: 1`, `Bình: 0` active tasks | PASS |
| raw `read_text_file` | `Tiến độ ATI\nAPI: Done\n` in both structured and text MCP fields | PASS |

## Migration rows and fingerprints

The isolated database contained exactly these five `schema_migrations` rows,
and every stored checksum matched the checked-in file bytes:

| Migration | SHA-256 |
| --- | --- |
| `0001_init.sql` | `ed6a450a1ccc22e71679b952f7ae2ee5aa5cacb48aa9a6dc32bae3e96e4de5f8` |
| `0002_audit_contracts.sql` | `ab2ab84660539f1d559ae68c8d542202203c3d098dbd162c88311b9173641689` |
| `0003_task_hub_local.sql` | `18e1edc97a2a18b245a85b7814b3b65f4b42c04ca54f3b10fbb8fecf0cb8ebc3` |
| `0004_task_hub_cards.sql` | `7c566bedb2cb8e886bd9a2c116955af288ec3cd483bdbf4e39ac29166197ca4e` |
| `0005_filesystem_dispatches.sql` | `d7af10defa6c886d73edaf569e9326dae10932e9f8b47e7f7508f25866ba9521` |

Reviewed contract fingerprints:

| Path | SHA-256 |
| --- | --- |
| `config/filesystem-reviewed.json` | `51e70f20031dd897d9b063fc5218a0ae7a8643df43d073ef5f7030a7d258bb64` |
| `config/mcp-presets.json` | `a7a42e3377592f7c41b6ed09016fc44c5e2992850901b427be2c754b2ab8653f` |
| `package-lock.json` | `a3ece75957e5129cf6ccbe52a0ea743ee923aefa1e04cf13517cd908a202085f` |
| `testdata/tools.json` | `95bb83ffa8f8338a08c81e41950ff7977e235bd36f75d6e47e83db9f0279617e` |

Built runtime fingerprints:

| Path | SHA-256 |
| --- | --- |
| `apps/mcp-task-hub/dist/cards.js` | `ceb5b8a7d1a52e0da5184814f33c92142aba270184bb921d096195ef01632961` |
| `apps/mcp-task-hub/dist/contracts.js` | `2bfe613fc2417796e56e241b9fbc1fbcb8bfb049ff58da7ab8e0424fea5c2878` |
| `apps/mcp-task-hub/dist/server.js` | `26d3e0a877e5a5e8a8ce599c2c0957c6bf8eb865555a53926c8d884053958d3c` |
| `apps/mcp-task-hub/dist/service.js` | `b3cd1dcfe99e218a3875f7b5a02d9a20d6cebf48c88dcac6d6d95481dbdd3096` |
| `packages/db/dist/connection.js` | `94d0cb06bc3d162c1322fc172f036798850d488e9cbd062ccfef687032df193f` |
| `packages/db/dist/migrate.js` | `7ed489b908a44b65938578aba95a14023e67c2e76eb098407abaa26011b6a5f1` |
| `packages/db/dist/seed.js` | `5ecdd856a9fa316bf32f33e0989a2df0707289b42428f6abf96fd0afe320de6e` |
| `packages/engine/dist/gateway-filesystem.js` | `78f68cbd73f425cb3810dd44674be96e75c08541dd94175e4b40a30e5aaabf74` |
| `packages/engine/dist/gateway-task-hub.js` | `af40466f91dfdf74674a4a348c454b2cbbd483dfd1a916607380e39f3841fea0` |
| `packages/engine/dist/gateway.js` | `5207ae6099215b5614d988c1a61061a30772c4d1449359fee6a57d3c2360e235` |
| `packages/engine/dist/index.js` | `6d4ec05bbe6359ca75961ac9506de6f2e7e8bc49663782b5cc993fda7bcc5f5b` |
| `packages/engine/dist/launch-policy.js` | `17702d33e36c2ce14e31895c1ac296ef04358c23341fb40211767ae84cf8b8b4` |

The installed filesystem closure recorded the pinned
`@modelcontextprotocol/server-filesystem@2026.8.31` package, 7 package-file
hashes, 102 resolved dependency nodes with 1,643 executable/package metadata
file hashes, and 1,650 SHA-256 entries in total. All entries are present in the
snapshot. Both built engine contract exports were available. Because
`loadFilesystemLaunch` derives a persistent project-runtime principal root and
does not accept an isolated-root argument, the snapshot used the supported
explicit filesystem launch object with `openLocalGateway`.

## Cleanup and failure boundary

The nested cleanup completed with `db_dropped: true` and
`root_removed: true`. Gateway, both direct clients, both direct transports,
the application database, and the admin connection recorded no close error;
database drop and root removal recorded no error; `failure` is `null`.
A separate read-only check confirmed that the generated database and root no
longer exist after the capture. The serialized snapshot contains no database
URI or named secret field.

The runner writes the same thirteen top-level groups on failure, includes the
sanitized failure and cleanup results under `cleanup`, and exits nonzero. It
validates the generated `fs06_it_<32 lowercase hex>` name and exact
`ati-fs06-*` temp-root scope before destructive cleanup. No dependency,
production contract, schema, policy, catalog, historical evidence, or Git
history mutation was made by Task 3.
