# list power wires (VPWR/VGND) overlapping the ADC macro and its own pin shapes
read_db $::env(ODB)
set block [ord::get_db_block]
set inst [$block findInst u_adc]
set bb [$inst getBBox]
puts "ADC bbox [expr [$bb xMin]/1000.0] [expr [$bb yMin]/1000.0] [expr [$bb xMax]/1000.0] [expr [$bb yMax]/1000.0]"
foreach mt [[$inst getMaster] getMTerms] {
  set n [$mt getName]
  if {[lsearch {vccd vssd vdda vssa} $n] >= 0} {
    set iterm [$inst findITerm $n]
    set net [$iterm getNet]
    puts "pin $n net [expr {$net eq "NULL" ? "NULL" : [$net getName]}]"
  }
}
foreach netname {VPWR VGND} {
  set net [$block findNet $netname]
  foreach sw [$net getSWires] {
    foreach box [$sw getWires] {
      if {[$box isVia]} continue
      set l [[$box getTechLayer] getName]
      if {$l ne "met4" && $l ne "met5"} continue
      set x0 [$box xMin]; set x1 [$box xMax]; set y0 [$box yMin]; set y1 [$box yMax]
      if {$x1 < [$bb xMin] || $x0 > [$bb xMax] || $y1 < [$bb yMin] || $y0 > [$bb yMax]} continue
      puts "$netname $l [expr $x0/1000.0] [expr $y0/1000.0] [expr $x1/1000.0] [expr $y1/1000.0]"
    }
  }
}
