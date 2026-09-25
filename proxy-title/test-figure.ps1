<#
  pj-title /figure-titles 受け入れテスト（仕様6章）
  ------------------------------------------------
  使い方:
    .\test-figure.ps1 -Base "https://pj-title.xxxx.workers.dev" -Key "<PJ_ACCESS_KEY>"

  このファイルは UTF-8（BOM付き）で保存してある。文字化けする場合は
  PowerShell 7 で実行するか、保存し直さずにそのまま使うこと。
#>
param(
  [Parameter(Mandatory=$true)][string]$Base,
  [Parameter(Mandatory=$true)][string]$Key,
  # 英題だけを見たいとき（1章だけ走らせる）
  [switch]$TitlesOnly
)

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$ErrorActionPreference = 'Stop'
try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch {}
$Base = $Base.TrimEnd('/')

# ---- 受け入れテストの10件（JANなし5件・中古2件・プライズ2件を含む）----
$items = @(
  @{ jan = ''; asin = 'B0CH8QT1LX'; condition = 'new'; ja_title = 'Banpresto - Umamusume: Pretty Derby - Air Groove, Bandai Spirits Figure' },
  @{ jan = ''; asin = 'B0BZZL3BNS'; condition = 'new'; ja_title = 'バンプレスト うる星やつら GLITTER&GLAMOURS LUM B' },
  @{ jan = ''; asin = 'B092VH4SBJ'; condition = 'new'; ja_title = 'figma 鬼滅の刃 我妻善逸 DXエディション ノンスケール ABS&PVC製 塗装済み可動フィギュア' },
  @{ jan = ''; asin = 'B01CCIH11S'; condition = 'new'; ja_title = 'ねんどろいど 刀剣乱舞-ONLINE- 蛍丸 ノンスケール ABS&PVC製 塗装済み可動フィギュア' },
  @{ jan = ''; asin = 'B0FPX7HNXN'; condition = 'new'; ja_title = 'グッドスマイルカンパニー[GOOD SMILE COMPANY] ねんどろいど 鬼滅の刃 冨岡義勇 ノンスケールプラスチック製 塗装済み可動フィギュア 二次再販' },
  @{ jan = '4580590128217'; asin = 'B09TPBVJ5F'; condition = 'used'; ja_title = 'ねんどろいど ハイキュー!! 黒尾鉄朗 セカンドユニフォームVer. ノンスケール プラスチック製 塗装済み可動フィギュア' },
  @{ jan = '4573102687647'; asin = 'B0FB8F42GQ'; condition = 'new'; ja_title = 'TAMASHII NATIONS S.H.フィギュアーツ 新サイクロン号（仮面ライダー） 栄光の昭和ライダーエディション 約190mm ABS&PVC製 塗装済み可動フィギュア' },
  @{ jan = '4580416947480'; asin = 'B0C3D1STPH'; condition = 'new'; ja_title = 'POP UP PARADE 機動戦艦ナデシコ ホシノ ルリ ノンスケール プラスチック製 塗装済み完成品フィギュア' },
  @{ jan = '4573102665973'; asin = 'B0G6LRMPS5'; condition = 'new'; ja_title = '超合金 CHOGOKIN ROBO 50' },
  @{ jan = '4580522750165'; asin = 'B0BHHJW4KR'; condition = 'used'; ja_title = 'ワンダフルワークス(Wonderful Works) ライザのアトリエ2 失われた伝承と秘密の妖精 クラウディア バレンツ ネグリジェVer. 1/7スケール プラスチック製 塗装済み完成品フィギュア' }
)

$BANNED = @('English','Multi-Language','Multilingual','Multi Language','Region Free',
            'Rare','L@@K','Japan','Import','Authentic','Free Shipping')

