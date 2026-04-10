$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$workerScript = Join-Path $scriptDir "remote_transcribe_worker.js"
node $workerScript
