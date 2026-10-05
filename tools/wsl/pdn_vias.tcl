read_db $::env(ODB)
set block [ord::get_db_block]
set sram [$block findInst u_capture_path.u_capture.u_capture_sram.u_sram22]
set bb [$sram getBBox]
puts "SRAM bbox [expr [$bb xMin]/1000.0] [expr [$bb yMin]/1000.0] [expr [$bb xMax]/1000.0] [expr [$bb yMax]/1000.0]"
array set cnt {}
foreach netname {VPWR VGND} {
  set net [$block findNet $netname]
  foreach sw [$net getSWires] { foreach box [$sw getWires] {
    set x0 [$box xMin]; set x1 [$box xMax]; set y0 [$box yMin]; set y1 [$box yMax]
    if {$x1 < [$bb xMin] || $x0 > [$bb xMax] || $y1 < [$bb yMin] || $y0 > [$bb yMax]} continue
    if {[$box isVia]} { set v [$box getTechVia]; if {$v eq "NULL"} { set v [$box getBlockVia] }; set key "$netname via [$v getName]" } else { set key "$netname [[$box getTechLayer] getName]" }
    if {![info exists cnt($key)]} { set cnt($key) 0 }
    incr cnt($key)
  } }
}
foreach k [lsort [array names cnt]] { puts "$k $cnt($k)" }
