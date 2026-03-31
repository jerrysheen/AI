param(
    [string]$ConfigPath
)

$ErrorActionPreference = "Stop"

function Resolve-FullPath {
    param([Parameter(Mandatory = $true)][string]$PathValue)
    return [System.IO.Path]::GetFullPath((Resolve-Path -LiteralPath $PathValue).Path)
}

function Test-DebugPort {
    param([int]$Port)
    try {
        $client = New-Object System.Net.Sockets.TcpClient
        $async = $client.BeginConnect("127.0.0.1", $Port, $null, $null)
        if ($async.AsyncWaitHandle.WaitOne(500) -and $client.Connected) {
            $client.EndConnect($async)
            $client.Close()
            return $true
        }
        $client.Close()
        return $false
    } catch {
        return $false
    }
}

function Wait-ForDebugPort {
    param(
        [int]$Port,
        [int]$TimeoutMs
    )

    $deadline = (Get-Date).AddMilliseconds($TimeoutMs)
    while ((Get-Date) -lt $deadline) {
        if (Test-DebugPort -Port $Port) {
            return $true
        }
        Start-Sleep -Milliseconds 500
    }
    return $false
}

$scriptDir = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }
$skillDir = [System.IO.Path]::GetFullPath((Join-Path $scriptDir ".."))
$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $skillDir "..\\.."))

if (-not $ConfigPath) {
    $ConfigPath = Join-Path $skillDir "config\\bilibili-browser.json"
}

$configFullPath = Resolve-FullPath -PathValue $ConfigPath
$config = Get-Content -Raw -LiteralPath $configFullPath | ConvertFrom-Json

$defaultProfileDir = Join-Path $repoRoot ".ai-data\\chrome-profile"
$chromeProfileDir = if ($env:AI_CHROME_PROFILE_DIR) {
    [System.IO.Path]::GetFullPath($env:AI_CHROME_PROFILE_DIR)
} elseif ($config.chrome.user_data_dir) {
    [System.IO.Path]::GetFullPath([string]$config.chrome.user_data_dir)
} else {
    [System.IO.Path]::GetFullPath($defaultProfileDir)
}

$port = if ($env:AI_CHROME_DEBUG_PORT) {
    [int]$env:AI_CHROME_DEBUG_PORT
} else {
    [int]$config.chrome.remote_debug_port
}

$chromePath = if ($env:AI_CHROME_PATH) {
    [string]$env:AI_CHROME_PATH
} elseif ($config.chrome.path) {
    [string]$config.chrome.path
} else {
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
}

$startupDelayMs = if ($env:AI_CHROME_STARTUP_DELAY_MS) {
    [int]$env:AI_CHROME_STARTUP_DELAY_MS
} else {
    [int]$config.chrome.startup_delay_ms
}

if (-not (Test-DebugPort -Port $port)) {
    New-Item -ItemType Directory -Force -Path $chromeProfileDir | Out-Null

    $arguments = @(
        "--user-data-dir=$chromeProfileDir",
        "--remote-debugging-port=$port",
        "--new-window"
    )

    foreach ($arg in $config.chrome.extra_args) {
        $arguments += [string]$arg
    }

    $arguments += [string]$config.site.startup_url
    Start-Process -FilePath $chromePath -ArgumentList $arguments | Out-Null
    Start-Sleep -Milliseconds $startupDelayMs

    if (-not (Wait-ForDebugPort -Port $port -TimeoutMs 15000)) {
        throw "Chrome remote debugging port $port is not reachable."
    }
}

Write-Output $port
