#!/usr/bin/env bash
set -uo pipefail
cat /nix/store/q5ycjmn0d9awbcq05c75z2rmgwjgbc9g-opensta/test/get_filter.tcl
echo "=== report_object_full_names definition ==="
grep -rn 'proc report_object_full_names' /nix/store/q5ycjmn0d9awbcq05c75z2rmgwjgbc9g-opensta 2>/dev/null
