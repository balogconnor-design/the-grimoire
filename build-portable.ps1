# Builds the portable release of The Grimoire:
#   .\Portable Build\The Grimoire\                      the folder to copy to a flash drive
#   .\Portable Build\The-Grimoire-<version>-portable.zip  the same folder, zipped for distribution
# Run "The Grimoire.exe" inside the folder to start the app.
# Run with:  powershell -ExecutionPolicy Bypass -File build-portable.ps1
# (or double-click "Build Portable.bat")
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

$appName = 'The Grimoire'
$node = 'C:\Program Files\nodejs\node.exe'
if (-not (Test-Path $node)) { $node = (Get-Command node -ErrorAction Stop).Source }
$csc = "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
if (-not (Test-Path $csc)) { $csc = "$env:WINDIR\Microsoft.NET\Framework\v4.0.30319\csc.exe" }
if (-not (Test-Path .\node_modules\vite\bin\vite.js)) { throw 'Dependencies are missing. Run "npm install" first.' }

$version = (Get-Content .\package.json -Raw | ConvertFrom-Json).version
$buildDir = Join-Path $PSScriptRoot 'Portable Build'
$out = Join-Path $buildDir $appName
$objDir = Join-Path $buildDir 'obj'
New-Item -ItemType Directory -Force $out, $objDir | Out-Null

Write-Host "Building $appName $version (portable)"

Write-Host '1/5 Type-checking, testing and building the app...'
& $node .\node_modules\typescript\bin\tsc --noEmit
if ($LASTEXITCODE) { throw 'Type check failed.' }
& $node .\node_modules\vitest\vitest.mjs run
if ($LASTEXITCODE) { throw 'Tests failed.' }
& $node .\node_modules\vite\bin\vite.js build --emptyOutDir
if ($LASTEXITCODE) { throw 'Vite build failed.' }

Write-Host '2/5 Making the icon from the Grimoire logo...'
# Multi-size .ico (PNG-compressed entries) generated from the same logo the app uses.
Add-Type -AssemblyName System.Drawing
$ico = Join-Path $objDir 'icon.ico'
$logo = [System.Drawing.Image]::FromFile((Join-Path $PSScriptRoot 'src\assets\grimoire-logo.png'))
try {
  $sizes = 256, 64, 48, 32, 24, 16
  $pngs = foreach ($sz in $sizes) {
    $b = New-Object System.Drawing.Bitmap $sz, $sz
    $gg = [System.Drawing.Graphics]::FromImage($b)
    $gg.InterpolationMode = 'HighQualityBicubic'; $gg.PixelOffsetMode = 'HighQuality'; $gg.SmoothingMode = 'AntiAlias'
    $gg.DrawImage($logo, 0, 0, $sz, $sz); $gg.Dispose()
    $ms = New-Object System.IO.MemoryStream; $b.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png); $b.Dispose()
    , $ms.ToArray()
  }
} finally { $logo.Dispose() }
$fs = [System.IO.File]::Create($ico); $w = New-Object System.IO.BinaryWriter $fs
try {
  $w.Write([uint16]0); $w.Write([uint16]1); $w.Write([uint16]$sizes.Count)
  $offset = 6 + 16 * $sizes.Count
  for ($i = 0; $i -lt $sizes.Count; $i++) {
    $d = if ($sizes[$i] -ge 256) { 0 } else { $sizes[$i] }
    $w.Write([byte]$d); $w.Write([byte]$d); $w.Write([byte]0); $w.Write([byte]0)
    $w.Write([uint16]1); $w.Write([uint16]32); $w.Write([uint32]$pngs[$i].Length); $w.Write([uint32]$offset)
    $offset += $pngs[$i].Length
  }
  foreach ($p in $pngs) { $w.Write($p) }
} finally { $w.Close() }

Write-Host '3/5 Compiling the launcher...'
# Version and copyright shown in the .exe's Properties > Details come from package.json and LICENSE.
$copyright = (Select-String -Path .\LICENSE -Pattern '^Copyright' | Select-Object -First 1).Line
$asmVersion = ($version -replace '[^0-9.].*$', '') + '.0'
$asmInfo = Join-Path $objDir 'AssemblyInfo.cs'
@"
using System.Reflection;
[assembly: AssemblyTitle("$appName")]
[assembly: AssemblyProduct("$appName")]
[assembly: AssemblyDescription("$appName - portable launcher")]
[assembly: AssemblyCopyright("$copyright")]
[assembly: AssemblyVersion("$asmVersion")]
[assembly: AssemblyFileVersion("$asmVersion")]
[assembly: AssemblyInformationalVersion("$version")]
"@ | Set-Content -Encoding UTF8 $asmInfo
$exe = Join-Path $out "$appName.exe"
& $csc /nologo /target:winexe /optimize+ "/out:$exe" "/win32icon:$ico" `
  /r:System.Windows.Forms.dll /r:System.Management.dll .\portable\Launcher.cs $asmInfo
if ($LASTEXITCODE) { throw 'Launcher compile failed. (Is "The Grimoire" still running from the build folder?)' }

Write-Host '4/5 Copying the app...'
# The "data" folder (saved decks and collection) is never touched.
if (Test-Path "$out\app") { Remove-Item -Recurse -Force "$out\app" }
Copy-Item -Recurse .\dist "$out\app"
(Get-Content .\portable\README.txt -Raw).Replace('{{VERSION}}', $version) | Set-Content -Encoding UTF8 "$out\README.txt"
Copy-Item .\LICENSE "$out\LICENSE.txt"

Write-Host '5/5 Zipping the release...'
# Zip from a clean staging copy so a "data" folder from test runs never ships.
$stage = Join-Path $objDir 'stage'
if (Test-Path $stage) { Remove-Item -Recurse -Force $stage }
$stageApp = Join-Path $stage $appName
New-Item -ItemType Directory -Force $stageApp | Out-Null
Copy-Item $exe, "$out\README.txt", "$out\LICENSE.txt" $stageApp
Copy-Item -Recurse "$out\app" "$stageApp\app"
$zip = Join-Path $buildDir ("The-Grimoire-$version-portable.zip")
if (Test-Path $zip) { Remove-Item -Force $zip }
Add-Type -AssemblyName System.IO.Compression, System.IO.Compression.FileSystem
# Entries are added one by one with "/" separators: under Windows PowerShell 5.1, CreateFromDirectory
# writes "\" separators, which non-Windows unzip tools turn into odd file names.
$archive = [System.IO.Compression.ZipFile]::Open($zip, [System.IO.Compression.ZipArchiveMode]::Create)
try {
  Get-ChildItem -Recurse -File $stage | ForEach-Object {
    $entry = $_.FullName.Substring($stage.Length + 1).Replace('\', '/')
    [void][System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $_.FullName, $entry, [System.IO.Compression.CompressionLevel]::Optimal)
  }
} finally { $archive.Dispose() }
Remove-Item -Recurse -Force $stage

Write-Host ''
Write-Host "Done: $out"
Write-Host "      $zip"
Write-Host "Copy the ""$appName"" folder to your flash drive and double-click ""$appName.exe"","
Write-Host 'or share the zip (unzip it anywhere, then run the .exe).'
