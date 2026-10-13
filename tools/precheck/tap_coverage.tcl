# Early placement check: standard-cell rows (after tap insertion) whose points are farther than the latch-up distance from any tap.
# env: ODB_IN, LU_DIST (um, default 15). Prints "TAPFAR rows=<n> bbox=..." lines and "SUMMARY flagged=<n> rows=<total>".
# Why: a row segment beside a macro that is too short to get a tap cell still receives decap/fill cells later -> LU.2/LU.3/nwell.4 DRC and floating nwell islands.
read_db $::env(ODB_IN)
set block [ord::get_db_block]
set lu 15.0
if {[info exists ::env(LU_DIST)]} { set lu $::env(LU_DIST) }
set taps {}
foreach inst [$block getInsts] {
  if {[string match "*tapvpwrvgnd*" [[$inst getMaster] getName]]} {
    set bb [$inst getBBox]
    lappend taps [list [expr {([$bb xMin]+[$bb xMax])/2000.0}] [expr {([$bb yMin]+[$bb yMax])/2000.0}]]
  }
}
puts "taps [llength $taps]"
set flagged 0; set total 0; set groups {}
foreach row [$block getRows] {
  incr total
  set bb [$row getBBox]
  set x0 [expr {[$bb xMin]/1000.0}]; set x1 [expr {[$bb xMax]/1000.0}]; set y [expr {([$bb yMin]+[$bb yMax])/2000.0}]
  set far 0
  set n [expr {int(($x1-$x0)/5.0)+1}]
  for {set i 0} {$i <= $n} {incr i} {
    set x [expr {min($x1, $x0 + $i*5.0)}]
    set best 1e9
    foreach t $taps {
      set dx [expr {[lindex $t 0]-$x}]; set dy [expr {[lindex $t 1]-$y}]
      if {abs($dx) > $lu+2 || abs($dy) > $lu+2} continue
      set d [expr {sqrt($dx*$dx+$dy*$dy)}]
      if {$d < $best} { set best $d }
    }
    if {$best > $lu + 2.0} { set far 1; break }
  }
  if {$far} { incr flagged; lappend groups [list $x0 $x1 $y] }
}
if {$flagged > 0} {
  set xs0 1e9; set xs1 -1e9; set ys0 1e9; set ys1 -1e9
  foreach g $groups { lassign $g a b c; if {$a<$xs0} {set xs0 $a}; if {$b>$xs1} {set xs1 $b}; if {$c<$ys0} {set ys0 $c}; if {$c>$ys1} {set ys1 $c} }
  puts [format "TAPFAR rows=%d bbox=x%.1f..%.1f y%.1f..%.1f" $flagged $xs0 $xs1 $ys0 $ys1]
}
puts "SUMMARY flagged=$flagged rows=$total"
