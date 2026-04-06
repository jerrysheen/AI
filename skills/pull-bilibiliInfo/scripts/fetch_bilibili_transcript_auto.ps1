param(
    [Parameter(Mandatory = $true)]
    [string]$Video,

    [string]$PreferLang = "ai-zh",
    [switch]$Pretty
)

$ErrorActionPreference = "Stop"

$scriptDir = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }

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

 # Future ASR hook: if Whisper fallback is re-enabled later, branch here and
 # call fetch_bilibili_audio.js plus transcribe_bilibili_audio.ps1/js.
Write-Stage "No AI subtitles found."
$final = [ordered]@{
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

Write-Output (Write-JsonResult -Object $final)
exit 1
