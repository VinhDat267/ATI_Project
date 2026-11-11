# 06 — CI, Ancestry & Session Provenance Verification

**Audit Bundle:** `docs/audits/2026-11-10-cross-service-integration/`  
**Document Status:** Task E Local Verification Complete (`WORKER REPORTED` on `4056fef20127d7da3c3139f34830035facbf5daf`); Draft PR `#315` Open (`isDraft: true`); Final Docs-Head (`C_E3`) Exact-Head CI & Coordinator Acceptance `PENDING / NOT VERIFIED` at Commit Time  
**Date:** 2026-11-11  
**Isolated Integration Worktree:** `C:\Users\VinhDat\orca\workspaces\ATI_Project\ati-v3-cross-service-integration-gate`  
**Integration Branch:** `VinhDat267/ati-v3-cross-service-integration-gate`  
**Draft Integration PR:** [`#315`](https://github.com/VinhDat267/ATI_Project/pull/315) (`OPEN`, `isDraft: true`, base `main` — `DO NOT MERGE` without explicit Owner approval)  
**Tested Code+Test Anchor (`C_E1`):** `4056fef20127d7da3c3139f34830035facbf5daf` (full-tree `270b82ba509d0ef01069c6548e18eb53853fa556`)

---

## 1. Non-Self-Referential Commit & CI Provenance Rule

Because a Git commit SHA is a cryptographic hash over its tree and metadata, **no commit can honestly record its own SHA or claim a passing post-commit GitHub Actions run inside itself**. To avoid endless self-referential documentation commits while ensuring GitHub Actions runs on the **exact final `HEAD`**:
1. All source code and automated test changes were frozen at commit **`4056fef20127d7da3c3139f34830035facbf5daf`** (`C_E1`, full-tree **`270b82ba509d0ef01069c6548e18eb53853fa556`**) before final local verification and documentation finalization.
2. Initial documentation commit **`11027dbc1e8c07f78af29c605f5c9eafc85c71a0`** (`C_E2`, full-tree `e5ff5077c87f09d60f26b78e9c69faa1dd8efd5f`) opened Draft PR [`#315`](https://github.com/VinhDat267/ATI_Project/pull/315) (`OPEN`, `isDraft: true`) and started `v3 check` run [`42955279986`](https://github.com/VinhDat267/ATI_Project/actions/runs/42955279986). Because `11027dbc` contained premature CI/Gate claims written before `42955279986` and Coordinator acceptance completed, `11027dbc` is superseded by one docs-only provenance correction commit (`C_E3`, `git diff 4056fef20127d7da3c3139f34830035facbf5daf HEAD -- ':!docs'` === `0` bytes).
3. At the moment `C_E3` is committed, required GitHub Actions workflow `.github/workflows/v3-check.yml` (`name: v3 check`, single job `v3` executing both `npm run check` and all 25 groups of `npm run test:browser:v3`) on `C_E3` is **`PENDING / NOT VERIFIED`**, and Coordinator Codex's final independent acceptance is **`PENDING`**. Even if superseded run `42955279986` on `11027dbc` completes, it does **not** certify `C_E3`. Once `C_E3` is pushed and its **own** exact-head `v3 check` run (`headSha === C_E3`) finishes, the exact `C_E3` commit SHA, `C_E3^{tree}` SHA, and actual CI run ID/URL/conclusion are recorded **externally** in Draft PR `#315`'s body and the Orca `worker_done` report (then independently verified by Coordinator Codex) without another self-referential commit.

---

## 2. Session, Model & Effort Provenance (Task E Dispatch `ctx_0839a6aea5c4`)

| Provenance Dimension | Observed Value | Primary Evidence Source | Attribution Label |
| --- | --- | --- | --- |
| **Orca Task & Dispatch IDs** | `task_34c997689985` / `ctx_0839a6aea5c4` (Worker terminal `term_f78a2460-9cc8-4313-b775-a328d2d11a3c`; Coordinator terminal `term_217b91f8-a275-4c5e-b7c3-4061e88cefca`) | `orca orchestration worker-show --dispatch ctx_0839a6aea5c4 --full --json` | `INDEPENDENTLY VERIFIED` (Orca state) |
| **Required & Effective Session Model** | `antigravity/gemini-4-carbon-high/high` (`Gemini 4 Carbon (High)`, **zero fallback**, **zero subagents/helpers spawned**) | `worker-show` `launch.requested` & `launch.effective = antigravity/gemini-4-carbon-high/high`; `C:\Users\VinhDat\.gemini\antigravity-cli\settings.json:3` (`"model": "Gemini 4 Carbon (High)"`); `transcript.jsonl` | `WORKER REPORTED` *(Orca `launch.effective` independently inspectable by Coordinator Codex)* |
| **Effective Reasoning Effort** | `1.00` (`high` / maximum reasoning effort) | Runtime system prompt (`EFFORT LEVEL: 1.00`) + `worker-show` `launch.effective` (`/high`) | `WORKER REPORTED` *(Orca `launch.effective` inspectable by Coordinator)* |
| **Upstream Served Model Wire Header** | Raw HTTP `modelVersion` response header from upstream LLM API is not persisted in local Antigravity `transcript.jsonl` | Local `transcript.jsonl` (`source: "MODEL"` entries) | **`NOT VERIFIED`** |
| **Workspace & Environment Isolation** | Dedicated Orca worktree `C:\Users\VinhDat\orca\workspaces\ATI_Project\ati-v3-cross-service-integration-gate`; `Test-Path .env` -> `False`; zero nested worktrees; other agents' concurrent containers (`ati-notion-n2b-pg-20261111` on `58909`, `ati-gmail-g2-a1-pg-738984a1` on `51850`, `ati-gmail-g2-codex-175a2007` on `60015`) and stopped checkpoints (`eba2bdc4b9f0`, `9718bcf4290f`, `20f50936ac02`, `bbb95cabe5a4`, `synthia-release-*`) untouched | `git worktree list`, `Test-Path .env`, `docker ps -a` before and after Task E | `WORKER REPORTED` |

---

## 3. Revalidated Baseline & Source PR Exact-Head CI Provenance

Revalidated at the start of Task E (`2026-11-11`, via `git fetch origin --prune`, `git rev-parse origin/main`, `gh pr view 306/313/314 --json number,state,isDraft,headRefName,headRefOid,baseRefName`, and `gh run view <id> --json databaseId,headSha,status,conclusion,workflowName,url`) and re-checked before handoff:

| Role | Ref / PR | State & Draft Flag | Exact Commit SHA | Exact Full-Tree SHA (`^{tree}`) | Merge-Base vs `origin/main` | Exact-Head `v3 check` Run | Provenance Label |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **Baseline** | `origin/main` | Base branch | `2eed8d1d4309e833088d6f1d3fa774189049e283` | `eb2ee6f1183eb0cdc51adfa238e3043a0b4ed4b4` | `2eed8d1d4309e833088d6f1d3fa774189049e283` | Baseline `main` (`0` commits ahead since preflight) | `INDEPENDENTLY VERIFIED` |
| **Source 1 (Trello Combined)** | PR `#313` (`VinhDat267/trello-v3-combined-gate`) | `OPEN`, `isDraft: true` | `1c17527f16715b2c6655c170cdb448673a84dd1b` | `f53ed6b2b7cfdeae0f27d18e1fc7831cc69f7d76` | `2eed8d1d4309e833088d6f1d3fa774189049e283` | [`42809170181`](https://github.com/VinhDat267/ATI_Project/actions/runs/42809170181) (`headSha === 1c17527f...`, `completed` / `success`) | `CI VERIFIED` + `INDEPENDENTLY VERIFIED` |
| **Source 2 (Calendar Combined)** | PR `#314` (`VinhDat267/calendar-v3-combined-gate`) | `OPEN`, `isDraft: true` | `3807986542dbe3470b8f3f1cd42413cb7bd460dd` | `8805043497bfffe05d9620c520d098abfb00a60c` | `2eed8d1d4309e833088d6f1d3fa774189049e283` | [`42835422010`](https://github.com/VinhDat267/ATI_Project/actions/runs/42835422010) (`headSha === 38079865...`, `completed` / `success`) | `CI VERIFIED` + `INDEPENDENTLY VERIFIED` |
| **Source 3 (Sheets R2)** | PR `#306` (`VinhDat267/sheets-gas-recovery-guard-argon`) | `OPEN`, `isDraft: true` | `f292884d0ae965ffb9841e7063b8843cd266b17e` | `a9ca98c257a99da8b8d1fde266091f2a3897719b` | `2eed8d1d4309e833088d6f1d3fa774189049e283` | [`42811254062`](https://github.com/VinhDat267/ATI_Project/actions/runs/42811254062) (`headSha === f292884d...`, `completed` / `success`) | `CI VERIFIED` + `INDEPENDENTLY VERIFIED` |

- **Zero Source Movement:** `origin/main` and all three source PR heads remained 100% stationary from Task A (`2026-11-10`) through Task E (`2026-11-11`). Constituent PRs (`#309`, `#310`, `#311`, `#307`, `#308`, `#312`) were never merged separately.
- **Source Branches Untouched:** Zero commits, tags, or force-pushes were made to `VinhDat267/trello-v3-combined-gate`, `VinhDat267/calendar-v3-combined-gate`, `VinhDat267/sheets-gas-recovery-guard-argon`, or `main`.

---

## 4. Complete First-Parent Integration Lineage (`origin/main..C_E2` + `C_E3` Docs Correction)

| Phase / Step | Commit SHA | Full-Tree SHA (`^{tree}`) | Parent Commit SHA(s) | Summary |
| --- | --- | --- | --- | --- |
| **Baseline** | `2eed8d1d4309e833088d6f1d3fa774189049e283` | `eb2ee6f1183eb0cdc51adfa238e3043a0b4ed4b4` | `0ea54325...` `92821ecb...` | `origin/main` baseline (`Merge pull request #303`) |
| **`C_A`** | `83cb340128fb9f1eefaa6b5ed346237f91667f30` | `84f3ec5e10877e48043c496b84f90e3ad514c06d` | `2eed8d1d4309e833088d6f1d3fa774189049e283` | `docs(audit): add cross-service integration v2 preflight plan and conflict matrix` |
| **`C_B0`** | `f228d8a4159b944a466f246ec44a9b6e1b28b74c` | `ac3f4abdb526e51942303896a48999e4b251b671` | `83cb340128fb9f1eefaa6b5ed346237f91667f30` | `docs(audit): correct Task A script, workflow, risk, and gate provenance` |
| **`M0` (`#313`)** | `b0232fdd9f5f59c6d1b4c0fc2b882eaf2fcd8954` | `d896d0997d3b79f3265ad40ac10e306b717ac773` | `f228d8a4159b944a466f246ec44a9b6e1b28b74c` `1c17527f16715b2c6655c170cdb448673a84dd1b` | `chore(integration): merge trello combined gate PR #313 (1c17527f)` (`--no-ff`, `0` conflicts) |
| **`M1` (`#314`)** | `edbeeffeca97cdb95a4b5dec88f9ee61645910aa` | `021ce568864dbb9fb33e095e72bf8e820b0361e9` | `b0232fdd9f5f59c6d1b4c0fc2b882eaf2fcd8954` `3807986542dbe3470b8f3f1cd42413cb7bd460dd` | `chore(integration): merge calendar combined gate PR #314 (38079865)` (`--no-ff`, `0` conflicts) |
| **`M2` (`#306`)** | `678c5337f0558c3158994825a23e9d09d6ad744c` | `6185a45a29537cad679a3b161ede539350696877` | `edbeeffeca97cdb95a4b5dec88f9ee61645910aa` `f292884d0ae965ffb9841e7063b8843cd266b17e` | `chore(integration): merge sheets r2 gate PR #306 (f292884d) and resolve shared contracts` (`--no-ff`, 3 conflicts resolved) |
| **`C_B1`** | `07c086bfb5299632fc35dd85cbcf906ce4cd1099` | `fcd0e64019b0c70eb96f7e0d6352ead5f1fc7d4d` | `678c5337f0558c3158994825a23e9d09d6ad744c` | `fix(integration): align Google privacy overview and add combined contract tests` |
| **`C_B2`** | `2fa749fc2a82fc642c008957f31df7a7a61d5ab0` | `9512c3e25bd161824234ac84421c7ae67915b927` | `07c086bfb5299632fc35dd85cbcf906ce4cd1099` | `docs(audit): record Task B merge ancestry, conflict dispositions, and focused verification` |
| **`C_C1`** | `7dcd3753742c755f3493ba3f010a7a743c72a074` | `f12bcb2d71d2812f95486d985e5431fe36ef9a89` | `2fa749fc2a82fc642c008957f31df7a7a61d5ab0` | `fix(chat-api): enforce cross-service pre-dispatch guards and digest telegram bindings` |
| **`C_C2`** | `a5309f2198354d2d46519778ac9100c665ceaa96` | `2e1a488020a1c4159a4424ee8293ec6aed4a19d8` | `7dcd3753742c755f3493ba3f010a7a743c72a074` | `docs(audit): record task c cross-service backend runtime evidence and risks` |
| **`C_D1`** | `5e2819985c205311af0354c796f6d28ac9c2eee2` | `07f6eb1ca67141381d9410c3fbbad5a00469a3b9` | `a5309f2198354d2d46519778ac9100c665ceaa96` | `fix(chat-web): enforce Cockpit schedule recovery parity and add C1/C2 Chromium calendar proofs` |
| **`C_D2`** | `127ded5cf5eabeb50b26c9551880e6c9d40c0ab8` | `231611d80234a122f49d57209a9578e2637fc0b7` | `5e2819985c205311af0354c796f6d28ac9c2eee2` | `docs(audit): record task d chromium c1/c2 and ui evidence and fix provenance` |
| **`C_E1` (Frozen Tested Code+Test Anchor)** | **`4056fef20127d7da3c3139f34830035facbf5daf`** | **`270b82ba509d0ef01069c6548e18eb53853fa556`** | `127ded5cf5eabeb50b26c9551880e6c9d40c0ab8` | `fix(chat-web): fail closed on unknown schedule status and align mysheets OAuth disclosure` |
| **`C_E2` (Superseded Initial Docs Commit)** | `11027dbc1e8c07f78af29c605f5c9eafc85c71a0` | `e5ff5077c87f09d60f26b78e9c69faa1dd8efd5f` | `4056fef20127d7da3c3139f34830035facbf5daf` | `docs(audit): finalize cross-service integration v2 evidence bundle and task e verdicts` (`133` files vs `main`, `0` non-`docs/` diff vs `4056fef2`; superseded by `C_E3` to correct premature CI/Gate claims) |
| **`C_E3` (Final Docs Head)** | *Recorded externally in Draft PR `#315` body* | *Recorded externally in Draft PR `#315` body* | `11027dbc1e8c07f78af29c605f5c9eafc85c71a0` | `docs(audit): mark exact-head CI and final gate acceptance pending at commit time` (`0` non-`docs/` diff vs `4056fef2`) |

### Exact Diff & Migration Counts
- **Full diff vs `origin/main` at `4056fef2` (`2eed8d1d..4056fef2`):** `127 files changed, 24590 insertions(+), 1437 deletions(-)` (at `11027dbc`: `133 files changed, 25105 insertions(+), 1437 deletions(-)`, `INDEPENDENTLY VERIFIED` by Coordinator Codex).
- **Non-`docs/` diff vs `origin/main` (`2eed8d1d..HEAD -- ':!docs'`):** `91 files changed, 21815 insertions(+), 1437 deletions(-)` (identical across `4056fef2`, `11027dbc`, and `C_E3`).
- **Integration-only non-`docs/` diff after `M2` (`678c5337..4056fef2 -- ':!docs'`):** `17 files changed, 5266 insertions(+), 45 deletions(-)` (`plan-repo.ts`, `adapter-factory.ts`, `execution-service.ts`, `calendar-digest-runner.ts`, `trello-digest-runner.ts`, `ScheduleRunRecovery.tsx`, `PrivacyPage.tsx`, `scripts/fake-google-gmail.mjs`, plus 9 backend/frontend/browser test files).
- **Database migrations (`db/v3/*.sql`):** **47** SQL files total (`0001_v3_core.sql` .. `0035_sheets_gas_r2_remediation.sql`; exactly **1** new migration vs `origin/main`: `db/v3/0035_sheets_gas_r2_remediation.sql`, creating **70** base tables in `public`).

---

## 5. GitHub Actions Required Workflow Structure & Commit-Time CI Status

### 5.1. Verified `.github/workflows/v3-check.yml` Topology
`.github/workflows/v3-check.yml` (`name: v3 check`) triggers on `pull_request` (and `push` to `main`) and defines **exactly one job (`v3` on `ubuntu-latest`, Node.js `24`, with `postgres:16` service container on `127.0.0.1:5432/ati_v3`)** executing sequentially:
1. `actions/checkout@v4` & `actions/setup-node@v4` (`node-version: '24'`, `cache: npm`)
2. `npm ci`
3. `npm run db:migrate:v3` (`node --env-file-if-exists=.env db/v3/migrate.mjs` -> applies all 47 SQL files)
4. `npm run check` (`typecheck:v3` + `test:v3` across all 6 workspaces + `test:eval:v3` + `build:v3` + `test-v3-web-build-security.mjs` + `test:launcher:v3` + 6 `node --test` fixture/plumbing scripts)
5. `npm run admin:provision:v3`
6. `npx playwright install --with-deps chromium`
7. `npm run test:browser:v3` (all **25** Playwright Chromium scenario groups in `scripts/test-v3-browser.mjs`)

### 5.2. Observed CI & Acceptance Status at `C_E3` Commit Time (External Recording Rule)
| Verification Target | Status at `C_E3` Commit Time | Provenance Label | External Capture Location |
| --- | --- | --- | --- |
| **Local Layer D Gate on `4056fef2` (`npm run check` + all 25 `test:browser:v3` groups)** | Executed locally (`6,494` passed + `1` skip; `201` browser passed + `1` skip) | **`WORKER REPORTED`** | `05-REGRESSION-TEST-EVIDENCE.md` §8 & `evidence/task-e-full-check-and-browser-25.txt` |
| **Draft PR [`#315`](https://github.com/VinhDat267/ATI_Project/pull/315)** | `OPEN`, `isDraft: true`, base `main` | **`INDEPENDENTLY VERIFIED`** (by Codex at `11027dbc`) | GitHub PR `#315` |
| **Superseded `C_E2` (`11027dbc`) CI Run [`42955279986`](https://github.com/VinhDat267/ATI_Project/actions/runs/42955279986)** | `completed` / `success` on `11027dbc1e8c07f78af29c605f5c9eafc85c71a0` (was `in_progress` during initial review); **does NOT certify final docs head `C_E3`** | **`CI VERIFIED` for superseded `11027dbc` ONLY (`NOT VERIFIED` for `C_E3`)** | Historical superseded reference only |
| **Final Docs Head (`C_E3`) Exact-Head `v3 check` Run (`headSha === C_E3`)** | **`PENDING / NOT VERIFIED`** *(not yet pushed at commit time)* | **`NOT VERIFIED` at commit time** *(transitions to `CI VERIFIED` externally only after `C_E3` run succeeds)* | **Draft PR `#315` body** & **Orca `worker_done` report** |
| **Coordinator Codex Final Acceptance Review** | **`PENDING`** *(prior Codex reruns on `2fa749fc`, `a5309f21`, `127ded5c` are `INDEPENDENTLY VERIFIED`)* | **`NOT VERIFIED` at commit time** | Coordinator Codex root acceptance record |

---

## 6. Full-Tree Equivalence Governance (`HEAD^{tree}`)

Per `XSVC-INTEGRATION-V2` §2.3, **exact tree equivalence** may be claimed **only** when full-tree Git SHAs (`git rev-parse <refA>^{tree}` vs. `git rev-parse <refB>^{tree}`) match 100% identically (`git diff <treeA> <treeB>` === `0` bytes with **zero path exclusions**):
- **Combined Integration PR vs. Raw Sequential Merges (`#313 -> #314 -> #306`):** Full-tree SHAs are **NOT** equivalent, and non-`docs/` trees are also **intentionally NOT identical** to raw constituent merges because the combined branch includes **6 essential TDD `RED -> GREEN` integration/contract fixes** (`PrivacyPage.tsx` overview + `drive.file` truthfulness, `calendar-digest-runner.ts` & `trello-digest-runner.ts` Telegram binding, `adapter-factory.ts` blank-scope & `phase === 'execution'` revocation guards, `plan-repo.ts` & `execution-service.ts` pre-step membership/scope guard, and `ScheduleRunRecovery.tsx` Cockpit paused/cancelled/`unknown` status fail-closed parity) plus combined integration tests and the `docs/audits/2026-11-10-cross-service-integration/` evidence bundle.
- **Frozen Tested Anchor `C_E1` (`4056fef2`, tree `270b82ba...`) vs. Final Docs Commit `C_E3`:** Full-tree SHAs differ (`docs/` files updated in `C_E2`/`C_E3`); non-`docs/` source and test paths are 100% byte-identical (`git diff 4056fef20127d7da3c3139f34830035facbf5daf C_E3 -- ':!docs'` === `0` bytes — disclosed strictly as a path-scoped comparison, **not** full-tree equivalence), and required GitHub Actions `v3 check` must pass directly on `C_E3` before claiming exact-head CI verification.
