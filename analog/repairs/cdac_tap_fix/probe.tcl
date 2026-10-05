drc on
catch {drc style drc(full)}
load sky130_ef_ip__cdac3v_12bit -quiet
select top cell
# region around the first U (internal units, 200/um): widen by 2 um each side
box 84600i -10700i 87000i -9000i
puts "BOXUM: [box size microns]"
select area
puts "---WHAT"
what
puts "---CELLS"
puts [cellname list children [cellname list self]]
puts "SELF: [cellname list self]"
# which child instances overlap
select cell
puts "SEL: [select list cell]"
quit -noprompt
