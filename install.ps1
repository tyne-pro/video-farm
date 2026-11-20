# Installs TyneFarm (the tyne.pro video farm app) on Windows from the latest release of github.com/tyne-pro/video-farm.
#   irm https://raw.githubusercontent.com/tyne-pro/video-farm/main/install.ps1 | iex
# Running it again updates the app. Data (clips, cache) stays in %USERPROFILE%\TyneFarm.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$repo = 'tyne-pro/video-farm'

$rel = Invoke-RestMethod "https://api.github.com/repos/$repo/releases/latest" -Headers @{ 'User-Agent' = 'tynefarm-installer' }
$asset = $rel.assets | Where-Object { $_.name -like '*x64-setup.exe' } | Select-Object -First 1
if (-not $asset) { Write-Host 'Не знайшов файл для завантаження. / No download found.'; exit 1 }

$setup = Join-Path $env:TEMP $asset.name
Write-Host "==> $($asset.browser_download_url)"
Invoke-WebRequest $asset.browser_download_url -OutFile $setup -UseBasicParsing

# The running copy has to be closed first, together with its generator
Get-Process -Name 'tyne-farm', 'TyneFarm' -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Seconds 1

# Silent install for the current user (no administrator rights needed)
Start-Process $setup -ArgumentList '/S' -Wait
Remove-Item $setup -Force -ErrorAction SilentlyContinue

$dir = Join-Path $env:LOCALAPPDATA 'TyneFarm'
$exe = Get-ChildItem $dir -Filter '*.exe' -ErrorAction SilentlyContinue | Where-Object { $_.Name -notmatch 'uninstall|node|ffmpeg|ffprobe' } | Select-Object -First 1
if ($exe) { Start-Process $exe.FullName }
Write-Host "==> Готово / Done: $dir"
