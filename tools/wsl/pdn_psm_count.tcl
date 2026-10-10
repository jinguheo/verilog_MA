read_db $::env(ODB_IN)
foreach netname {VPWR VGND} {
  puts "== PSM $netname"
  catch {check_power_grid -net $netname} msg
  puts $msg
}
