#! /bin/bash
#
# Run layout extraction on all components of the
# analog switch library.

./run_extract_lay_large.sh
./run_extract_lay_xlarge.sh
./run_extract_lay_isolated.sh
./run_extract_lay_simple.sh
./run_extract_lay_simplest.sh
./run_extract_lay_minimal.sh
./run_extract_lay_mux.sh

exit 0

