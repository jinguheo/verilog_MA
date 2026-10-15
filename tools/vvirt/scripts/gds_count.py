"""Print the number of structures in a GDS file (oracle helper, uses vvirt's own reader):  pyrun.sh gds_count.py file.gds"""
import sys

from vvirt.gdsio import GdsFile

print(len(GdsFile(sys.argv[1]).cells()))
