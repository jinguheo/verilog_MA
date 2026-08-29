#!/usr/bin/env bash
set -uo pipefail
D=/nix/store/q5ycjmn0d9awbcq05c75z2rmgwjgbc9g-opensta
echo "=== filter expression parsing ==="
grep -rn 'proc.*filter_expr\|parse_filter\|proc.*filter1\b' "$D" 2>/dev/null | head -10
echo
echo "=== pin properties available (for filter) ==="
grep -rn 'proc pin_property\|"direction"\|"lib_pin"\|"name"' "$D"/tcl/Property.tcl 2>/dev/null | head -20
echo
echo "=== any use of 'get_pins' with 'name ==' filter in opensta examples/tests ==="
grep -rln 'get_pins.*-filter' "$D" 2>/dev/null | head -5
grep -rn 'get_pins.*-filter' "$D" 2>/dev/null | head -10
