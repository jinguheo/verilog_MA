#!/usr/bin/env bash
H=/mnt/d/MyWork/Veriolg_MA/analog/repairs/cdac_tap_baseline
setsid nohup bash $H/run_cace.sh > /dev/null 2>&1 < /dev/null &
echo "launched $!"
sleep 5
