v {xschem version=3.4.5 file_version=1.2
}
G {}
K {}
V {}
S {}
E {}
T {Isolated switch} 1140 -1260 0 0 0.4 0.4 {}
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
N 1460 -920 1500 -920 {
lab=#net1}
N 1370 -920 1400 -920 {
lab=#net1}
N 1370 -1110 1370 -920 {
lab=#net1}
N 1370 -1110 1400 -1110 {
lab=#net1}
N 1460 -1110 1500 -1110 {
lab=#net1}
N 1560 -1110 1600 -1110 {
lab=out}
N 1660 -1110 1700 -1110 {
lab=out}
N 1700 -1110 1700 -920 {
lab=out}
N 1660 -920 1700 -920 {
lab=out}
N 1560 -920 1600 -920 {
lab=out}
N 1480 -1110 1480 -920 {
lab=#net1}
N 1580 -1110 1580 -920 {
lab=out}
N 1580 -1020 1700 -1020 {
lab=out}
N 1370 -1020 1480 -1020 {
lab=#net1}
N 1310 -1020 1370 -1020 {
lab=#net1}
N 1700 -1020 1750 -1020 {
lab=out}
N 1430 -1110 1430 -1060 {
lab=vss}
N 1430 -1060 1630 -1060 {
lab=vss}
N 1630 -1110 1630 -1060 {
lab=vss}
N 1530 -1060 1530 -920 {
lab=vss}
N 1300 -1060 1430 -1060 {
lab=vss}
N 1430 -960 1430 -920 {
lab=vdd}
N 1430 -960 1630 -960 {
lab=vdd}
N 1630 -960 1630 -920 {
lab=vdd}
N 1300 -960 1430 -960 {
lab=vdd}
N 1550 -1080 1550 -960 {
lab=vdd}
N 1530 -1080 1550 -1080 {
lab=vdd}
N 1530 -1110 1530 -1080 {
lab=vdd}
N 1430 -1190 1430 -1150 {
lab=off}
N 1430 -1190 1630 -1190 {
lab=off}
N 1630 -1190 1630 -1150 {
lab=off}
N 1530 -1190 1530 -1150 {
lab=off}
N 1430 -880 1430 -840 {
lab=on}
N 1430 -840 1630 -840 {
lab=on}
N 1630 -880 1630 -840 {
lab=on}
N 1530 -880 1530 -840 {
lab=on}
N 1300 -1020 1310 -1020 {
lab=#net1}
N 1170 -1020 1300 -1020 {
lab=#net1}
N 1050 -960 1300 -960 {
lab=vdd}
N 1050 -1060 1300 -1060 {
lab=vss}
N 1250 -1020 1250 -910 {
lab=#net1}
N 1250 -910 1250 -830 {
lab=#net1}
N 1250 -770 1250 -740 {
lab=vss}
N 1200 -740 1250 -740 {
lab=vss}
N 1200 -800 1250 -800 {
lab=vss}
N 1200 -800 1200 -740 {
lab=vss}
N 1290 -800 1330 -800 {
lab=off}
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
C {sky130_fd_pr/nfet_g5v0d10v5.sym} 1530 -900 3 0 {name=M11
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
C {sky130_fd_pr/pfet_g5v0d10v5.sym} 1530 -1130 1 0 {name=M12
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
C {sky130_fd_pr/nfet_g5v0d10v5.sym} 1630 -1130 1 0 {name=M13
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
C {sky130_fd_pr/pfet_g5v0d10v5.sym} 1630 -900 3 0 {name=M14
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
C {sky130_fd_pr/nfet_g5v0d10v5.sym} 1430 -1130 1 0 {name=M15
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
C {sky130_fd_pr/pfet_g5v0d10v5.sym} 1430 -900 3 0 {name=M16
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
C {devices/lab_pin.sym} 1630 -1190 0 1 {name=l3 sig_type=std_logic lab=off}
C {devices/lab_pin.sym} 1630 -840 0 1 {name=l7 sig_type=std_logic lab=on}
C {sky130_fd_pr/nfet_g5v0d10v5.sym} 1270 -800 2 0 {name=M17
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
C {devices/lab_pin.sym} 1200 -740 0 0 {name=p2 sig_type=std_logic lab=vss}
C {devices/lab_pin.sym} 1330 -800 0 1 {name=p5 sig_type=std_logic lab=off}
C {devices/iopin.sym} 1750 -1020 0 0 {name=p8 lab=out}
C {devices/iopin.sym} 720 -960 0 1 {name=p9 lab=vdd}
C {devices/iopin.sym} 720 -1060 0 1 {name=p10 lab=vss}
C {devices/iopin.sym} 720 -1020 0 1 {name=p11 lab=in}
C {devices/ipin.sym} 800 -1190 0 0 {name=p3 lab=off}
