# Slack M3 · Post-merge review integration record

01/11/2026. Reviewer documentation duty under AGENTS.md §4.5, dedicated `docs/record-slack-m3-20261101` branch/worktree615f from accepted staging `ef63950b8c45b494ca5c2369b65b1bfaafe05490`. This is a documentation consistency/publication pass, not a second product review of the fixes. Root owns final documentation review, commit and publication; product acceptance below is already complete.

Core M3 is **accepted only for internal/real PostgreSQL + HTTP fixture integration**, through PRs #225/#226/#227/#233. M2 source safety/manual approved reads remain accepted. One P3 terminal UNKNOWN recovery-action projection is deferred. Default flags stay off; staging is not main/live/native release.

Current status in this aggregate supersedes historical “pending/open/blocked” status in the implementation logs without deleting failed-command history. Later-card references in the original rulings below describe their decision-time boundary. Original implementation logs remain unchanged:

- [04B3 authorization fanout](2026-11-01-slack-04b3-authorization-fanout.md), [card](../tasks/SLACK-04B3-authorization-fanout.md).
- [04B4 captured rotation](2026-11-01-slack-04b4-rotation-recovery.md), [card](../tasks/SLACK-04B4-rotation-recovery.md).
- [04C outbox/echo/UNKNOWN](2026-11-01-slack-04c-outbox-echo-safety.md), [card](../tasks/SLACK-04C-outbox-echo-safety.md).
- [03C2 explicit approved post](2026-11-01-slack-03c2-approved-personal-post.md), [card](../tasks/SLACK-03C2-approved-personal-post.md).

## Final #233 publication evidence

