# 2026-11-09 — Independent Trello Gate 0 RED evidence

- Authorized scope: evidence and RED tests only; no production changes, merges, deployments or external provider writes.
- Base main: 08c8d8c5e7bf12625857ac3496fb96ec3914e34f; baseline CI success.
- Branch: test/trello-gate0-evidence.
- Corrected OAuth claim: official Trello API reference lists read:board:trello for board cards, lists and members. Provider native OAuth consent and reads NOT_RUN.
- New RED tests: scope/board grounding; digest coverage and missing receipts/channel validation.
- See docs/audits/2026-11-09-trello-gate0/EVIDENCE.md for precise status and limitations.
- Shared Sheets draft PRs #289–#295 left untouched. Future GREEN remediation requires a new approval.
- Reviewer evidence pending exact branch CI inspection; test failures must reflect intended assertions, not environment setup.
