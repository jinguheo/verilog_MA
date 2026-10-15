# Connection and recovery

Run from **PowerShell** on Windows (Git Bash rewrites `/mnt/...` paths). Always run script files; inline `bash -c` quoting breaks.

```
wsl.exe -d Ubuntu -e bash /mnt/d/MyWork/Veriolg_MA/tools/vvirt/scripts/doctor.sh            # read-only readiness check
wsl.exe -d Ubuntu -e bash /mnt/d/MyWork/Veriolg_MA/tools/vvirt/scripts/vserver.sh start     # start vvirt + the real daemon (stop/status/log)
wsl.exe -d Ubuntu -e bash /mnt/d/MyWork/Veriolg_MA/tools/vvirt/scripts/pyrun.sh my_script.py # run Python with the real client importable
```

`doctor` prints, for every failed or degraded check, the fix command and **which capability it limits** (`layout`, `rules`,
`official_drc`). Repair only what it names:

| doctor says | Meaning | Repair |
|---|---|---|
| server FAIL | vvirt is not running (it stops on reboot) | `vserver.sh start` |
| clone FAIL / WARN | upstream clone missing or not the tested commit | commands in `tools/vvirt/README.md` |
| deps FAIL | `vendor/` missing packages | `setup_env.sh` (prints a plan) then `setup_env.sh --yes` |
| bridge_env / token / setup_il | bridge files not generated or stale | `vb.sh start`, then restart the server |
| klayout WARN | KLayout missing: placing and `vvRoute` still work, rule checks do not | install KLayout in WSL |
| storage WARN | workspace not on D: | set `VVIRT_WORKSPACE` under `/mnt/d` |
| roundtrip FAIL with the rest OK | client cannot authenticate/reach the daemon | `vserver.sh log`; restart the server |

The server is shared by every session on the machine. Restarting it drops in-memory state (unsaved cellviews), so `dbSave`
before restarting, and do not restart it while another session may be mid-run unless you must.
The doctor never installs software and never edits configuration; `setup_env.sh` writes only under `tools/vvirt/` and shows its plan first.
