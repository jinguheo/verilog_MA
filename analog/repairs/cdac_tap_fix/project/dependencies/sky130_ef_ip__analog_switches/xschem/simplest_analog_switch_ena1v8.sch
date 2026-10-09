v {xschem version=3.4.5 file_version=1.2
}
G {}
K {}
V {}
S {}
E {}
T {Simple balanced switch with 1.8V enable} -150 -110 0 0 0.4 0.4 {}
N 10 30 50 30 {
lab=#net1}
N -240 50 -190 50 {
lab=on}
N 350 30 380 30 {
lab=avss}
N 380 -10 380 30 {
lab=avss}
N 380 -10 410 -10 {
lab=avss}
N 350 50 410 50 {
lab=out}
N 350 70 410 70 {
lab=in}
N 350 90 380 90 {
lab=avdd}
N 380 90 380 120 {
lab=avdd}
N 380 120 410 120 {
lab=avdd}
N -70 250 -30 250 {
lab=dvdd}
N -10 -10 10 -10 {
lab=#net1}
N 10 -10 10 30 {
lab=#net1}
N -10 50 50 50 {
lab=#net2}
N -110 50 -90 50 {
lab=#net3}
N -110 -10 -90 -10 {
lab=#net2}
N -10 20 -10 50 {
lab=#net2}
N -110 20 -10 20 {
lab=#net2}
N -110 -10 -110 20 {
lab=#net2}
N -210 50 -210 130 {
lab=on}
N -70 270 -30 270 {
lab=dvss}
C {lsbuflv2hv_1.sym} -150 50 0 0 {name=x2 LVPWR=dvdd VGND=dvss VNB=dvss VPB=avdd VPWR=avdd prefix=sky130_fd_sc_hvl__ }
C {devices/ipin.sym} -240 50 0 0 {name=p1 lab=on}
C {devices/iopin.sym} 410 -10 0 0 {name=p2 lab=avss}
C {devices/iopin.sym} 410 50 0 0 {name=p3 lab=out}
C {devices/iopin.sym} 410 70 0 0 {name=p4 lab=in}
C {devices/iopin.sym} 410 120 0 0 {name=p5 lab=avdd}
C {devices/iopin.sym} -30 250 0 0 {name=p6 lab=dvdd}
C {devices/iopin.sym} -30 270 0 0 {name=p7 lab=dvss}
C {devices/lab_pin.sym} -70 250 0 0 {name=p8 sig_type=std_logic lab=dvdd}
C {simple_analog_switch_2.sym} 200 60 0 0 {name=x3}
C {sky130_stdcells/inv_2.sym} -50 50 0 0 {name=x1 VGND=dvss VNB=dvss VPB=avdd VPWR=avdd prefix=sky130_fd_sc_hvl__ }
C {sky130_stdcells/inv_2.sym} -50 -10 0 0 {name=x4 VGND=dvss VNB=dvss VPB=avdd VPWR=avdd prefix=sky130_fd_sc_hvl__ }
C {sky130_stdcells/decap_4.sym} -70 200 0 0 {name=x5[1:0] VGND=dvss VNB=dvss VPB=avdd VPWR=avdd prefix=sky130_fd_sc_hvl__}
C {sky130_stdcells/diode_2.sym} -120 130 0 0 {name=x5 VGND=dvss VNB=dvss VPB=avdd VPWR=avdd prefix=sky130_fd_sc_hvl__ }
C {devices/lab_pin.sym} -70 270 0 0 {name=p9 sig_type=std_logic lab=dvss}
