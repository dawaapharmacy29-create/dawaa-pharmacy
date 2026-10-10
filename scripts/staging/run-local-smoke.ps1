$ErrorActionPreference = 'Stop'

function Fail([string]$Message) {
  Write-Host "FAIL: $Message" -ForegroundColor Red
  exit 1
}

if (-not (Test-Path 'package.json')) {
  Fail 'Run this script from the repository root.'
}

$envPath = Join-Path (Get-Location) '.env.local'
if (Test-Path $envPath) {
  $envBytes = [System.IO.File]::ReadAllBytes($envPath)
  if (
    $envBytes.Length -ge 3 -and
    $envBytes[0] -eq 0xEF -and
    $envBytes[1] -eq 0xBB -and
    $envBytes[2] -eq 0xBF
  ) {
    $existingEnv = [System.Text.Encoding]::UTF8.GetString($envBytes, 3, $envBytes.Length - 3)
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($envPath, $existingEnv, $utf8NoBom)
    Write-Host 'Normalized local environment file encoding (values not printed).'
  }
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
$runtimeRoot = Join-Path $env:TEMP ("dawaa-local-smoke-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $runtimeRoot | Out-Null
foreach ($file in @('package.json', 'vercel.json', 'vite.config.ts', 'tsconfig.json', 'index.html', 'postcss.config.js', 'tailwind.config.ts')) {
  Copy-Item -LiteralPath (Join-Path $repo $file) -Destination (Join-Path $runtimeRoot $file)
}
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$localIndexPath = Join-Path $runtimeRoot 'index.html'
$localIndex = [System.IO.File]::ReadAllText($localIndexPath)
$localIndexWithWorkerCsp = $localIndex.Replace(
  "script-src 'self' 'unsafe-inline'",
  "script-src 'self' 'unsafe-inline'; worker-src 'self' blob:"
)
$localIndexWithLoopbackCsp = $localIndex.Replace(
  "connect-src 'self'",
  "connect-src 'self' http://127.0.0.1:54321 ws://127.0.0.1:54321"
)
if ($localIndexWithWorkerCsp -eq $localIndex -or $localIndexWithLoopbackCsp -eq $localIndex) {
  Fail 'Could not add the local Supabase endpoint to the isolated smoke CSP.'
}
$localIndexWithLoopbackCsp = $localIndexWithWorkerCsp.Replace(
  "connect-src 'self'",
  "connect-src 'self' http://127.0.0.1:54321 ws://127.0.0.1:54321"
)
[System.IO.File]::WriteAllText($localIndexPath, $localIndexWithLoopbackCsp, $utf8NoBom)
$localVercelConfigPath = Join-Path $runtimeRoot 'vercel.json'
$localVercelConfig = Get-Content $localVercelConfigPath -Raw | ConvertFrom-Json
$localVercelConfig.PSObject.Properties.Remove('rewrites')
$localVercelConfigJson = $localVercelConfig | ConvertTo-Json -Depth 100
[System.IO.File]::WriteAllText($localVercelConfigPath, $localVercelConfigJson, $utf8NoBom)
foreach ($directory in @('api', 'src', 'public', 'node_modules')) {
  if ($directory -in @('api', 'src', 'public')) {
    Copy-Item -LiteralPath (Join-Path $repo $directory) -Destination (Join-Path $runtimeRoot $directory) -Recurse
  } else {
    New-Item -ItemType Junction -Path (Join-Path $runtimeRoot $directory) -Target (Join-Path $repo $directory) | Out-Null
  }
}
[System.IO.File]::WriteAllText((Join-Path $runtimeRoot '.env'), $envFile, $utf8NoBom)

$devCommand = "Set-Location -LiteralPath '$($runtimeRoot.Replace("'", "''"))'; npx vercel dev --local --listen 127.0.0.1:3000"
$devProcess = Start-Process powershell.exe -WorkingDirectory $runtimeRoot -ArgumentList '-NoExit', '-Command', $devCommand -PassThru
Write-Host "Started isolated local Vercel dev runtime (PID $($devProcess.Id)); cloud project env is not used."

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
  Write-Host "Vercel dev is still running for the browser smoke test; stop PID $($devProcess.Id) when finished."
  exit 0
}

Write-Host "HTTP status: $httpCode"
if ($body) { Write-Host "Response: $body" }
Fail 'Local runtime probe did not reach the expected authenticated boundary.'
