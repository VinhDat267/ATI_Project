[CmdletBinding()]
param(
  [string]$FilePath = "npm",
  [string[]]$ArgumentList = @("run", "ai:eval:offline"),
  [switch]$Live
)

$ErrorActionPreference = "Stop"

function Get-SelectedProviders {
  $providers = @($env:AI_PLANNING_PROVIDER, $env:AI_QE_PROVIDER, $env:AI_EMBEDDING_PROVIDER) |
    Where-Object { $_ -and $_.Trim() } |
    ForEach-Object { $_.Trim().ToLowerInvariant() } |
    Select-Object -Unique
  return $providers
}

function Read-SecretEnvironmentValue([string]$Name) {
  $secure = Read-Host -Prompt "Enter $Name (hidden; blank cancels)" -AsSecureString
  $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try {
    return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
  }
  finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
    $secure.Dispose()
  }
}

if (-not $Live) {
  & $FilePath @ArgumentList
  exit $LASTEXITCODE
}

$selected = @(Get-SelectedProviders)
if ($selected.Count -eq 0) {
  throw "AI provider selection is required before live launch"
}

$names = @()
if ($selected -contains "openai") { $names += "OPENAI_API_KEY" }
if ($selected -contains "google") { $names += "GEMINI_API_KEY" }

$previous = @{}
try {
  foreach ($name in $names) {
    $previous[$name] = [Environment]::GetEnvironmentVariable($name, "Process")
    $value = Read-SecretEnvironmentValue $name
    if ([string]::IsNullOrWhiteSpace($value)) { throw "$name was not supplied" }
    [Environment]::SetEnvironmentVariable($name, $value, "Process")
    $value = $null
  }

  & $FilePath @ArgumentList
  exit $LASTEXITCODE
}
finally {
  foreach ($name in $names) {
    [Environment]::SetEnvironmentVariable($name, $previous[$name], "Process")
  }
}
