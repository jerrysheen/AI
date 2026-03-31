param(
    [Parameter(Mandatory = $true)]
    [string]$Video,

    [string]$PreferLang = "ai-zh",
    [string]$WhisperModel = "small",
    [string]$WhisperLanguage = "Chinese",
    [string]$AudioFormat = "m4a",
    [switch]$NoAudioFallback,
    [switch]$Pretty
)

$ErrorActionPreference = "Stop"

$scriptDir = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }
$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $scriptDir "..\..\.."))

function Invoke-NodeJson {
    param(
        [Parameter(Mandatory = $true)]
        [string]$ScriptPath,
        [Parameter(Mandatory = $true)]
        [string[]]$Arguments,
        [switch]$AllowNonZeroExit
    )

    $output = & node $ScriptPath @Arguments 2>&1
    $exitCode = $LASTEXITCODE
    $text = ($output | Out-String).Trim()

    if ($exitCode -ne 0 -and -not $AllowNonZeroExit) {
        throw $text
    }

    if (-not $text) {
        throw "No JSON output returned from $ScriptPath"
    }

    try {
        return $text | ConvertFrom-Json
    } catch {
        if ($exitCode -ne 0) {
            throw $text
        }
        throw
    }
}

function Write-JsonResult {
    param([Parameter(Mandatory = $true)]$Object)

    if ($Pretty) {
        $Object | ConvertTo-Json -Depth 20
    } else {
        $Object | ConvertTo-Json -Depth 20 -Compress
    }
}

function Write-Stage {
    param([Parameter(Mandatory = $true)][string]$Message)
    [Console]::Error.WriteLine($Message)
}

$subtitleScript = Join-Path $scriptDir "fetch_bilibili_subtitle.js"
$audioScript = Join-Path $scriptDir "fetch_bilibili_audio.js"
$asrScript = Join-Path $scriptDir "transcribe_bilibili_audio.ps1"

$subtitleArgs = @($Video, "--prefer-lang", $PreferLang)
if ($Pretty) {
    $subtitleArgs += "--pretty"
}

Write-Stage "Checking subtitles..."
$subtitle = Invoke-NodeJson -ScriptPath $subtitleScript -Arguments $subtitleArgs -AllowNonZeroExit

if (-not $subtitle.error) {
    Write-Stage "Subtitle track found."
    $result = [ordered]@{
        bvid = $subtitle.bvid
        title = $subtitle.title
        url = $subtitle.url
        subtitle_lang = $subtitle.subtitle_lang
        subtitle_lang_doc = $subtitle.subtitle_lang_doc
        has_ai_subtitle = $subtitle.has_ai_subtitle
        transcript_source = "subtitle"
        fallback_used = $false
        audio_file = $null
        asr_file = $null
        full_text = $subtitle.full_text
        error = $null
    }
    Write-Output (Write-JsonResult -Object $result)
    exit 0
}

if ($NoAudioFallback) {
    Write-Stage "No subtitles found. Audio fallback disabled."
    $result = [ordered]@{
        bvid = $subtitle.bvid
        title = $subtitle.title
        url = $subtitle.url
        subtitle_lang = $subtitle.subtitle_lang
        subtitle_lang_doc = $subtitle.subtitle_lang_doc
        has_ai_subtitle = $subtitle.has_ai_subtitle
        transcript_source = $null
        fallback_used = $false
        audio_file = $null
        asr_file = $null
        full_text = ""
        error = $subtitle.error
    }
    Write-Output (Write-JsonResult -Object $result)
    exit 1
}

Write-Stage "No subtitles found. Downloading audio..."
$audioArgs = @($Video, "--audio-format", $AudioFormat)
if ($Pretty) {
    $audioArgs += "--pretty"
}
$audio = Invoke-NodeJson -ScriptPath $audioScript -Arguments $audioArgs

$asrOutputDir = Join-Path $repoRoot ".ai-data\asr\bilibili"
Write-Stage "Running Whisper ASR..."
$asrOutput = & powershell -ExecutionPolicy Bypass -File $asrScript -AudioFile $audio.audio_file -Model $WhisperModel -Language $WhisperLanguage -OutputDir $asrOutputDir 2>&1
$asrExitCode = $LASTEXITCODE
if ($asrExitCode -ne 0) {
    throw (($asrOutput | Out-String).Trim())
}

$bvidMatch = [regex]::Match([string]$subtitle.bvid, "BV[0-9A-Za-z]+")
$bvid = if ($bvidMatch.Success) { $bvidMatch.Value } else { [System.IO.Path]::GetFileNameWithoutExtension($audio.audio_file) }
$asrFile = Join-Path $asrOutputDir "$bvid.txt"
$fullText = if (Test-Path -LiteralPath $asrFile) {
    (Get-Content -Raw -LiteralPath $asrFile).Trim()
} else {
    ""
}

$final = [ordered]@{
    bvid = $subtitle.bvid
    title = $subtitle.title
    url = $subtitle.url
    subtitle_lang = $null
    subtitle_lang_doc = $null
    has_ai_subtitle = $false
    transcript_source = "audio_asr"
    fallback_used = $true
    audio_file = $audio.audio_file
    asr_file = $asrFile
    full_text = $fullText
    error = if ($fullText) { $null } else { "ASR completed but transcript text was empty." }
}

Write-Stage "Transcript ready."
Write-Output (Write-JsonResult -Object $final)
if ($final.error) {
    exit 1
}
exit 0
