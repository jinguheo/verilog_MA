$ErrorActionPreference = 'SilentlyContinue'
Add-Type -TypeDefinition @"
using System; using System.Runtime.InteropServices;
public static class Sz {
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  static extern uint GetCompressedFileSizeW(string name, out uint high);
  public static long OnDisk(string path) { uint hi; uint lo = GetCompressedFileSizeW(path, out hi); if (lo == 0xFFFFFFFF && Marshal.GetLastWin32Error() != 0) return -1; return ((long)hi << 32) | lo; }
}
"@
"=== Play Games: 큰 파일의 논리 크기 vs 실제 디스크 점유"
Get-ChildItem 'C:\Users\oem\AppData\Local\Google\Play Games' -Recurse -Force -File | Where-Object { $_.Length -gt 100MB } |
  Sort-Object Length -Descending | Select-Object -First 8 | ForEach-Object {
    $od = [Sz]::OnDisk($_.FullName)
    "{0,8:N1} GB logical  {1,8:N2} GB on disk  sparse={2}  수정 {3}  {4}" -f ($_.Length/1GB), ($od/1GB), (($_.Attributes -band [IO.FileAttributes]::SparseFile) -ne 0), $_.LastWriteTime.ToString('MM-dd HH:mm'), $_.FullName.Replace('C:\Users\oem\AppData\Local\Google\','')
  }
"=== WSL vhdx 위치"
foreach ($base in 'C:\Users\oem\AppData\Local','D:\','E:\') {
  Get-ChildItem $base -Recurse -Force -Filter ext4.vhdx -Depth 5 | ForEach-Object { "{0}  logical {1:N1} GB  on disk {2:N1} GB  수정 {3}" -f $_.FullName, ($_.Length/1GB), ([Sz]::OnDisk($_.FullName)/1GB), $_.LastWriteTime.ToString('MM-dd HH:mm') }
}
"=== 최근 24시간 안에 수정된 큰 파일 (실제 점유 1GB 이상, C: 사용자·ProgramData·Windows\Temp)"
foreach ($root in 'C:\Users\oem','C:\ProgramData','C:\Windows\Temp') {
  Get-ChildItem $root -Recurse -Force -File -Attributes !ReparsePoint | Where-Object { $_.LastWriteTime -gt (Get-Date).AddHours(-24) -and $_.Length -gt 1GB } | ForEach-Object {
    $od = [Sz]::OnDisk($_.FullName); if ($od -gt 1GB) { "{0,7:N2} GB on disk  수정 {1}  {2}" -f ($od/1GB), $_.LastWriteTime.ToString('MM-dd HH:mm'), $_.FullName }
  }
}
"=== 시스템 파일 (실제 점유)"
foreach ($f in 'C:\hiberfil.sys','C:\pagefile.sys','C:\swapfile.sys') { $i = Get-Item $f -Force; if ($i) { "{0}: {1:N1} GB  수정 {2}" -f $f, ($i.Length/1GB), $i.LastWriteTime.ToString('MM-dd HH:mm') } }
