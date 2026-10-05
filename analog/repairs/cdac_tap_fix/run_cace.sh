#!/usr/bin/env bash
# Full physical signoff (Magic area/DRC, Netgen LVS, KLayout DRC) of the repaired CDAC copy, same command analog_runner uses.
set -uo pipefail
H=/mnt/d/MyWork/Veriolg_MA/analog/repairs/cdac_tap_fix
export PDK_ROOT=/home/oem/eda/pdk
export PATH=/nix/store/kh8imbr9x09a76n3bww3s674l5jxvvxp-magic-vlsi/bin:/nix/store/d55q9bly3qrnbkif0sc6nmmvba3law57-netgen/bin:/nix/store/kd8jmsgmli7f4wx53gvsmjwpb42igdqc-klayout/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
cd $H/project
/mnt/d/MyWork/Veriolg_MA/analog/.venv-cace/bin/python -m cace $H/datasheet.yaml --source layout --parameter magic_area magic_drc netgen_lvs klayout_drc_full --run-path $H/cace_runs --no-plot --no-progress-bar --max-runs 3 --log-level INFO > $H/cace_console.log 2>&1
echo "exit $?" >> $H/cace_console.log
