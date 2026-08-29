#!/usr/bin/env bash
# Locate the complete set of nix-provided tools OpenLane expects, so the flow can
# be launched with the right PATH instead of the apt binaries installed later in
# this session (yosys, magic, klayout, netgen-lvs all now shadow nix versions).
#
#   wsl -d Ubuntu -- bash /mnt/d/MyWork/Veriolg_MA/tools/wsl/82_find_openlane_env.sh
set -uo pipefail

echo "=== nix store entries providing each tool ==="
for t in yosys openroad magic klayout netgen; do
  echo "--- $t ---"
  find /nix/store -maxdepth 3 -type f -name "$t" -perm -u+x 2>/dev/null | head -3
done

echo
echo "=== is there a single env that has several of them? ==="
for d in /nix/store/*-env/bin /nix/store/*openlane*/bin; do
  [ -d "$d" ] || continue
  n=0
  for t in yosys openroad magic klayout netgen; do
    [ -x "$d/$t" ] && n=$((n+1))
  done
  [ "$n" -ge 2 ] && echo "$n tools: $d"
done | sort -rn | head -5

echo
echo "=== nix profiles ==="
ls -d "$HOME/.nix-profile" /nix/var/nix/profiles/* 2>/dev/null | head -5

echo
echo "=== does the nix yosys accept -y ? ==="
NY="$(find /nix/store -maxdepth 3 -type f -name yosys -perm -u+x 2>/dev/null | grep 'with-plugins.*env' | head -1)"
echo "candidate: ${NY:-<none>}"
if [ -n "$NY" ]; then
  "$NY" -V 2>&1 | head -1
  "$NY" -y /dev/null 2>&1 | head -2
fi

echo
echo "=== how does openlane resolve tools? ==="
OL="$HOME/.venvs/openlane312/bin/openlane"
grep -rl 'nix' "$HOME/.venvs/openlane312/lib/python3.12/site-packages/openlane" 2>/dev/null | head -3
python3 - <<'PY' 2>/dev/null || true
import os, json, glob
# openlane records the tool versions it saw in each run's resolved.json
p = "/mnt/d/MyWork/Veriolg_MA/samples/sample_test_4/asic/chan_ctrl/runs/RUN_2026-08-26_13-14-47/resolved.json"
try:
    d = json.load(open(p))
    for k in sorted(d):
        if any(s in k.upper() for s in ("YOSYS","OPENROAD","MAGIC","KLAYOUT","NETGEN","PATH","BIN")):
            print(f"  {k} = {d[k]}")
except Exception as e:
    print("resolved.json:", e)
PY
