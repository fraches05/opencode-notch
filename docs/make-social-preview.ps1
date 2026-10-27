Add-Type -AssemblyName System.Drawing

$W = 1280; $H = 640
$bmp = New-Object System.Drawing.Bitmap $W, $H
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = 'AntiAlias'
$g.InterpolationMode = 'HighQualityBicubic'
$g.TextRenderingHint = 'ClearTypeGridFit'

# background
$rect = New-Object System.Drawing.Rectangle 0, 0, $W, $H
$bg = New-Object System.Drawing.Drawing2D.LinearGradientBrush $rect, ([System.Drawing.Color]::FromArgb(255, 16, 17, 22)), ([System.Drawing.Color]::FromArgb(255, 5, 5, 7)), 20
$g.FillRectangle($bg, $rect)

# soft glow behind panel
$glowPath = New-Object System.Drawing.Drawing2D.GraphicsPath
$glowPath.AddEllipse(760, 40, 620, 620)
$glow = New-Object System.Drawing.Drawing2D.PathGradientBrush $glowPath
$glow.CenterColor = [System.Drawing.Color]::FromArgb(60, 90, 200, 255)
$glow.SurroundColors = @([System.Drawing.Color]::FromArgb(0, 0, 0, 0))
$g.FillPath($glow, $glowPath)
$glow.Dispose()

function New-Font($size, $style) {
  New-Object System.Drawing.Font 'Segoe UI', $size, $style, ([System.Drawing.GraphicsUnit]::Pixel)
}

$mint = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 190, 246, 224))
$white = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 244, 246, 250))
$dim = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 150, 157, 170))
$line = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(255, 40, 43, 52)), 1

# icon
$icon = [System.Drawing.Image]::FromFile((Join-Path $PSScriptRoot 'icon.png'))
$g.DrawImage($icon, 78, 84, 74, 74)
$icon.Dispose()

$fBrand = New-Font 26 ([System.Drawing.FontStyle]::Regular)
$g.DrawString('Windows overlay for OpenCode', $fBrand, $dim, 168, 108)

$fTitle = New-Font 68 ([System.Drawing.FontStyle]::Bold)
$g.DrawString('OpenCode Notch', $fTitle, $white, 74, 186)

$fSub = New-Font 27 ([System.Drawing.FontStyle]::Regular)
$g.DrawString('Approve, reply and watch your agent', $fSub, $mint, 78, 274)
$g.DrawString('runs from the top of your screen.', $fSub, $mint, 78, 310)

$fItem = New-Font 24 ([System.Drawing.FontStyle]::Regular)
$items = @(
  'Live run activity and context usage',
  'Permission approvals and forms inline',
  'Session center with projects and search',
  'Command palette, themes, EN / RU'
)
$y = 380
foreach ($it in $items) {
  $g.FillEllipse($mint, 82, $y + 9, 7, 7)
  $g.DrawString($it, $fItem, $white, 104, $y)
  $y += 44
}

# panel screenshot, right side
$panel = [System.Drawing.Image]::FromFile((Join-Path $PSScriptRoot 'screenshots\panel.png'))
$ph = 540
$pw = [int]($panel.Width * $ph / $panel.Height)
$px = $W - $pw - 92
$py = 50
$g.DrawImage($panel, $px, $py, $pw, $ph)
$panel.Dispose()

$fFoot = New-Font 22 ([System.Drawing.FontStyle]::Regular)
$g.DrawString('github.com/fraches05/opencode-notch', $fFoot, $dim, 78, 566)

$g.Dispose()
$out = Join-Path $PSScriptRoot 'social-preview.png'
$bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
Write-Output "saved $out"
