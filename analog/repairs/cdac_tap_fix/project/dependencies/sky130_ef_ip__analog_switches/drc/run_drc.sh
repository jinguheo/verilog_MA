#! /bin/bash
#
# Run DRC on all of the library components in the
# analog switch library

./run_drc_simplest.sh
mv drc.log drc_all.log
./run_drc_simple.sh
cat drc.log >> drc_all.log
./run_drc_isolated.sh
cat drc.log >> drc_all.log
./run_drc_large.sh
cat drc.log >> drc_all.log
./run_drc_xlarge.sh
cat drc.log >> drc_all.log
rm drc.log

exit 0

