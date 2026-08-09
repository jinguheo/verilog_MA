// OpenTitan prim layer, consumed directly from the external corpus rather than
// vendored into this repository. Sample Test 2 already references the same tree
// by absolute path from its build scripts; this file makes that dependency
// explicit and single-sourced.
//
// $OT_PRIM_ROOT and $OT_PRIM_GENERIC_ROOT are set by scripts/run_lint.ps1.
//
// Why include directories are needed as well as file names:
//   - every prim module does `include "prim_assert.sv"`
//   - Verilator resolves *modules* by name from -I/-y directories, so the
//     module files themselves do not have to be listed
//   - it does NOT resolve *packages* that way, which is why the package files
//     below are listed one by one

-I$OT_PRIM_ROOT
-I$OT_PRIM_GENERIC_ROOT

$OT_PRIM_GENERIC_ROOT/prim_pkg.sv
$OT_PRIM_ROOT/prim_util_pkg.sv
$OT_PRIM_ROOT/prim_mubi_pkg.sv
$OT_PRIM_ROOT/prim_count_pkg.sv
$OT_PRIM_ROOT/prim_secded_pkg.sv
