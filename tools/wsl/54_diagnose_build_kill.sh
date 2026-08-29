#!/usr/bin/env bash
# The build stopped at 10,335/11,882 with no compiler error in the log, which
# looks like the process was killed rather than failing. Find out why, and check
# whether the expensive part (Qt, needed only for the OpenROAD GUI) can be
# skipped entirely.
#
#   wsl -d Ubuntu -- bash /mnt/d/MyWork/Veriolg_MA/tools/wsl/54_diagnose_build_kill.sh
set -uo pipefail

echo "=== memory available to WSL ==="
free -h

echo
echo "=== swap ==="
swapon --show 2>/dev/null || echo '(no swap)'

echo
echo "=== OOM kills in the kernel log? ==="
sudo -n dmesg 2>/dev/null | grep -iE 'out of memory|oom-kill|killed process' | tail -8 \
  || echo '(dmesg unavailable or no OOM entries)'

echo
echo "=== is anything still running? ==="
pgrep -fa 'bazel|java|cc1plus' | head -5 || echo '(nothing running)'

echo
echo "=== did a binary get produced anyway? ==="
ORFS="$HOME/eda/OpenROAD-flow-scripts"
find "$ORFS/tools/OpenROAD" -maxdepth 4 -name openroad -perm -u+x 2>/dev/null | head -3
find "$ORFS" -maxdepth 5 -name 'openroad' -type f -perm -u+x 2>/dev/null | head -3

echo
echo "=== can the GUI be skipped? ==="
# Qt is being compiled from source and is only needed for OpenROAD's GUI.
# KLayout already covers layout viewing, so a batch-only build would avoid
# thousands of Qt compile actions.
bash "$ORFS/tools/OpenROAD/etc/Build.sh" -h 2>&1 | grep -iE 'gui|qt|no-gui|cmake' | head -12

echo
echo "=== bazel build config knobs ==="
grep -rniE 'no-gui|NO_GUI|BUILD_GUI|ENABLE_GUI' "$ORFS/tools/OpenROAD/etc/Build.sh" 2>/dev/null | head -8
grep -rniE 'gui' "$ORFS/tools/OpenROAD/CMakeLists.txt" 2>/dev/null | head -8

echo
df -h "$HOME" | tail -1