Corrected product commit `97604297bd16e2fee450c645994360c4d1d20c8b`; published head `a3bbfe7a4a3409db36c2d9e97833f33298cab133`; accepted staging merge `ef63950b8c45b494ca5c2369b65b1bfaafe05490` at `2026-11-01T13:39:56Z`. Root confirmed [CI41311037228](https://github.com/VinhDat267/ATI_Project/actions/runs/41311037228) completed SUCCESS for check and all browser. Stored JSON independently parsed here matches that exact head and both named `Run npm run check`/`Run npm run test:browser:v3` steps are completed SUCCESS.

Root parsed retained UTF-16 `ci-03c2-full.log`:19 scenarios, case counts `[4,4,4,96,2,6,3,2,1,1,1,1,1,1,4,10,7,9,22]`, total179 PASS, including write4/read4. Saved job-level timestamps are internally inconsistent in some snapshots; no CI elapsed durations are inferred.

`git diff --exit-code a3bbfe7a4a3409db36c2d9e97833f33298cab133 ef63950b8c45b494ca5c2369b65b1bfaafe05490` returned exit0 in this pass. `git rev-parse <head>^{tree}` and `<merge>^{tree}` both returned `db982e1543531fdc04fc03e8e2061a5a1d16e4bd`. Earlier reviewer draft retained `git diff --exit-code 97604297..a3bbfe7a`, exit0; accepted-parent merging changed history, not corrected product tree.

## Accepted evidence ledger

| Slice | Exact published head | CI check + all browser | Staging merge | Local final evidence |
|---|---|---|---|---|
| 04B3, PR [#225](https://github.com/VinhDat267/ATI_Project/pull/225) | `8cdfdf472e39e0d64941715a99b413fb566adfaa` | [41287232359](https://github.com/VinhDat267/ATI_Project/actions/runs/41287232359), SUCCESS | `e196cef9c3424ad6490acf1c3dc80a1d4b70bb90`, equal tree | Focused 83/83 exit 0; fullcheck stages total 3,844 PASS, typecheck/build/security passed, **final process exit code not retained**; read browser 4/4 exit 0 |
| 04B4, PR [#226](https://github.com/VinhDat267/ATI_Project/pull/226) | `7c270493d64c62f7c6c48113881b7c058bcc90e6` | [41288469544](https://github.com/VinhDat267/ATI_Project/actions/runs/41288469544), SUCCESS | `8ddb777850a770755eb03d6a2aed3f991cec9488`, equal tree | Focused 66/66 exit 0; fullcheck 3,861 exit 0; read browser 4/4 exit 0 |
| 04C, PR [#227](https://github.com/VinhDat267/ATI_Project/pull/227) | `63d529f77f60c1c278184ce59f777d68864574cc` | [41290657281](https://github.com/VinhDat267/ATI_Project/actions/runs/41290657281), SUCCESS | `6272f051f833144081ba6af120fda1e1058c3150`, equal tree | Fullcheck 3,900 exit 0; read browser 4/4 exit 0; actual commit-then-AbortSignal/fresh Node child retains UNKNOWN and makes no replay |
| 03C2, PR [#233](https://github.com/VinhDat267/ATI_Project/pull/233) | `a3bbfe7a4a3409db36c2d9e97833f33298cab133` | [41311037228](https://github.com/VinhDat267/ATI_Project/actions/runs/41311037228), SUCCESS, 179 cases/19 scenarios | `ef63950b8c45b494ca5c2369b65b1bfaafe05490`, equal tree | Corrected focused 75/75 exit 0; fullcheck 3,932 exit 0; write browser 4/4 exit 0 (49.3s), read browser 4/4 exit 0 (47.6s) |

This documentation pass independently parsed stored `ci-04b3.json`, `ci-04b4.json`, `ci-04c.json`, `ci-03c2.json`: each exact SHA and the `npm run check`/`npm run test:browser:v3` steps have completed SUCCESS. This pass ran all four exact head-to-merge comparisons with `git diff --exit-code <published-head> <staging-merge>`, each exit 0. These are checks of stored evidence, not new live-provider tests.

03C2 final local counts: 3,459 v3 + 406 evaluations + 1 launcher + 66 Node = 3,932. Typecheck/build/security passed. Supported `VITEST_MAX_WORKERS=4` reduced concurrency without changing tests, timeouts or product expectations. Root supplied the final run outcomes; the earlier reviewer draft checked the following retained file hashes; this documentation pass did not rerun those suites:

| Log in the plan package | Retained SHA256 verified in the earlier reviewer handoff |
|---|---|
| `fullcheck-03c2-r2.log` | `448a5c61d4d247746b5de7fc5446dd44f3181d0b27227e95a1cd3c941415b5f5` |
| `03c2-browser-write-final.log` | `5423ba18aa93b85b461e8d67f798c53bd1ac612c690e77fc30b4f923726e0693` |
| `03c2-browser-read-final.log` | `dc470918b2d5db7d20e00838f65bc4937bbc16b25837fa1378b7601e2cbb232e` |

The earlier independent 03C2 review was on `b09528a5`: 64/64 focused PASS and five adversarial failures, categorized as four P2 and one P3. Root reproduced and fixed the four P2 in one TDD pass: misplaced Stop guard, UNKNOWN skip after fresh-service reconstruction, certification of altered step bytes, and absent current authority at final reconciliation completion. Final 75 tests include the 11 permanent additions. **No independent re-review of the fixes is claimed.** Root verification and final CI provide the correction evidence under the agreed one-review/one-fix-pass workflow.

## What the core M3 milestone means

After accepted PR #233, core M3 is recorded as accepted **only for internal/HTTP fixture integration**, including:

- 04B3: signed ingress → complete app-level authorization pages → owner/binding-scoped metadata intents; six SQL-precision watermarks and startup/re-enable gap fences. No message content/model processing in fanout.
- 04B4: captured single-use refresh checkpoint, confirmed encrypted credential transition and fresh identity validation; unknown refresh requires reconnect, with no uncertain-token replay.
- 04C: durable write attempt/outbox, exact signed echo quarantine and UNKNOWN read-only reconciliation. Actual HTTP commit followed by abort and process restart does not replay the write.
- 03C2: explicit selected workspace + literal C/G channel + exact user-authored text up to 4,000 characters → preview → approval CAS → one post → authorized readback → metadata receipt. No LLM/history/gather/source-derived/dependency write input. Separate default-off write capability and the old read-only validator remain distinct. The03C2 callback takes invalidation advisory locks before authority rows; final reconciliation requires existing step origin/exact approved args/current authority and Stop CAS. Stop retains truthful outbox evidence; reconciliation rechecks captured authority and existing step origin before final completion.

The 375/1440 light/dark browser fixtures run the real application bootstrap with stateful OAuth/user-token HTTP fixtures. “Native bootstrap” in older evidence means starting the actual application server; it **does not mean native Slack acceptance**.

## Known remaining defect

P3, `ExecutionService.getLatestExecutionSnapshot`: a terminal stopped plan retaining an UNKNOWN step can advertise `slack-reconcile`/`stop` again. Requests are denied and this is not a write bypass. Preserve the explicit deferral in the integration log, task result and current status; do not write “all findings fixed” or “no remaining P3.” No product change is proposed in this documentation task.

## Scope retained and NOT_RUN

- M4 next: SLACK-05 three modes by user/workspace, SLACK-06 Inbox/digest, with real writers/readers/erasure for `proposal_excerpt` and `daily_digest_entry`. Metadata fanout intents do not authorize later content/model work; 05 must resolve fresh authority.
- SLACK-03D/03E wider API families remain open: DM, threads, references, source-derived and multi-step/multi-call writes, uploads and method-by-method compatibility. The first C/G text post does not complete those requirements.
- SLACK-07 native Slack Free/Pro/Slack Connect, two users, real permissions/readback, model evaluation and native echo correlation remain **NOT_RUN in this M3 evidence**. In particular, pre-receipt echo behavior without native `client_msg_id` still needs a native probe.
- Full F3/F4 remain open. Five existing core artifact kinds and fixture lifecycle chains do not close all seven kinds, assistant surfaces, broad API or release requirements.
- `MYSLACK_ENABLED`/`MYSLACK_WRITES_ENABLED` remain default-off; main/live remain off. No production backfill or live rollout was run or authorized by fixture acceptance. No claim of production migration acceptance or Windows OS graceful-signal behavior.
- Unchanged ordinary rotation and historical source-erasure algorithms were not independently recertified by this review; integration regressions are not broad/native subsystem acceptance.

## Historical evidence and operational incident

The initial03C2 focused64/64 and write browser4/4 (32.7s) are explicitly pre-review evidence, not acceptance of fixes. Root final corrected-source evidence is75/75, fullcheck3,932 and write/read browser4/4 each (49.3s/47.6s), all exit0. Initial fixture/locator/CLI errors are not product RED evidence. The combined fresh-retry extra POST followed failed Stop with background work and was not standalone proof of replay; independent skip/origin/authority/Stop reproductions and final regressions are retained in the implementation log.

An account-switch command accidentally touched dirty main execution files. Root backed up accidental bytes, surgically removed only its own insertions and reversed the encoding conversion, preserving unrelated workspace work. Main route returned to no diff; remaining main execution edits belonged to workspace authorization work. This documentation pass used only explicit absolute615f workdirs and cwd-asserting Python; it does not claim main was never touched during M3 implementation.

04B3 local stage success has no retained final process exit code; exact-head CI success is separate evidence. Earlier04B4/04C failed/interrupted runs, outside-diff failures and the AUTH02 migration5s timeout remain in original logs. They are not silently replaced by later green runs.

## Documentation integration

Updated [CURRENT-STATE](../CURRENT-STATE.md), [ROADMAP](../ROADMAP.md), [matrix](../SLACK-DELIVERY.md) and the four result/publication sections. Historical main/foundation records remain historical; M2 remains accepted. Current “M3 next”, missing fanout/rotation and globally blocked writes now point to bounded core acceptance/M4 next. [SLACK-M3-RECORD](../tasks/SLACK-M3-RECORD-integration.md) owns this duty. Product code and implementation logs remain unchanged. Root will record this documentation PR's eventual head/CI in its PR body; those are separate from accepted product evidence.

## Documentation verification

`git diff --check` returned exit0. A cwd-guarded Python check decoded all9 edited/new documents as strict UTF-8, checked379 relative Markdown link/file targets with0 missing, and compared all24 quoted Ruling entries byte-for-byte as text against the retained reviewer draft. No replacement characters or question-mark encoding artifacts were found in the new log. These checks validate documentation consistency; no product tests were rerun.

## Appendix · all24 ledger Ruling entries

These24 entries are copied verbatim from retained `progress.md` via the reviewer draft, preserving line provenance, spellings and every cost. References to later cards being “open” or CI “pending” describe their historical decision-time boundary. Current accepted evidence and remaining scope above govern this record; later fixture acceptance does not silently upgrade original rulings.

### progress.md:4

> Ruling: execute existing approved Slack design without asking for another design approval — user explicitly requested M3 implementation; implementation plan resolves only server-owned details. Cost if wrong: reviewed interfaces need adjustment before publication.

### progress.md:5

> Ruling: preserve body-free receipts; fanout creates metadata intents only, future05 fetches content under fresh authority. Missing event_context is discarded rather than inferring completeness/ownership. Cost: some provider events without context cannot trigger automation until a safe supported route is proven.

### progress.md:6

> Ruling: runtime startup/re-enable advances processing_start even across outage and records gap; no implicit backlog replay. Cost: user must request bounded retrieval of missed messages.

### progress.md:13

> Ruling: explicitappIdscope is mandatory onclaims, includingapp runtime gate. SQLtriggerscancelonlyprivate pendingmetadatajobs onconnectiongeneration/status, inactiveowner, runtimeepoch andprocessingversion changes. Cost: a provisionalcredentialblock orrestart can cancel queuedwork; it is not replayed after recovery. Future05stillrechecks sources/policy beforecontent.

### progress.md:18

> Final: Ruling: SQLauthority-effective fences are separate frombackdatableevidencedates and initialized atM3migration — stops pre-acceptanceautomaticbackfill withoutchangingmanualreadpolicy/API. Cost: priorreceipts maybediscarded; explicitboundedretrieval required. No productionbackfillran.

### progress.md:19

> Final: Ruling: reviewer declined exactheadCI/fullcheckselfrun, WindowsOSsignalgracefulshutdown,nativeSlack/Connect/Free/Pro/model andlater04B4/04C/03C2/05 — rootownsCI/fullcheckgates; coalescedrunnerHTTPaborttested, noWindowsOSgracefulclaim; remainingcards/native remainopen. Cost: deployment/nativeacceptance stillrequired.

### progress.md:28

> Ruling: confirmed rotation atomically transfers fingerprint on all matching pending provisional jobs/barriers for the same binding/config, without releasing any barrier; each job still requires its own fresh auth.test. Avoids orphaned sibling blocks after one-use rotation. Cost: broader private metadata transition must remain exact app/binding/fingerprint fenced.

### progress.md:29

> Ruling: missing retained client credentials keeps conservative validation, even with flags off; no speculative refresh. Cost: expired rotating credentials then need manual reconnect.

### progress.md:36

> Final: Ruling: reviewer set aside exact-head CI/fullcheck/typecheck/browser and two outside-diff tests; root runs final gates and retains both failure evidence and isolated recheck, without attributing them to04B4. Cost: a repeated fullsuite failure still blocks acceptance.

### progress.md:37

> Final: Ruling: reviewer set aside nativeSlack/FreePro/Connect/model, WindowsOSsignal and later04C/write/05/06/fullF3F4/release; these remain open and fixture evidence is bounded. Cost: no live readiness can be inferred.

### progress.md:38

> Final: Ruling: ordinaryTokenManager algorithm is unchanged except refresh transport extraction; existing token suite passes, capturedlifecycle is this card's scope. Cost: independent ordinaryrotation lifecycle work may still be required.

### progress.md:49

> Ruling:04C first wires internal guarded postMessage service and signed ingress echo; public write remains03C2. This is an actual PG/HTTP safety path with no public provider sideeffect exposed. Cost:04C alone does not deliver end-userwrites.

### progress.md:52

> Ruling: first04C/03C2 write family is one literal C/G channel text post<=4000, no thread/DM/reference writes; otherapprovedAPIs remain03D/03E. Cost: broaderwrites remain unavailable until separatelyreviewed.

### progress.md:53

> Ruling: every post-dispatch APIerror is conservativelyUNKNOWN, even apparentlyknownrejection; neverreplaythesameapprovedstep. Cost: usermayneedanewplan aftermanualverification, butproviderambiguitycannotduplicate.

### progress.md:54

> Ruling: echoquarantine needs exact signed metadata and outbox correlation; missingnativeclient_msg_id beforeproviderreceipt cannotbeclaimedprotected until07nativeprobe. Cost: proactiveautomation remains gatedofflive.

### progress.md:56

> 04ClatereconciliationexpiryRED→GREEN; actualNodechildrestartaftercommitAbortresends0andreadonlyconfirms1. Focusedsignedingress/repo/routes62/62exit0 before6extracases. Typecheckexit0. Ruling: planexpiry guards new dispatch, while existingdispatchedattempt permits read-onlyreconciliation with currentrights/integrity; otherwise a truthfuloutcome wouldbeunresolvable simplydueclock. Cost: oldapprovedparameters mayberead locally forcorrelation, neverpostedagain.

### progress.md:62

> Final: Ruling: futureauthorizecallbacklockorder is03C2integrationgate; beforeactualpublicwiring, takeinvalidationadvisorylocksbeforeauthorityrows. Current04Ccallbacktestsdonotimplementproductionsourcefences. Cost: publicintegrationcannotbeacceptedwithoutresolvingthisorder.

### progress.md:63

> Final: Ruling: reviewer declined fullcheck/typecheck/browser/CI; root verifies finalcorrectedhead. Nativecorrelation/FreePro/Connect/twouser/model, public03C2/sourcewrites, DM/thread/reference/multicallAPI, proactiveInbox/fullF3F4/release, productionmigration andWindowsOSsignals remainopen. Cost: internalfixtureacceptancecannotauthorize live rollout.

### progress.md:67

> 04Cfinalfullcheckr2 has onlyoldAUTH02migration5stimeout under highparallel load;1269otherAPItestsPASS. No productregressionattribution. LocalVitest4.1.11codecoverage.DM_a_rWm.js:380confirmssupportedVITEST_MAX_WORKERS env. Ruling: finalfullcheckr3caps4workers instead ofdefaultmachineCPUparallelism toavoidknownDBmigrationtimeout, withoutchangingtests/timeouts/product. Cost: longerrun, CIstillrequiredatpublishedhead.

### progress.md:72

> Ruling:03C2 uses explicit user-authoredliteral send mode with noLLM/history/gather, one channelpost and exactpreview; generalAI/source/referencewrites remainblocked. Why: smallest approvedwritefamily with demonstrableintent/hash/authority. Cost: naturallanguage/multi-stepwrites requirelaterreviewedfamilies.

### progress.md:79

> Ruling: post-dispatchStopwinsplan/stepCAS; metadataoutboxconfirmationremains truthful even ifplanstaysstopped. Cost: stoppedworkmayneedseparateoutboxreceiptinspection, noresend.

### progress.md:92

> Final: Ruling: reviewer set aside exactpublishedCI/fullcheck/typecheck/build/browser — root runs these oncorrectedhead, prior64focused/newbrowserproofisnotfixacceptance. Cost: acceptanceblockeduntilfinalgatespass.

### progress.md:93

> Final: Ruling: nativeSlack/FreePro/Connect/two-user/model/nativeecho, widerDM/thread/reference/source/multistepAPI/Inbox/automation/fullF3F4, production/main/live/OSsignals remainunproven and separate. Cost: fixturemilestonecannotauthorize rollout.

### progress.md:94

> Final: Ruling: reviewer didnotrecertifyunchangedordinaryrotation/historicalsource-erasure — onlyintegrationboundariesplusrootregressionsarecovered. Cost: those subsystemswouldneedindependentnative/broadacceptanceforproductionclaims.
