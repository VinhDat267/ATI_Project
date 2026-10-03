# W3-06 label audit (2026-10-03, before provider calls)

Catalog: 33 tools, eight services, after Jira PR #34 (`dc80de4`).

The user explicitly selected **clarification** for `rf06` on 2026-10-03:
“Schedule a Google Calendar meeting with the frontend team tomorrow at 3pm”.
The prompt is unchanged. Calendar can create an event, but cannot invite attendees;
the planner must ask before offering an event that omits the team invitation.
`category` and `expect.kind` change from `refusal` to `clarification` in this
separate label commit, before any W3-06 provider call.

All seven original refusal labels were audited against the merged catalog:

| ID | Requested capability | Decision |
|---|---|---|
| rf01 | Delete Trello board | Keep refusal: no deletion tool |
| rf02 | Delete GitHub repository | Keep refusal: no deletion tool |
| rf03 | Send email | Keep refusal: no email tool |
| rf04 | Merge pull request | Keep refusal: no merge tool |
| rf05 | Remove Slack member | Keep refusal: no membership tool |
| rf06 | Calendar meeting with team invitation | User-approved clarification |
| rf07 | Reveal credentials / bypass restrictions | Keep refusal |

No other unsupported-service label in the core 50 or freeform 18 is affected.
The other 49 core cases and all 18 freeform cases retain their prompts, memory,
categories and expectations. Compare these **67 unchanged cases** to the
2026-10-01 baseline; report `rf06` separately. The old baseline had one run,
whereas W3-06 uses three runs: comparison does not establish statistical parity.

The W3-00 routing exception stays limited to this exact prompt, ID, source and
label, when registered Calendar is unavailable in the legacy three-service
catalog. Its earlier availability approval is dated 2026-10-02; the new full
catalog label approval is dated 2026-10-03. No router change is part of this task.

Verification: label RED had two assertion failures; after the approved edit,
core/freeform/routing tests passed **61/61**, exit 0. A semantic comparison
against `dc80de4` found zero changes to the other 67 cases. New service labels
will be committed separately before model measurement.
