#!/usr/bin/env bash
# Stacked-PR merge-commit ancestry & exact §5.3 operator command rehearsal for Google Sheets Digest Gate A (FEAC v1.2).
#
# Runs entirely in throw-away git repositories under a temp directory. It never pushes,
# never talks to GitHub and never touches the source repository's refs.
#
# Usage:
#   SOURCE_REPO=<path-to-any-clone-of-VinhDat267/ATI_Project> bash stacked-merge-rehearsal.sh
#
# Part 1 (synthetic): main -> PR A -> PR B, merge PR A with a merge commit, prove that the
#   old check `git merge-base --is-ancestor origin/main <next_SHA>` FAILS, prove that the
#   corrected checks PASS, retarget PR B and verify its delta, then show that an unrelated
#   commit on main ("integration drift") is detected so stale CI cannot be reused.
# Part 2 (real SHAs): replay the 9 locked Gate A SHAs (#289 -> #299) as merge commits on a
#   local copy of origin/main 08c8d8c5 and verify every check of the corrected runbook.
# Part 3 (exact §5.3 operator command block against bare origin remote): execute the exact
#   commands the operator runs in STACKED-PR-INTEGRATION-MATRIX.md §5.3 across all 9 steps
#   (#289 -> #299) against a local bare `origin` remote and prove zero false failures on
#   PR #290+, while proving the removed FEAC-EXT-RB-02 pre-merge check
#   (`git merge-base --is-ancestor "$MAIN_BEFORE" "$SHA"`) fails at Steps 2..9 (#290..#299).
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
  bad "SOURCE_REPO not set; Part 2 & Part 3 skipped"
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
    N=$(git diff --name-only main..."$SHA" | wc -l | tr -d ' ')
    N2=$(git diff --name-only "$PREV" "$SHA" | wc -l | tr -d ' ')
    [ "$N" = "${EXPECTED[$i]}" ] && [ "$N" = "$N2" ] \
      && ok "expected delta vs main = ${EXPECTED[$i]} files (three-dot == parent..child)" \
      || bad "delta vs main = $N (parent..child = $N2), expected ${EXPECTED[$i]}"
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
  echo "== Part 3: execute EXACT §5.3 operator command block against bare origin remote =="
  ORIGIN_BARE="$WORK/origin.git"
  OPERATOR_REPO="$WORK/operator"
  GH_STATE="$WORK/gh-state"
  GH_BIN="$WORK/bin"
  mkdir -p "$GH_STATE" "$GH_BIN"

  git clone -q --bare --shared "$SOURCE_REPO" "$ORIGIN_BARE" || exit 2
  git -C "$ORIGIN_BARE" update-ref refs/heads/main "$BASE"
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
  for i in "${!PRS[@]}"; do
    PR_NUM=${PRS[$i]}
    HEAD_SHA=${SHAS[$i]}
    BR_NAME=${BRANCHES[$i]}
    git -C "$ORIGIN_BARE" update-ref "refs/heads/$BR_NAME" "$HEAD_SHA"
    echo "$HEAD_SHA" > "$GH_STATE/pr-$PR_NUM-head"
    echo "$BR_NAME" > "$GH_STATE/pr-$PR_NUM-headRefName"
    echo "true" > "$GH_STATE/pr-$PR_NUM-draft"
    if [ "$i" -eq 0 ]; then
      echo "main" > "$GH_STATE/pr-$PR_NUM-base"
    else
      echo "${BRANCHES[$((i - 1))]}" > "$GH_STATE/pr-$PR_NUM-base"
    fi
  done

  # Offline local `gh` shim backed strictly by $ORIGIN_BARE and $GH_STATE (zero network access).
  cat > "$GH_BIN/gh" <<'EOF_GH'
