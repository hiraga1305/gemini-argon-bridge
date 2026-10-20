[CmdletBinding()]
param (
    [ValidateSet('auto', 'chrome', 'edge')]
    [string]$Browser = 'auto',
    [int]$Port = 9222,
    [string]$Url = "https://gemini.google.com/app"
)

# 1. Check if CDP port is already alive
try {
    $res = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/json/version" -UseBasicParsing -TimeoutSec 2 -ErrorAction Stop
    Write-Host "[OK] Browser CDP is already running on port $Port!" -ForegroundColor Green
    exit 0
} catch {
    # Port not open, continue to launch
}

# 2. Determine browser executable path
$browserPath = ""
$profileDir = ""

$chromePaths = @(
    "C:\Program Files\Google\Chrome\Application\chrome.exe",
    "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
)

$edgePaths = @(
    "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    "C:\Program Files\Microsoft\Edge\Application\msedge.exe"
)

if ($Browser -eq 'chrome' -or $Browser -eq 'auto') {
    foreach ($p in $chromePaths) {
        if (Test-Path $p) {
            $browserPath = $p
            $profileDir = "$env:LOCALAPPDATA\Google\Chrome\ArgonProfile"
            break
        }
    }
}

if (-not $browserPath -and ($Browser -eq 'edge' -or $Browser -eq 'auto')) {
    foreach ($p in $edgePaths) {
        if (Test-Path $p) {
            $browserPath = $p
            $profileDir = "$env:LOCALAPPDATA\Microsoft\Edge\ArgonProfile"
            break
        }
    }
}

if (-not $browserPath) {
    Write-Error "Could not find Chrome or Edge on this machine."
    exit 1
}

Write-Host "Launching browser: $browserPath on port $Port..." -ForegroundColor Cyan
Start-Process -FilePath $browserPath -ArgumentList "--remote-debugging-port=$Port", "--user-data-dir=`"$profileDir`"", "`"$Url`""

# Wait briefly for CDP endpoint to become ready
$ready = $false
for ($i = 0; $i -lt 10; $i++) {
    Start-Sleep -Milliseconds 500
    try {
        $res = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/json/version" -UseBasicParsing -TimeoutSec 1 -ErrorAction Stop
        $ready = $true
        break
    } catch {
        # Retry
    }
}

if ($ready) {
    Write-Host "[OK] Browser launched and CDP port $Port is ready!" -ForegroundColor Green
} else {
    Write-Host "[WARN] Browser started, please ensure tab is loaded." -ForegroundColor Yellow
}
