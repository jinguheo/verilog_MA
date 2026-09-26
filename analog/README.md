# Analog and Memory Design Workspace

This directory keeps public educational IP, requirement-driven candidate
selection studies, and the isolated CACE environment. Third-party repositories
retain their own licenses and are not part of this project's source license.

The selection engine does not invent analog PPA values. DRC=0 and LVS match are
hard gates. Power, performance and area optimization starts only after
post-layout extraction produces measured results.

## Installed resources

- SKY130 12-bit SAR ADC hard IP and its comparator/CDAC dependencies
- IIC-JKU SKY130 mixed-signal ADC reference
- OpenFASoC temperature sensor, digital LDO and Glayout generators
- Efabless analog IP project template
- OpenRAM and prebuilt SKY130 SRAM macro configurations
- SRAM22 SKY130 hard macros, including the subset reported as measured in silicon
- Efabless PSRAM/QSPI controller
- CACE source and isolated CACE 2.11.0 environment
- IHP Analog Academy (education reference; different PDK)

## Next executable steps

1. Select a requirement in the Analog Design dashboard.
2. Characterize the selected schematic with CACE/ngspice.
3. Add sizing and layout search adapters per circuit family.
4. Require zero DRC and matching LVS.
5. Compare extracted PPA and export the winning hard macro views.

## Executable dashboard actions

The dashboard can start persistent background jobs through
`POST /api/analog/run`. SRAM and hard-macro candidates support an artifact
audit for GDS/LEF/Liberty/SPICE/Verilog views and LEF area extraction. The
Efabless ADC, CDAC, and comparator support CACE area, Magic DRC, Netgen LVS,
KLayout DRC, or the combined physical-signoff action. Jobs and logs are stored
under `analog/jobs/` and shown in the dashboard.

Prebuilt SKY130 and SRAM22 candidates also support `select_memory_macro`.
The selector matches requested capacity, word width, and port count, rejects
macros missing any integration view, and writes a persistent
`memory_macro.json` manifest with LEF/GDS/Liberty/SPICE/Verilog paths and the
measured LEF area. SRAM22 remains preferred when requirements are otherwise
equal because the catalog records its measured-silicon evidence.

OpenFASoC temperature-sensor and LDO candidates additionally support
`generate_verilog` and `generate_macro`. Both Verilog generators were run
successfully on 2026-09-19. Macro generation is automatically blocked while
other Veriolg_MA OpenLane jobs are active, preventing CPU and workspace
contention; the user can run it later from the dashboard.

On 2026-09-20 the requirement selector chose `sram22_1024x32m8w8` for a
4 KiB, 32-bit, single-port request. Its LEF/GDS/three-corner Liberty/SPICE/
Verilog views are complete, and its LEF area is 351,764.387 µm². The
persistent evidence is stored in the matching `analog/jobs/*/memory_macro.json`.

ADC physical evidence currently has mixed signoff status and must remain
blocked as a full hard-macro candidate: KLayout full DRC passes with zero
violations on the 1.49 MB Magic-exported GDS, while Magic reports 103
`diff/tap.18,20` violations (spacing of N-diff/P-tap to the MV nwell used by
this IP's 3.3V devices - not yet root-caused; possibly a PDK-version/tech-
file mismatch against whatever Magic version the vendor originally signed
off with, since the violation is a single repeated rule across ~103
instances of what looks like the CDAC's unit-capacitor array, not 103
independent layout mistakes in vendor-verified IP).

