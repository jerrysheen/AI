$ErrorActionPreference = "Stop"
Set-Location -Path $PSScriptRoot\..

function Write-Stage {
    param(
        [int]$Percent,
        [string]$Label
    )

    $width = 28
    $filled = [Math]::Min($width, [Math]::Floor($Percent * $width / 100))
    $bar = ("#" * $filled).PadRight($width, ".")
    Write-Host ("[{0,3}%] [{1}] {2}" -f $Percent, $bar, $Label)
}

Write-Stage -Percent 5 -Label "prepare workspace"

$envFile = Join-Path (Get-Location) ".env"
if (Test-Path $envFile) {
    Write-Stage -Percent 15 -Label "load .env"
    Get-Content $envFile | ForEach-Object {
        $line = $_.Trim()
        if (-not $line -or $line.StartsWith("#")) {
            return
        }

        $separatorIndex = $line.IndexOf("=")
        if ($separatorIndex -lt 1) {
            return
        }

        $name = $line.Substring(0, $separatorIndex).Trim()
        $value = $line.Substring($separatorIndex + 1).Trim()

        if (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'"))) {
            $value = $value.Substring(1, $value.Length - 2)
        }

        Set-Item -Path ("Env:" + $name) -Value $value
    }
}

Write-Stage -Percent 35 -Label "resolve python entrypoint"
$env:AI_KNOWLEDGE_BASE_BOOT_PROGRESS = "1"
Write-Stage -Percent 55 -Label "import knowledge-base modules"
Write-Stage -Percent 75 -Label "initialize storage and http server"
Write-Stage -Percent 90 -Label "handoff to python runtime"
python -m src.knowledge_base.server
