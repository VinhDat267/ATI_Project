#!/usr/bin/env bash
# Stacked-PR merge-commit ancestry rehearsal for Google Sheets Digest Gate A (FEAC v1.2).
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
  bad "SOURCE_REPO not set; Part 2 skipped"
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
fi

echo
echo "RESULT: PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ]
