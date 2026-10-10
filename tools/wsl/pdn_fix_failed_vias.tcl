# Generic repair for "[PDN-0110] No via inserted between met4 and met5 at (x0, y0) - (x1, y1) on NET" warnings.
# env: ODB_IN, ODB_OUT, VIA_JOBS (file: one "NET x0 y0 x1 y1" per line, microns).
# Via master: the pdngen-generated via whose name matches the overlap size (<w>_<h>); otherwise the single 1.6 um cut via if the overlap
# is at least 1.6 x 1.6 um. Overlaps that fit neither are reported as NOT FIXED (never silently skipped).
read_db $::env(ODB_IN)
set block [ord::get_db_block]
set fh [open $::env(VIA_JOBS) r]
set fixed 0; set notfixed 0
while {[gets $fh line] >= 0} {
  if {[llength $line] != 5} continue
  lassign $line netname x0 y0 x1 y1
  set w [expr {int(round(($x1-$x0)*1000))}]; set h [expr {int(round(($y1-$y0)*1000))}]
  set master NULL
  foreach v [$block getVias] {
    if {[regexp {^via5_6_(\d+)_(\d+)_} [$v getName] -> vw vh] && abs($vw-$w) <= 10 && abs($vh-$h) <= 10} { set master $v; break }
  }
  if {$master eq "NULL" && $w >= 1600 && $h >= 1600} { set master [$block findVia via5_6_1600_1600_1_1_1600_1600] }
  if {$master eq "NULL"} { puts "NOT FIXED $netname $x0 $y0 $x1 $y1 (no matching via master)"; incr notfixed; continue }
  set sw [lindex [[$block findNet $netname] getSWires] 0]
  odb::dbSBox_create $sw $master [expr {int(round(($x0+$x1)/2.0*1000))}] [expr {int(round(($y0+$y1)/2.0*1000))}] STRIPE
  puts "FIXED $netname $x0 $y0 $x1 $y1 with [$master getName]"; incr fixed
}
close $fh
puts "summary fixed=$fixed notfixed=$notfixed"
write_db $::env(ODB_OUT)
