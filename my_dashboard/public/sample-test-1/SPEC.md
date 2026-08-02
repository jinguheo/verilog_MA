# Sample Test 1 — OpenTitan prim_filter

Source: `D:\MyWork\verilog\dbs\opentitan\hw\ip\prim\rtl\prim_filter.sv`

Configuration: `Cycles=4`, `AsyncOn=0`.

## Requirements

1. Reset clears filtered state to zero.
2. When bypassed, output follows input.
3. Four stable high samples update output high.
4. Four stable low samples update output low.
5. The selected configuration shall lint, elaborate, simulate and synthesize.

## Architecture

The module shifts the latest four input samples into a history register. When
all samples agree, it updates stored state. The output mux selects raw input in
bypass mode and stored state in filtering mode.
