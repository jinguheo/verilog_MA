cd /mnt/d/MyWork/Veriolg_MA/tools/vvirt/src && python3 -c "
from vvirt.stdcell import StdCellLib
l=StdCellLib()
for c in ['inv_1','inv_2','inv_4']: print(c,l.masters['sky130_fd_sc_hd__'+c].width)"
