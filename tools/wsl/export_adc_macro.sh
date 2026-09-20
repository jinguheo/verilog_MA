#!/usr/bin/env bash
# Export and validate the first analog hard macro without changing the upstream IP.
#
#   wsl -d Ubuntu -- bash /mnt/d/MyWork/Veriolg_MA/tools/wsl/export_adc_macro.sh
set -euo pipefail

project_root=/mnt/d/MyWork/Veriolg_MA
macro_name=sky130_ef_ip__adc3v_12bit
source_root="$project_root/analog/third_party/$macro_name"
integration_root="$project_root/analog/macros/$macro_name"
output_root="$project_root/analog/build/$macro_name"
pdk_root_default=/home/oem/.volare/volare/sky130/versions/0fe599b2afb6708d281543108caf8310912f54af
pdk_root="${PDK_ROOT:-$pdk_root_default}"
pdk="${PDK:-sky130A}"
magic_rc="$pdk_root/$pdk/libs.tech/magic/sky130A.magicrc"
export PDK_ROOT="$pdk_root"
export PDK="$pdk"

for required in \
  "$source_root/mag/$macro_name.mag" \
  "$source_root/lef/$macro_name.lef" \
  "$source_root/netlist/layout/$macro_name.spice" \
  "$integration_root/$macro_name.blackbox.v" \
  "$magic_rc"; do
  if [[ ! -f "$required" ]]; then
    echo "missing required file: $required" >&2
    exit 2
  fi
done

command -v python3 >/dev/null || { echo "python3 is not installed" >&2; exit 2; }

magic_bin="${MAGIC_BIN:-}"
if [[ -z "$magic_bin" ]]; then
  magic_bin="$(find /nix/store -maxdepth 3 -type f -path '*/bin/magic' -perm -u+x 2>/dev/null | head -n 1)"
fi
if [[ -z "$magic_bin" ]]; then
  magic_bin="$(command -v magic || true)"
fi
if [[ -z "$magic_bin" ]]; then
  echo "magic is not installed" >&2
  exit 2
fi
magic_version="$("$magic_bin" --version 2>&1 | head -n 1)"
echo "using Magic $magic_version from $magic_bin"

mkdir -p "$output_root"
cp "$source_root/lef/$macro_name.lef" "$output_root/$macro_name.lef"
cp "$source_root/netlist/layout/$macro_name.spice" "$output_root/$macro_name.spice"
cp "$integration_root/$macro_name.blackbox.v" "$output_root/$macro_name.blackbox.v"

pushd "$source_root/mag" >/dev/null
"$magic_bin" -dnull -noconsole -rcfile "$magic_rc" <<MAGIC_EOF
drc off
load $macro_name
select top cell
gds write $output_root/$macro_name.gds
quit -noprompt
MAGIC_EOF
popd >/dev/null

python3 "$project_root/tools/validate_macro_views.py" \
  --name "$macro_name" \
  --lef "$output_root/$macro_name.lef" \
  --verilog "$output_root/$macro_name.blackbox.v" \
  --spice "$output_root/$macro_name.spice" \
  --gds "$output_root/$macro_name.gds" \
  --report "$output_root/validation.json"

echo "macro bundle: $output_root"
