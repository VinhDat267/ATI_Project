# Calendar combined gate: C1/C2 final blockers

Owner authorized recovery, targeted fixes and isolated implementation. Scope: Calendar preview fidelity and valid recurring fixture; no provider behavior change. Baseline combined5b5669ee.

## Kết quả
Codex reproduced C1/C2 and recurring fixture failure:3fail/6pass, log combined-gate/logs/codex-final-c-red.log. Added explicit existing-attendee update disclosure, used named timezone in detailed/inline previews with safe invalid-zone display and unchanged date-only semantics. Added cross-midnight and DST spring/fall exact wall-time assertions without mutating frozen approved args. Added required IANA timezone to recurring fixture. GREEN3files16tests, log codex-final-c-green.log. Full combined CI and independent final review pending; productionHOLD.
