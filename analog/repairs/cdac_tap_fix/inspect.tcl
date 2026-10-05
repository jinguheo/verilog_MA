# Report the CDAC DRC errors (internal units: 200 per micron) and the layers drawn at the first error.
drc on
catch {drc style drc(full)}
load sky130_ef_ip__cdac3v_12bit -quiet
select top cell
drc check
drc catchup
puts "ERRCOUNT [drc list count total]"
set why [drc listall why]
foreach {msg rects} $why {
  puts "WHY: $msg"
  foreach r $rects { puts "RECT: $r" }
}
quit -noprompt
