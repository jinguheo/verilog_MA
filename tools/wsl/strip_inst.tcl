read_db $::env(ODB)
set block [ord::get_db_block]
array set cnt {}
set tot 0
foreach inst [$block getInsts] {
  set bb [$inst getBBox]
  set x0 [expr [$bb xMin]/1000.0]; set x1 [expr [$bb xMax]/1000.0]; set y0 [expr [$bb yMin]/1000.0]; set y1 [expr [$bb yMax]/1000.0]
  if {$x1 < 20 || $x0 > 40 || $y1 < 130 || $y0 > 460} continue
  set m [[$inst getMaster] getName]
  if {![info exists cnt($m)]} {set cnt($m) 0}
  incr cnt($m); incr tot
}
puts "total $tot"
foreach k [lsort [array names cnt]] { puts "$k $cnt($k)" }
# tap cells everywhere: count + x positions histogram near the strip
set taps 0
foreach inst [$block getInsts] {
  set m [[$inst getMaster] getName]
  if {[string match "*tapvpwrvgnd*" $m]} {
    set bb [$inst getBBox]; set x [expr [$bb xMin]/1000.0]; set y [expr [$bb yMin]/1000.0]
    if {$x < 45 && $y > 100 && $y < 500} { incr taps; if {$taps < 6} {puts "tap at $x $y"} }
  }
}
puts "taps near strip: $taps"
