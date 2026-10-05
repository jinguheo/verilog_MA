read_db $::env(ODB)
set block [ord::get_db_block]
foreach netname {VPWR VGND} {
  set net [$block findNet $netname]
  foreach sw [$net getSWires] { foreach box [$sw getWires] {
    set x0 [expr [$box xMin]/1000.0]; set x1 [expr [$box xMax]/1000.0]; set y0 [expr [$box yMin]/1000.0]; set y1 [expr [$box yMax]/1000.0]
    if {$x1 < 40 || $x0 > 264 || $y1 < 150 || $y0 > 444} continue
    if {[$box isVia]} { puts "$netname VIA $x0 $y0 $x1 $y1" } else {
      set l [[$box getTechLayer] getName]
      if {$l eq "met5" || $l eq "met4"} { puts "$netname $l $x0 $y0 $x1 $y1" } }
  } }
}
