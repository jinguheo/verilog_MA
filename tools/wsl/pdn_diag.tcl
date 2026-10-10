read_db $::env(ODB)
set block [ord::get_db_block]
set inst [$block findInst u_adc]
set bb [$inst getBBox]
set ox [expr [$bb xMin]/1000.0]; set oy [expr [$bb yMin]/1000.0]
puts "ADC origin $ox $oy"
puts "--- master OBS (abs um) layers met4/met5"
foreach ob [[$inst getMaster] getObstructions] {
  set l [[$ob getTechLayer] getName]
  if {$l eq "met4" || $l eq "met5"} {
    puts [format "OBS %s %.3f %.3f %.3f %.3f" $l [expr $ox+[$ob xMin]/1000.0] [expr $oy+[$ob yMin]/1000.0] [expr $ox+[$ob xMax]/1000.0] [expr $oy+[$ob yMax]/1000.0]]
  }
}
puts "--- ADC pins on met4/met5 (abs um)"
foreach mt [[$inst getMaster] getMTerms] {
  set n [$mt getName]
  if {[lsearch {vccd vssd vdda vssa} $n] < 0} continue
  foreach mp [$mt getMPins] { foreach b [$mp getGeometry] {
    set l [[$b getTechLayer] getName]
    puts [format "PIN %s %s %.3f %.3f %.3f %.3f" $n $l [expr $ox+[$b xMin]/1000.0] [expr $oy+[$b yMin]/1000.0] [expr $ox+[$b xMax]/1000.0] [expr $oy+[$b yMax]/1000.0]]
  } }
}
puts "--- core met5 / via4 shapes crossing the ADC (abs um)"
foreach netname {VPWR VGND} {
  set net [$block findNet $netname]
  foreach sw [$net getSWires] { foreach box [$sw getWires] {
    set x0 [expr [$box xMin]/1000.0]; set x1 [expr [$box xMax]/1000.0]; set y0 [expr [$box yMin]/1000.0]; set y1 [expr [$box yMax]/1000.0]
    if {$x1 < 30 || $x0 > 255 || $y1 < 148 || $y0 > 445} continue
    if {[$box isVia]} { set v [$box getTechVia]; if {$v eq "NULL"} { set v [$box getBlockVia] }; puts [format "%s VIA %s %.3f %.3f %.3f %.3f" $netname [$v getName] $x0 $y0 $x1 $y1] } else {
      set l [[$box getTechLayer] getName]; if {$l eq "met5" || $l eq "met4"} { puts [format "%s %s %.3f %.3f %.3f %.3f" $netname $l $x0 $y0 $x1 $y1] } }
  } }
}
