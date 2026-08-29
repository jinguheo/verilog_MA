#!/usr/bin/env bash
set -uo pipefail
grep -rn 'proc foreach_in_collection\|foreach_in_collection' \
  /nix/store/q5ycjmn0d9awbcq05c75z2rmgwjgbc9g-opensta/tcl/*.tcl \
  /nix/store/q5ycjmn0d9awbcq05c75z2rmgwjgbc9g-opensta/sdc/*.tcl 2>/dev/null | head -10
echo "---"
grep -rln 'foreach_in_collection' /nix/store/q5ycjmn0d9awbcq05c75z2rmgwjgbc9g-opensta 2>/dev/null | head -5
