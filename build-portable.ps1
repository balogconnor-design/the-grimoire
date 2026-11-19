# Builds the portable app into ".\Portable Build\Commander Deck".
# Copy that "Commander Deck" folder to a flash drive and run "Commander Deck.exe".
# Run with:  powershell -ExecutionPolicy Bypass -File build-portable.ps1
# (or double-click "Build Portable.bat")
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

$node = 'C:\Program Files\nodejs\node.exe'
if (-not (Test-Path $node)) { $node = (Get-Command node -ErrorAction Stop).Source }
$csc = "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
if (-not (Test-Path $csc)) { $csc = "$env:WINDIR\Microsoft.NET\Framework\v4.0.30319\csc.exe" }

Write-Host '1/4 Type-checking and building the app...'
& $node .\node_modules\typescript\bin\tsc --noEmit
if ($LASTEXITCODE) { throw 'Type check failed.' }
& $node .\node_modules\vite\bin\vite.js build --emptyOutDir
if ($LASTEXITCODE) { throw 'Vite build failed.' }

$out = Join-Path $PSScriptRoot 'Portable Build\Commander Deck'
New-Item -ItemType Directory -Force $out | Out-Null

Write-Host '2/4 Making the icon...'
$ico = Join-Path $PSScriptRoot 'portable\icon.ico'
if (-not (Test-Path $ico)) {
  Add-Type -AssemblyName System.Drawing
  $s = 256
  $bmp = New-Object System.Drawing.Bitmap $s, $s
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = 'AntiAlias'; $g.TextRenderingHint = 'AntiAliasGridFit'
  function New-RoundRect($x, $y, $w, $h, $r) {
    $p = New-Object System.Drawing.Drawing2D.GraphicsPath
    $p.AddArc($x, $y, $r, $r, 180, 90); $p.AddArc($x + $w - $r, $y, $r, $r, 270, 90)
    $p.AddArc($x + $w - $r, $y + $h - $r, $r, $r, 0, 90); $p.AddArc($x, $y + $h - $r, $r, $r, 90, 90)
    $p.CloseFigure(); $p
  }
  # Two fanned "cards"
  $g.TranslateTransform(128, 140); $g.RotateTransform(-12)
  $g.FillPath((New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 60, 52, 110))), (New-RoundRect -70 -100 140 196 22))
  $g.ResetTransform(); $g.TranslateTransform(128, 128); $g.RotateTransform(8)
  $card = New-RoundRect -72 -104 144 204 22
  $grad = New-Object System.Drawing.Drawing2D.LinearGradientBrush ([System.Drawing.Point]::new(0, -104)), ([System.Drawing.Point]::new(0, 100)), ([System.Drawing.Color]::FromArgb(255, 124, 92, 230)), ([System.Drawing.Color]::FromArgb(255, 58, 36, 140))
  $g.FillPath($grad, $card)
  $g.DrawPath((New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(255, 240, 200, 90)), 8), $card)
  $font = New-Object System.Drawing.Font 'Georgia', 92, ([System.Drawing.FontStyle]::Bold), ([System.Drawing.GraphicsUnit]::Pixel)
  $fmt = New-Object System.Drawing.StringFormat; $fmt.Alignment = 'Center'; $fmt.LineAlignment = 'Center'
  $g.DrawString('C', $font, (New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 245, 210, 110))), (New-Object System.Drawing.RectangleF -72, -100, 144, 204), $fmt)
  $g.Dispose()
  # Write a multi-size .ico (PNG-compressed entries)
  $sizes = 256, 64, 48, 32, 16
  $pngs = foreach ($sz in $sizes) {
    $b = New-Object System.Drawing.Bitmap $sz, $sz
    $gg = [System.Drawing.Graphics]::FromImage($b); $gg.InterpolationMode = 'HighQualityBicubic'
    $gg.DrawImage($bmp, 0, 0, $sz, $sz); $gg.Dispose()
    $ms = New-Object System.IO.MemoryStream; $b.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png); $b.Dispose()
    , $ms.ToArray()
  }
  $fs = [System.IO.File]::Create($ico); $w = New-Object System.IO.BinaryWriter $fs
  $w.Write([uint16]0); $w.Write([uint16]1); $w.Write([uint16]$sizes.Count)
  $offset = 6 + 16 * $sizes.Count
  for ($i = 0; $i -lt $sizes.Count; $i++) {
    $d = if ($sizes[$i] -ge 256) { 0 } else { $sizes[$i] }
    $w.Write([byte]$d); $w.Write([byte]$d); $w.Write([byte]0); $w.Write([byte]0)
    $w.Write([uint16]1); $w.Write([uint16]32); $w.Write([uint32]$pngs[$i].Length); $w.Write([uint32]$offset)
    $offset += $pngs[$i].Length
  }
  foreach ($p in $pngs) { $w.Write($p) }
  $w.Close(); $bmp.Dispose()
}

Write-Host '3/4 Compiling the launcher...'
& $csc /nologo /target:winexe /optimize+ "/out:$out\Commander Deck.exe" "/win32icon:$ico" `
  /r:System.Windows.Forms.dll /r:System.Management.dll .\portable\Launcher.cs
if ($LASTEXITCODE) { throw 'Launcher compile failed.' }

Write-Host '4/4 Copying the app...'
if (Test-Path "$out\app") { Remove-Item -Recurse -Force "$out\app" }
Copy-Item -Recurse .\dist "$out\app"
Copy-Item .\portable\README.txt "$out\README.txt"

Write-Host ''
Write-Host "Done: $out"
Write-Host 'Copy the "Commander Deck" folder to your flash drive and double-click "Commander Deck.exe".'