function Invoke-Titles {
  # $ExpectStatus に期待するHTTPコードを渡すと、そのコードは失敗として赤く出さない
  param([array]$Items, [bool]$Force, [int]$ExpectStatus = 0)
  $payload = @{ items = $Items; force = $Force } | ConvertTo-Json -Depth 5 -Compress
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($payload)
  try {
    return Invoke-RestMethod -Method Post -Uri "$Base/figure-titles" -Body $bytes `
      -ContentType 'application/json; charset=utf-8' -Headers @{ 'X-PJ-Key' = $Key }
  } catch {
    $code = 0
    if ($_.Exception.Response) { $code = [int]$_.Exception.Response.StatusCode }
    if ($ExpectStatus -gt 0 -and $code -eq $ExpectStatus) {
      Write-Host ("  期待どおり HTTP {0} で弾かれた" -f $code) -ForegroundColor Green
    } else {
      Write-Host ("  !! 失敗 HTTP {0} : {1}" -f $code, $_.Exception.Message) -ForegroundColor Red
    }
    return $null
  }
}

<#
  pj_price の figTitleFrom() と同じ組み立て（書式の確認用）
  [Used] brand series chara variant scale line Figure
  80字を超えたら 作品名を短縮 → ブランド → 版とスケール → 商品ライン の順に落とす
#>
function Build-FigTitle {
  param([bool]$Used, $F)
  $keys = @('brand','series','chara','variant','scale','line')
  $any = $false
  foreach ($k in $keys) { if ($F.$k) { $any = $true } }
  if (-not $any) { return [pscustomobject]@{ text = ''; dropped = '' } }

  $st = @{}
  foreach ($k in $keys) { $st[$k] = [string]$F.$k }
  $short = [string]$F.series_short
  # 商品ラインの語がキャラクター名や作品名に入っていれば二重に出さない
  if ($st['line']) {
    $lk = ($st['line'].ToLower() -replace '[^a-z0-9]','')
    $ck = ($st['chara'].ToLower() -replace '[^a-z0-9]','')
    $sk = ($st['series'].ToLower() -replace '[^a-z0-9]','')
    if ($lk -and ($ck.Contains($lk) -or $sk.Contains($lk))) { $st['line'] = '' }
  }
  $drop = New-Object System.Collections.ArrayList

  $join = {
    $p = New-Object System.Collections.ArrayList
    if ($Used) { [void]$p.Add('Used') }
    foreach ($k in $keys) { if ($st[$k]) { [void]$p.Add($st[$k]) } }
    [void]$p.Add('Figure')
    ($p -join ' ')
  }
  $t = & $join
  if ($t.Length -gt 80 -and $short -and $short -ne $st['series']) {
    $st['series'] = $short; [void]$drop.Add('作品名を短縮'); $t = & $join
  }
  if ($t.Length -gt 80 -and $st['brand']) {
    $st['brand'] = ''; [void]$drop.Add('ブランド'); $t = & $join
  }
  if ($t.Length -gt 80 -and ($st['variant'] -or $st['scale'])) {
    $st['variant'] = ''; $st['scale'] = ''; [void]$drop.Add('版・スケール'); $t = & $join
  }
  if ($t.Length -gt 80 -and $st['line']) {
    $st['line'] = ''; [void]$drop.Add('商品ライン'); $t = & $join
  }
  return [pscustomobject]@{ text = $t; dropped = ($drop -join ',') }
}

function Show-Results {
  param($Results, [array]$Items)
  $n = 0
  foreach ($r in $Results) {
    $src = $Items[$n]
    $n++
    $f = $r.fields
    $used = ($src.condition -eq 'used')
    $bt = if ($f) { Build-FigTitle -Used $used -F $f } else { [pscustomobject]@{ text=''; dropped='' } }
    $len = $bt.text.Length
    $bad = @()
    foreach ($w in $BANNED) { if ($bt.text -match [regex]::Escape($w)) { $bad += $w } }

    $color = switch ($r.status) { 'ok' { 'Green' } 'review' { 'Yellow' } default { 'Red' } }
    Write-Host ("[{0}] {1}" -f $r.status, $r.key) -ForegroundColor $color
    Write-Host ("    和名     : {0}" -f $src.ja_title)
    if ($f) {
      Write-Host ("    brand    : {0}" -f $f.brand)
      Write-Host ("    series   : {0}" -f $f.series)
      Write-Host ("    series_short : {0}" -f $f.series_short)
      Write-Host ("    chara    : {0}" -f $f.chara)
      Write-Host ("    variant  : {0}" -f $f.variant)
      Write-Host ("    scale    : {0}" -f $f.scale)
      Write-Host ("    line     : {0}" -f $f.line)
    }
    Write-Host ("    英題     : {0}" -f $bt.text)
    $lenMsg = "    文字数   : {0} / 80" -f $len
    if ($bt.dropped) { $lenMsg += ("  （省略: {0}）" -f $bt.dropped) }
    Write-Host $lenMsg -ForegroundColor $(if ($len -gt 80) { 'Red' } else { 'Gray' })
    if ($r.jan_resolved) { Write-Host ("    jan_resolved : {0}" -f $r.jan_resolved) -ForegroundColor Cyan }
    Write-Host ("    sources  : {0}" -f ($r.sources -join ', '))
    Write-Host ("    note     : {0}" -f $r.note)
    if (@($bad).Count -gt 0) { Write-Host ("    !! 禁止語: {0}" -f ($bad -join ', ')) -ForegroundColor Red }
    if (@($r.candidates).Count -gt 0) {
      Write-Host ("    候補     : {0}" -f @($r.candidates)[0])
    }
    Write-Host ''
  }
}

Write-Host '==== 1. 本番10件（8件 + 2件に分けて送る・force=true で作り直す）====' -ForegroundColor Cyan
$all = @()
$allItems = @()
$batches = @( ,($items[0..7]) ) + @( ,($items[8..9]) )
$sw = [System.Diagnostics.Stopwatch]::StartNew()
foreach ($b in $batches) {
  Write-Host ("-- {0}件 送信中…" -f $b.Count)
  $res = Invoke-Titles -Items $b -Force $true
  if ($null -eq $res) { Write-Host '中止します。' -ForegroundColor Red; exit 1 }
  if (-not $TitlesOnly) { Show-Results -Results $res.results -Items $b }
  $all += $res.results
  $allItems += $b
}
$sw.Stop()
Write-Host ("所要 {0:N1} 秒" -f $sw.Elapsed.TotalSeconds)

if ($TitlesOnly) {
  Write-Host ''
  Write-Host '==== 英題だけ ====' -ForegroundColor Cyan
  $n = 0
  foreach ($r in $all) {
    $src = $allItems[$n]; $n++
    $used = ($src.condition -eq 'used')
    $bt = Build-FigTitle -Used $used -F $r.fields
    $mark = if ($bt.text.Length -gt 80) { '!!' } else { '  ' }
    Write-Host ("{0} {1,2}. [{2,-6}] {3,3}字 {4}" -f $mark, $n, $r.status, $bt.text.Length, $bt.text)
    if ($bt.dropped) { Write-Host ("        省略: {0}" -f $bt.dropped) -ForegroundColor DarkGray }
  }
  Write-Host ''
  Write-Host 'この出力をそのまま貼って送ってください。' -ForegroundColor Green
  exit 0
}

Write-Host ''
Write-Host '==== 2. 集計 ====' -ForegroundColor Cyan
$all | Group-Object status | ForEach-Object { Write-Host ("  {0} : {1}件" -f $_.Name, $_.Count) }
$withEbay = @($all | Where-Object { @($_.sources) -contains 'ebay' -or @($_.sources) -contains 'ebay_keyword' }).Count
Write-Host ("  eBay候補を使えた行 : {0}件" -f $withEbay)
$resolved = @($all | Where-Object { $_.jan_resolved })
Write-Host ("  ASINからJANが判明  : {0}件" -f $resolved.Count)
foreach ($r in $resolved) {
  $usedEbay = (@($r.sources) -contains 'ebay' -or @($r.sources) -contains 'ebay_keyword')
  Write-Host ("    {0} -> {1}  eBay候補: {2}" -f $r.key, $r.jan_resolved, $(if ($usedEbay) { 'あり OK' } else { 'なし' }))
}

Write-Host ''
Write-Host '==== 3. invalid_id がほかの行を止めないか ====' -ForegroundColor Cyan
$mix = @(
  @{ jan = ''; asin = ''; ja_title = 'IDなしの行' },
  @{ jan = ''; asin = 'B0BZZL3BNS'; ja_title = 'バンプレスト うる星やつら GLITTER&GLAMOURS LUM B' },
  @{ jan = '123'; asin = 'XX'; ja_title = 'どちらも不正な行' }
)
$res3 = Invoke-Titles -Items $mix -Force $false
if ($res3) {
  foreach ($r in $res3.results) {
    Write-Host ("  key='{0}'  status={1}  note={2}" -f $r.key, $r.status, $r.note)
  }
}

Write-Host ''
Write-Host '==== 4. 2回目はKVキャッシュが効くか（force=false）====' -ForegroundColor Cyan
$sw2 = [System.Diagnostics.Stopwatch]::StartNew()
$res4 = Invoke-Titles -Items $items[0..7] -Force $false
$sw2.Stop()
if ($res4) {
  $cached = @($res4.results | Where-Object { $_.note -eq 'キャッシュ' }).Count
  Write-Host ("  キャッシュから返った行 : {0} / {1}" -f $cached, @($res4.results).Count)
  Write-Host ("  所要 {0:N1} 秒（1回目より明らかに速ければキャッシュが効いている）" -f $sw2.Elapsed.TotalSeconds)
  $noLog = @($res4.results | Where-Object { -not $_.log }).Count
  Write-Host ("  外部APIを呼ばなかった行 : {0} / {1}" -f $noLog, @($res4.results).Count)
}

Write-Host ''
Write-Host '==== 5. 認証と件数の上限 ====' -ForegroundColor Cyan
$payload = @{ items = @(@{ jan = '4580590128217' }) } | ConvertTo-Json -Depth 5 -Compress
$bytes = [System.Text.Encoding]::UTF8.GetBytes($payload)
try {
  Invoke-RestMethod -Method Post -Uri "$Base/figure-titles" -Body $bytes `
    -ContentType 'application/json; charset=utf-8' -Headers @{ 'X-PJ-Key' = 'wrong-key' } | Out-Null
  Write-Host '  キー違い: 通ってしまった !!' -ForegroundColor Red
} catch {
  $code = $null
  if ($_.Exception.Response) { $code = [int]$_.Exception.Response.StatusCode }
  Write-Host ("  キー違い: HTTP {0}（401 が正しい）" -f $code)
}
Write-Host '  21件を送る:' -NoNewline
$big = @(); 1..21 | ForEach-Object { $big += @{ jan = '4580590128217' } }
$res5 = Invoke-Titles -Items $big -Force $false -ExpectStatus 400
if ($null -ne $res5) { Write-Host '  21件: 通ってしまった !!' -ForegroundColor Red }

Write-Host ''
Write-Host '==== 6. 確認してほしい点 ====' -ForegroundColor Cyan
Write-Host '  - うる星やつら LUM B の variant に "B" が入っているか'
Write-Host '  - エアグルーヴ（B0CH8QT1LX）の brand が Banpresto になっているか'
Write-Host '  - ハイキュー!! の series が "Haikyu!!" のまま（!! が消えていない）か'
Write-Host '  - 中古2件（黒尾鉄朗・クラウディア）の英題が Used で始まっているか'
Write-Host '  - 全10件が80文字以内で、禁止語が出ていないか'
Write-Host ''
Write-Host '出力をそのまま貼って送ってください。' -ForegroundColor Green