**2026-09-20: LVS root cause found and fixed (two separate bugs, both local
to this project's checkout/tooling, not the vendor IP itself)** - LVS
previously could not even run ("Cannot find cell sky130_ef_ip__adc3v_12bit"
from netgen). Root causes:
1. `ip/sky130_ef_ip__cdac3v_12bit/xschem/xschemrc` sourced its
   `sky130_ef_ip__analog_switches` dependency's own `xschemrc` but never its
   `sky130_ef_ip__samplehold` one, even though both are checked out as
   siblings under `dependencies/`. Any hierarchical netlisting that needed
   to resolve symbols pulled in transitively through the CDAC (which is
   everything, since the ADC top only directly instantiates the CDAC and
   the comparator) silently produced an incomplete netlist missing the top-
   level `.subckt ... .ends` wrapper entirely. Fixed by adding the missing
   `source` line, mirroring the existing analog_switches one.
2. Separately, this project's isolated `analog/.venv-cace` build of CACE
   2.11.0 always regenerates the schematic netlist via `xschem --tcl "set
   top_is_subckt 1"` - and for this specific IP's schematic hierarchy,
   `top_is_subckt` alone still did not produce the top-level wrapper, even
   after fix (1). Setting xschem's older `lvs_netlist` option alongside it
   does. Patched locally in
   `analog/.venv-cace/lib/python3.12/site-packages/cace/common/cace_regenerate.py`
   (not upstream CACE - if this venv is ever recreated, the one-line change
   needs reapplying; the patch itself explains why inline).

With both fixed, `netgen_lvs` now actually runs the comparison instead of
erroring, and reports a real, specific result: **the two netlists' devices
and connectivity are equivalent** ("Device classes ... are equivalent") -
the underlying circuit checks out. The one remaining failure is a top-level
**pin *order*/naming mismatch**, not a circuit defect: `adc_vrefH`/
`adc_vrefL` are swapped, `adc_dac_val[11:0]`'s bit order differs by a
rotation between the schematic capture and the GDS-extracted layout pin
list, and `vdda`/`vssd`'s position in the list differs. netgen auto-
corrects internally to still prove device-level equivalence, but formally
fails "top level cell pin matching." Fixing this needs deciding whether to
reorder the xschem top-level symbol's pins to match the GDS's actual bond-
pad order, or the reverse - not yet done.

The CACE adapter uses the correct VLSI Netgen/KLayout binaries, generates
per-job runtime datasheets, and replaces the vendor's empty 20-byte GDS
archive with the validated Magic export without editing the upstream
configuration.

CACE is invoked with the Magic 8.3.489 binary already installed by OpenLane,
because Ubuntu's Magic 8.3.105 is too old for the current SKY130 techfile.
Electrical PPA remains unmeasured where an IP repository only supplies
physical checks and no power/performance testbench.

## 2026-09-23 PPA1 CDAC checkpoint

The earlier assumption that the editable CDAC `.mag` was clean while only the
CACE GDS had 84 errors was disproved: CACE prefers and directly checks the
Magic hierarchy.  The CDAC pinned an older analog-switch dependency.  Moving
that nested checkout from `2dc44dd` to the upstream DRC/LVS fix `34a2361`
reduced Magic DRC from 84 to 9.  Extending the stale `EF_SW_RST` nwell/dnwell
stitching edges to the updated child-cell boundary made that cell DRC-clean and
reduced the CDAC total to 6 repeated `diff/tap.18,20` errors.

The remaining six errors are at the CDAC top-level symmetric tap/nwell
integration boundary.  A freshly generated GDS exposed that the previous
KLayout zero-error result was stale; before the `EF_SW_RST` stitching fix the
new GDS reported two well-spacing errors in that cell.  Re-run GDS generation,
KLayout DRC, and LVS after the final six Magic errors are closed.  CACE 2.11.0
currently also raises a `datetime.date` string-concatenation error while
checking the modified child `.mag` timestamp, so the adapter needs a small
regeneration-path workaround before the next full signoff run.

## 2026-09-21: what the SRAM is for — ADC calibration LUT

The catalogued `sram22_1024x32m8w8` macro (above) now has an architectural
job: a shared, single-port, per-channel ADC calibration/linearity-correction
lookup table, digital RTL in
[`samples/sample_test_4/rtl/analog_if/adc_cal_lut.sv`](../samples/sample_test_4/rtl/analog_if/adc_cal_lut.sv).
The macro's own fixed 1024 x 32-bit depth is what pins the split: 8 channels
x 128 entries/channel fills it exactly, addressed by `{channel_id,
code[11:5]}` — a SAR ADC's systematic INL/DNL needs a piecewise correction
table indexed by the upper code bits, which a single per-channel trim
constant (`sar_adc_ch.sv`'s original placeholder assumption) cannot provide.
Calibration writes (software, rare) always win single-port arbitration over
per-channel reads (frequent, up to once per conversion); reads arbitrate
against each other with `prim_arbiter_tree` for genuine round-robin
fairness. Verified in
[`samples/sample_test_4/tb/tb_adc_cal_lut.sv`](../samples/sample_test_4/tb/tb_adc_cal_lut.sv)
across 7 seeds — see `samples/sample_test_4/RESULTS.md`'s 2026-09-21 entry
for the full writeup. Wiring this LUT into `sar_adc_ch.sv`'s own conversion
FSM (issue lookup, wait for grant+data, apply correction before packet
emission) is a deliberately separate next step, not yet done.
