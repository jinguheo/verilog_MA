# DREAMPlace build handoff

Updated: 2026-09-19 17:09 KST

## Current state

- Source: `/home/oem/eda-research/dreamplace`
- Build tree: `/home/oem/eda-research/dreamplace/build`
- Python environment: `/home/oem/eda-research/dreamplace/.venv` (Python 3.9, PyTorch 2.8)
- Build type: `Release`
- CUDA build: enabled
- Generator: Unix Makefiles
- Detached session: `tmux` session `dreamplace`
- Parallelism: 4 jobs
- Last observed progress: 55%; active C++/CUDA compilation, no current error

The build continues after Codex or a terminal closes because it runs inside
the detached `tmux` session.

## Fixes already applied

`/home/oem/eda-research/dreamplace/CMakeLists.txt` has an uncommitted local
patch under `if(CUDA_FOUND)`:

1. Always use `thirdparty/cub` instead of CUDA 12's bundled CCCL CUB. This
   avoids a `DreamPlace::cuda` versus `cuda::` namespace collision.
2. Add `-DTHRUST_IGNORE_CUB_VERSION_CHECK`. CUDA 12 Thrust otherwise rejects
   the intentionally selected vendored CUB.

Do not discard this CMake change when resuming.

The build previously stalled after `FindGUROBI` because the WSL `PATH`
contained many `/mnt/c` and `/mnt/d` Windows paths. CMake entered an
uninterruptible `p9_client_rpc` file lookup. The current build therefore uses
a Linux-only PATH. GUROBI, CPLEX, LPSOLVE, COIN, and Doxygen are optional and
their not-found messages are not build failures.

## Check current status

```bash
wsl -d Ubuntu -- tmux list-sessions
wsl -d Ubuntu -- tmux capture-pane -p -t dreamplace:0.0 -S -100
```

For an interactive view:

```bash
wsl -d Ubuntu -- tmux attach -t dreamplace
```

Detach without stopping the build with `Ctrl-b`, then `d`.

## Resume if the tmux session has ended

First inspect the final output. If the session is gone, run this exact command
from PowerShell to continue incrementally without reintroducing Windows PATH
entries:

```powershell
wsl.exe -d Ubuntu -- tmux new-session -d -s dreamplace -c /home/oem/eda-research/dreamplace env PATH=/home/oem/eda-research/dreamplace/.venv/bin:/home/oem/.local/bin:/home/oem/.nix-profile/bin:/nix/var/nix/profiles/default/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/usr/lib/wsl/lib cmake --build build --parallel 4
```

The existing `build/` directory is incremental; do not delete or reconfigure it
unless a later error specifically proves that a clean build is required.

## Completion checks

After the session exits, rerun the same clean-PATH `cmake --build` command in
the foreground. A completed tree should return successfully without compiling
more targets. Then validate the Python package from the project venv:

```bash
cd /home/oem/eda-research/dreamplace
.venv/bin/python -c "import dreamplace; print(dreamplace.__file__)"
```

Record any first failing compiler line before making further changes; the many
CMake policy, missing optional solver, and `libgomp` search-path messages seen
so far are warnings rather than the root error.
