drc on
catch {drc style drc(full)}
load $::env(CELL) -quiet
select top cell
drc check
drc catchup
puts "ERRCOUNT [drc list count total]"
foreach {msg rects} [drc listall why] {
  puts "WHY: $msg"
  foreach r $rects { puts "RECT: $r" }
}
quit -noprompt
