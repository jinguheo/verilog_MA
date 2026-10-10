# Add the missing met4-met5 vias that pdngen could not insert at the ADC power pins, re-using the via masters pdngen itself generated
# (same size/DRC-clean cut pattern as the vias it did place at the vssd/vdda crossings). Then run the PSM connectivity check.
read_db $::env(ODB_IN)
set block [ord::get_db_block]
set jobs {
  {VGND 217.770 347.270 222.875 348.870 via5_6_5100_1600_1_3_1600_1600}
  {VGND 217.770 426.005 222.875 433.475 via5_6_5100_7470_4_3_1600_1600}
  {VPWR 226.425 159.690 231.520 167.530 via5_6_5100_7840_5_3_1600_1600}
  {VPWR 226.425 190.790 231.520 192.390 via5_6_5100_1600_1_3_1600_1600}
}
foreach j $jobs {
  lassign $j netname x0 y0 x1 y1 vname
  set v [$block findVia $vname]
  if {$v eq "NULL"} { puts "MISSING via master $vname"; continue }
  set net [$block findNet $netname]
  set sw [lindex [$net getSWires] 0]
  odb::dbSBox_create $sw $v [expr {int(round(($x0+$x1)/2.0*1000))}] [expr {int(round(($y0+$y1)/2.0*1000))}] STRIPE
  puts "added $vname on $netname at [expr {($x0+$x1)/2.0}] [expr {($y0+$y1)/2.0}]"
}
if {[info exists ::env(ODB_OUT)]} { write_db $::env(ODB_OUT) }
foreach netname {VPWR VGND} {
  puts "== PSM $netname"
  catch {check_power_grid -net $netname} msg
  puts $msg
}
