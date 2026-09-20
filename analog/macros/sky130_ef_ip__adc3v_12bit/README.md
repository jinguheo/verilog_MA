# SKY130 12-bit ADC hard-macro integration

This directory contains project-owned integration metadata and a physical
black-box. The upstream IP remains under `analog/third_party/` and is not
modified.

Generate the reproducible P&R bundle in WSL:

```sh
bash /mnt/d/MyWork/Veriolg_MA/tools/wsl/export_adc_macro.sh
```

The command writes ignored build products under
`analog/build/sky130_ef_ip__adc3v_12bit/`, then verifies that the LEF,
black-box Verilog, and extracted top-level SPICE subcircuit expose the same
pins. It also checks that Magic produced a non-empty GDS.

The upstream behavioral Verilog is not used for synthesis because its port
names do not match the released LEF and it contains unresolved internal signal
names. Use `sky130_ef_ip__adc3v_12bit.blackbox.v` for synthesis/P&R. A separate
mixed-signal simulation model can be repaired later without changing the
physical contract.

`openlane-macro.example.json` shows the OpenLane 2 `MACROS` entry. Merge it
into the consuming design and adjust the instance location. The instance must
be named `u_adc`, or the `instances` key must be changed to match the RTL.

No Liberty view is claimed yet. Until measured characterization produces one,
budget paths to and from the ADC boundary explicitly in the top-level SDC and
do not report internal ADC timing as STA-verified.
