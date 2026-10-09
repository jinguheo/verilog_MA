v {xschem version=3.4.5 file_version=1.2
}
G {}
K {}
V {}
S {}
E {}
T {Isolated switch} 980 -1260 0 0 0.4 0.4 {}
N 900 -1110 900 -920 {
lab=in}
N 1000 -1110 1000 -920 {
lab=#net1}
N 790 -1020 900 -1020 {
lab=in}
N 730 -1020 790 -1020 {
lab=in}
N 950 -1190 950 -1150 {
lab=off}
N 950 -880 950 -840 {
lab=on}
N 720 -1020 730 -1020 {
lab=in}
N 1120 -1110 1120 -920 {
lab=#net1}
N 1220 -1110 1220 -920 {
lab=out}
N 1220 -1020 1340 -1020 {
lab=out}
N 1340 -1020 1390 -1020 {
lab=out}
N 1170 -1190 1170 -1150 {
lab=off}
N 1170 -880 1170 -840 {
lab=on}
N 1060 -770 1060 -740 {
lab=vss}
N 1010 -740 1060 -740 {
lab=vss}
N 1010 -800 1060 -800 {
lab=vss}
N 1010 -800 1010 -740 {
lab=vss}
N 1100 -800 1140 -800 {
lab=shunt}
N 800 -1190 950 -1190 {
lab=off}
N 800 -840 950 -840 {
lab=on}
N 980 -920 1000 -920 {
lab=#net1}
N 980 -1110 1000 -1110 {
lab=#net1}
N 900 -1110 920 -1110 {
lab=in}
N 900 -920 920 -920 {
lab=in}
N 1170 -840 1270 -840 {
lab=on}
N 1200 -920 1220 -920 {
lab=out}
N 1120 -920 1140 -920 {
lab=#net1}
N 1200 -1110 1220 -1110 {
lab=out}
N 1120 -1110 1140 -1110 {
lab=#net1}
N 1000 -1020 1120 -1020 {
lab=#net1}
N 1060 -1020 1060 -830 {
lab=#net1}
N 720 -960 1170 -960 {
lab=vss}
N 1170 -960 1170 -920 {
lab=vss}
N 720 -1060 1170 -1060 {
lab=vdd}
N 1170 -1110 1170 -1060 {
lab=vdd}
N 950 -1110 950 -1060 {
lab=vdd}
N 950 -960 950 -920 {
lab=vss}
N 950 -1190 1170 -1190 {
lab=off}
C {sky130_fd_pr/nfet_g5v0d10v5.sym} 950 -900 3 0 {name=M1
L=0.5
W=12
nf=6
mult=1
ad="'int((nf+1)/2) * W/nf * 0.29'" 
pd="'2*int((nf+1)/2) * (W/nf + 0.29)'"
as="'int((nf+2)/2) * W/nf * 0.29'" 
ps="'2*int((nf+2)/2) * (W/nf + 0.29)'"
nrd="'0.29 / W'" nrs="'0.29 / W'"
sa=0 sb=0 sd=0
model=nfet_g5v0d10v5
spiceprefix=X
}
C {sky130_fd_pr/pfet_g5v0d10v5.sym} 950 -1130 1 0 {name=M2
L=0.5
W=24
nf=12
mult=1
ad="'int((nf+1)/2) * W/nf * 0.29'" 
pd="'2*int((nf+1)/2) * (W/nf + 0.29)'"
as="'int((nf+2)/2) * W/nf * 0.29'" 
ps="'2*int((nf+2)/2) * (W/nf + 0.29)'"
nrd="'0.29 / W'" nrs="'0.29 / W'"
sa=0 sb=0 sd=0
model=pfet_g5v0d10v5
spiceprefix=X
}
C {devices/ipin.sym} 800 -840 0 0 {name=p6 lab=on}
C {sky130_fd_pr/nfet_g5v0d10v5.sym} 1170 -900 3 0 {name=M11
L=0.5
W=12
nf=6
mult=1
ad="'int((nf+1)/2) * W/nf * 0.29'" 
pd="'2*int((nf+1)/2) * (W/nf + 0.29)'"
as="'int((nf+2)/2) * W/nf * 0.29'" 
ps="'2*int((nf+2)/2) * (W/nf + 0.29)'"
nrd="'0.29 / W'" nrs="'0.29 / W'"
sa=0 sb=0 sd=0
model=nfet_g5v0d10v5
spiceprefix=X
}
C {sky130_fd_pr/pfet_g5v0d10v5.sym} 1170 -1130 1 0 {name=M12
L=0.5
W=24
nf=12
mult=1
ad="'int((nf+1)/2) * W/nf * 0.29'" 
pd="'2*int((nf+1)/2) * (W/nf + 0.29)'"
as="'int((nf+2)/2) * W/nf * 0.29'" 
ps="'2*int((nf+2)/2) * (W/nf + 0.29)'"
nrd="'0.29 / W'" nrs="'0.29 / W'"
sa=0 sb=0 sd=0
model=pfet_g5v0d10v5
spiceprefix=X
}
C {devices/lab_pin.sym} 1270 -840 0 1 {name=l7 sig_type=std_logic lab=on}
C {sky130_fd_pr/nfet_g5v0d10v5.sym} 1080 -800 2 0 {name=M17
L=0.5
W=1
nf=1
mult=1
ad="'int((nf+1)/2) * W/nf * 0.29'" 
pd="'2*int((nf+1)/2) * (W/nf + 0.29)'"
as="'int((nf+2)/2) * W/nf * 0.29'" 
ps="'2*int((nf+2)/2) * (W/nf + 0.29)'"
nrd="'0.29 / W'" nrs="'0.29 / W'"
sa=0 sb=0 sd=0
model=nfet_g5v0d10v5
spiceprefix=X
}
C {devices/lab_pin.sym} 1010 -740 0 0 {name=p2 sig_type=std_logic lab=vss}
C {devices/iopin.sym} 1390 -1020 0 0 {name=p8 lab=out}
C {devices/iopin.sym} 720 -1060 0 1 {name=p9 lab=vdd}
C {devices/iopin.sym} 720 -960 0 1 {name=p10 lab=vss}
C {devices/iopin.sym} 720 -1020 0 1 {name=p11 lab=in}
C {devices/ipin.sym} 800 -1190 0 0 {name=p3 lab=off}
C {devices/ipin.sym} 1140 -800 0 1 {name=p1 lab=shunt}
