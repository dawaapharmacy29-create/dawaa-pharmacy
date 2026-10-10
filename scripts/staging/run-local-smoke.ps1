$ErrorActionPreference = 'Stop'

function Fail([string]$Message) {
  Write-Host "FAIL: $Message" -ForegroundColor Red
  exit 1
}

if (-not (Test-Path 'package.json')) {
  Fail 'Run this script from the repository root.'
}

Write-Host 'Preparing isolated local Supabase smoke runtime...'

$status = & npx supabase status -o env 2>$null
if ($LASTEXITCODE -ne 0) {
  Fail 'Local Supabase is not running. Start Docker/Supabase first.'
}

function Get-SupaEnv([string]$Name) {
  $line = $status | Where-Object { $_ -match "^$Name=" } | Select-Object -First 1
  if (-not $line) { return $null }
  return (($line -replace '^[^=]+=', '').Trim('"'))
}

$anon = Get-SupaEnv 'PUBLISHABLE_KEY'
if (-not $anon) { $anon = Get-SupaEnv 'ANON_KEY' }
$service = Get-SupaEnv 'SECRET_KEY'
if (-not $service) { $service = Get-SupaEnv 'SERVICE_ROLE_KEY' }

if (-not $anon) { Fail 'Could not read the local Supabase publishable/anon key.' }
if (-not $service) { Fail 'Could not read the local Supabase server/service key.' }

$env:DAWAA_DEPLOY_ENV = 'local'
$env:VITE_SUPABASE_URL = 'http://127.0.0.1:54321'
$env:SUPABASE_URL = 'http://127.0.0.1:54321'
$env:VITE_SUPABASE_ANON_KEY = $anon
$env:SUPABASE_SERVICE_ROLE_KEY = $service

$envFile = @"
DAWAA_DEPLOY_ENV=local
VITE_SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_URL=http://127.0.0.1:54321
VITE_SUPABASE_ANON_KEY=$anon
SUPABASE_SERVICE_ROLE_KEY=$service
"@

$envPath = Join-Path (Get-Location) '.env.local'
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($envPath, $envFile, $utf8NoBom)
Write-Host 'PASS local environment prepared (secrets not printed).'

& node scripts/build-sales-intelligence-refresh-api.cjs --check *> $null
if ($LASTEXITCODE -ne 0) {
  Write-Host 'Generated API was stale; rebuilding it locally...'
  & node scripts/build-sales-intelligence-refresh-api.cjs
  if ($LASTEXITCODE -ne 0) { Fail 'Could not rebuild the generated Sales Intelligence API.' }
  & node scripts/build-sales-intelligence-refresh-api.cjs --check
  if ($LASTEXITCODE -ne 0) { Fail 'Generated API verification still fails after rebuild.' }
}
Write-Host 'PASS generated API matches canonical server source.'

$repo = (Get-Location).Path
$devCommand = "Set-Location -LiteralPath '$($repo.Replace("'", "''"))'; npx vercel dev"
Start-Process powershell.exe -WorkingDirectory $repo -ArgumentList '-NoExit', '-Command', $devCommand | Out-Null
Write-Host 'Started Vercel dev in a separate PowerShell window.'

$ready = $false
for ($i = 0; $i -lt 60; $i++) {
  Start-Sleep -Seconds 1
  try {
    $code = & curl.exe -s -o NUL -w '%{http_code}' 'http://localhost:3000/' 2>$null
    if ($code -match '^2\d\d$|^3\d\d$|^4\d\d$') {
      $ready = $true
      break
    }
  } catch {}
}
if (-not $ready) { Fail 'Vercel dev did not become reachable on http://localhost:3000 within 60 seconds.' }

$tempBody = Join-Path $env:TEMP 'dawaa-local-smoke-response.json'
$httpCode = & curl.exe -s -o $tempBody -w '%{http_code}' -X POST 'http://localhost:3000/api/sales-intelligence-refresh-source' -H 'Content-Type: application/json' -H 'Expect:' --data '{}'
$body = if (Test-Path $tempBody) { Get-Content $tempBody -Raw } else { '' }
Remove-Item $tempBody -ErrorAction SilentlyContinue

if ($httpCode -eq '401' -and $body -match 'missing_user_token') {
  Write-Host 'LOCAL_RUNTIME_SMOKE_READY' -ForegroundColor Green
  Write-Host 'API transport, environment isolation, and local server configuration passed.'
  Write-Host 'Vercel dev is still running in the separate window for the browser smoke test.'
  exit 0
}

Write-Host "HTTP status: $httpCode"
if ($body) { Write-Host "Response: $body" }
Fail 'Local runtime probe did not reach the expected authenticated boundary.'
