param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('api', 'web')]
  [string]$Mode
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $repoRoot

if ($Mode -eq 'web') {
  $env:WAP_API_TARGET = 'http://127.0.0.1:3001'
  $env:WAP_PREVIEW_ORIGIN = 'http://127.0.0.1:4173'
  npm run build -w @wap/web -- --mode live
  if ($LASTEXITCODE -ne 0) { throw 'Không build được giao diện live' }
  Write-Host 'Mở http://127.0.0.1:4173/#/pilot/runs/81fbbc5a-64e5-4d74-80e9-337a211447cd'
  npm run preview -w @wap/web
  exit $LASTEXITCODE
}

$ownerId = '00000000-0000-4000-8000-000000000001'
$required = @(
  'PILOT_V2_ENABLED', 'PILOT_PRINCIPALS', 'PILOT_SPREADSHEET_ID', 'PILOT_TAB_ID',
  'PILOT_BOARD_ID', 'PILOT_TRELLO_LIST_ID', 'GOOGLE_SHEETS_API_KEY',
  'TRELLO_API_KEY', 'TRELLO_API_TOKEN'
)
foreach ($name in $required) {
  $value = [Environment]::GetEnvironmentVariable($name, 'User')
  if ([string]::IsNullOrWhiteSpace($value)) { throw "Thiếu biến User $name" }
  [Environment]::SetEnvironmentVariable($name, $value, 'Process')
}
if ($env:PILOT_V2_ENABLED -ne 'true' -or
    -not (($env:PILOT_PRINCIPALS -split ',').Trim() -contains $ownerId)) {
  throw 'Pilot hoặc principal chủ run chưa được allowlist'
}

# Keep Trello and model dispatch disabled for this acceptance session.
$env:PILOT_V2_WRITE_ENABLED = 'false'
$env:AI_PROVIDER_CALLS_ENABLED = 'false'
$env:API_NEW_RUNS_ENABLED = 'false'
$env:API_PLANNER_MODE = 'disabled'
$env:WAP_PLANNER_MODE = 'disabled'
$env:API_LEGACY_PASSWORD_AUTH_ENABLED = 'true'
$env:OIDC_ENABLED = 'false'
$env:API_PORT = '3001'
$env:G1_DATABASE_URL = 'postgresql://wap:wap@127.0.0.1:55532/wap_pilot_preview_20260925'
$env:G1_USER_ID = $ownerId
$env:API_DEMO_EMAIL = 'pilot-owner@example.local'
$env:API_CURSOR_KEY = [Convert]::ToBase64String(
  [Security.Cryptography.RandomNumberGenerator]::GetBytes(32)
)
$password = [Convert]::ToBase64String(
  [Security.Cryptography.RandomNumberGenerator]::GetBytes(24)
)
$env:API_DEMO_PASSWORD_HASH = $password | node --input-type=module -e `
  'import { readFileSync } from "node:fs"; import { hashPassword } from "./apps/api/dist/auth.js"; process.stdout.write(await hashPassword(readFileSync(0, "utf8").trim()));'
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($env:API_DEMO_PASSWORD_HASH)) {
  throw 'Không tạo được mật khẩu phiên nghiệm thu'
}

Write-Host 'Phiên nghiệm thu chỉ đọc đang khởi động trên http://127.0.0.1:3001'
Write-Host "Email: $env:API_DEMO_EMAIL"
Write-Host "Mật khẩu tạm (chỉ hiện ở terminal này): $password"
Write-Host 'Giữ terminal này mở; đóng terminal để dừng API. Không chia sẻ mật khẩu hoặc key.'
node apps/api/dist/main.js
exit $LASTEXITCODE
