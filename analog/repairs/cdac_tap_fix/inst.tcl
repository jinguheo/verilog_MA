drc off
load sky130_ef_ip__cdac3v_12bit -quiet
select top cell
set names [lsort -unique [select list cell]]
foreach inst {x3 x1 x2 x4 x5 x6 cdac_dummy_switch_1 cdac_dummy_switch_2} {
  catch {
    select clear
    select cell $inst
    puts "BBOX $inst: [select bbox]"
  }
}
puts "ALLCELLS: [cellname list childinst top]"
quit -noprompt
