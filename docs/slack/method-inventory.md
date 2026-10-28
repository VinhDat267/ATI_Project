# Slack API inventory · SLACK-01

[Snapshot](method-inventory.json) covers the 343 canonical method URLs in the official sitemap at collection time. It is documentation evidence, not a tool catalog or native-provider acceptance.

| Result | Count |
|---|---:|
| Method rows, exactly matching frozen index | 343 |
| Method metadata explicitly declares user scopes | 254 |
| No user-scope declaration; token eligibility undetermined | 89 |
| Excluded from Free/Pro user tools | 97 |
| Still require native entitlement/role/behavior probes | 246 |
| Implemented or live-verified tools claimed here | 0 |

Of the 97 exclusions, 92 method pages explicitly carry the Enterprise-only availability notice, three document deprecated/retired/non-functional methods (`files.upload`, `rtm.start`, `users.setActive`), and two require an app-level token (`apps.connections.open`, `apps.event.authorizations.list`). The last authorization lookup remains infrastructure planned in SLACK-04; it is not a user-token business tool.

## Read the evidence correctly

- `sourceUrl`, `fetchedAt`, `sourceSha256` identify each method page. The frozen `index.methods` contains canonical method names and `index.sha256` identifies the fetched sitemap.
- `userToken:documented` means the method's frontmatter has an explicit `scopes.user` array. It does not prove all scopes are granted, the caller has the role or the workspace plan is eligible. `null` scopes mean no declaration; they do not mean the method rejects user tokens. An explicit empty array is different from absence.
- `reviewState:reviewed` records review of this metadata and the documented restrictions/unknowns, not completed native probes or a security review of a tool implementation. `probe_required` remains open even on a reviewed row.
- `planRequirement`/`roleRequirement` are conservative. If the available evidence does not establish a requirement, the row explicitly requires a native probe; no absence-of-restriction inference is made. Lists need a paid-plan capability check; Canvas operations need their particular Free/Pro capability verified. Stars describe the legacy API, not the current Later UI.
- `sideEffect`/`risk` are manually annotated for 72 straightforward descriptions; 271 remain `undetermined` and require action-specific review before a tool can be defined. HTTP verbs and scope suffixes are never used to infer side effects: some write methods use read-named scopes.
- `atiMapping` points to a future card/family or connection infrastructure, not an implemented tool. All rows have `deliveryStatus:not_implemented`. There is no generic method dispatcher and this file does not enable any runtime capability.

## Commands

```powershell
node scripts/slack/inventory.mjs collect --output docs/slack/method-inventory.json
node scripts/slack/inventory.mjs verify --input docs/slack/method-inventory.json
node --test scripts/slack/inventory.test.mjs
```

Collection reads only the HTTPS docs.slack.dev sitemap and method markdown, at most two requests in flight, with a 10-second request signal and at most two retries. It never reads Slack credentials or calls the Slack Web API. A Retry-After beyond the bounded wait budget stops collection rather than retrying too early.

Run the collector with root development dependencies installed (`npm ci`). It uses the explicitly declared, already locked `saxes@6.0.0` XML parser. Invalid XML or misplaced sitemap urlset/url/loc elements fail collection before an existing snapshot can be overwritten; valid namespaced extension metadata is preserved as irrelevant to method extraction.

New rows start `unreviewed`. Recollection preserves annotations only as reviewed when their source hash matches; a changed page becomes `source_changed` and needs review. Verify is entirely offline, rejects omitted/duplicate/extra methods, missing provenance and any unreviewed/changed row. It does not fetch a newer index or promote rows to supported.

For the first snapshot the exported collector also retained method markdown temporarily in the ignored execution workspace for review. Only extracted metadata, hashes and annotations are committed. The cached documentation is not needed for offline verify.

SLACK-02–07 must resolve the applicable probes and record native readback for each implemented capability. Full Slack acceptance remains open; passing this verifier only establishes inventory coverage and recorded decisions for this snapshot.

On 29/10/2026 a parser compatibility check of the current public sitemap returned 354 methods, with all 343 frozen methods still present and 11 additional slackbot.skills/admin.slackbot.skills methods. Both the old and corrected parser returned 354 for that same document. This fix retains the reviewed 343-row artifact; the 11 additions require a separate inventory refresh/review before any capability claim.
