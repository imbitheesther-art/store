# Regenerates assets/images/icon.ico at installer quality.
#
# The repository only shipped a 64x64 icon, but the NSIS installer (and the
# Windows shell at large icon sizes) requires at least 256x256. This upscales
# the 90x90 source logo into a multi-resolution .ico containing
# 16/24/32/48/64/128/256 px entries.
#
#   powershell -ExecutionPolicy Bypass -File tools\build-icon.ps1

$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$source = Join-Path $root 'public\logo_icon.png'
$target = Join-Path $root 'assets\images\icon.ico'

if (-not (Test-Path $source)) {
    throw "Source logo not found: $source"
}

$src = [System.Drawing.Image]::FromFile($source)

function New-ScaledBitmap([System.Drawing.Image]$image, [int]$size) {
    $bmp = New-Object System.Drawing.Bitmap($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    $g.Clear([System.Drawing.Color]::Transparent)
    $g.DrawImage($image, (New-Object System.Drawing.Rectangle(0, 0, $size, $size)))
    $g.Dispose()
    return $bmp
}

# Returns the raw 32bpp BGRA pixels, bottom-up, as Windows ICO expects.
function Get-Pixels([System.Drawing.Bitmap]$bmp) {
    $rect = New-Object System.Drawing.Rectangle(0, 0, $bmp.Width, $bmp.Height)
    $data = $bmp.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::ReadOnly, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    try {
        $bytes = New-Object byte[] ($data.Stride * $bmp.Height)
        [System.Runtime.InteropServices.Marshal]::Copy($data.Scan0, $bytes, 0, $bytes.Length)
        # The comma stops PowerShell unrolling the array into Object[].
        return , $bytes
    }
    finally {
        $bmp.UnlockBits($data)
    }
}

# Builds a classic BMP/DIB entry (BITMAPINFOHEADER + XOR bits + AND mask).
function Get-IconDib([System.Drawing.Bitmap]$bmp) {
    $w = $bmp.Width
    $h = $bmp.Height
    $pixels = Get-Pixels $bmp

    $stream = New-Object System.IO.MemoryStream
    $bw = New-Object System.IO.BinaryWriter($stream)
    $bw.Write([int]40)            # biSize
    $bw.Write([int]$w)            # biWidth
    $bw.Write([int]($h * 2))      # biHeight (doubled: colour bits + mask)
    $bw.Write([int16]1)           # biPlanes
    $bw.Write([int16]32)          # biBitCount
    $bw.Write([int]0)             # biCompression = BI_RGB
    $bw.Write([int]0)             # biSizeImage
    $bw.Write([int]0)             # biXPelsPerMeter
    $bw.Write([int]0)             # biYPelsPerMeter
    $bw.Write([int]0)             # biClrUsed
    $bw.Write([int]0)             # biClrImportant
    $bw.Write($pixels)            # XOR bitmap (bottom-up BGRA)

    # 1bpp AND mask, each row padded to a 4-byte boundary. Fully opaque.
    $stride = [int]([math]::Floor(($w + 31) / 32) * 4)
    $bw.Write((New-Object byte[] ($stride * $h)))

    $bw.Flush()
    return , $stream.ToArray()
}

$sizes = @(16, 24, 32, 48, 64, 128, 256)
$entries = @()

foreach ($size in $sizes) {
    $bmp = New-ScaledBitmap $src $size

    if ($size -eq 256) {
        # 256px is stored as PNG - smaller and fully supported by Windows.
        $ms = New-Object System.IO.MemoryStream
        $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
        $data = $ms.ToArray()
        $ms.Dispose()
    }
    else {
        $data = Get-IconDib $bmp
    }

    $entries += , @{ Size = $size; Data = $data }

    $bmp.Dispose()
}

$src.Dispose()

# ICONDIR + ICONDIRENTRY[] + image payloads
$out = New-Object System.IO.MemoryStream
$bw = New-Object System.IO.BinaryWriter($out)
$bw.Write([int16]0)                                   # reserved
$bw.Write([int16]1)                                   # type = icon
$bw.Write([int16]$entries.Count)

$offset = 6 + (16 * $entries.Count)

foreach ($entry in $entries) {
    # 256 is encoded as 0 in the single-byte width/height fields.
    $dim = if ($entry.Size -eq 256) { 0 } else { $entry.Size }
    $bw.Write([byte]$dim)                             # width
    $bw.Write([byte]$dim)                             # height
    $bw.Write([byte]0)                                # palette size
    $bw.Write([byte]0)                                # reserved
    $bw.Write([int16]1)                               # colour planes
    $bw.Write([int16]32)                              # bits per pixel
    $bw.Write([int]$entry.Data.Length)                # payload size
    $bw.Write([int]$offset)                           # payload offset
    $offset += $entry.Data.Length
}

foreach ($entry in $entries) {
    $bw.Write($entry.Data)
}

$bw.Flush()

[System.IO.File]::WriteAllBytes($target, $out.ToArray())

Write-Host "Wrote $target ($([math]::Round($out.Length / 1KB, 1)) KB, sizes: $($sizes -join ', '))"