// Source: D:\MyWork\verilog\dbs\sv-tests\tests\chapter-11\simple\11.4.11--simple_cond_op-sim.sv
// Copyright (C) 2019-2021 The SymbiFlow Authors. SPDX-License-Identifier: ISC
// Canonical file name for the top module, retained for strict linting.
module top(input a, output b);
  assign b = (a) ? 0 : 1;
endmodule
