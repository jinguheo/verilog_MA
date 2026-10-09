v {xschem version=3.4.5 file_version=1.2
}
G {}
K {}
V {}
S {}
E {}
T {Simple analog switch} 760 -1290 0 0 0.4 0.4 {}
N 900 -1110 900 -920 {
lab=in}
N 1000 -1110 1000 -920 {
lab=out}
N 1000 -1020 1120 -1020 {
lab=out}
N 790 -1020 900 -1020 {
lab=in}
N 730 -1020 790 -1020 {
lab=in}
N 1120 -1020 1170 -1020 {
lab=out}
N 950 -1190 950 -1150 {
lab=off}
N 950 -880 950 -840 {
lab=on}
N 720 -1020 730 -1020 {
lab=in}
N 980 -1110 1000 -1110 {
lab=out}
N 800 -1190 950 -1190 {
lab=off}
N 800 -840 950 -840 {
lab=on}
N 980 -920 1000 -920 {
lab=out}
N 900 -920 920 -920 {
lab=in}
N 900 -1110 920 -1110 {
lab=in}
N 720 -1060 950 -1060 {
lab=vdd}
N 950 -1110 950 -1060 {
lab=vdd}
N 720 -960 950 -960 {
lab=vss}
N 950 -960 950 -920 {
lab=vss}
C {sky130_fd_pr/nfet_g5v0d10v5.sym} 950 -900 3 0 {name=M1
L=0.5
W=20
nf=4
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
W=40
nf=8
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
C {devices/iopin.sym} 720 -1060 0 1 {name=p9 lab=vdd}
C {devices/iopin.sym} 720 -960 0 1 {name=p10 lab=vss}
C {devices/iopin.sym} 720 -1020 0 1 {name=p11 lab=in}
C {devices/ipin.sym} 800 -1190 0 0 {name=p3 lab=off}
