$ErrorActionPreference = 'SilentlyContinue'
"=== 여유 공간 5회 샘플링 (10초 간격) — 갑자기 변하는지 확인"
1..5 | ForEach-Object { $d = Get-PSDrive C; "{0}  free {1:N2} GB" -f (Get-Date -Format 'HH:mm:ss'), ($d.Free/1GB); if ($_ -lt 5) { Start-Sleep -Seconds 10 } }

"=== WSL 배포판 디스크 위치"
Get-ChildItem 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Lxss' | ForEach-Object { $p = Get-ItemProperty $_.PSPath; if ($p.DistributionName) { $vh = Join-Path $p.BasePath 'ext4.vhdx'; "{0}: {1}  ({2})" -f $p.DistributionName, $vh, $(if (Test-Path $vh) { '{0:N1} GB' -f ((Get-Item $vh).Length/1GB) } else { 'vhdx 없음' }) } }

"=== Google 폴더 하위 (논리 크기 vs 실제 디스크 사용)"
$g = 'C:\Users\oem\AppData\Local\Google'
Get-ChildItem $g -Force -Directory | ForEach-Object {
  $logical = 0L; $placeholder = 0L; $count = 0
  Get-ChildItem $_.FullName -Recurse -Force -File -Attributes !ReparsePoint | ForEach-Object {
    $count++; $logical += $_.Length
    # OFFLINE(0x1000), RECALL_ON_OPEN(0x40000), RECALL_ON_DATA_ACCESS(0x400000) = 클라우드 자리표시자
    if (([int]$_.Attributes -band 0x441000) -ne 0) { $placeholder += $_.Length }
  }
  "{0,8:N2} GB logical, {1,8:N2} GB 자리표시자, {2,7} files  {3}" -f ($logical/1GB), ($placeholder/1GB), $count, $_.Name
}
Get-ChildItem "$g\DriveFS" -Force -Directory | ForEach-Object { "DriveFS\{0}" -f $_.Name }
"=== DriveFS content_cache 실제 크기 (자리표시자 제외)"
Get-ChildItem "$g\DriveFS" -Directory -Force | ForEach-Object {
  $cc = Join-Path $_.FullName 'content_cache'
  if (Test-Path $cc) {
    $files = Get-ChildItem $cc -Recurse -Force -File
    $real = ($files | Where-Object { ([int]$_.Attributes -band 0x441000) -eq 0 } | Measure-Object Length -Sum).Sum
    "{0}: {1:N2} GB (실제), 파일 {2}개, 최신 수정 {3}" -f $_.Name, ($real/1GB), $files.Count, (($files | Sort-Object LastWriteTime -Descending | Select-Object -First 1).LastWriteTime)
  }
}
"=== Roaming\Claude 하위"
Get-ChildItem 'C:\Users\oem\AppData\Roaming\Claude' -Force -Directory | ForEach-Object {
  $s = (Get-ChildItem $_.FullName -Recurse -Force -File | Measure-Object Length -Sum).Sum
  "{0,8:N2} GB  {1}" -f ($s/1GB), $_.Name
} | Sort-Object -Descending | Select-Object -First 8
