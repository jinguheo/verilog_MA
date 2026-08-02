# Sample Test 1 — OpenTitan `prim_filter`

## Source selection

This experiment uses the self-contained synchronous configuration of OpenTitan's
`prim_filter` module from the Knowledge DB:

`D:\MyWork\verilog\dbs\opentitan\hw\ip\prim\rtl\prim_filter.sv`

The copied implementation is 2KB and includes asynchronous reset, enable/bypass
behavior, a configurable stability window, and sequential state. `AsyncOn=0`
is used so the experiment has no external synchronizer dependency.

## Interface and configuration

| Signal | Direction | Meaning |
| --- | --- | --- |
| `clk_i` | input | Active clock. |
| `rst_ni` | input | Active-low asynchronous reset. |
| `enable_i` | input | `0`: bypass; `1`: filter active. |
| `filter_i` | input | Raw one-bit input. |
| `filter_o` | output | Filtered or bypassed output. |

Parameters: `Cycles=4`, `AsyncOn=0`.

## Baseline requirements

| ID | Requirement | Acceptance evidence |
| --- | --- | --- |
| REQ-001 | Reset shall clear the filtered state to zero. | Simulation reset phase. |
| REQ-002 | With filtering disabled, the output shall follow the input immediately. | Bypass simulation check and formal assertion. |
| REQ-003 | With filtering enabled, a stable high input for four clock cycles shall update the output high. | Simulation check after four rising edges. |
| REQ-004 | With filtering enabled, a stable low input for four clock cycles shall update the output low. | Simulation check after four rising edges. |
| REQ-005 | The selected configuration shall elaborate and synthesize without external IP. | Verilator, Slang, Yosys evidence. |

## Architecture

`stored_vector_q` keeps the last four synchronized input samples. When all
samples are zero or all are one, `stored_value_q` is updated. The output mux
returns the raw input when bypassed and `stored_value_q` when enabled.
