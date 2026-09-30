# INVALIDATED

This run does not measure planning quality. It targeted the local 9router
gateway (`ag/gemini-3.8-flash`) without `LLM_API_KEY`, and every completion was
rejected with HTTP 401 "Missing API key" in under half a second. It is kept only
as evidence that a gateway auth error fails fast without retries.
