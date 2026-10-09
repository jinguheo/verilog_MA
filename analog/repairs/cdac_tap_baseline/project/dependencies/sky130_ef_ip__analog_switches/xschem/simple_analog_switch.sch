v {xschem version=3.4.5 file_version=1.2
}
G {}
K {}
V {}
S {}
E {}
T {Simple balanced analog switch} 760 -1290 0 0 0.4 0.4 {}
N 880 -920 920 -920 {
lab=in}
N 790 -920 820 -920 {
lab=in}
N 790 -1110 790 -920 {
lab=in}
N 790 -1110 820 -1110 {
lab=in}
N 880 -1110 920 -1110 {
lab=in}
N 980 -1110 1020 -1110 {
lab=#net1}
N 1080 -1110 1120 -1110 {
lab=#net1}
N 1120 -1110 1120 -920 {
lab=#net1}
N 1080 -920 1120 -920 {
lab=#net1}
N 980 -920 1020 -920 {
lab=#net1}
N 900 -1110 900 -920 {
lab=in}
N 1000 -1110 1000 -920 {
lab=#net1}
N 1000 -1020 1120 -1020 {
lab=#net1}
N 790 -1020 900 -1020 {
lab=in}
N 730 -1020 790 -1020 {
lab=in}
N 1120 -1020 1170 -1020 {
lab=#net1}
N 850 -1110 850 -1060 {
lab=vss}
N 850 -1060 1050 -1060 {
lab=vss}
N 1050 -1110 1050 -1060 {
lab=vss}
N 950 -1060 950 -920 {
lab=vss}
N 720 -1060 850 -1060 {
lab=vss}
N 850 -960 850 -920 {
lab=vdd}
N 850 -960 1050 -960 {
lab=vdd}
N 1050 -960 1050 -920 {
lab=vdd}
N 720 -960 850 -960 {
lab=vdd}
N 970 -1080 970 -960 {
lab=vdd}
N 950 -1080 970 -1080 {
lab=vdd}
N 950 -1110 950 -1080 {
lab=vdd}
N 850 -1190 850 -1150 {
lab=off}
N 850 -1190 1050 -1190 {
lab=off}
N 1050 -1190 1050 -1150 {
lab=off}
N 950 -1190 950 -1150 {
lab=off}
N 850 -880 850 -840 {
lab=on}
N 850 -840 1050 -840 {
lab=on}
N 1050 -880 1050 -840 {
lab=on}
N 950 -880 950 -840 {
lab=on}
N 720 -1020 730 -1020 {
lab=in}
N 800 -840 850 -840 {
lab=on}
N 800 -1190 850 -1190 {
lab=off}
C {sky130_fd_pr/nfet_g5v0d10v5.sym} 950 -900 3 0 {name=M1
L=0.5
W=4
nf=2
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
W=8
nf=4
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
C {sky130_fd_pr/nfet_g5v0d10v5.sym} 1050 -1130 1 0 {name=M3
L=0.5
W=2
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
C {sky130_fd_pr/pfet_g5v0d10v5.sym} 1050 -900 3 0 {name=M4
L=0.5
W=4
nf=2
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
C {sky130_fd_pr/nfet_g5v0d10v5.sym} 850 -1130 1 0 {name=M5
L=0.5
W=2
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
C {sky130_fd_pr/pfet_g5v0d10v5.sym} 850 -900 3 0 {name=M6
L=0.5
W=4
nf=2
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
C {devices/iopin.sym} 1170 -1020 0 0 {name=p8 lab=out}
C {devices/iopin.sym} 720 -960 0 1 {name=p9 lab=vdd}
C {devices/iopin.sym} 720 -1060 0 1 {name=p10 lab=vss}
C {devices/iopin.sym} 720 -1020 0 1 {name=p11 lab=in}
C {devices/ipin.sym} 800 -1190 0 0 {name=p3 lab=off}
