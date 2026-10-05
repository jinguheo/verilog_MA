# Copyright 2020-2022 Efabless Corporation
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#      http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

source $::env(SCRIPTS_DIR)/openroad/common/set_global_connections.tcl
set_global_connections

set secondary []
foreach vdd $::env(VDD_NETS) gnd $::env(GND_NETS) {
    if { $vdd != $::env(VDD_NET)} {
        lappend secondary $vdd

        set db_net [[ord::get_db_block] findNet $vdd]
        if {$db_net == "NULL"} {
            set net [odb::dbNet_create [ord::get_db_block] $vdd]
            $net setSpecial
            $net setSigType "POWER"
        }
    }

    if { $gnd != $::env(GND_NET)} {
        lappend secondary $gnd

        set db_net [[ord::get_db_block] findNet $gnd]
        if {$db_net == "NULL"} {
            set net [odb::dbNet_create [ord::get_db_block] $gnd]
            $net setSpecial
            $net setSigType "GROUND"
        }
    }
}

set_voltage_domain -name CORE -power $::env(VDD_NET) -ground $::env(GND_NET) \
    -secondary_power $secondary

if { $::env(FP_PDN_MULTILAYER) == 1 } {
    define_pdn_grid \
        -name stdcell_grid \
        -starts_with POWER \
        -voltage_domain CORE \
        -pins "$::env(FP_PDN_VERTICAL_LAYER) $::env(FP_PDN_HORIZONTAL_LAYER)"

    add_pdn_stripe \
        -grid stdcell_grid \
        -layer $::env(FP_PDN_VERTICAL_LAYER) \
        -width $::env(FP_PDN_VWIDTH) \
        -pitch $::env(FP_PDN_VPITCH) \
        -offset $::env(FP_PDN_VOFFSET) \
        -spacing $::env(FP_PDN_VSPACING) \
        -starts_with POWER -extend_to_core_ring

    add_pdn_stripe \
        -grid stdcell_grid \
        -layer $::env(FP_PDN_HORIZONTAL_LAYER) \
        -width $::env(FP_PDN_HWIDTH) \
        -pitch $::env(FP_PDN_HPITCH) \
        -offset $::env(FP_PDN_HOFFSET) \
        -spacing $::env(FP_PDN_HSPACING) \
        -starts_with POWER -extend_to_core_ring

    add_pdn_connect \
        -grid stdcell_grid \
        -layers "$::env(FP_PDN_VERTICAL_LAYER) $::env(FP_PDN_HORIZONTAL_LAYER)"
} else {
    define_pdn_grid \
        -name stdcell_grid \
        -starts_with POWER \
        -voltage_domain CORE \
        -pins $::env(FP_PDN_VERTICAL_LAYER)

    add_pdn_stripe \
        -grid stdcell_grid \
        -layer $::env(FP_PDN_VERTICAL_LAYER) \
        -width $::env(FP_PDN_VWIDTH) \
        -pitch $::env(FP_PDN_VPITCH) \
        -offset $::env(FP_PDN_VOFFSET) \
        -spacing $::env(FP_PDN_VSPACING) \
        -starts_with POWER -extend_to_core_ring
}

# Adds the standard cell rails if enabled.
if { $::env(FP_PDN_ENABLE_RAILS) == 1 } {
    add_pdn_stripe \
        -grid stdcell_grid \
        -layer $::env(FP_PDN_RAIL_LAYER) \
        -width $::env(FP_PDN_RAIL_WIDTH) \
        -followpins \
        -starts_with POWER

    add_pdn_connect \
        -grid stdcell_grid \
        -layers "$::env(FP_PDN_RAIL_LAYER) $::env(FP_PDN_VERTICAL_LAYER)"
}


# Adds the core ring if enabled.
if { $::env(FP_PDN_CORE_RING) == 1 } {
    if { $::env(FP_PDN_MULTILAYER) == 1 } {
        add_pdn_ring \
            -grid stdcell_grid \
            -layers "$::env(FP_PDN_VERTICAL_LAYER) $::env(FP_PDN_HORIZONTAL_LAYER)" \
            -widths "$::env(FP_PDN_CORE_RING_VWIDTH) $::env(FP_PDN_CORE_RING_HWIDTH)" \
            -spacings "$::env(FP_PDN_CORE_RING_VSPACING) $::env(FP_PDN_CORE_RING_HSPACING)" \
            -core_offset "$::env(FP_PDN_CORE_RING_VOFFSET) $::env(FP_PDN_CORE_RING_HOFFSET)"
    } else {
        throw APPLICATION "FP_PDN_CORE_RING cannot be used when FP_PDN_MULTILAYER is set to false."
        # add_pdn_ring \
        #     -grid stdcell_grid \
        #     -layers "$::env(FP_PDN_VERTICAL_LAYER)" \
        #     -widths "$::env(FP_PDN_CORE_RING_VWIDTH)" \
        #     -spacings "$::env(FP_PDN_CORE_RING_VSPACING)" \
        #     -core_offset "$::env(FP_PDN_CORE_RING_VOFFSET)"
    }
}

# ---- PPA3 custom macro grids (2026-10-05) -------------------------------------------------------------------------
# Default config: one generic macro grid that only joins met4/met5. The SRAM22 macro has its power pins (vdd/vss) as a met2 mesh
# with only met1/met2 obstructions, so the core met4/met5 straps have to be tied down through via3/via2 (met4-met3-met2).
set H $::env(FP_PDN_HORIZONTAL_HALO)
set V $::env(FP_PDN_VERTICAL_HALO)

define_pdn_grid -macro -instances {u_capture_path.u_capture.u_capture_sram.u_sram22} -name sram_grid -starts_with POWER -halo "$H $V"
add_pdn_connect -grid sram_grid -layers {met2 met4}
add_pdn_connect -grid sram_grid -layers {met4 met5}

define_pdn_grid -macro -instances {u_adc} -name adc_grid -starts_with POWER -halo "$H $V"
add_pdn_connect -grid adc_grid -layers {met4 met5} -fixed_vias {M4M5_PR}
