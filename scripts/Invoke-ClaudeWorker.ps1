[CmdletBinding()]
param(
    [string]$TaskFile,
    [switch]$ValidateOnly
)
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$workerRoot = Join-Path $repoRoot '.claude/worktrees/recruiting-worker'
$workerBranch = 'worktree-recruiting-worker'
$projectId = 'prj_tAhuHcbCr3HXxant1EGPbaFLjc6E'
$teamId = 'team_QQUI11r0DA1T0deViNT5khbf'

function Get-GitOutput([string]$Directory, [string[]]$GitArgs) {
    $output = & git -C $Directory @GitArgs
    if ($LASTEXITCODE -ne 0) { throw "Git check failed: $($GitArgs -join ' ')" }
    return ($output -join "`n").Trim()
}

Get-Command claude -ErrorAction Stop | Out-Null
Get-Command git -ErrorAction Stop | Out-Null
$branch = Get-GitOutput $repoRoot @('branch', '--show-current')
if ($branch -ne 'codex/claude-coordination') { throw "Wrong coordinator branch: $branch" }
$remote = Get-GitOutput $repoRoot @('remote', 'get-url', 'origin')
if ($remote -ne 'https://github.com/ChandlerMS/lgcyap-crm.git') { throw "Unexpected repository: $remote" }
if (Test-Path -LiteralPath $workerRoot) {
    $actualBranch = Get-GitOutput $workerRoot @('branch', '--show-current')
    if ($actualBranch -ne $workerBranch) { throw "Unexpected worker branch: $actualBranch" }
    if (Get-GitOutput $workerRoot @('status', '--porcelain')) { throw 'Worker has pending changes; Codex must review them first.' }
}
$projectFile = Join-Path $repoRoot '.vercel/project.json'
if (!(Test-Path -LiteralPath $projectFile)) { throw 'Coordinator Vercel link is missing.' }
$project = Get-Content -Raw -LiteralPath $projectFile | ConvertFrom-Json
if ($project.projectId -ne $projectId -or $project.orgId -ne $teamId) { throw 'Vercel project mismatch.' }
if ($ValidateOnly) {
    Write-Output "Coordinator verified: $repoRoot"
    Write-Output "Worker destination: $workerRoot ($workerBranch)"
    Write-Output 'Vercel link verified: main-team8/legacy-recruiting-private'
    return
}
if (!$TaskFile -or !(Test-Path -LiteralPath $TaskFile -PathType Leaf)) { throw 'Provide an existing task file.' }
$task = Get-Content -Raw -LiteralPath $TaskFile
if ([string]::IsNullOrWhiteSpace($task)) { throw 'Task file is empty.' }
$runId = (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [guid]::NewGuid().ToString('N').Substring(0, 8)
$runRoot = Join-Path $repoRoot ".collaboration/runs/$runId"
New-Item -ItemType Directory -Path $runRoot -Force | Out-Null
$task | Set-Content -LiteralPath (Join-Path $runRoot 'task.md') -Encoding UTF8
$settings = @{
    permissions = @{
        allow = @('Read', 'Edit', 'Write', 'Glob', 'Grep')
        deny = @('Read(**/.env*)', 'Read(**/.vercel/**)', 'Read(**/*.pem)', 'Edit(**/.env*)', 'Write(**/.env*)')
    }
    disableAllHooks = $true
}
$settingsPath = Join-Path $runRoot 'settings.json'
$settings | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $settingsPath -Encoding UTF8
$mcpPath = Join-Path $runRoot 'mcp.json'
'{"mcpServers":{}}' | Set-Content -LiteralPath $mcpPath -Encoding UTF8
$prompt = @"
You are Codex's implementation worker for legacy-recruiting-private.
Read CLAUDE.md, AGENTS.md and docs/collaboration/README.md first.
Work only inside this checkout and the task's allowed paths. You have file tools only.
Codex runs shell commands, tests, Git operations, and deployments. Do not access secrets or customer data.
Return status, files changed, checks actually run, checks needed, and blockers; then stop.

$task
"@
$claudeArgs = @('--print', '--output-format', 'json', '--permission-mode', 'dontAsk',
    '--tools', 'Read,Edit,Write,Glob,Grep', '--allowedTools', 'Read,Edit,Write,Glob,Grep',
    '--settings', $settingsPath, '--setting-sources', 'project', '--strict-mcp-config',
    '--mcp-config', $mcpPath, '--disable-slash-commands')
$launchRoot = $workerRoot
if (!(Test-Path -LiteralPath $workerRoot)) {
    $launchRoot = $repoRoot
    $claudeArgs += @('--worktree', 'recruiting-worker')
}
Write-Output "Run files: $runRoot"
Push-Location $launchRoot
try {
    $prompt | & claude @claudeArgs 2> (Join-Path $runRoot 'stderr.log') |
        Set-Content -LiteralPath (Join-Path $runRoot 'result.json') -Encoding UTF8
    $claudeExit = $LASTEXITCODE
} finally { Pop-Location }
if (Test-Path -LiteralPath $workerRoot) {
    if ((Get-GitOutput $workerRoot @('branch', '--show-current')) -ne $workerBranch) { throw 'Worker branch changed unexpectedly.' }
    $workerLink = Join-Path $workerRoot '.vercel'
    New-Item -ItemType Directory -Path $workerLink -Force | Out-Null
    Copy-Item -LiteralPath $projectFile -Destination (Join-Path $workerLink 'project.json')
}
if ($claudeExit -ne 0) { throw "Claude exited with code $claudeExit; inspect run files." }
$result = Get-Content -Raw -LiteralPath (Join-Path $runRoot 'result.json') | ConvertFrom-Json
if ($result.is_error) { throw "Claude reported an error; inspect $runRoot" }
if (!$result.result) { throw 'Claude returned no task result.' }
Write-Output $result.result
Write-Output 'Codex must inspect the worker diff and verify acceptance before integration.'
