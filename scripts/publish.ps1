<#
.SYNOPSIS
  Publish Vesper to GitHub under your own account: create the repository, push the code,
  and tag a release so GitHub Actions builds the Windows, macOS and Linux installers.

.DESCRIPTION
  Run it from anywhere inside the repository:

      powershell -ExecutionPolicy Bypass -File scripts\publish.ps1            # Windows
      pwsh scripts/publish.ps1                                               # macOS / Linux

  What it does (it asks before anything that rewrites history or publishes):
    1. Checks git, the GitHub CLI (gh) and that you are logged in (gh auth login).
    2. Removes AI-attribution lines ("Generated with ...", "Co-authored-by: Claude/Anthropic ...")
       from local commit messages so you are the only author. Only before the first push;
       a backup branch is kept.
    3. Writes the repository URL into package.json (Vesper's update check uses it) and commits.
    4. Creates the GitHub repository (public unless -Private) if needed, and pushes.
    5. Tags v<version from package.json> and pushes the tag. The Release workflow then builds
       the installers and attaches them to a draft release. With -PublishRelease the script
       waits for the builds and publishes the release.

.PARAMETER Name            Repository name (default: vesper).
.PARAMETER Private         Create a private repository instead of a public one.
.PARAMETER NoRelease       Push the code but do not tag a release.
.PARAMETER PublishRelease  Wait for the installer builds, then publish the draft release.
.PARAMETER Yes             Do not ask for confirmation.
.PARAMETER DryRun          Only report what would happen; change nothing.
#>
param(
  [string]$Name = 'vesper',
  [switch]$Private,
  [switch]$NoRelease,
  [switch]$PublishRelease,
  [switch]$Yes,
  [switch]$DryRun
)
# git and gh write progress to stderr. Judge them by exit code, not by stderr output.
$ErrorActionPreference = 'Continue'

function Say($msg, $color = 'Gray') { Write-Host $msg -ForegroundColor $color }
function Step($msg) { Write-Host "`n== $msg" -ForegroundColor Red }
function Fail($msg) { Write-Host "`n$msg" -ForegroundColor Red; exit 1 }
function Confirm-Step($question) {
  if ($Yes) { return $true }
  $a = Read-Host "$question [y/N]"
  return $a -match '^(y|yes)$'
}
# Run a native command, return its output lines; stop with a message if it fails.
function Run {
  $exe = $args[0]; $rest = @($args | Select-Object -Skip 1)
  $out = & $exe @rest 2>&1 | ForEach-Object { "$_" }
  if ($LASTEXITCODE -ne 0) { Fail "$exe $($rest -join ' ') failed:`n$($out -join "`n")" }
  return $out
}
# Run a native command silently; return $true when it succeeds.
function Ok {
  $exe = $args[0]; $rest = @($args | Select-Object -Skip 1)
  & $exe @rest *> $null
  return ($LASTEXITCODE -eq 0)
}

# ---------------------------------------------------------------- 1. prerequisites
Step 'Checking tools'
if (-not (Get-Command git -ErrorAction SilentlyContinue)) { Fail 'git is not installed.' }
if (-not (Get-Command gh -ErrorAction SilentlyContinue)) { Fail 'The GitHub CLI is not installed. Get it from https://cli.github.com, then run: gh auth login' }
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Fail 'Node.js is not installed.' }
$root = ((Run git rev-parse --show-toplevel) | Select-Object -First 1).Trim()
Set-Location $root
if (-not (Test-Path (Join-Path $root 'package.json'))) { Fail "No package.json in $root. Run this inside the Vesper repository." }
if (-not (Ok gh auth status)) { Fail 'You are not logged in to GitHub. Run: gh auth login' }
$owner = ((Run gh api user --jq .login) | Select-Object -First 1).Trim()
$version = ((Run node -p "require('./package.json').version") | Select-Object -First 1).Trim()
$tag = "v$version"
$branch = ((Run git rev-parse --abbrev-ref HEAD) | Select-Object -First 1).Trim()
$url = "https://github.com/$owner/$Name"
Say "GitHub account: $owner   repository: $owner/$Name   branch: $branch   version: $version"
if ((Run git status --porcelain) -and -not $DryRun) { Fail 'You have uncommitted changes. Commit or stash them first, then run this again.' }

# ---------------------------------------------------------------- 2. attribution
Step 'Checking commit messages for AI attribution'
$pattern = '(?im)^(Generated with .*|Co-authored-by:.*(claude|anthropic|qwythos).*)$'
$flagged = @(Run git log --format=%H "refs/heads/$branch" -- | Where-Object { ((Run git log -1 --format=%B $_) -join "`n") -match $pattern })
$remoteExists = Ok gh repo view "$owner/$Name"
$pushedBefore = $remoteExists -and (Ok git ls-remote --exit-code "$url.git" "refs/heads/$branch")
Say "Commits with attribution lines: $($flagged.Count)"

if ($DryRun) {
  Say "Repository exists on GitHub: $remoteExists   branch already pushed: $pushedBefore"
  if ($flagged.Count -and -not $pushedBefore) { Say 'Would remove the attribution lines (keeping a backup branch).' }
  Say "Would $(if ($remoteExists) { 'push to' } else { "create a $(if ($Private) { 'private' } else { 'public' }) repository and push to" }) $url"
  if (-not $NoRelease) { Say "Would tag $tag and push it, which builds the installers." }
  Say "`nDry run: nothing was changed." 'Green'
  exit 0
}

if ($flagged.Count -gt 0) {
  if ($pushedBefore) {
    Say 'This branch is already on GitHub, so its history is left as it is.' 'Yellow'
  } elseif (Confirm-Step 'Remove those lines from the commit messages? (a backup branch is kept)') {
    $backup = "backup/before-publish-$(Get-Date -Format yyyyMMdd-HHmmss)"
    Run git branch $backup | Out-Null
    $env:FILTER_BRANCH_SQUELCH_WARNING = '1'
    # The filter runs in git's own sh, so sed exists on every platform (Git for Windows ships it).
    $filter = "sed -E '/^Generated with /d; /^Co-[Aa]uthored-[Bb]y:.*([Cc]laude|[Aa]nthropic|[Qq]wythos)/d'"
    Run git filter-branch -f --msg-filter $filter -- $branch | Out-Null
    Remove-Item -Recurse -Force (Join-Path $root '.git/refs/original') -ErrorAction SilentlyContinue
    $left = @(Run git log --format=%B "refs/heads/$branch" -- | Where-Object { $_ -match $pattern }).Count
    if ($left) { Fail "Some attribution lines remain. Your original history is on branch $backup." }
    Say "Cleaned. The original history is kept as branch $backup (delete it with: git branch -D $backup)." 'Green'
  }
}

# ---------------------------------------------------------------- 3. repository URL
$pkgRaw = Get-Content (Join-Path $root 'package.json') -Raw
if ($pkgRaw -notmatch [regex]::Escape("$url.git")) {
  Step 'Recording the repository URL in package.json and README'
  Run node -e "const fs=require('fs');const p=JSON.parse(fs.readFileSync('package.json','utf8'));p.repository={type:'git',url:process.argv[1]+'.git'};p.bugs={url:process.argv[1]+'/issues'};fs.writeFileSync('package.json',JSON.stringify(p,null,2)+'\n');const r=fs.readFileSync('README.md','utf8');fs.writeFileSync('README.md',r.split('<this repository>').join(process.argv[1]+'.git'))" $url | Out-Null
  Run git add package.json README.md | Out-Null
  Run git commit -q -m "Set repository URL" | Out-Null
  Say "package.json now points at $url" 'Green'
}

# ---------------------------------------------------------------- 4. publish the code
Step 'Publishing the code'
if (-not $remoteExists) {
  $kind = if ($Private) { 'a private' } else { 'a PUBLIC' }
  if (-not (Confirm-Step "Create $kind repository $owner/$Name and push '$branch'?")) { Say 'Stopped. Nothing was published.' 'Yellow'; exit 0 }
  Ok git remote remove origin | Out-Null
  $vis = if ($Private) { '--private' } else { '--public' }
  Run gh repo create "$owner/$Name" $vis --source $root --remote origin --push `
    --description 'A desktop coding agent for long-running work. Built for Refuseless and any OpenAI-compatible provider.' `
    --homepage 'https://refuseless.com/?ref=dwqxpimh' | Out-Null
  Ok gh repo edit "$owner/$Name" --add-topic coding-agent --add-topic ai-agent --add-topic electron --add-topic llm --add-topic refuseless | Out-Null
} else {
  if (-not (Ok git remote get-url origin)) { Run git remote add origin "$url.git" | Out-Null }
  if (-not (Confirm-Step "Push '$branch' to $url?")) { Say 'Stopped.' 'Yellow'; exit 0 }
  Run git push -u origin $branch | Out-Null
}
Say "Code is at $url" 'Green'

# ---------------------------------------------------------------- 5. release
if ($NoRelease) { Say "`nNo release tagged (-NoRelease). Later: git tag $tag; git push origin $tag"; exit 0 }
Step "Releasing $tag"
if (Ok git rev-parse -q --verify "refs/tags/$tag") {
  if (Ok git ls-remote --exit-code --tags origin "refs/tags/$tag") { Say "Tag $tag is already on GitHub. Raise `"version`" in package.json to release again." 'Yellow'; exit 0 }
} else {
  Run git tag -a $tag -m "Vesper $version" | Out-Null
}
if (-not (Confirm-Step "Push tag $tag? This starts the Windows, macOS and Linux installer builds.")) { Say "Tag $tag exists locally but was not pushed." 'Yellow'; exit 0 }
Run git push origin $tag | Out-Null
Say "Builds started: $url/actions" 'Green'

if ($PublishRelease) {
  Say 'Waiting for the builds (usually 10-20 minutes)...'
  $runId = $null
  for ($i = 0; $i -lt 20 -and -not $runId; $i++) {
    Start-Sleep -Seconds 6
    $runId = (& gh run list --repo "$owner/$Name" --workflow release.yml --limit 1 --json databaseId,headBranch --jq ".[] | select(.headBranch==`"$tag`") | .databaseId" 2>$null | Select-Object -First 1)
  }
  if (-not $runId) { Say "Could not find the build. Publish the draft yourself at $url/releases" 'Yellow'; exit 0 }
  & gh run watch $runId --repo "$owner/$Name" --exit-status
  if ($LASTEXITCODE -ne 0) { Fail "The release build failed. See $url/actions/runs/$runId" }
  Run gh release edit $tag --repo "$owner/$Name" --draft=false --latest | Out-Null
  Say "Published: $url/releases/tag/$tag" 'Green'
} else {
  Say "When the builds finish, the installers are on a draft release. Review and publish it at: $url/releases"
}
