param(
    [string]$ConfigPath
)

$ErrorActionPreference = "Stop"

function Resolve-FullPath {
    param([Parameter(Mandatory = $true)][string]$PathValue)
    return [System.IO.Path]::GetFullPath((Resolve-Path -LiteralPath $PathValue).Path)
}

$scriptDir = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }
$rootDir = [System.IO.Path]::GetFullPath((Join-Path $scriptDir "..\.."))

if (-not $ConfigPath) {
    $ConfigPath = Join-Path $rootDir "config\sider-chat.json"
}

$configFullPath = Resolve-FullPath -PathValue $ConfigPath
$config = Get-Content -Raw -LiteralPath $configFullPath | ConvertFrom-Json

New-Item -ItemType Directory -Force -Path $config.chrome.user_data_dir | Out-Null

$arguments = @(
    "--user-data-dir=$($config.chrome.user_data_dir)",
    "--remote-debugging-port=$($config.chrome.remote_debug_port)",
    "--new-window",
    $config.site.url
)

foreach ($arg in $config.chrome.extra_args) {
    $arguments += [string]$arg
}

Start-Process -FilePath $config.chrome.path -ArgumentList $arguments | Out-Null
Write-Output "Chrome launched with profile: $($config.chrome.user_data_dir)"
Write-Output "Log in to Sider in that window once, then future runs can stay fully automated."
