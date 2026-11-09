#!/usr/bin/env bash
# Stacked-PR merge-commit ancestry, fail-closed G1-G7 enforcement & negative rehearsal for Google Sheets Digest Gate A (FEAC v1.2).
#
# Runs entirely in throw-away git repositories under a temp directory. It never pushes,
# never talks to GitHub and never touches the source repository's refs.
# Uses Node.js (`node -e`) for JSON assertions so it runs identically on Windows and Linux
# without requiring an external `jq` binary.
#
# Usage:
#   SOURCE_REPO=<path-to-any-clone-of-VinhDat267/ATI_Project> bash stacked-merge-rehearsal.sh
set -u

PASS=0
FAIL=0
ok()   { PASS=$((PASS + 1)); echo "  [PASS] $*"; }
bad()  { FAIL=$((FAIL + 1)); echo "  [FAIL] $*"; }
expect_exit() { # expect_exit <expected> <label> <cmd...>
  local want="$1" label="$2"; shift 2
  "$@" >/dev/null 2>&1; local got=$?
  if [ "$got" -eq "$want" ]; then ok "$label (exit $got, expected $want)"; else bad "$label (exit $got, expected $want)"; fi
}

# Exact expected sorted file lists for each of the 9 Gate A PRs (G2).
expected_files_for_pr() {
  case "$1" in
    289)
      cat <<'EOF'
apps/chat-api/tests/helpers/sheets-digest-tenant-fixtures.ts
apps/chat-api/tests/services/sheets-digest-baseline-inventory.test.ts
docs/handoff/log/2026-11-08-RMD-00-sheets-digest-baseline.md
docs/handoff/tasks/RMD-00-sheets-digest-baseline.md
docs/superpowers/plans/2026-11-08-sheets-digest-gate-a-remediation.md
docs/superpowers/specs/2026-11-08-sheets-digest-gate-a-remediation-design.md
EOF
      ;;
    290)
      cat <<'EOF'
packages/tool-schemas/src/types.ts
packages/tool-schemas/tests/sheets-digest-v2-types.test.ts
EOF
      ;;
    291)
      cat <<'EOF'
packages/tool-adapters/src/index.ts
packages/tool-adapters/src/sheets/personal-sheets-adapter.ts
packages/tool-adapters/src/sheets/sheets-adapter.ts
packages/tool-adapters/src/sheets/sheets-shared.ts
packages/tool-adapters/tests/sheets/sheets-digest-window.test.ts
EOF
      ;;
    292)
      cat <<'EOF'
apps/chat-api/src/config/schedules-runtime.ts
apps/chat-api/src/server.ts
apps/chat-api/src/services/schedules/schedule-runner.ts
apps/chat-api/src/services/schedules/sheets-digest-candidate.ts
apps/chat-api/src/services/schedules/sheets-digest-runner.ts
apps/chat-api/tests/config/schedules-runtime.test.ts
apps/chat-api/tests/services/sheets-digest-concurrency.test.ts
apps/chat-api/tests/services/sheets-digest.test.ts
db/v3/0033_sheets_digest_v2_remediation.sql
EOF
      ;;
    293)
      cat <<'EOF'
apps/chat-api/src/config/gmail-tools-runtime.ts
apps/chat-api/src/config/schedules-runtime.ts
apps/chat-api/src/server.ts
apps/chat-api/src/services/chat-service.ts
apps/chat-api/src/services/schedules/schedule-service.ts
apps/chat-api/src/services/schedules/sheets-digest-candidate.ts
apps/chat-api/tests/services/sheets-digest-candidate-v2.test.ts
apps/chat-api/tests/services/sheets-digest-e2e-pipeline.test.ts
apps/chat-api/tests/services/sheets-digest.test.ts
EOF
      ;;
    294)
      cat <<'EOF'
apps/chat-api/src/routes/schedule-routes.ts
apps/chat-api/src/services/schedules/schedule-service.ts
apps/chat-api/tests/services/sheets-digest-reauthorize.test.ts
EOF
      ;;
    295)
      cat <<'EOF'
apps/chat-api/src/db/repositories/schedule-repo.ts
apps/chat-api/src/routes/schedule-routes.ts
apps/chat-api/src/services/schedules/run-state.ts
apps/chat-api/src/services/schedules/schedule-service.ts
apps/chat-api/tests/services/sheets-digest-delivery-recovery.test.ts
packages/tool-schemas/src/types.ts
packages/tool-schemas/tests/sheets-digest-v2-types.test.ts
EOF
      ;;
    297)
      cat <<'EOF'
apps/chat-api/src/scripts/sheets-digest-v2-migrate.ts
apps/chat-api/src/services/schedules/sheets-digest-v2-migration.ts
apps/chat-api/tests/services/sheets-digest-v2-migration.test.ts
EOF
      ;;
    299)
      cat <<'EOF'
apps/chat-web/src/pages/Cockpit/ScheduleActions.tsx
apps/chat-web/src/pages/Cockpit/ScheduleMoment.tsx
apps/chat-web/src/pages/Cockpit/ScheduleRunRecovery.tsx
apps/chat-web/src/pages/History/ScheduleSection.tsx
apps/chat-web/src/services/api-client.ts
apps/chat-web/tests/browser/sheets-digest-v2-recovery.spec.ts
apps/chat-web/tests/chat-api-test-shim.d.ts
apps/chat-web/tests/mysheets-ui.test.tsx
apps/chat-web/tests/schedule-sheets-digest-v2-real-backend.test.tsx
apps/chat-web/tests/schedule-sheets-digest-v2.test.tsx
apps/chat-web/vite.config.ts
EOF
      ;;
    *) return 1 ;;
  esac
}

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
export GIT_AUTHOR_NAME=rehearsal GIT_AUTHOR_EMAIL=rehearsal@example.invalid
export GIT_COMMITTER_NAME=rehearsal GIT_COMMITTER_EMAIL=rehearsal@example.invalid
export GIT_AUTHOR_DATE='2026-11-09T00:00:00Z' GIT_COMMITTER_DATE='2026-11-09T00:00:00Z'

