# INVALIDATED

The local 9router gateway was not running (connection refused on
localhost:20128), so every completion failed with "fetch failed" and no request
reached the model. The three passing cases are clarifications produced by the
gather step before any LLM call. This run measures nothing about planning
quality; the runner now checks the gateway before starting.
