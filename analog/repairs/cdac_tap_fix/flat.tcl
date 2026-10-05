drc off
load cdac_flat -quiet
getcell sky130_ef_ip__cdac3v_12bit
select cell
flatten cdac_flat_body
load cdac_flat_body -quiet
save cdac_flat_body
quit -noprompt
