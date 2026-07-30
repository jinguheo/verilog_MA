# Verible and slang static analysis

The RTL analysis flow uses this fixed order:

1. Verilator for the first executable lint gate and fast simulation checks.
2. Verible for the second style and syntax lint gate.
3. slang/pyslang for the third SystemVerilog parse and elaboration gate.

The project toolchain reports `verible`, `slang`, and `pyslang` separately so a
missing CLI does not hide the Python parser that is already available.

## WSL installation

The OpenLane Python environment can install the Verible wrapper without
changing the system Python:

```bash
~/.local/bin/uv pip install --python ~/.venvs/openlane312/bin/python verible
~/.venvs/openlane312/bin/verible-cli verible-verilog-lint path/to/design.sv
~/.venvs/openlane312/bin/verible-cli verible-verilog-syntax path/to/design.sv
```

For native Windows, use the official Verible binary release and add the folder
containing `verible-verilog-lint.exe` and `verible-verilog-syntax.exe` to PATH.
