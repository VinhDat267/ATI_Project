# Start API server in AI mode (Gemini) for local demo
# Usage: .\scripts\start-api-ai.ps1
# Requires GEMINI_API_KEY to be set in environment before running,
# or set it in this script (never commit the key).

$ErrorActionPreference = "Stop"

# ── Load demo credentials from .artifacts/demo-config.json ────────────────────
$cfg = Get-Content '.artifacts/demo-config.json' | ConvertFrom-Json
$env:G1_DATABASE_URL          = "postgresql://wap:wap@127.0.0.1:55532/wap_g1"
$env:G1_FILESYSTEM_ENABLED    = "true"
$env:API_DEMO_EMAIL           = "demo@ati.local"
$env:API_DEMO_PASSWORD_HASH   = $cfg.HASH
$env:API_CURSOR_KEY           = $cfg.CURSOR_KEY
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
