# Makes the web app (PWA) icons in public/icons from the logo.
# Run from the repo root after changing the logo:  powershell -ExecutionPolicy Bypass -File scripts/make-icons.ps1
# A logo of 512x512 or larger gives sharp icons; smaller logos are enlarged and look soft.
param([string]$Logo = 'src/assets/grimoire-logo.png')
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$root = Split-Path -Parent $PSScriptRoot
$src = [System.Drawing.Image]::FromFile((Resolve-Path (Join-Path $root $Logo)))
$out = Join-Path $root 'public/icons'
New-Item -ItemType Directory -Force $out | Out-Null

function Save-Icon([int]$size, [double]$scale, [string]$background, [string]$name) {
  $bmp = New-Object System.Drawing.Bitmap $size, $size
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  if ($background) { $g.Clear([System.Drawing.ColorTranslator]::FromHtml($background)) }
  $d = [int]($size * $scale); $o = [int](($size - $d) / 2)
  $g.DrawImage($src, $o, $o, $d, $d)
  $g.Dispose()
  $bmp.Save((Join-Path $out $name), [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  Write-Host "  $name"
}

Write-Host "Icons from $Logo ($($src.Width)x$($src.Height)):"
Save-Icon 192 1.0 $null 'icon-192.png'
Save-Icon 512 1.0 $null 'icon-512.png'
# Maskable icons are cropped to a circle or squircle by Android; keep the logo inside the central safe zone.
Save-Icon 512 0.72 '#0f1218' 'maskable-512.png'
$src.Dispose()