echo "== Part 1: synthetic main -> PR A -> PR B =="
S="$WORK/synthetic"
git init -q -b main "$S" && cd "$S" || exit 2
git config core.autocrlf false
echo base > base.txt && git add base.txt && git commit -qm "main: base"
git checkout -qb pr-a && echo a > a.txt && git add a.txt && git commit -qm "PR A"
A_SHA=$(git rev-parse HEAD)
git checkout -qb pr-b && echo b > b.txt && git add b.txt && git commit -qm "PR B"
B_SHA=$(git rev-parse HEAD)
git checkout -q main
MAIN_BEFORE=$(git rev-parse main)

echo "-- pre-merge checks for PR A"
[ "$(git rev-parse pr-a)" = "$A_SHA" ] && ok "PR A head SHA matches locked SHA" || bad "PR A head SHA mismatch"
expect_exit 0 "main is ancestor of PR A (PR A is based on current main)" git merge-base --is-ancestor main "$A_SHA"
[ "$(git diff --name-only main..."$A_SHA")" = "a.txt" ] && ok "PR A expected delta = a.txt" || bad "PR A delta unexpected"

echo "-- merge PR A with a merge commit (equivalent of: gh pr merge A --merge --match-head-commit A_SHA)"
git merge -q --no-ff --no-edit "$A_SHA"
MERGE_A=$(git rev-parse main)
[ "$(git rev-parse "$MERGE_A^1")" = "$MAIN_BEFORE" ] && ok "merge commit parent 1 = previous main" || bad "merge parent 1 wrong"
[ "$(git rev-parse "$MERGE_A^2")" = "$A_SHA" ] && ok "merge commit parent 2 = PR A SHA" || bad "merge parent 2 wrong"

echo "-- OLD (defective) check"
expect_exit 1 "OLD: git merge-base --is-ancestor main <PR_B_SHA> fails after a merge commit" git merge-base --is-ancestor main "$B_SHA"

echo "-- CORRECTED checks"
expect_exit 0 "NEW: git merge-base --is-ancestor <PR_A_SHA> main" git merge-base --is-ancestor "$A_SHA" main
expect_exit 0 "NEW: git merge-base --is-ancestor <PR_A_SHA> <PR_B_SHA>" git merge-base --is-ancestor "$A_SHA" "$B_SHA"
[ "$(git rev-parse "$MERGE_A^{tree}")" = "$(git rev-parse "$A_SHA^{tree}")" ] \
  && ok "no integration drift: tree(main) == tree(PR A)" || bad "tree(main) != tree(PR A)"

echo "-- retarget PR B to main and verify expected delta"
[ "$(git diff --name-only main..."$B_SHA")" = "b.txt" ] && ok "PR B delta vs main (three-dot) = b.txt only" || bad "PR B delta unexpected"
git merge -q --no-ff --no-edit "$B_SHA"
[ "$(git rev-parse "main^{tree}")" = "$(git rev-parse "$B_SHA^{tree}")" ] \
  && ok "after merging PR B: tree(main) == tree(PR B)" || bad "tree(main) != tree(PR B) after B"

echo "-- drift scenario: unrelated commit lands on main between merges"
git checkout -q -b drift "$MERGE_A" && echo x > x.txt && git add x.txt && git commit -qm "unrelated commit on main"
expect_exit 0 "PR A still ancestor of drifted main" git merge-base --is-ancestor "$A_SHA" drift
[ "$(git rev-parse "drift^{tree}")" != "$(git rev-parse "$A_SHA^{tree}")" ] \
  && ok "drift DETECTED: tree(main) != tree(PR A) -> PR B CI must be re-run on new integration state" \
  || bad "drift not detected"

echo "-- head mutation scenario: PR B head changed after review"
git checkout -q -b pr-b-mutated "$B_SHA" && echo b2 >> b.txt && git commit -qam "late change"
[ "$(git rev-parse pr-b-mutated)" != "$B_SHA" ] \
  && ok "SHA mismatch DETECTED -> --match-head-commit would refuse the merge" || bad "mutation not detected"

echo
echo "== Part 2: replay 9 locked Gate A SHAs as merge commits =="
if [ -z "${SOURCE_REPO:-}" ]; then
  bad "SOURCE_REPO not set; Parts 2, 3 & 4 skipped"