#!/usr/bin/env bash
set -euo pipefail
sub="${1:-}"; shift || true
case "$sub" in
  api)
    endpoint="${1:-}"
    case "$endpoint" in
      repos/VinhDat267/ATI_Project/branches/main*) echo "false" ;;
      repos/VinhDat267/ATI_Project/deployments*) echo "0" ;;
      *) echo "{}" ;;
    esac
    ;;
  run)
    # Local offline simulation of `gh run list --workflow "v3 check" ...`
    echo "completed	success	v3 check"
    ;;
  pr)
    action="${1:-}"; shift || true
    case "$action" in
      view)
        pr="${1:-}"; shift || true
        head_oid=$(cat "$GH_STATE/pr-$pr-head")
        base_ref=$(cat "$GH_STATE/pr-$pr-base")
        is_draft=$(cat "$GH_STATE/pr-$pr-draft")
        merge_oid=$(cat "$GH_STATE/pr-$pr-mergeCommit" 2>/dev/null || true)
        if [[ "$*" == *"--jq .mergeCommit.oid"* ]]; then
          echo "$merge_oid"
        else
          printf '{"headRefOid":"%s","baseRefName":"%s","isDraft":%s,"mergeable":"MERGEABLE","reviewDecision":"","statusCheckRollup":[{"name":"v3","status":"COMPLETED","conclusion":"SUCCESS"}],"mergeCommit":{"oid":"%s"}}\n' \
            "$head_oid" "$base_ref" "$is_draft" "$merge_oid"
        fi
        ;;
      diff)
        pr="${1:-}"; shift || true
        head_oid=$(cat "$GH_STATE/pr-$pr-head")
        base_ref=$(cat "$GH_STATE/pr-$pr-base")
        git -C "$ORIGIN_BARE" diff --name-only "refs/heads/$base_ref...$head_oid"
        ;;
      ready)
        pr="${1:-}"
        echo "false" > "$GH_STATE/pr-$pr-draft"
        ;;
      close|reopen)
        pr="${1:-}"
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
        main_oid=$(git -C "$ORIGIN_BARE" rev-parse refs/heads/main)
        tree_oid=$(git -C "$ORIGIN_BARE" merge-tree --write-tree "$main_oid" "$head_oid")
        merge_oid=$(git -C "$ORIGIN_BARE" commit-tree "$tree_oid" -p "$main_oid" -p "$head_oid" -m "Merge pull request #$pr")
        git -C "$ORIGIN_BARE" update-ref refs/heads/main "$merge_oid" "$main_oid"
        echo "$merge_oid" > "$GH_STATE/pr-$pr-mergeCommit"
        # Simulate GitHub delete_branch_on_merge + automatic retarget of child PR whose base was this PR's branch
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

  git clone -q "$ORIGIN_BARE" "$OPERATOR_REPO" && cd "$OPERATOR_REPO" || exit 2

  run_exact_step_5_3() {
    local STEP="$1" PR="$2" SHA="$3" PREV="$4" EXPECTED_DELTA="$5" NEXT_PR="${6:-}" NEXT="${7:-}"
    (
      export PATH="$GH_BIN:$PATH"
      export ORIGIN_BARE GH_STATE
      set -euo pipefail

      # === BEGIN EXACT §5.3 COMMAND BLOCK ===
      git fetch origin
      MAIN_BEFORE=$(git rev-parse origin/main)

      # G6 & G7: branch protection / manual control & CD safety
      gh api repos/VinhDat267/ATI_Project/branches/main --jq .protected >/dev/null
      gh api repos/VinhDat267/ATI_Project/deployments?per_page=5 --jq 'length' >/dev/null
      # G1, G2: SHA và base
      gh pr view "$PR" --json headRefOid,baseRefName,isDraft,mergeable,reviewDecision,statusCheckRollup >/dev/null
      # G2: expected delta (phải khớp số file ở bảng 5.5)
      git diff --name-only origin/main..."$SHA" >/dev/null
      gh pr diff "$PR" --name-only >/dev/null
      test "$(git diff --name-only origin/main..."$SHA" | wc -l | tr -d ' ')" = "$EXPECTED_DELTA"
      test "$(git diff --name-only "$PREV" "$SHA" | wc -l | tr -d ' ')" = "$EXPECTED_DELTA"
      # G3 (trước merge): bước 1 khóa baseline; mọi bước kiểm tra PREV là tổ tiên của origin/main & SHA, và tree(origin/main) == tree(PREV)
      if [ "$STEP" -eq 1 ]; then
        test "$MAIN_BEFORE" = "08c8d8c5e7bf12625857ac3496fb96ec3914e34f"
      fi
      git merge-base --is-ancestor "$PREV" origin/main
      git merge-base --is-ancestor "$PREV" "$SHA"
      test "$(git rev-parse "origin/main^{tree}")" = "$(git rev-parse "$PREV^{tree}")"
      # G4 (trước merge): run pull_request mới nhất của PR phải xanh trên đúng SHA và được tạo sau lần đổi main gần nhất
      gh run list --workflow "v3 check" --event pull_request --commit "$SHA" --limit 5 >/dev/null
      # G5: đã có quyết định A1 của Chủ dự án

      gh pr ready "$PR"
      gh pr merge "$PR" --merge --match-head-commit "$SHA"     # KHÔNG dùng --squash / --rebase / --admin

      # G3 (sau merge): kiểm tra ancestry, parents và tree của merge commit
      git fetch origin
      MERGE=$(gh pr view "$PR" --json mergeCommit --jq .mergeCommit.oid)
      git merge-base --is-ancestor "$SHA" origin/main
      test "$(git rev-parse "$MERGE^1")" = "$MAIN_BEFORE"
      test "$(git rev-parse "$MERGE^2")" = "$SHA"
      test "$(git rev-parse "$MERGE^{tree}")" = "$(git rev-parse "$SHA^{tree}")"
      # G4 (sau merge): run push trên main phải xanh
      gh run list --workflow "v3 check" --branch main --event push --commit "$MERGE" >/dev/null

      # Chuẩn bị PR kế tiếp (bỏ qua ở bước 9)
      if [ "$STEP" -lt 9 ]; then
        git merge-base --is-ancestor "$SHA" origin/main
        git merge-base --is-ancestor "$SHA" "$NEXT"
        test "$(git rev-parse "origin/main^{tree}")" = "$(git rev-parse "$SHA^{tree}")"
        gh pr view "$NEXT_PR" --json baseRefName,headRefOid >/dev/null
        git diff --name-only origin/main..."$NEXT" >/dev/null
        gh pr close "$NEXT_PR" && gh pr reopen "$NEXT_PR"
      fi
      # === END EXACT §5.3 COMMAND BLOCK ===
    )
  }

  PREV="$BASE"
  for i in "${!PRS[@]}"; do
    STEP=$((i + 1))
    PR=${PRS[$i]}
    SHA=${SHAS[$i]}
    EXP=${EXPECTED[$i]}
    NEXT_I=$((i + 1))
    if [ "$NEXT_I" -lt "${#PRS[@]}" ]; then
      NEXT_PR=${PRS[$NEXT_I]}
      NEXT_SHA=${SHAS[$NEXT_I]}
    else
      NEXT_PR=""
      NEXT_SHA=""
    fi
    echo "-- Exact §5.3 Step $STEP/9: PR #$PR @ $SHA (PREV=$PREV, EXPECTED_DELTA=$EXP)"
    git fetch origin
    MAIN_BEFORE_CHECK=$(git rev-parse origin/main)
    if [ "$STEP" -ge 2 ]; then
      expect_exit 1 "FEAC-EXT-RB-02 (removed defective pre-merge check): is-ancestor MAIN_BEFORE -> PR #$PR fails" \
        git merge-base --is-ancestor "$MAIN_BEFORE_CHECK" "$SHA"
    fi
    expect_exit 0 "Exact §5.3 command block for Step $STEP/9 (PR #$PR) executes cleanly" \
      run_exact_step_5_3 "$STEP" "$PR" "$SHA" "$PREV" "$EXP" "$NEXT_PR" "$NEXT_SHA"
    PREV="$SHA"
  done
  git fetch origin
  [ "$(git rev-parse "origin/main^{tree}")" = "$(git rev-parse "b80c238941c4927cbd6c9b435816a4fdc6522f4e^{tree}")" ] \
    && ok "Part 3 post-step-9 check: tree(origin/main) == tree(#299)" || bad "Part 3 final tree mismatch"
fi

echo
echo "RESULT: PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ]
