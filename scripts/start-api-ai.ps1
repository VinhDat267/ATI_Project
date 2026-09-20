# Start API server in AI mode (Gemini) for local demo
# Usage: .\scripts\start-api-ai.ps1
# Requires GEMINI_API_KEY to be set in environment before running,
# or set it in this script (never commit the key).

$ErrorActionPreference = "Stop"

# ── Static demo credentials (not real user data) ──────────────────────────────
$env:G1_DATABASE_URL          = "postgresql://wap:wap@127.0.0.1:55532/wap_g1"
$env:API_DEMO_EMAIL           = "demo@local.dev"
$env:API_DEMO_PASSWORD_HASH   = "scrypt`$16384`$8`$1`$19bcc1910a38373b93f6ec2e044c44ae`$4bd92ed2b52ab4820394c4807953beb16c2968df9d2976d92003736fba04176ce41105b256f427fe2aaef62453ba205d6a9a36a0ec03fb25e4f67c47d16b5230"
$env:API_CURSOR_KEY           = "ROOqEsg+vyYDpPyBovPBu9zO9gu4VJEjdbL6lARCZ+k="
$env:API_PORT                 = "3001"

# ── AI planner — Google Gemini ─────────────────────────────────────────────────
$env:API_PLANNER_MODE         = "ai"
$env:AI_PLANNING_PROVIDER     = "google"
$env:AI_PLANNING_MODEL        = "gemini-3.5-flash"
$env:AI_QE_PROVIDER           = "google"
$env:AI_QE_MODEL              = "gemini-3.5-flash"
$env:AI_EMBEDDING_PROVIDER    = "google"
$env:AI_EMBEDDING_MODEL       = "gemini-embedding-001"
$env:AI_EMBEDDING_DIMENSIONS  = "1536"

# ── GEMINI_API_KEY must already be set externally (never hardcode here) ────────
if (-not $env:GEMINI_API_KEY) {
  $secure = Read-Host -Prompt "Enter GEMINI_API_KEY (hidden; blank cancels)" -AsSecureString
  $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try   { $env:GEMINI_API_KEY = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr); $secure.Dispose() }
  if ([string]::IsNullOrWhiteSpace($env:GEMINI_API_KEY)) { throw "GEMINI_API_KEY was not supplied" }
}

Write-Host "Starting API (planner_mode=ai, provider=google/gemini-3.5-flash)..." -ForegroundColor Cyan
node apps/api/dist/main.js