else
  R="$WORK/real"
  git clone -q --no-checkout --shared "$SOURCE_REPO" "$R" && cd "$R" || exit 2
  BASE=08c8d8c5e7bf12625857ac3496fb96ec3914e34f
  PRS=(289 290 291 292 293 294 295 297 299)
  SHAS=(dd7fd0b7b73a5e3f7d1ce26a4965694ca512780f 365b674bfa52f6d15b4c7b4034f9f63ef01c9ce7
        6b307bdc81a22fa3ae95df5a1b39a1a3ee103b52 e3e1e2b86e7f2619844d9030f07c96f978051214
        e8e7ce31d950acd7dcdc915c65f175893d2770cf d97574f81a509c471ca81d21631e2ca757adfe60
        84057251564b9d88cc0da642ba4cf171c9701074 c7ef31cb761f74a5ce3a1afef525f30d60b742c1
        b80c238941c4927cbd6c9b435816a4fdc6522f4e)
  EXPECTED=(6 2 5 9 9 3 7 3 11)
  git checkout -q -B main "$BASE"
  PREV="$BASE"
  for i in "${!PRS[@]}"; do
    PR=${PRS[$i]}; SHA=${SHAS[$i]}
    echo "-- Step $((i + 1))/9: PR #$PR @ $SHA"
    git cat-file -e "$SHA^{commit}" 2>/dev/null && ok "locked SHA present" || { bad "locked SHA missing"; continue; }
    expect_exit 0 "previous PR/base $PREV is ancestor of PR #$PR" git merge-base --is-ancestor "$PREV" "$SHA"
    EXP_PATHS=$(expected_files_for_pr "$PR")
    ACT_THREE=$(git diff --name-only main..."$SHA" | LC_ALL=C sort)
    ACT_TWO=$(git diff --name-only "$PREV" "$SHA" | LC_ALL=C sort)
    [ "$ACT_THREE" = "$EXP_PATHS" ] && [ "$ACT_TWO" = "$EXP_PATHS" ] \
      && ok "expected exact file path set vs main (${EXPECTED[$i]} files, three-dot == parent..child == manifest)" \
      || bad "file path set mismatch on PR #$PR"
    MAIN_BEFORE=$(git rev-parse main)
    git merge -q --no-ff --no-edit -m "Merge pull request #$PR (rehearsal)" "$SHA" || { bad "merge conflict"; continue; }
    M=$(git rev-parse main)
    [ "$(git rev-parse "$M^1")" = "$MAIN_BEFORE" ] && [ "$(git rev-parse "$M^2")" = "$SHA" ] \
      && ok "merge commit parents = (previous main, PR #$PR)" || bad "merge parents wrong"
    expect_exit 0 "NEW: is-ancestor PR #$PR -> main" git merge-base --is-ancestor "$SHA" main
    [ "$(git rev-parse "main^{tree}")" = "$(git rev-parse "$SHA^{tree}")" ] \
      && ok "tree(main) == tree(PR #$PR) (no integration drift)" || bad "tree drift after PR #$PR"
    NEXT_I=$((i + 1))
    if [ "$NEXT_I" -lt "${#PRS[@]}" ]; then
      NEXT=${SHAS[$NEXT_I]}
      expect_exit 0 "NEW: is-ancestor PR #$PR -> next PR #${PRS[$NEXT_I]}" git merge-base --is-ancestor "$SHA" "$NEXT"
      expect_exit 1 "OLD (defective): is-ancestor main -> next PR #${PRS[$NEXT_I]} fails" git merge-base --is-ancestor main "$NEXT"
    fi
    PREV="$SHA"
  done
  [ "$(git rev-parse "main^{tree}")" = "$(git rev-parse "b80c238941c4927cbd6c9b435816a4fdc6522f4e^{tree}")" ] \
    && ok "final integrated main tree == Gate A stack tip #299 tree" || bad "final tree mismatch"

  echo
  echo "== Part 3: execute EXACT §5.3 fail-closed operator command block against bare origin remote =="
  ORIGIN_BARE="$WORK/origin.git"
  OPERATOR_REPO="$WORK/operator"
  GH_STATE="$WORK/gh-state"
  GH_BIN="$WORK/bin"
  mkdir -p "$GH_STATE" "$GH_BIN"

  git clone -q --bare --shared "$SOURCE_REPO" "$ORIGIN_BARE" || exit 2
  BRANCHES=(
    feat/sheets-digest-v2-contracts
    feat/sheets-digest-v2-ddl
    feat/sheets-digest-v2-preview-bind
    feat/sheets-digest-runner-enforce-pause
    feat/sheets-digest-delivery-idempotency
    feat/sheets-digest-reauth-preview-resolve
    feat/sheets-digest-scheduler-delivery-outcome
    feat/sheets-digest-v1-v2-migration
    feat/sheets-digest-web-recovery
  )

  reset_origin_and_gh_state() {
    rm -rf "$GH_STATE" && mkdir -p "$GH_STATE"
    git -C "$ORIGIN_BARE" update-ref refs/heads/main "$BASE"
    cat > "$GH_STATE/branch-main.json" <<'EOF_BP'
{
  "protected": true,
  "protection": {
    "enabled": true,
    "required_status_checks": {
      "strict": true,
      "checks": [{ "context": "v3" }]
    }
  },
  "enforce_admins": { "enabled": true },
  "required_pull_request_reviews": {
    "dismiss_stale_reviews": true,
    "required_approving_review_count": 1
  },
  "allow_force_pushes": { "enabled": false },
  "allow_deletions": { "enabled": false }
}
EOF_BP
    for i in "${!PRS[@]}"; do
      local pr_num=${PRS[$i]}
      local head_sha=${SHAS[$i]}
      local br_name=${BRANCHES[$i]}
      git -C "$ORIGIN_BARE" update-ref "refs/heads/$br_name" "$head_sha"
      echo "$head_sha" > "$GH_STATE/pr-$pr_num-head"
      echo "$br_name" > "$GH_STATE/pr-$pr_num-headRefName"
      echo "true" > "$GH_STATE/pr-$pr_num-draft"
      echo "MERGEABLE" > "$GH_STATE/pr-$pr_num-mergeable"
      echo "VinhDat267" > "$GH_STATE/pr-$pr_num-author"
      echo "APPROVED" > "$GH_STATE/pr-$pr_num-reviewDecision"
      printf '[{"state":"APPROVED","commit":{"oid":"%s"},"author":{"login":"independent-reviewer"}}]\n' "$head_sha" \
        > "$GH_STATE/pr-$pr_num-reviews.json"
      printf '[{"databaseId":900%s,"status":"completed","conclusion":"success","headSha":"%s","event":"pull_request","createdAt":"2026-11-09T12:00:00Z"}]\n' \
        "$pr_num" "$head_sha" > "$GH_STATE/runs-pr-$head_sha.json"
      if [ "$i" -eq 0 ]; then
        echo "main" > "$GH_STATE/pr-$pr_num-base"
      else
        echo "${BRANCHES[$((i - 1))]}" > "$GH_STATE/pr-$pr_num-base"
      fi
    done
  }

  # Offline local `gh` shim backed strictly by $ORIGIN_BARE and $GH_STATE (zero network access).
  cat > "$GH_BIN/gh" <<'EOF_GH'
