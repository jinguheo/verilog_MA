# Manual PDN stitching of the ADC macro power rails to the core grid (PPA3 single-supply experiment).
# The ADC rails (met5, x 40..241 abs) end at the macro's left edge x=40; core met4 straps VPWR x22.66-24.26 and VGND x26.34-27.94
# run along that edge (y 135..457). Each rail gets a 1.6 um met5 tab from the same-net strap to 0.5 um inside the rail, plus a
# via4 on the strap. pdngen's own via insertion failed on these crossings ("No via inserted").
read_db $::env(ODB_IN)
set block [ord::get_db_block]
set tech [ord::get_db_tech]
set m5 [$tech findLayer met5]
set via [$tech findVia M4M5_PR]
if {$via eq "NULL"} { error "tech via M4M5_PR not found" }
proc um {v} { return [expr {int(round($v * 1000))}] }
# net, strap x0 x1, tab y0 y1 (inside the rail's y range)
set jobs {
  {VGND 26.34 27.94 152.0 153.6}
  {VPWR 22.66 24.26 161.5 163.1}
  {VGND 26.34 27.94 428.0 429.6}
  {VPWR 22.66 24.26 437.5 439.1}
}
foreach j $jobs {
  lassign $j netname sx0 sx1 ty0 ty1
  set net [$block findNet $netname]
  set sw [lindex [$net getSWires] 0]
  odb::dbSBox_create $sw $m5 [um $sx0] [um $ty0] [um 40.5] [um $ty1] STRIPE
  odb::dbSBox_create $sw $via [um [expr {($sx0 + $sx1) / 2.0}]] [um [expr {($ty0 + $ty1) / 2.0}]] STRIPE
  puts "stitched $netname strap x $sx0..$sx1 y $ty0..$ty1"
}
write_db $::env(ODB_OUT)
