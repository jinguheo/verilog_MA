// Sample Test 4, phase 1 RTL: packages plus the two rtl/common modules that
// are not covered by the OpenTitan prim library.
//
// The rest of the planned rtl/common layer (reset_sync, sync_2ff, cdc_pulse,
// cdc_data_handshake, async_fifo, sync_fifo, arb_rr, crc32, ecc_secded) is
// reused from prim and therefore appears in prim.f, not here. See
// tb/prim_reuse_smoke.sv for the elaboration gate that proves the mapping.
//
// $DAQ_ROOT is set by the scripts under scripts/.

-f $DAQ_ROOT/filelist/pkg.f

$DAQ_ROOT/rtl/common/skid_buffer.sv
$DAQ_ROOT/rtl/common/cnt_sat.sv
