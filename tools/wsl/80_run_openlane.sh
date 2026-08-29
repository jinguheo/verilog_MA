#!/usr/bin/env bash
# Run the OpenLane 2 flow on one Sample Test 4 design.
#
#   wsl -d Ubuntu -- bash /mnt/d/MyWork/Veriolg_MA/tools/wsl/80_run_openlane.sh chan_ctrl
#
# Two things this has to get right:
#
# 1. Working directory. OpenLane refuses to read files outside it, so the flow is
#    launched from samples/sample_test_4 and every path in config.json points
#    downward from there.
#
# 2. PATH. OpenLane expects the nix-provided tools. The apt packages installed
#    later in this session (yosys, magic, klayout, netgen-lvs) shadow them, and
#    the failure is not obvious: OpenLane invokes `yosys -y <script.py>` for its
#    pyosys steps, and yosys 0.52 from apt has no -y option, so the flow dies at
#    "Generate JSON Header" with "Option 'y' does not exist". The nix yosys is
#    0.46 built with plugins and does support it. The store paths are resolved
#    here rather than assumed, so this keeps working if nix garbage-collects and
#    rebuilds them.
set -euo pipefail

DESIGN="${1:-chan_ctrl}"
REPO=/mnt/d/MyWork/Veriolg_MA
SAMPLE="$REPO/samples/sample_test_4"
CFG="$SAMPLE/asic/$DESIGN/config.json"
OL="$HOME/.venvs/openlane312/bin/openlane"

[ -f "$CFG" ] || { echo "no config: $CFG" >&2; exit 1; }
[ -x "$OL" ]  || { echo "openlane not found at $OL" >&2; exit 1; }

# Prefer the *-env variants: those are the wrapped builds that carry their
# python bindings, which is what the pyosys and openroad steps need.
pick_bin() {
  local tool="$1" pref="$2" hit
  hit="$(find /nix/store -maxdepth 3 -type f -name "$tool" -perm -u+x 2>/dev/null \
         | grep -- "$pref" | head -1)"
  [ -z "$hit" ] && hit="$(find /nix/store -maxdepth 3 -type f -name "$tool" -perm -u+x 2>/dev/null | head -1)"
  [ -n "$hit" ] && dirname "$hit"
}

# Expose ONLY these binaries, via a directory of symlinks.
#
# Putting the nix bin directories themselves on PATH also exposes their
# `python3` (3.11), which then shadows the venv's 3.12 while the venv's stdlib
# paths are still in effect. The result is a late, confusing failure in a
# post-processing script: "AssertionError: SRE module mismatch" at the KLayout
# DRC report conversion, 63 steps in. Symlinking individual tools keeps python3
# resolution untouched.
#
# `sta` is OpenSTA, a separate binary from openroad - OpenLane calls it directly
# for the STA steps, and without it the flow dies with FileNotFoundError: 'sta'.
SHIM="$HOME/.cache/openlane-tools/bin"
rm -rf "$SHIM"; mkdir -p "$SHIM"

for spec in "yosys:with-plugins.*env" "openroad:python3.*env" "sta:opensta" "magic:" "klayout:/bin/" "netgen:"; do
  tool="${spec%%:*}"; pref="${spec#*:}"
  d="$(pick_bin "$tool" "${pref:-.}")" || true
  if [ -n "${d:-}" ]; then
    ln -sf "$d/$tool" "$SHIM/$tool"
    printf '%-9s %s\n' "$tool" "$d/$tool"
  else
    printf '%-9s %s\n' "$tool" "(not found in /nix/store - will fall back to PATH)"
  fi
done

# OpenLane shells out to a bare `python3` for its post-processing scripts. On
# this machine that resolves to the distro's Python 3.14 while the environment
# still points at the venv's 3.12 standard library, and the mismatch surfaces as
# "AssertionError: SRE module mismatch" at the very last step. Pinning python3
# to the venv interpreter keeps the C extensions and the stdlib in step.
ln -sf "$(dirname "$OL")/python3" "$SHIM/python3"
printf '%-9s %s\n' "python3" "$(dirname "$OL")/python3"

export PATH="$SHIM:$PATH"

echo
echo "design : $DESIGN"
echo "config : $CFG"
echo "yosys  : $(command -v yosys)  $(yosys -V 2>&1 | head -1)"
"$OL" --version
echo

cd "$SAMPLE"
"$OL" "asic/$DESIGN/config.json"

echo
echo "=== newest run ==="
RUN="$(find "$SAMPLE/asic/$DESIGN/runs" -maxdepth 1 -type d -name 'RUN_*' | sort | tail -1)"
echo "$RUN"
[ -f "$RUN/final/metrics.json" ] && echo 'final/metrics.json written' || echo 'no final metrics'
