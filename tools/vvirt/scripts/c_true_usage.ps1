$ErrorActionPreference = 'SilentlyContinue'
Add-Type -TypeDefinition @"
using System; using System.IO; using System.Collections.Generic; using System.Runtime.InteropServices;
public static class Du {
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  static extern uint GetCompressedFileSizeW(string name, out uint high);
  static long OnDisk(string p) { uint hi; uint lo = GetCompressedFileSizeW(p, out hi); if (lo == 0xFFFFFFFF && Marshal.GetLastWin32Error() != 0) return 0; return ((long)hi << 32) | lo; }
  // 링크(ReparsePoint)는 루트이든 하위이든 따라가지 않고, 파일은 실제 디스크 점유(희소 파일 반영)로 센다
  public static long Size(string root) {
    try { if ((File.GetAttributes(root) & FileAttributes.ReparsePoint) != 0) return 0; } catch { return 0; }
    long total = 0; var stack = new Stack<string>(); stack.Push(root);
    while (stack.Count > 0) {
      string d = stack.Pop();
      try { foreach (var f in Directory.EnumerateFiles(d)) { try { total += OnDisk(f); } catch {} } } catch {}
      try { foreach (var s in Directory.EnumerateDirectories(d)) { try { if ((File.GetAttributes(s) & FileAttributes.ReparsePoint) == 0) stack.Push(s); } catch {} } } catch {}
    }
    return total;
  }
}
"@
function Show($label, $path) { $s = [Du]::Size($path); "{0,8:N1} GB  {1}" -f ($s/1GB), $label; return $s }
"=== C:\ 최상위 (실제 디스크 점유, 링크 제외)"
$tot = 0
Get-ChildItem 'C:\' -Force -Directory | ForEach-Object { $s = [Du]::Size($_.FullName); $tot += $s; [pscustomobject]@{ GB = $s/1GB; Name = $_.Name } } | Sort-Object GB -Descending | Select-Object -First 10 | ForEach-Object { "{0,8:N1} GB  C:\{1}" -f $_.GB, $_.Name }
"=== 최상위 시스템 파일"
foreach ($f in 'hiberfil.sys','pagefile.sys','swapfile.sys') { $i = Get-Item "C:\$f" -Force; if ($i) { "{0,8:N1} GB  C:\{1}" -f ($i.Length/1GB), $f } }
"=== C:\Windows 하위"
Get-ChildItem 'C:\Windows' -Force -Directory | ForEach-Object { [pscustomobject]@{ GB = [Du]::Size($_.FullName)/1GB; Name = $_.Name } } | Sort-Object GB -Descending | Select-Object -First 8 | ForEach-Object { "{0,8:N1} GB  Windows\{1}" -f $_.GB, $_.Name }
"=== C:\Users\oem 하위 (링크 제외)"
Get-ChildItem 'C:\Users\oem' -Force -Directory | ForEach-Object { [pscustomobject]@{ GB = [Du]::Size($_.FullName)/1GB; Name = $_.Name } } | Sort-Object GB -Descending | Select-Object -First 8 | ForEach-Object { "{0,8:N1} GB  oem\{1}" -f $_.GB, $_.Name }
"=== C:\Users 전체 사용자"
Get-ChildItem 'C:\Users' -Force -Directory | ForEach-Object { "{0,8:N1} GB  Users\{1}" -f ([Du]::Size($_.FullName)/1GB), $_.Name }
"=== 볼륨 정보"
$v = Get-Volume -DriveLetter C; "크기 {0:N1} GB, 사용 {1:N1} GB, 여유 {2:N1} GB" -f ($v.Size/1GB), (($v.Size-$v.SizeRemaining)/1GB), ($v.SizeRemaining/1GB)
