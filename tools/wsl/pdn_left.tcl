read_db $::env(ODB)
set block [ord::get_db_block]
set die [$block getDieArea]
puts "die [expr [$die xMax]/1000.0] x [expr [$die yMax]/1000.0]"
foreach netname {VPWR VGND} {
  set net [$block findNet $netname]
  foreach sw [$net getSWires] { foreach box [$sw getWires] {
    if {[$box isVia]} continue
    set l [[$box getTechLayer] getName]
    set x0 [expr [$box xMin]/1000.0]; set x1 [expr [$box xMax]/1000.0]; set y0 [expr [$box yMin]/1000.0]; set y1 [expr [$box yMax]/1000.0]
    if {$l eq "met4" && $x0 < 60 && ($y1 - $y0) > 100} { puts "$netname met4 $x0 $y0 $x1 $y1" }
    if {$l eq "met5" && $x0 < 45 && $y1 > 140 && $y0 < 450} { puts "$netname met5 $x0 $y0 $x1 $y1" }
  } }
}
