# Находит Node.js или ставит его ОДИН раз в общую папку %LOCALAPPDATA%\Lumen\node.
# Её используют и приложение, и бот, и все новые версии — повторно ничего не качается.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch {}

$root   = Split-Path -Parent $PSScriptRoot
$base   = Join-Path $env:LOCALAPPDATA 'Lumen'
$shared = Join-Path $base 'node'
$local  = Join-Path $root 'runtime\node'

function Test-Node($exe) {
  if (-not $exe -or -not (Test-Path -LiteralPath $exe)) { return $false }
  try {
    $out = & $exe -p "process.versions.node.split('.')[0]" 2>$null
    return ([int]"$out") -ge 18
  } catch { return $false }
}

# 1) уже есть: рядом с программой (старые версии), в общей папке или в системе
if (Test-Node (Join-Path $local 'node.exe'))  { exit 0 }
if (Test-Node (Join-Path $shared 'node.exe')) { exit 0 }
foreach ($c in @(Get-Command node.exe -All -ErrorAction SilentlyContinue)) {
  if (Test-Node $c.Source) { exit 0 }
}
foreach ($p in @("$env:ProgramFiles\nodejs\node.exe", "${env:ProgramFiles(x86)}\nodejs\node.exe")) {
  if (Test-Node $p) { exit 0 }
}

# 2) остатки прошлой неудачной установки (распаковалось, но не переименовалось)
New-Item -ItemType Directory -Force -Path $base | Out-Null
foreach ($d in @(Get-ChildItem -LiteralPath $base -Directory -Filter 'node-v*' -ErrorAction SilentlyContinue) + @(Get-ChildItem -LiteralPath (Join-Path $root 'runtime') -Directory -Filter 'node-v*' -ErrorAction SilentlyContinue)) {
  $inner = Get-ChildItem -LiteralPath $d.FullName -Directory -Filter 'node-v*' -ErrorAction SilentlyContinue | Select-Object -First 1
  $cand = if ($inner) { $inner.FullName } else { $d.FullName }
  if (Test-Node (Join-Path $cand 'node.exe')) {
    try {
      if (Test-Path -LiteralPath $shared) { Remove-Item -LiteralPath $shared -Recurse -Force }
      Move-Item -LiteralPath $cand -Destination $shared
      if ($inner) { Remove-Item -LiteralPath $d.FullName -Recurse -Force -ErrorAction SilentlyContinue }
      if (Test-Node (Join-Path $shared 'node.exe')) { exit 0 }
    } catch {}
  }
}

# 3) качаем один раз
try {
  Write-Host ''
  Write-Host '  Скачиваю Node.js (~30 МБ). Это один раз на компьютер...' -ForegroundColor Magenta
  $idx = Invoke-RestMethod 'https://nodejs.org/dist/index.json'
  $v = ($idx | Where-Object { $_.lts -and $_.version -like 'v22.*' } | Select-Object -First 1).version
  $arch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64' -or $env:PROCESSOR_ARCHITEW6432 -eq 'ARM64') { 'arm64' } else { 'x64' }
  $name = "node-$v-win-$arch"
  $zip = Join-Path $env:TEMP "$name-$PID.zip"
  $stage = Join-Path $base "node-v-stage-$PID"
  Invoke-WebRequest "https://nodejs.org/dist/$v/$name.zip" -OutFile $zip -UseBasicParsing

  Write-Host '  Распаковываю...' -ForegroundColor Magenta
  New-Item -ItemType Directory -Force -Path $stage | Out-Null
  $tar = Get-Command tar.exe -ErrorAction SilentlyContinue
  $done = $false
  if ($tar) {
    try { & $tar.Source -xf $zip -C $stage 2>$null | Out-Null } catch {}
    $done = Test-Path -LiteralPath (Join-Path $stage "$name\node.exe")
  }
  if (-not $done) { Expand-Archive -LiteralPath $zip -DestinationPath $stage -Force }
  Remove-Item -LiteralPath $zip -Force -ErrorAction SilentlyContinue

  # пока мы качали, другое окно (приложение/бот) могло уже поставить
  if (Test-Node (Join-Path $shared 'node.exe')) {
    Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue
    exit 0
  }
  if (Test-Path -LiteralPath $shared) { Remove-Item -LiteralPath $shared -Recurse -Force }
  # антивирус может держать свежие файлы — пробуем несколько раз
  $moved = $false
  for ($i = 0; $i -lt 15 -and -not $moved; $i++) {
    try { Move-Item -LiteralPath (Join-Path $stage $name) -Destination $shared; $moved = $true }
    catch { Start-Sleep -Seconds 1 }
  }
  if (-not $moved) { throw 'Не получилось переместить Node.js (возможно, мешает антивирус).' }
  Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue
  if (-not (Test-Node (Join-Path $shared 'node.exe'))) { throw 'Node.js скачался, но не запускается.' }
  Write-Host "  Node.js $v готов. Больше качать не будет." -ForegroundColor Green
  exit 0
} catch {
  Write-Host ''
  Write-Host "  Ошибка: $($_.Exception.Message)" -ForegroundColor Red
  "$(Get-Date -Format s)  $($_.Exception.Message)" | Out-File -Append -Encoding utf8 (Join-Path $base 'node-install.log')
  exit 1
}