#!/usr/bin/env bash
set -euo pipefail
sub="${1:-}"; shift || true
case "$sub" in
  api)
    endpoint="${1:-}"
    case "$endpoint" in
      repos/VinhDat267/ATI_Project/branches/main*)
        cat "$GH_STATE/branch-main.json"
        ;;
      *)
        echo "{}"
        ;;
    esac
    ;;
  run)
    action="${1:-}"; shift || true
    if [ "$action" = "list" ]; then
      event=""
      commit=""
      while [ $# -gt 0 ]; do
        case "$1" in
          --event) event="$2"; shift 2 ;;
          --commit) commit="$2"; shift 2 ;;
          --workflow|--branch|--limit|--json) shift 2 ;;
          *) shift ;;
        esac
      done
      if [ "$event" = "pull_request" ] && [ -f "$GH_STATE/runs-pr-$commit.json" ]; then
        cat "$GH_STATE/runs-pr-$commit.json"
      elif [ "$event" = "push" ] && [ -f "$GH_STATE/runs-push-$commit.json" ]; then
        cat "$GH_STATE/runs-push-$commit.json"
      else
        echo "[]"
      fi
    fi
    ;;
  pr)
    action="${1:-}"; shift || true
    case "$action" in
      view)
        pr="${1:-}"; shift || true
        head_oid=$(cat "$GH_STATE/pr-$pr-head")
        base_ref=$(cat "$GH_STATE/pr-$pr-base")
        is_draft=$(cat "$GH_STATE/pr-$pr-draft")
        mergeable=$(cat "$GH_STATE/pr-$pr-mergeable")
        author=$(cat "$GH_STATE/pr-$pr-author")
        review_decision=$(cat "$GH_STATE/pr-$pr-reviewDecision")
        reviews_json=$(cat "$GH_STATE/pr-$pr-reviews.json")
        merge_oid=$(cat "$GH_STATE/pr-$pr-mergeCommit" 2>/dev/null || true)
        if [[ "$*" == *"--jq .mergeCommit.oid"* ]]; then
          echo "$merge_oid"
        else
          printf '{"headRefOid":"%s","baseRefName":"%s","isDraft":%s,"mergeable":"%s","reviewDecision":"%s","author":{"login":"%s"},"reviews":%s,"mergeCommit":{"oid":"%s"}}\n' \
            "$head_oid" "$base_ref" "$is_draft" "$mergeable" "$review_decision" "$author" "$reviews_json" "$merge_oid"
        fi
        ;;
      diff)
        pr="${1:-}"; shift || true
        if [ -f "$GH_STATE/pr-$pr-diff-override.txt" ]; then
          cat "$GH_STATE/pr-$pr-diff-override.txt"
        else
          head_oid=$(cat "$GH_STATE/pr-$pr-head")
          base_ref=$(cat "$GH_STATE/pr-$pr-base")
          git -C "$ORIGIN_BARE" diff --name-only "refs/heads/$base_ref...$head_oid"
        fi
        ;;
      ready)
        pr="${1:-}"
        echo "false" > "$GH_STATE/pr-$pr-draft"
        ;;
      close)
        pr="${1:-}"
        ;;
      reopen)
        pr="${1:-}"
        head_oid=$(cat "$GH_STATE/pr-$pr-head")
        reopen_ts="${SIMULATED_REOPEN_TS:-2026-11-09T13:00:00Z}"
        printf '[{"databaseId":910%s,"status":"completed","conclusion":"success","headSha":"%s","event":"pull_request","createdAt":"%s"}]\n' \
          "$pr" "$head_oid" "$reopen_ts" > "$GH_STATE/runs-pr-$head_oid.json"
        ;;
      edit)
        pr="${1:-}"; shift || true
        if [ "${1:-}" = "--base" ]; then
          echo "${2:-main}" > "$GH_STATE/pr-$pr-base"
        fi
        ;;
      merge)
        pr="${1:-}"; shift || true
        mode=""
        match_sha=""
        while [ $# -gt 0 ]; do
          case "$1" in
            --merge) mode="merge"; shift ;;
            --match-head-commit) match_sha="$2"; shift 2 ;;
            *) shift ;;
          esac
        done
        [ "$mode" = "merge" ] || { echo "ERROR: only --merge allowed" >&2; exit 1; }
        head_oid=$(cat "$GH_STATE/pr-$pr-head")
        [ "$head_oid" = "$match_sha" ] || { echo "ERROR: head SHA mismatch ($head_oid != $match_sha)" >&2; exit 1; }
        base_ref=$(cat "$GH_STATE/pr-$pr-base")
        [ "$base_ref" = "main" ] || { echo "ERROR: baseRefName is $base_ref, expected main" >&2; exit 1; }
        is_draft=$(cat "$GH_STATE/pr-$pr-draft")
        [ "$is_draft" = "false" ] || { echo "ERROR: cannot merge draft PR #$pr" >&2; exit 1; }
        main_oid=$(git -C "$ORIGIN_BARE" rev-parse refs/heads/main)
        tree_oid=$(git -C "$ORIGIN_BARE" merge-tree --write-tree "$main_oid" "$head_oid")
        merge_oid=$(git -C "$ORIGIN_BARE" commit-tree "$tree_oid" -p "$main_oid" -p "$head_oid" -m "Merge pull request #$pr")
        git -C "$ORIGIN_BARE" update-ref refs/heads/main "$merge_oid" "$main_oid"
        echo "$merge_oid" > "$GH_STATE/pr-$pr-mergeCommit"
        printf '[{"databaseId":920%s,"status":"completed","conclusion":"success","headSha":"%s","event":"push","createdAt":"2026-11-09T12:30:00Z"}]\n' \
          "$pr" "$merge_oid" > "$GH_STATE/runs-push-$merge_oid.json"
        head_branch=$(cat "$GH_STATE/pr-$pr-headRefName")
        for base_file in "$GH_STATE"/pr-*-base; do
          if [ "$(cat "$base_file")" = "$head_branch" ]; then
            echo "main" > "$base_file"
          fi
        done
        git -C "$ORIGIN_BARE" update-ref -d "refs/heads/$head_branch"
        ;;
    esac
    ;;
