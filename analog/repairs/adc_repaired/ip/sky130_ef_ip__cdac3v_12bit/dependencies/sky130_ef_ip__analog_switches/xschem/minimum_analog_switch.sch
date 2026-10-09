v {xschem version=3.4.5 file_version=1.2
}
G {}
K {}
V {}
S {}
E {}
T {Minimal one-sided balanced analog switch} 770 -1310 0 0 0.4 0.4 {}
T {Intended for use with the "in" side connected to low voltage (such as ground)} 610 -1270 0 0 0.4 0.4 {}
N 980 -1110 1020 -1110 {
lab=out}
N 850 -960 1050 -960 {
lab=vss}
N 950 -1110 950 -960 {
lab=vss}
N 1050 -1110 1050 -960 {
lab=vss}
N 1050 -1180 1120 -1180 {
lab=off}
N 1000 -1110 1000 -1020 {
lab=out}
N 1080 -1110 1170 -1110 {
lab=out}
N 1000 -1020 1110 -1020 {
lab=out}
N 1110 -1110 1110 -1020 {
lab=out}
N 830 -1210 950 -1210 {
lab=on}
N 890 -1110 920 -1110 {
lab=in}
N 900 -1110 900 -1020 {
lab=in}
N 810 -1020 900 -1020 {
lab=in}
N 810 -1110 810 -1020 {
lab=in}
N 740 -1110 830 -1110 {
lab=in}
N 860 -1110 860 -960 {
lab=vss}
N 860 -1180 860 -1150 {
lab=off}
N 860 -1180 1050 -1180 {
lab=off}
N 1050 -1180 1050 -1150 {
lab=off}
N 950 -1210 950 -1150 {
lab=on}
N 850 -920 890 -920 {
lab=vdd}
C {devices/ipin.sym} 830 -1210 0 0 {name=p6 lab=on}
C {devices/iopin.sym} 1170 -1110 0 0 {name=p8 lab=out}
C {devices/iopin.sym} 850 -960 0 1 {name=p9 lab=vss}
C {devices/iopin.sym} 740 -1110 0 1 {name=p11 lab=in}
C {devices/ipin.sym} 1120 -1180 0 1 {name=p3 lab=off}
C {sky130_fd_pr/nfet_g5v0d10v5.sym} 860 -1130 1 0 {name=M3
W=0.5
L=0.5
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
C {sky130_fd_pr/nfet_g5v0d10v5.sym} 1050 -1130 1 0 {name=M1
W=0.5
L=0.5
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
C {sky130_fd_pr/nfet_g5v0d10v5.sym} 950 -1130 1 0 {name=M4
W=1
L=0.5
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
C {devices/iopin.sym} 850 -920 0 1 {name=p1 lab=vdd}
C {devices/noconn.sym} 890 -920 0 1 {name=l1}
