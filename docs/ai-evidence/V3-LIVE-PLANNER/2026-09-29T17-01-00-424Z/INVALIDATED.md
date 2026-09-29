# INVALIDATED

This run does not measure planning quality. The probe supplied no `gatherSearch`,
so the planner returned "Search tools are unavailable" clarifications before any
LLM call for five of six scenarios; the sixth hit a transient Gemini 503. The
probe was corrected to supply labelled fixture search results and to retry
transient 503/429 responses. Kept only as a record of the 503 observation.
