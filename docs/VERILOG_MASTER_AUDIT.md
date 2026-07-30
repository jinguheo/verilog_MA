# Existing `D:\MyWork\verilog` audit

The master database already contains the verification inputs needed before
selecting a concrete top module:

- Graphify structure graph and embedding rows
- RTL/AST artifacts
- DV and testbench source files
- UVM examples and OpenTitan UVM generator templates
- SVA/bind artifacts
- SDC timing constraints and synthesis scripts
- Xcelium and Questa simulator configuration files
- Verible, slang, and Tree-sitter runners in the `sv-tests` tool collection

The database does not contain a project-specific OpenLane configuration or a
Sky130 PDK path. Those must be generated only after selecting a top module,
its RTL source set, clock/reset constraints, and target PDK. The adapter audit
reports these gaps without modifying the master database.
