# Corrected Gemini public campaign follow-up

Status: `PUBLIC_STRICT_26_PASS / HOLDOUT_NOT_RUN / AI_ACCEPTANCE_PARTIAL`.

## Frozen campaign

- Commit: `2011169d8e902fa1f1192c5861fd079156fc55bc`.
- Campaign: `pilot-v2-gemini-free-20260926T12480`.
- Freeze: `7ffec3932f25b049a9cfe00d8b9f1ebd4ad754852ef417a43f56c4580af251ff`.
- Model: `google / gemini-3.1-flash-lite / Interactions`, fixed pilot catalog, `model-only-v1`.
- Manifest: `%TEMP%\pilot-v2-followup-manifest-20260926.json`.
- Journal: `%TEMP%\pilot-v2-followup-journal-20260926` (53 records; 26 public reservations and successful outcomes).
- Report: `%TEMP%\pilot-v2-followup-report-final-20260926.json`.
- Cost cap: **0 USD**, with project-owner Free Tier/no-billing attestation. The provider invoice was not independently verified.

The new manifest was prepared after the evaluator and planner guidance changes were committed. One probe, targeted smoke and the full public set used 26 calls total. No fallback model was used.

## Results

- Strict public grade: **26/26 PASS**, including 4/4 plans per language, 12/12 clarifications and 6/6 refusals.
- Provider attempts: 26 succeeded, 0 failed; usage was reported on every attempt.
- Aggregate reported usage: 63,387 input tokens and 7,878 output tokens, within the frozen caps of 1,000,000 and 200,000.
- All 26 observations were gradeable, with no unsafe-to-grade or redaction flags, unsafe reasons, or remote effects.
- The corrected smoke subset was 11/11 PASS. It included all five plan variants that still failed under the previous evaluator/prompt snapshot.
- This campaign executes no Trello, Sheets, or product workflow tools. A passing public grade establishes only the frozen automatic model-only rubric; semantic adjudication and product/customer acceptance remain separate.

The [corrected strict offline regrade](FULL-DSL-REGRADING-2026-09-26.md) of the *older* saved public campaign remains 19/26 PASS. Those historical observations predate the corrected tool identity mapping and planner guidance; the new 26/26 result above comes from a fresh provider campaign and freeze.

## Holdout execution stopped before the first attempt

The public strict gate and reported-usage budget check passed, so the campaign's report gate opened the frozen holdout dataset. The subsequent one-time holdout execution stopped during local planning-context construction, before `authorizeAndReserve`; the journal contains **zero holdout reservations and zero holdout provider calls**.

A bounded metadata check found that all 20 holdout fixtures omit `sourceFixture.tabId`. The planner correctly fails closed with `PILOT_TRUSTED_SOURCE_INVALID`. No holdout prompt, expected answer or raw model output was printed or used for tuning. The opened holdout is `NOT_RUN`, not a model failure and not sealed. Do not edit these opened cases and reuse them as a fresh holdout; any future holdout campaign needs a separately prepared dataset and a new freeze.

No blind retry was made. The current overall AI-quality state remains partial until holdout evidence, semantic review and user acceptance are complete. SaaS workflow safety and the default-off Trello write gate remain independent.
