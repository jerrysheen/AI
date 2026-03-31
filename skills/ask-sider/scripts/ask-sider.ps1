param(
    [Parameter(Mandatory = $true, Position = 0)]
    [string]$Question,

    [string]$ConfigPath,

    [switch]$AsJson,

    [switch]$SkipBrowserCleanup,

    [switch]$ReuseExistingChrome
)

$ErrorActionPreference = "Stop"
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[Console]::InputEncoding = $utf8NoBom
[Console]::OutputEncoding = $utf8NoBom
$OutputEncoding = $utf8NoBom

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

if (-not $ConfigPath) {
    $ConfigPath = Join-Path $skillDir "config\sider-chat.json"
}

$configFullPath = Resolve-FullPath -PathValue $ConfigPath
$config = Get-Content -Raw -LiteralPath $configFullPath | ConvertFrom-Json
$port = [int]$config.chrome.remote_debug_port
$portReady = Test-DebugPort -Port $port

if (-not $portReady) {
    if ($config.browser_cleanup.enabled -and -not $SkipBrowserCleanup) {
        foreach ($processName in $config.browser_cleanup.process_names) {
            Get-Process -Name $processName -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
        }
        Start-Sleep -Milliseconds ([int]$config.browser_cleanup.wait_after_kill_ms)
    }

    New-Item -ItemType Directory -Force -Path $config.chrome.user_data_dir | Out-Null

    $arguments = @(
        "--user-data-dir=$($config.chrome.user_data_dir)",
        "--remote-debugging-port=$($config.chrome.remote_debug_port)",
        "--new-window"
    )

    foreach ($arg in $config.chrome.extra_args) {
        $arguments += [string]$arg
    }

    $arguments += [string]$config.chrome.startup_url
    Start-Process -FilePath $config.chrome.path -ArgumentList $arguments | Out-Null
    Start-Sleep -Milliseconds ([int]$config.chrome.startup_delay_ms)

    if (-not (Wait-ForDebugPort -Port $port -TimeoutMs 15000)) {
        throw "Chrome remote debugging port $port is not reachable. Run skills\\ask-sider\\scripts\\init-sider-profile.ps1 once, confirm the dedicated Chrome window can open Sider, then rerun."
    }
}

$nodeScript = Join-Path $scriptDir "ask-sider.js"
if (-not (Test-Path -LiteralPath $nodeScript)) {
    throw "Node script not found: $nodeScript"
}

$jsonText = node $nodeScript --config $configFullPath --question $Question
$result = $jsonText | ConvertFrom-Json

if ($LASTEXITCODE -ne 0 -or $result.status -eq 'error') {
    $message = if ($result.note) { $result.note } else { "Unknown error" }
    throw "ask-sider.js failed: $message"
}

if ($AsJson) {
    $result | ConvertTo-Json -Depth 10
} else {
    if ($result.status -ne 'ok') {
        $hint = if ($result.recovery_hint) { $result.recovery_hint } else { 'manual_check' }
        throw "ask-sider.js returned status '$($result.status)' with recovery_hint '$hint': $($result.note)"
    }
    Write-Output $result.reply_text
}

