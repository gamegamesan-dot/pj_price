<#
  原産国の調査（Amazon のカタログ属性に country_of_origin が入っているか）
  ----------------------------------------------------------------------
    .\test-origin.ps1 -Base "https://pj-title.xxxx.workers.dev" -Key "<PJ_ACCESS_KEY>"

  実データの数件を /debug/catalog に投げて、
    ・attributes がいくつ返るか
    ・country / origin / made を含む属性名とその中身
    ・いまの実装が何を原産国として解釈するか
  を出す。調査が済んだら Worker の /debug/catalog は削除する。
#>
param(
  [Parameter(Mandatory=$true)][string]$Base,
  [Parameter(Mandatory=$true)][string]$Key
)
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$ErrorActionPreference = 'Stop'
try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch {}
$Base = $Base.TrimEnd('/')

# 実在庫から、系統をばらして6件
$items = @(
  @{ asin = 'B093QSFHL6'; note = 'S.H.Figuarts キャプテン・アメリカ（今回の例）' },
  @{ asin = 'B0FB8F42GQ'; note = 'S.H.Figuarts 新サイクロン号' },
  @{ asin = 'B09TPBVJ5F'; note = 'ねんどろいど 黒尾鉄朗' },
  @{ asin = 'B0C3D1STPH'; note = 'POP UP PARADE ホシノ・ルリ' },
  @{ asin = 'B0BHHJW4KR'; note = 'ワンダフルワークス クラウディア 1/7' },
  @{ asin = 'B0BZZL3BNS'; note = 'バンプレスト うる星やつら（JANなし）' }
)

$hit = 0
foreach ($it in $items) {
  Write-Host ("==== {0}  {1}" -f $it.asin, $it.note) -ForegroundColor Cyan
  try {
    $r = Invoke-RestMethod -Method Get -Uri "$Base/debug/catalog?asin=$($it.asin)" `
      -Headers @{ 'X-PJ-Key' = $Key }
  } catch {
    $code = 0
    if ($_.Exception.Response) { $code = [int]$_.Exception.Response.StatusCode }
    Write-Host ("  !! HTTP {0} : {1}" -f $code, $_.Exception.Message) -ForegroundColor Red
    continue
  }
  if ($r.error) { Write-Host ("  error: {0} {1}" -f $r.error, $r.message) -ForegroundColor Red
                  if ($r.body) { Write-Host ("  body: {0}" -f $r.body) }
                  continue }
  if (-not $r.found) { Write-Host '  カタログに見つからない' -ForegroundColor Yellow; continue }
  Write-Host ("  商品名   : {0}" -f $r.item_name)
  Write-Host ("  属性の数 : {0}" -f $r.attribute_count)
  $names = @($r.origin_like.PSObject.Properties.Name)
  if ($names.Count -gt 0) {
    $hit++
    Write-Host '  原産国に関係する属性:' -ForegroundColor Green
    foreach ($n in $names) {
      Write-Host ("    {0} = {1}" -f $n, ($r.origin_like.$n | ConvertTo-Json -Compress -Depth 4))
    }
  } else {
    Write-Host '  原産国に関係する属性: なし' -ForegroundColor Yellow
  }
  Write-Host ("  実装の解釈: origin='{0}'  brand='{1}'  ean='{2}'" -f $r.parsed_origin, $r.parsed_brand, $r.parsed_ean)
  # 属性名を一覧で出す（どんな名前があるのか把握するため。長いので折り返す）
  Write-Host ("  属性名   : {0}" -f (($r.attribute_names) -join ', '))
  Write-Host ''
}
Write-Host ("原産国に関係する属性があった商品: {0} / {1}" -f $hit, $items.Count) -ForegroundColor Cyan
Write-Host 'この出力をそのまま貼って送ってください。' -ForegroundColor Green
