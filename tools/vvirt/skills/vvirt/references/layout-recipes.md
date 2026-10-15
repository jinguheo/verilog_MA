# Layout recipes (taken from runs recorded in the dashboard VB tab)

```
; look up and place two cells abutted, second row flipped
vvCells("sky130_fd_sc_hd" "dfxtp_1")
list(vvGet(vvCellInfo("sky130_fd_sc_hd__nand2_1") "width") vvGet(vvCellInfo("sky130_fd_sc_hd__nand2_1") "height") vvGet(vvCellInfo("sky130_fd_sc_hd__dfxtp_1") "width"))   ; (1.38 2.72 7.36)
cv = dbOpenCellViewByType("testlib" "demo" "layout" "maskLayout" "w")
dbCreateParamInstByMasterName(cv "sky130_fd_sc_hd" "sky130_fd_sc_hd__nand2_1" "layout" "U_nand" list(0.0 0.0) "R0")
dbCreateParamInstByMasterName(cv "sky130_fd_sc_hd" "sky130_fd_sc_hd__dfxtp_1" "layout" "U_dff" list(1.38 0.0) "R0")
dbCreateParamInstByMasterName(cv "sky130_fd_sc_hd" "sky130_fd_sc_hd__nand2_1" "layout" "U_flip" list(0.0 5.44) "MX")   ; occupies y 2.72..5.44
dbSave(cv)
mapcar(lambda((i) list(i~>name i~>xy i~>orient i~>bBox)) cv~>instances)
```

```
; loop: four inverters in a row; then li1 jumpers from each Y pin to the next A pin
for(i 0 3 dbCreateParamInstByMasterName(cv "sky130_fd_sc_hd" "sky130_fd_sc_hd__inv_1" "layout" sprintf(nil "U%d" i) list(i*1.38 0.0) "R0"))
; read the pin centres first: vvGet(vvPin("sky130_fd_sc_hd__inv_1" "Y") "center"), then dbCreatePath(cv list("li1" "drawing") list(list x0 y0) list(...)) 0.17)
```

```
; modify: replace U2, shift U3 by the width difference, read back
cv = dbOpenCellViewByType("testlib" "chain" "layout" "maskLayout" "a")
foreach(s cv~>shapes when(s~>objType == "path" dbDeleteObject(s)))
foreach(i cv~>instances when(i~>name == "U2" dbDeleteObject(i)))
dbCreateParamInstByMasterName(cv "sky130_fd_sc_hd" "sky130_fd_sc_hd__inv_4" "layout" "U2" list(2.76 0.0) "R0")
dbMoveFig(car(setof(i cv~>instances i~>name == "U3")) cv list(0.92:0 "R0"))
```

```
; vias (vvViaDefs() lists the names)
dbCreateVia(cv techFindViaDefByName(techGetTechFile(cv) "M1M2_PR") list(0.25 0.25) "R0" nil)
```

```
; copy a PDK cell, edit it, reuse it as a master
vvCopyCell("sky130_fd_sc_hd" "sky130_fd_sc_hd__inv_1" "designlib" "inv_edit")
```

Errors are normal feedback: a wrong layer prints the valid list; a wrong cell name is fixed with `vvCells`.
There is no `dbCreateEllipse`: approximate a circle with a polygon built from `cos`/`sin` in a `for` loop.