esac
EOF_GH
  chmod +x "$GH_BIN/gh"

  reset_origin_and_gh_state
  git clone -q "$ORIGIN_BARE" "$OPERATOR_REPO" && cd "$OPERATOR_REPO" || exit 2

  # Exact §5.3 Fail-Closed Operator Step Function.
  # Every pre-merge gate (G1..G7) is enforced BEFORE `gh pr ready` and BEFORE `gh pr merge`.
  run_exact_step_5_3() {
    local STEP="$1" PR="$2" SHA="$3" PREV="$4" MIN_CI_CREATED_AT="$5" NEXT_PR="${6:-}" NEXT="${7:-}"
    (
      export PATH="$GH_BIN:$PATH"
      export ORIGIN_BARE GH_STATE
      set -euo pipefail

      # === BEGIN EXACT §5.3 FAIL-CLOSED COMMAND BLOCK ===
      git fetch origin
      MAIN_BEFORE=$(git rev-parse origin/main)

      # G7 (trước gh pr ready & gh pr merge): Bắt buộc đóng A5 (Vercel & Render Dashboard/API + Production Flags).
      # Tuyệt đối KHÔNG lấy số lượng GitHub Deployment objects thay thế kiểm tra Vercel/Render.
      if [ "${OWNER_A5_CD_VERIFICATION_STATUS:-}" != "VERIFIED" ] || \
         [ "${VERCEL_MAIN_AUTO_DEPLOY_SAFE:-}" != "VERIFIED" ] || \
         [ "${RENDER_MAIN_AUTO_DEPLOY_SAFE:-}" != "VERIFIED" ] || \
         [ "${PROD_RUNTIME_FLAGS_SAFE:-}" != "VERIFIED" ]; then
        echo "GATE_FAILURE:G7_A5_NOT_VERIFIED" >&2
        exit 1
      fi

      # G6 (trước gh pr ready & gh pr merge): Branch Protection trên main hoặc Signed Manual Control + Named Step-Verifier
      BP_JSON=$(gh api repos/VinhDat267/ATI_Project/branches/main)
      BP_MODE=$(BP_JSON="$BP_JSON" \
        OWNER_A6="${OWNER_A6_MANUAL_CONTROL_SIGN_OFF:-}" \
        STEP_VERIFIER="${NAMED_STEP_VERIFIER:-}" \
        node -e '
          const bp = JSON.parse(process.env.BP_JSON);
          if (bp.protected === true) {
            const checks = (bp.protection && bp.protection.required_status_checks && bp.protection.required_status_checks.checks) || [];
            const hasV3 = checks.some(c => c.context === "v3");
            const strict = Boolean(bp.protection && bp.protection.required_status_checks && bp.protection.required_status_checks.strict);
            const enforceAdmins = Boolean(bp.enforce_admins && bp.enforce_admins.enabled);
            const noForcePush = bp.allow_force_pushes && bp.allow_force_pushes.enabled === false;
            const noDeletions = bp.allow_deletions && bp.allow_deletions.enabled === false;
            const reqApprovals = (bp.required_pull_request_reviews && bp.required_pull_request_reviews.required_approving_review_count) || 0;
            if (!strict || !hasV3 || !enforceAdmins || !noForcePush || !noDeletions) {
              console.error("GATE_FAILURE:G6_INCOMPLETE_BRANCH_PROTECTION");
              process.exit(1);
            }
            process.stdout.write("PROTECTED:" + reqApprovals);
          } else {
            if (process.env.OWNER_A6 !== "APPROVED" || !process.env.STEP_VERIFIER || !process.env.STEP_VERIFIER.trim()) {
              console.error("GATE_FAILURE:G6_UNPROTECTED_MAIN_NO_MANUAL_SIGNOFF");
              process.exit(1);
            }
            process.stdout.write("MANUAL:0");
          }
        ')

      # G1 (trước gh pr ready & gh pr merge): JSON assertions bắt buộc cho headRefOid, baseRefName, isDraft, mergeable
      PR_JSON=$(gh pr view "$PR" --json headRefOid,baseRefName,isDraft,mergeable,reviewDecision,reviews,author)
      PR_JSON="$PR_JSON" EXPECTED_SHA="$SHA" node -e '
        const pr = JSON.parse(process.env.PR_JSON);
        if (pr.headRefOid !== process.env.EXPECTED_SHA) {
          console.error("GATE_FAILURE:G1_SHA_MISMATCH");
          process.exit(1);
        }
        if (pr.baseRefName !== "main") {
          console.error("GATE_FAILURE:G1_WRONG_BASE");
          process.exit(1);
        }
        if (pr.isDraft !== true || pr.mergeable !== "MERGEABLE") {
          console.error("GATE_FAILURE:G1_PR_STATE_INVALID");
          process.exit(1);
        }
      '

      # G2 (trước gh pr ready & gh pr merge): So sánh chính xác tập đường dẫn file thay đổi (không chỉ wc -l)
      EXPECTED_PATHS=$(expected_files_for_pr "$PR")
      ACTUAL_THREE_DOT=$(git diff --name-only origin/main..."$SHA" | LC_ALL=C sort)
      ACTUAL_TWO_DOT=$(git diff --name-only "$PREV" "$SHA" | LC_ALL=C sort)
      ACTUAL_PR_DIFF=$(gh pr diff "$PR" --name-only | LC_ALL=C sort)
      if [ "$ACTUAL_THREE_DOT" != "$EXPECTED_PATHS" ] || \
         [ "$ACTUAL_TWO_DOT" != "$EXPECTED_PATHS" ] || \
         [ "$ACTUAL_PR_DIFF" != "$EXPECTED_PATHS" ]; then
        echo "GATE_FAILURE:G2_FILE_DELTA_MISMATCH" >&2
        exit 1
      fi

      # G3 (trước gh pr ready & gh pr merge): Bước 1 khóa baseline; mọi bước kiểm tra PREV là tổ tiên của origin/main & SHA, và tree(origin/main) == tree(PREV)
      if [ "$STEP" -eq 1 ]; then
        test "$MAIN_BEFORE" = "08c8d8c5e7bf12625857ac3496fb96ec3914e34f"
      fi
      git merge-base --is-ancestor "$PREV" origin/main
      git merge-base --is-ancestor "$PREV" "$SHA"
      test "$(git rev-parse "origin/main^{tree}")" = "$(git rev-parse "$PREV^{tree}")"

      # G4 (trước gh pr ready & gh pr merge): CI "v3 check" pull_request phải completed/success trên đúng $SHA và createdAt >= $MIN_CI_CREATED_AT
      CI_PR_JSON=$(gh run list --workflow "v3 check" --event pull_request --commit "$SHA" --limit 10 \
        --json databaseId,status,conclusion,headSha,event,createdAt)
      CI_PR_JSON="$CI_PR_JSON" EXPECTED_SHA="$SHA" MIN_TS="$MIN_CI_CREATED_AT" node -e '
        const runs = JSON.parse(process.env.CI_PR_JSON).filter(
          r => r.headSha === process.env.EXPECTED_SHA && r.event === "pull_request" && r.createdAt >= process.env.MIN_TS
        );
        if (runs.length === 0) {
          console.error("GATE_FAILURE:G4_CI_MISSING_OR_STALE");
          process.exit(1);
        }
        const latest = runs[0];
        if (latest.status !== "completed") {
          console.error("GATE_FAILURE:G4_CI_IN_PROGRESS");
          process.exit(1);
        }
        if (latest.conclusion !== "success") {
          console.error("GATE_FAILURE:G4_CI_RED");
          process.exit(1);
        }
      '

      # G5 (trước gh pr ready & gh pr merge): Quyết định A1..A4 + Independent Approving Review (hoặc Signed Manual Control khi unprotected)
      if [ "${OWNER_A1_MERGE_GO:-}" != "APPROVED" ] || \
         [ "${OWNER_A2_COPY_SIGN_OFF:-}" != "APPROVED" ] || \
         [ "${OWNER_A3_DEFAULTS_SIGN_OFF:-}" != "APPROVED" ] || \
         [ "${OWNER_A4_P3_RISK_ACCEPTANCE:-}" != "APPROVED" ]; then
        echo "GATE_FAILURE:G5_OWNER_A1_A4_MISSING" >&2
        exit 1
      fi
      PR_JSON="$PR_JSON" BP_MODE="$BP_MODE" EXPECTED_PR="$PR" EXPECTED_SHA="$SHA" \
        OWNER_A6="${OWNER_A6_MANUAL_CONTROL_SIGN_OFF:-}" \
        MANUAL_PR="${MANUAL_REVIEW_VERIFIED_PR:-}" \
        MANUAL_SHA="${MANUAL_REVIEW_VERIFIED_SHA:-}" \
        node -e '
          const pr = JSON.parse(process.env.PR_JSON);
          const bpMode = process.env.BP_MODE || "";
          const prAuthor = pr.author && pr.author.login;
          const independentApprovals = (pr.reviews || []).filter(
            r => r.state === "APPROVED" && r.commit && r.commit.oid === process.env.EXPECTED_SHA && r.author && r.author.login !== prAuthor
          );
          const hasIndependentApproval = pr.reviewDecision === "APPROVED" && independentApprovals.length >= 1;
          if (bpMode.startsWith("PROTECTED:")) {
            const reqCount = Number(bpMode.split(":")[1] || "1");
            if (reqCount >= 1 && !hasIndependentApproval) {
              console.error("GATE_FAILURE:G5_INDEPENDENT_APPROVAL_REQUIRED");
              process.exit(1);
            }
          } else {
            const hasSignedManual =
              process.env.OWNER_A6 === "APPROVED" &&
              process.env.MANUAL_PR === process.env.EXPECTED_PR &&
              process.env.MANUAL_SHA === process.env.EXPECTED_SHA;
            if (!hasIndependentApproval && !hasSignedManual) {
              console.error("GATE_FAILURE:G5_REVIEW_OR_MANUAL_CONTROL_MISSING");
              process.exit(1);
            }
          }
        '

      # Chỉ sau khi cả 7 cổng G1..G7 đều PASS mới được phép chuyển Draft -> Ready và thực thi merge
      gh pr ready "$PR"
      READY_JSON=$(gh pr view "$PR" --json headRefOid,baseRefName,isDraft,mergeable)
      READY_JSON="$READY_JSON" EXPECTED_SHA="$SHA" node -e '
        const pr = JSON.parse(process.env.READY_JSON);
        if (pr.headRefOid !== process.env.EXPECTED_SHA || pr.baseRefName !== "main" || pr.isDraft !== false || pr.mergeable !== "MERGEABLE") {
          console.error("GATE_FAILURE:G1_POST_READY_STATE_INVALID");
          process.exit(1);
        }
      '
      gh pr merge "$PR" --merge --match-head-commit "$SHA"     # KHÔNG dùng --squash / --rebase / --admin

      # G3 (sau merge): kiểm tra ancestry, parents 1/2 và tree của merge commit
      git fetch origin
      MERGE=$(gh pr view "$PR" --json mergeCommit --jq .mergeCommit.oid)
      git merge-base --is-ancestor "$SHA" origin/main
      test "$(git rev-parse "$MERGE^1")" = "$MAIN_BEFORE"
      test "$(git rev-parse "$MERGE^2")" = "$SHA"
      test "$(git rev-parse "$MERGE^{tree}")" = "$(git rev-parse "$SHA^{tree}")"

      # G4 (sau merge): run push trên main phải completed/success tại đúng $MERGE
      CI_MAIN_JSON=$(gh run list --workflow "v3 check" --branch main --event push --commit "$MERGE" --limit 5 \
        --json databaseId,status,conclusion,headSha,event,createdAt)
      CI_MAIN_JSON="$CI_MAIN_JSON" MERGE_SHA="$MERGE" node -e '
        const runs = JSON.parse(process.env.CI_MAIN_JSON).filter(
          r => r.headSha === process.env.MERGE_SHA && r.event === "push"
        );
        if (runs.length === 0 || runs[0].status !== "completed" || runs[0].conclusion !== "success") {
          console.error("GATE_FAILURE:G4_POST_MERGE_PUSH_CI_FAILED");
          process.exit(1);
        }
      '

      # Chuẩn bị PR kế tiếp (bỏ qua ở bước 9)
      if [ "$STEP" -lt 9 ]; then
        git merge-base --is-ancestor "$SHA" origin/main
        git merge-base --is-ancestor "$SHA" "$NEXT"
        test "$(git rev-parse "origin/main^{tree}")" = "$(git rev-parse "$SHA^{tree}")"
        NEXT_VIEW=$(gh pr view "$NEXT_PR" --json headRefOid,baseRefName,isDraft,mergeable)
        NEXT_BASE=$(NEXT_VIEW="$NEXT_VIEW" node -e 'process.stdout.write(JSON.parse(process.env.NEXT_VIEW).baseRefName)')
        if [ "$NEXT_BASE" != "main" ]; then
          gh pr edit "$NEXT_PR" --base main
          NEXT_VIEW=$(gh pr view "$NEXT_PR" --json headRefOid,baseRefName,isDraft,mergeable)
        fi
        NEXT_VIEW="$NEXT_VIEW" EXPECTED_NEXT_SHA="$NEXT" node -e '
          const pr = JSON.parse(process.env.NEXT_VIEW);
          if (pr.headRefOid !== process.env.EXPECTED_NEXT_SHA || pr.baseRefName !== "main" || pr.isDraft !== true || pr.mergeable !== "MERGEABLE") {
            console.error("GATE_FAILURE:NEXT_PR_STATE_INVALID");
            process.exit(1);
          }
        '
        NEXT_EXPECTED_PATHS=$(expected_files_for_pr "$NEXT_PR")
        NEXT_ACTUAL_THREE_DOT=$(git diff --name-only origin/main..."$NEXT" | LC_ALL=C sort)
        test "$NEXT_ACTUAL_THREE_DOT" = "$NEXT_EXPECTED_PATHS"
        gh pr close "$NEXT_PR" && gh pr reopen "$NEXT_PR"     # kích hoạt CI mới sau retarget
      fi
      # === END EXACT §5.3 FAIL-CLOSED COMMAND BLOCK ===
    )
  }

  # Positive 9-step rehearsal under Branch Protection + Independent Reviewer + A1..A5 VERIFIED
  export OWNER_A1_MERGE_GO=APPROVED
  export OWNER_A2_COPY_SIGN_OFF=APPROVED
  export OWNER_A3_DEFAULTS_SIGN_OFF=APPROVED
  export OWNER_A4_P3_RISK_ACCEPTANCE=APPROVED
  export OWNER_A5_CD_VERIFICATION_STATUS=VERIFIED
  export VERCEL_MAIN_AUTO_DEPLOY_SAFE=VERIFIED
  export RENDER_MAIN_AUTO_DEPLOY_SAFE=VERIFIED
  export PROD_RUNTIME_FLAGS_SAFE=VERIFIED
  export SIMULATED_REOPEN_TS="2026-11-09T13:00:00Z"

  PREV="$BASE"
  MIN_TS="2026-11-09T12:00:00Z"
  for i in "${!PRS[@]}"; do
    STEP=$((i + 1))
    PR=${PRS[$i]}
    SHA=${SHAS[$i]}
    NEXT_I=$((i + 1))
    if [ "$NEXT_I" -lt "${#PRS[@]}" ]; then
      NEXT_PR=${PRS[$NEXT_I]}
      NEXT_SHA=${SHAS[$NEXT_I]}
    else
      NEXT_PR=""
      NEXT_SHA=""
    fi
    echo "-- Exact §5.3 Step $STEP/9: PR #$PR @ $SHA (PREV=$PREV, MIN_CI_CREATED_AT=$MIN_TS)"
    git fetch origin
    MAIN_BEFORE_CHECK=$(git rev-parse origin/main)
    if [ "$STEP" -ge 2 ]; then
      expect_exit 1 "FEAC-EXT-RB-02 (removed defective pre-merge check): is-ancestor MAIN_BEFORE -> PR #$PR fails" \
        git merge-base --is-ancestor "$MAIN_BEFORE_CHECK" "$SHA"
    fi
    expect_exit 0 "Exact §5.3 fail-closed block for Step $STEP/9 (PR #$PR) executes cleanly" \
      run_exact_step_5_3 "$STEP" "$PR" "$SHA" "$PREV" "$MIN_TS" "$NEXT_PR" "$NEXT_SHA"
    PREV="$SHA"
    MIN_TS="2026-11-09T13:00:00Z"
  done
  git fetch origin
  [ "$(git rev-parse "origin/main^{tree}")" = "$(git rev-parse "b80c238941c4927cbd6c9b435816a4fdc6522f4e^{tree}")" ] \
    && ok "Part 3 post-step-9 check: tree(origin/main) == tree(#299)" || bad "Part 3 final tree mismatch"

  echo
  echo "== Part 4: fail-closed negative rehearsals (each must exit 1 with exact gate tag BEFORE gh pr ready / merge) =="
  PR1=289
  SHA1=dd7fd0b7b73a5e3f7d1ce26a4965694ca512780f
  PR2=290
  SHA2=365b674bfa52f6d15b4c7b4034f9f63ef01c9ce7

  assert_blocked_before_ready_and_merge() {
    local expected_tag="$1" label="$2"; shift 2
    local main_before err_file rc draft_after main_after err_out
    main_before=$(git -C "$ORIGIN_BARE" rev-parse refs/heads/main)
    err_file="$WORK/last_neg_err.txt"
    "$@" >/dev/null 2>"$err_file"
    rc=$?
    err_out=$(cat "$err_file" 2>/dev/null || true)
    draft_after=$(cat "$GH_STATE/pr-$PR1-draft")
    main_after=$(git -C "$ORIGIN_BARE" rev-parse refs/heads/main)
    if [ "$rc" -eq 1 ] && [[ "$err_out" == *"$expected_tag"* ]] && [ "$draft_after" = "true" ] && [ "$main_after" = "$main_before" ]; then
      ok "$label -> blocked with $expected_tag (exit $rc, isDraft=$draft_after, main unchanged)"
    else
      bad "$label -> UNEXPECTED (exit $rc, tag=$err_out, expected=$expected_tag, isDraft=$draft_after, main_after=$main_after)"
    fi
  }

  # 4.1 CI red (conclusion = failure)
  reset_origin_and_gh_state
  printf '[{"databaseId":9901,"status":"completed","conclusion":"failure","headSha":"%s","event":"pull_request","createdAt":"2026-11-09T12:00:00Z"}]\n' \
    "$SHA1" > "$GH_STATE/runs-pr-$SHA1.json"
  assert_blocked_before_ready_and_merge "GATE_FAILURE:G4_CI_RED" \
    "Negative 4.1 (G4): CI red (conclusion=failure)" \
    run_exact_step_5_3 1 "$PR1" "$SHA1" "$BASE" "2026-11-09T12:00:00Z" "$PR2" "$SHA2"

  # 4.2a CI in progress (status = in_progress)
  reset_origin_and_gh_state
  printf '[{"databaseId":9902,"status":"in_progress","conclusion":"","headSha":"%s","event":"pull_request","createdAt":"2026-11-09T12:00:00Z"}]\n' \
    "$SHA1" > "$GH_STATE/runs-pr-$SHA1.json"
  assert_blocked_before_ready_and_merge "GATE_FAILURE:G4_CI_IN_PROGRESS" \
    "Negative 4.2a (G4): CI in_progress" \
    run_exact_step_5_3 1 "$PR1" "$SHA1" "$BASE" "2026-11-09T12:00:00Z" "$PR2" "$SHA2"

  # 4.2b CI missing or stale (createdAt < MIN_CI_CREATED_AT after retarget)
  reset_origin_and_gh_state
  printf '[{"databaseId":9903,"status":"completed","conclusion":"success","headSha":"%s","event":"pull_request","createdAt":"2026-11-09T11:00:00Z"}]\n' \
    "$SHA1" > "$GH_STATE/runs-pr-$SHA1.json"
  assert_blocked_before_ready_and_merge "GATE_FAILURE:G4_CI_MISSING_OR_STALE" \
    "Negative 4.2b (G4): stale CI created before retarget timestamp" \
    run_exact_step_5_3 1 "$PR1" "$SHA1" "$BASE" "2026-11-09T12:00:00Z" "$PR2" "$SHA2"

  # 4.3 SHA mismatch (PR headRefOid mutated after lock)
  reset_origin_and_gh_state
  echo "0000000000000000000000000000000000000000" > "$GH_STATE/pr-$PR1-head"
  assert_blocked_before_ready_and_merge "GATE_FAILURE:G1_SHA_MISMATCH" \
    "Negative 4.3 (G1): headRefOid SHA mismatch" \
    run_exact_step_5_3 1 "$PR1" "$SHA1" "$BASE" "2026-11-09T12:00:00Z" "$PR2" "$SHA2"

  # 4.4 Wrong base (baseRefName != main)
  reset_origin_and_gh_state
  echo "feat/wrong-base-branch" > "$GH_STATE/pr-$PR1-base"
  assert_blocked_before_ready_and_merge "GATE_FAILURE:G1_WRONG_BASE" \
    "Negative 4.4 (G1/G2): wrong baseRefName (!= main)" \
    run_exact_step_5_3 1 "$PR1" "$SHA1" "$BASE" "2026-11-09T12:00:00Z" "$PR2" "$SHA2"

  # 4.5 Wrong file delta (same file count = 6, but 1 unexpected file path)
  reset_origin_and_gh_state
  cat > "$GH_STATE/pr-$PR1-diff-override.txt" <<'EOF_BAD_DIFF'
apps/chat-api/tests/helpers/sheets-digest-tenant-fixtures.ts
apps/chat-api/tests/services/sheets-digest-baseline-inventory.test.ts
docs/handoff/log/2026-11-08-RMD-00-sheets-digest-baseline.md
docs/handoff/tasks/RMD-00-sheets-digest-baseline.md
docs/superpowers/plans/2026-11-08-sheets-digest-gate-a-remediation.md
apps/chat-api/src/UNEXPECTED-SNEAKY-FILE.ts
EOF_BAD_DIFF
  assert_blocked_before_ready_and_merge "GATE_FAILURE:G2_FILE_DELTA_MISMATCH" \
    "Negative 4.5 (G2): wrong file path in diff (even with same file count 6)" \
    run_exact_step_5_3 1 "$PR1" "$SHA1" "$BASE" "2026-11-09T12:00:00Z" "$PR2" "$SHA2"

  # 4.6a Review COMMENTED (not APPROVED) when branch protection requires approving review
  reset_origin_and_gh_state
  echo "REVIEW_REQUIRED" > "$GH_STATE/pr-$PR1-reviewDecision"
  printf '[{"state":"COMMENTED","commit":{"oid":"%s"},"author":{"login":"independent-reviewer"}}]\n' "$SHA1" \
    > "$GH_STATE/pr-$PR1-reviews.json"
  assert_blocked_before_ready_and_merge "GATE_FAILURE:G5_INDEPENDENT_APPROVAL_REQUIRED" \
    "Negative 4.6a (G5): COMMENTED review rejected when branch protection requires approval" \
    run_exact_step_5_3 1 "$PR1" "$SHA1" "$BASE" "2026-11-09T12:00:00Z" "$PR2" "$SHA2"

  # 4.6b Missing reviewer approval under manual control (unprotected main + A6 signed, but no review & no manual review SHA)
  reset_origin_and_gh_state
  echo '{"protected":false}' > "$GH_STATE/branch-main.json"
  echo "REVIEW_REQUIRED" > "$GH_STATE/pr-$PR1-reviewDecision"
  printf '[{"state":"APPROVED","commit":{"oid":"%s"},"author":{"login":"VinhDat267"}}]\n' "$SHA1" \
    > "$GH_STATE/pr-$PR1-reviews.json"
  OWNER_A6_MANUAL_CONTROL_SIGN_OFF=APPROVED NAMED_STEP_VERIFIER="VinhDat267" \
    MANUAL_REVIEW_VERIFIED_PR="" MANUAL_REVIEW_VERIFIED_SHA="" \
    assert_blocked_before_ready_and_merge "GATE_FAILURE:G5_REVIEW_OR_MANUAL_CONTROL_MISSING" \
    "Negative 4.6b (G5): missing independent reviewer & missing manual review record" \
    run_exact_step_5_3 1 "$PR1" "$SHA1" "$BASE" "2026-11-09T12:00:00Z" "$PR2" "$SHA2"

  # 4.7 Missing A5 (OWNER_A5_CD_VERIFICATION_STATUS=NOT_VERIFIED)
  reset_origin_and_gh_state
  OWNER_A5_CD_VERIFICATION_STATUS=NOT_VERIFIED \
    assert_blocked_before_ready_and_merge "GATE_FAILURE:G7_A5_NOT_VERIFIED" \
    "Negative 4.7 (G7): A5=NOT_VERIFIED blocks before gh pr ready/merge" \
    run_exact_step_5_3 1 "$PR1" "$SHA1" "$BASE" "2026-11-09T12:00:00Z" "$PR2" "$SHA2"

  # 4.8 Unprotected main without manual risk-acceptance sign-off / named step-verifier
  reset_origin_and_gh_state
  echo '{"protected":false}' > "$GH_STATE/branch-main.json"
  OWNER_A6_MANUAL_CONTROL_SIGN_OFF="" NAMED_STEP_VERIFIER="" \
    assert_blocked_before_ready_and_merge "GATE_FAILURE:G6_UNPROTECTED_MAIN_NO_MANUAL_SIGNOFF" \
    "Negative 4.8 (G6): unprotected main without manual sign-off & step-verifier" \
    run_exact_step_5_3 1 "$PR1" "$SHA1" "$BASE" "2026-11-09T12:00:00Z" "$PR2" "$SHA2"
fi

echo
echo "RESULT: PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ]
