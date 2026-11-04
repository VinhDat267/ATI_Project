# PLANORA-UI · Publication snapshot PL-01–PL-06

## Scope and result

This branch publishes the Planora frontend snapshot through PL-06: foundation tokens/components, shell/sidebar, public authentication, auth lifecycle, conversation feed and workflow/preview/receipt cards.

- Product source: `514d982fd9fc152290feb305b0d97f2c40dda21a`.
- Functional base: `6c235837efa6811064c652b570e8c91bf8f77ab6`.
- Each changed product file is byte-identical to that source snapshot.
- PL-07 is pending review fixes and is outside this publication snapshot.
- Private worker prompts, coordinator instructions and local execution records are excluded from both the new commit and its ancestry.

## Validation and limits

- Publication verification checks exact product blob equality, allowed file scope, parent/base ancestry and absence of the private prompt commit.
- Plain `git diff --check` reports six trailing blank lines already present in the source snapshot. No code was changed to remove them; the whitespace check excluding blank-at-EOF warnings passes.
- The PL-06 source has an independent local re-review marked passing for its scope. This publication does not claim fresh runtime tests or CI results.
- Main has advanced since the functional base. Reconcile current main features and rerun integration checks before any merge or deployment. Publication alone does not satisfy the final migration gate.
