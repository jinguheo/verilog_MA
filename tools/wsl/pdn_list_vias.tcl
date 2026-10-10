read_db $::env(ODB_IN)
set block [ord::get_db_block]
foreach v [$block getVias] { set n [$v getName]; if {[string match "via5_6_*" $n]} { puts "VIA $n" } }
