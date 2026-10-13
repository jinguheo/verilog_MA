#!/usr/bin/env bash
# usage: vserver.sh start|stop|status|log
ROOT=/mnt/d/MyWork/Veriolg_MA/tools/vvirt
WS=$ROOT/workspace
PID=$WS/server.pid
mkdir -p "$WS"
case "$1" in
  start)
    if [ -f "$PID" ] && kill -0 "$(cat $PID)" 2>/dev/null; then echo "already running pid $(cat $PID)"; exit 0; fi
    cd "$ROOT/src" || exit 1
    PYTHONPATH="$ROOT/src" nohup python3 -m vvirt.server --workspace "$WS" -v >"$WS/server.out" 2>&1 &
    echo $! >"$PID"
    sleep 2
    echo "started pid $(cat $PID)"; tail -5 "$WS/server.out"
    ;;
  stop)
    if [ -f "$PID" ]; then kill "$(cat $PID)" 2>/dev/null; rm -f "$PID"; echo stopped; else echo "not running"; fi
    ;;
  status)
    if [ -f "$PID" ] && kill -0 "$(cat $PID)" 2>/dev/null; then echo "running pid $(cat $PID)"; else echo "not running"; fi
    ;;
  log) tail -${2:-40} "$WS/server.out" ;;
esac
