v {xschem version=3.4.5 file_version=1.2
}
G {}
K {}
V {}
S {}
E {}
T {Minimal balanced n-type switch with 1.8V enable} -150 -110 0 0 0.4 0.4 {}
N -240 50 -190 50 {
lab=on}
N 350 50 410 50 {
lab=out}
N 350 70 410 70 {
lab=in}
N -70 250 -30 250 {
lab=dvdd}
N -10 50 50 50 {
lab=#net1}
N -110 50 -90 50 {
lab=#net2}
N -10 50 -10 80 {
lab=#net1}
N -110 80 -10 80 {
lab=#net1}
N -110 80 -110 110 {
lab=#net1}
N -110 110 -90 110 {
lab=#net1}
N -10 110 10 110 {
lab=#net3}
N 10 70 10 110 {
lab=#net3}
N 10 70 50 70 {
lab=#net3}
N 350 90 410 90 {
lab=avdd}
N 350 110 410 110 {
lab=avss}
N -70 270 -30 270 {
lab=dvss}
N -210 -10 -170 -10 {
lab=on}
N -210 -10 -210 50 {
lab=on}
C {lsbuflv2hv_1.sym} -150 50 0 0 {name=x2 LVPWR=dvdd VGND=dvss VNB=dvss VPB=avdd VPWR=avdd prefix=sky130_fd_sc_hvl__ }
C {devices/ipin.sym} -240 50 0 0 {name=p1 lab=on}
C {devices/iopin.sym} 410 50 0 0 {name=p3 lab=out}
C {devices/iopin.sym} 410 70 0 0 {name=p4 lab=in}
C {devices/iopin.sym} 410 90 0 0 {name=p5 lab=avdd}
C {devices/iopin.sym} -30 250 0 0 {name=p6 lab=dvdd}
C {devices/iopin.sym} -30 270 0 0 {name=p7 lab=dvss}
C {devices/lab_pin.sym} -70 250 0 0 {name=p8 sig_type=std_logic lab=dvdd}
C {sky130_stdcells/inv_2.sym} -50 50 0 0 {name=x1 VGND=dvss VNB=dvss VPB=avdd VPWR=avdd prefix=sky130_fd_sc_hvl__ }
C {sky130_stdcells/inv_2.sym} -50 110 0 0 {name=x4 VGND=dvss VNB=dvss VPB=avdd VPWR=avdd prefix=sky130_fd_sc_hvl__ }
C {sky130_stdcells/decap_4.sym} -80 -50 0 0 {name=x6 VGND=dvss VNB=dvss VPB=avdd VPWR=avdd prefix=sky130_fd_sc_hvl__}
C {minimum_analog_switch.sym} 200 70 0 0 {name=x3}
C {devices/iopin.sym} 410 110 0 0 {name=p2 lab=avss}
C {devices/lab_pin.sym} -70 270 0 0 {name=p9 sig_type=std_logic lab=dvss}
C {sky130_stdcells/diode_2.sym} -80 -10 0 0 {name=x5 VGND=dvss VNB=dvss VPB=avdd VPWR=avdd prefix=sky130_fd_sc_hvl__ }
