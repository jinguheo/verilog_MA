# PARSAC Windows integration

IntelLabs PARSAC is used as an experimental coarse floorplanning step before
OpenLane/OpenROAD. It does not replace RTL/UVM verification or physical
signoff.

The local source and Python environment are stored on `D:` under the ignored
`.local-cache/tools/` directory. Run the Sample Test 2 proof of concept with:

```powershell
powershell -ExecutionPolicy Bypass -File tools/parsac/run_sample_test_2.ps1
```

The input and generated JSON report are stored in
`physical_design/parsac/sample_test_2/`.

For the measured Sample Test 4 hardened blocks:

```powershell
.local-cache\tools\parsac-env\python.exe tools\parsac\extract_openlane_blocks.py --manifest physical_design\parsac\sample_test_4\manifest.json --output physical_design\parsac\sample_test_4\input.json
powershell -ExecutionPolicy Bypass -File tools\parsac\run_sample_test_2.ps1 -InputFile physical_design\parsac\sample_test_4\input.json -OutputFile physical_design\parsac\sample_test_4\result.json -Steps 3000 -Runs 16 -Workers 2
.local-cache\tools\parsac-env\python.exe tools\parsac\export_openlane_macros.py --result physical_design\parsac\sample_test_4\result.json --output-dir physical_design\parsac\sample_test_4
```

`VERSION.json` pins the archived upstream repository to an exact commit and
records the tested Windows runtime. Do not update it without rebuilding the
C++ extension and rerunning both smoke tests plus the measured-block run.

The generated OpenLane files follow the OpenLane 2 `MACROS` dictionary and
`MACRO_PLACEMENT_CFG` format. A true baseline-versus-PARSAC PPA comparison
requires two completed runs of the same hierarchical top. The current three
Sample Test 4 blocks are not peers in the RTL hierarchy, so
`ppa_comparison.json` deliberately records that comparison as pending instead
of presenting the individual block signoff metrics as a top-level comparison.

The example dimensions are an engineering model. Real implementation work
must replace them with macro geometry and connectivity extracted from the
synthesis/OpenLane flow, then verify the selected placement with OpenROAD.
