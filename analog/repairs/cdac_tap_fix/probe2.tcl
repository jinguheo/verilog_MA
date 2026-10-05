drc off
load sky130_ef_ip__cdac3v_12bit -quiet
select top cell
foreach {nm x0 y0 x1 y1} {left 84300 -10700 84660 -10300 right 89090 -10700 89400 -10300 lefttop 84300 -9800 84660 -9400} {
  box ${x0}i ${y0}i ${x1}i ${y1}i
  select clear
  select area
  puts "== $nm"
  what
}
quit -noprompt
