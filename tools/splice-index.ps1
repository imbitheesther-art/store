# Redesign splice for index.html (byte-level, UTF-8 safe):
#   lines 107-134 -> new Transactions filter bar (adds Payment Method select)
#   lines 136-204 -> stat-cards row + chart panels + full-width table
#                    (Products / Name / Sold / Available / Sales table removed)
#   line 215/235/258/274 -> POS cart card tag swaps for the flex layout
# All other bytes (including the backspace glyph) are left untouched.
$path = 'd:\POS\store\index.html'
$orig = [System.IO.File]::ReadAllBytes($path)
$b = $orig
$enc = New-Object System.Text.UTF8Encoding($false)
$strict = New-Object System.Text.UTF8Encoding($false, $true)

$off = New-Object System.Collections.Generic.List[int]
[void]$off.Add(0)
for ($i = 0; $i -lt $b.Length; $i++) { if ($b[$i] -eq 10) { [void]$off.Add($i + 1) } }

function GetHL([int]$n) {
    $s = $script:off[$n - 1]
    $e = if ($n -lt $script:off.Count) { $script:off[$n] } else { $script:b.Length }
    $t = $script:enc.GetString($script:b, $s, $e - $s)
    return $t.TrimEnd([char]13, [char]10)
}

function ToCRLF([string]$t) {
    $t = $t -replace "`r`n", "`n"
    return $t -replace "`n", "`r`n"
}

function LoadRegion([string]$p) {
    $t = [System.IO.File]::ReadAllText($p)
    $t = ($t -replace "`r`n", "`n").TrimEnd("`n")
    return (ToCRLF $t) + "`r`n"
}

function SwapLine([int]$n, [string]$tag) {
    $line = GetHL $n
    $trim = $line.Trim()
    $indent = $line.Substring(0, $line.Length - $trim.Length)
    return (ToCRLF ($indent + $tag)) + "`r`n"
}

# ---- 1. anchor checks -------------------------------------------------------
$checks = @{
    107 = '<div class="card-box">'
    134 = '</div>'
    136 = '<div class="row">'
    204 = '</div>'
    215 = '<div class="col-md-12">'
    235 = '<div>'
    258 = '<div class="m-t-5">'
    274 = '<div class="button-list pull-right">'
}
$fail = @()
foreach ($k in ($checks.Keys | Sort-Object)) {
    $got = (GetHL $k).Trim()
    if ($got -ne $checks[$k]) { $fail += "line ${k}: got [$got] want [$($checks[$k])]" }
}
if ($fail.Count -gt 0) {
    Write-Output 'ABORT - anchor line mismatch:'
    $fail | ForEach-Object { Write-Output ('  ' + $_) }
    exit 1
}
Write-Output 'Anchor checks OK (8/8)'

# ---- 2. region content ------------------------------------------------------
$newA = LoadRegion 'd:\POS\store\tools\tx-a.html'
$newB = LoadRegion 'd:\POS\store\tools\tx-b.html'

# ---- 3. apply edits, descending offsets -------------------------------------
$edits = @(
    @{ N = 274; Tag = '<div class="button-list pos-actions">' },
    @{ N = 258; Tag = '<div class="m-t-5 pos-totals">' },
    @{ N = 235; Tag = '<div class="cart-wrap">' },
    @{ N = 215; Tag = '<div class="pos-head">' },
    @{ N = 136; EndLine = 204; Text = $newB },
    @{ N = 107; EndLine = 134; Text = $newA }
)
foreach ($ed in $edits) {
    $s = $off[$ed.N - 1]
    if ($ed.ContainsKey('EndLine')) {
        $e = $off[$ed.EndLine]
        $txt = $ed.Text
        $label = 'lines ' + $ed.N + '-' + $ed.EndLine
    } else {
        $e = $off[$ed.N]
        $txt = SwapLine $ed.N $ed.Tag
        $label = 'line ' + $ed.N
    }
    $nb = $enc.GetBytes($txt)
    $lst = New-Object System.Collections.Generic.List[byte]
    if ($s -gt 0) { foreach ($x in $b[0..($s - 1)]) { [void]$lst.Add($x) } }
    foreach ($x in $nb) { [void]$lst.Add($x) }
    if ($e -lt $b.Length) { foreach ($x in $b[$e..($b.Length - 1)]) { [void]$lst.Add($x) } }
    $b = $lst.ToArray()
    Write-Output ('spliced ' + $label)
}

# ---- 4. verify ---------------------------------------------------------------
try { $txt = $strict.GetString($b) } catch {
    Write-Output 'ABORT: spliced bytes are not valid UTF-8'
    exit 1
}
$need = @(
    'id="pay_methods"', 'class="row tx-stats"', 'stat-value',
    'id="chart_payments"', 'id="chart_products"', 'Sales by Payment Method',
    'Top Products', 'class="cart-wrap"', 'class="pos-head"',
    'class="button-list pos-actions"', 'class="m-t-5 pos-totals"',
    'id="transactionList"'
)
$gone = @(
    'product_sales', 'productsSold', 'id="totals"', 'productSales',
    'class="button-list pull-right">'
)
$bad = @()
foreach ($m in $need) { if (-not $txt.Contains($m)) { $bad += ('missing: ' + $m) } }
foreach ($m in $gone) { if ($txt.Contains($m)) { $bad += ('still present: ' + $m) } }
if (-not $txt.Contains([string][char]0x232B)) { $bad += 'backspace glyph (U+232B) lost' }
if ($bad.Count -gt 0) {
    Write-Output 'ABORT - verification failed:'
    $bad | ForEach-Object { Write-Output ('  ' + $_) }
    exit 1
}

# ---- 5. write ----------------------------------------------------------------
[System.IO.File]::WriteAllBytes($path + '.bak-uitx', $orig)
[System.IO.File]::WriteAllBytes($path, $b)
$check = [System.IO.File]::ReadAllBytes($path)
if ($check.Length -ne $b.Length) { Write-Output 'ABORT - re-read length mismatch'; exit 1 }
$lines = 0
foreach ($x in $b) { if ($x -eq 10) { $lines++ } }
Write-Output ('WROTE ' + $path + ' (' + $b.Length + ' bytes, ' + $lines + ' lines)')
Write-Output ('backup: ' + $path + '.bak-uitx (was ' + $orig.Length + ' bytes)')
Write-Output 'Verification PASSED'