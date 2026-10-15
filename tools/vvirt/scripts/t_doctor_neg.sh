#!/usr/bin/env bash
# negative paths of the doctor (no files changed except stopping/starting the server)
ROOT=/mnt/d/MyWork/Veriolg_MA/tools
export PYTHONPATH="$ROOT/vvirt/vendor:$ROOT/virtuoso-bridge-lite/src:$ROOT/vvirt/src"
echo "##### A: server stopped"
bash $ROOT/vvirt/scripts/vserver.sh stop >/dev/null; sleep 1
python3 -m vvirt.doctor | grep -E "FAIL|WARN|fix|affects|ready|BLOCKED|usable|fail," ; echo "exit=$?  (grep) / doctor exit below"
python3 -m vvirt.doctor >/dev/null; echo "doctor exit=$?"
bash $ROOT/vvirt/scripts/vserver.sh start >/dev/null
echo; echo "##### B: no klayout, no git on PATH, workspace outside D:"
mkdir -p /tmp/nobin /tmp/vvws
PATH=/tmp/nobin VVIRT_WORKSPACE=/tmp/vvws /usr/bin/python3 -m vvirt.doctor --no-roundtrip | grep -E "WARN|FAIL|fix|affects|ready|usable|BLOCKED|HEAD|ok,"
echo; echo "##### C: --json is valid"
python3 -m vvirt.doctor --json --no-roundtrip | python3 -c "import json,sys; d=json.load(sys.stdin); print('json ok:', len(d['checks']), 'checks; summary', d['summary']['ok'], d['summary']['warn'], d['summary']['fail'])"
