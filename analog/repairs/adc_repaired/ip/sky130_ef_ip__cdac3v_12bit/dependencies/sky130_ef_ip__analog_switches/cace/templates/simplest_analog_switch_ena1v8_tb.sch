v {xschem version=3.4.5 file_version=1.2
}
G {}
K {}
V {}
S {}
E {}
B 2 2090 420 2890 820 {flags=graph
y1=0
y2=3.3
ypos1=0
ypos2=2
divy=5
subdivy=4
unity=1
x1=0
x2=3.3
divx=5
subdivx=4
xlabmag=1.0
ylabmag=1.0
dataset=-1
unitx=1
logx=0
logy=0
node="out
on
in
dvss
dvdd
avss
avdd"
rainbow=1
color="4 5 6 7 8 9 10"}
B 2 2090 840 2890 1240 {flags=graph
y1=-0.0028
y2=6.3e-12
ypos1=0
ypos2=2
divy=5
subdivy=4
unity=1
x1=0
x2=3.3
divx=5
subdivx=4
xlabmag=1.0
ylabmag=1.0
dataset=-1
unitx=1
logx=0
logy=0

color="8 4 4 4 4 4"
node="i(vin)"}
B 2 60 660 860 1060 {flags=graph
y1=53
y2=320
ypos1=0
ypos2=2
divy=5
subdivy=4
unity=1
x1=0
x2=3.3
divx=5
subdivx=4
xlabmag=1.0
ylabmag=1.0
dataset=-1
unitx=1
logx=0
logy=0


color=4
node=r_switch}
N 50 150 50 170 {
lab=GND}
N 50 50 50 90 {
lab=DVSS}
N 130 150 130 170 {
lab=GND}
N 50 170 50 190 {
lab=GND}
N 130 50 130 90 {
lab=DVDD}
N 50 170 130 170 {
lab=GND}
N 210 150 210 170 {
lab=GND}
N 210 50 210 90 {
lab=AVSS}
N 290 150 290 170 {
lab=GND}
N 290 50 290 90 {
lab=AVDD}
N 370 150 370 170 {
lab=GND}
N 370 50 370 90 {
lab=ON}
N 130 170 210 170 {
lab=GND}
N 210 170 290 170 {
lab=GND}
N 290 170 370 170 {
lab=GND}
N 160 270 160 310 {
lab=IN}
N 160 370 160 410 {
lab=GND}
N 260 370 260 410 {
lab=GND}
N 260 270 260 310 {
lab=OUT}
C {simplest_analog_switch_ena1v8.sym} 570 360 0 0 {name=x1}
C {devices/vsource.sym} 50 120 0 0 {name=V0 value=0 savecurrent=false}
C {devices/gnd.sym} 50 190 0 0 {name=l3 lab=GND}
C {devices/vsource.sym} 130 120 0 0 {name=V2 value=CACE\{dvdd\} savecurrent=false}
C {devices/lab_wire.sym} 50 50 0 0 {name=p1 sig_type=std_logic lab=DVSS}
C {devices/lab_wire.sym} 130 50 0 0 {name=p5 sig_type=std_logic lab=DVDD}
C {devices/launcher.sym} 500 520 0 0 {name=h1
descr="Annotate OP" 
tclcommand="set show_hidden_texts 1; xschem annotate_op"
}
C {devices/launcher.sym} 500 560 0 0 {name=h2
descr="Load waves DC" 
tclcommand="
xschem raw_read $netlist_dir/[file tail [file rootname [xschem get current_name]]].raw dc
"
}
C {devices/vsource.sym} 210 120 0 0 {name=V1 value=0 savecurrent=false}
C {devices/vsource.sym} 290 120 0 0 {name=V3 value=CACE\{avdd\} savecurrent=false}
C {devices/lab_wire.sym} 210 50 0 0 {name=p2 sig_type=std_logic lab=AVSS}
C {devices/lab_wire.sym} 290 50 0 0 {name=p3 sig_type=std_logic lab=AVDD}
C {devices/lab_wire.sym} 720 330 0 1 {name=p4 sig_type=std_logic lab=DVSS}
C {devices/lab_wire.sym} 720 310 0 1 {name=p6 sig_type=std_logic lab=DVDD}
C {devices/lab_wire.sym} 720 350 0 1 {name=p7 sig_type=std_logic lab=AVSS}
C {devices/lab_wire.sym} 720 410 0 1 {name=p8 sig_type=std_logic lab=AVDD}
C {devices/vsource.sym} 370 120 0 0 {name=V4 value="CACE[CACE\{dvdd\} * CACE\{enable\}]" savecurrent=false}
C {devices/lab_wire.sym} 370 50 0 0 {name=p9 sig_type=std_logic lab=ON}
C {devices/code_shown.sym} 1000 140 0 0 {name=SETUP
simulator=ngspice
only_toplevel=false
value="
.lib CACE\{PDK_ROOT\}/CACE\{PDK\}/libs.tech/combined/sky130.lib.spice CACE\{corner\}

.include CACE\{PDK_ROOT\}/CACE\{PDK\}/libs.ref/sky130_fd_sc_hvl/spice/sky130_fd_sc_hvl.spice

.include CACE\{DUT_path\}

.temp CACE\{temperature\}
"}
C {devices/code_shown.sym} 1000 360 0 0 {name=CONTROL
simulator=ngspice
only_toplevel=false
value="
.control
    *save all

    * run op
    *op
    *write simplest_analog_switch_ena1v8_tb.raw
    *set appendwrite

    * run dc simulation
    dc vin 0 CACE\{avdd\} CACE\{step\}
    let r_switch = (v(in)-v(out))/-i(vin)

    meas DC r_switch_max max r_switch

    *write simplest_analog_switch_ena1v8_tb.raw

    echo $&r_switch_max > CACE\{simpath\}/CACE\{filename\}_CACE\{N\}.data
.endc
"}
C {devices/vsource.sym} 160 340 0 0 {name=VIN value="ac 1" savecurrent=false}
C {devices/lab_wire.sym} 160 270 0 0 {name=p10 sig_type=std_logic lab=IN}
C {devices/gnd.sym} 160 410 0 0 {name=l1 lab=GND}
C {devices/lab_wire.sym} 420 310 0 0 {name=p11 sig_type=std_logic lab=ON}
C {devices/lab_wire.sym} 260 270 0 0 {name=p12 sig_type=std_logic lab=OUT}
C {devices/res.sym} 260 340 0 0 {name=R1
value=1k
footprint=1206
device=resistor
m=1}
C {devices/gnd.sym} 260 410 0 0 {name=l2 lab=GND}
C {devices/lab_wire.sym} 720 390 0 1 {name=p13 sig_type=std_logic lab=IN}
C {devices/lab_wire.sym} 720 370 0 1 {name=p14 sig_type=std_logic lab=OUT}
