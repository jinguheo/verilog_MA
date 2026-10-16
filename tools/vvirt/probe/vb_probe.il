;; vb_probe.il -- READ-ONLY probe of what a Virtuoso session can tell us (libraries, tech, layers, vias, one sample cell).
;;
;; Writes one JSON file per section into vbpOut and returns a one-line summary. Nothing in the design data is created or changed.
;; Every section runs inside errset, so a function that does not exist in this installation shows up as status "error" instead of
;; stopping the probe. That list of working / missing functions is the main result.
;;
;; The runner (run_probe.py) puts these lines in front of this file:
;;   vbpOut = "/some/dir"   vbpLib = "myLib"   vbpCell = "myCell"   vbpMax = 500
;; then loads this file and calls vbpRun().
;;
;; Known limits: parseString drops empty tokens, so a name with two quotes in a row is escaped imperfectly; numbers are written with %g.

procedure(vbpEsc(s)
  if(s == "" then "" else
    buildString(parseString(buildString(parseString(s "\\") "\\\\") "\"") "\\\"")))

procedure(vbpToS(x) sprintf(nil "%s" x))
procedure(vbpStr(x) if(x == nil then "null" else sprintf(nil "\"%s\"" vbpEsc(vbpToS(x)))))
procedure(vbpBool(x) if(x then "true" else "false"))
procedure(vbpNum(x) if(numberp(x) then sprintf(nil "%g" x) else "null"))
procedure(vbpList(items) strcat("[" if(items then buildString(items ",") else "") "]"))
procedure(vbpObj(pairs)
  strcat("{" if(pairs then buildString(mapcar(lambda((p) sprintf(nil "\"%s\":%s" car(p) cadr(p))) pairs) ",") else "") "}"))

procedure(vbpWrite(name text "tt")
  let((path p)
    path = strcat(vbpOut "/" name)
    p = outfile(path "w")
    if(p then fprintf(p "%s\n" text) close(p) t else nil)))

;; ---- section: which functions exist here -------------------------------------------------------------------------------
vbpFuncNames = '(ddGetLibList ddGetObj ddDeleteObj ddCreateLib dbOpenCellViewByType dbClose dbSave
                 techGetTechFile techGetTechLibName techFindViaDefByName techDumpTechFile techGetLayerNum
                 leGetValidLayerList leGetValidLayerPurposePairs cstGetConstraintGroup
                 geGetEditCellView hiGetCurrentWindow outfile infile fprintf createDir getDirFiles isFile
                 xstSetField xstOutDoTranslate system getShellEnvVar getWorkingDir)

procedure(vbpSecFuncs()
  vbpList(mapcar(lambda((s) vbpObj(list(list("name" vbpStr(s)) list("exists" vbpBool(fboundp(s)))))) vbpFuncNames)))

;; ---- section: libraries -------------------------------------------------------------------------------------------------
procedure(vbpSecLibs()
  let((out r)
    out = nil
    foreach(lib ddGetLibList()
      out = cons(vbpObj(list(
        list("name" vbpStr(lib~>name))
        list("readPath" vbpStr(let((r) r = errset(lib~>readPath nil) if(r car(r) nil))))
        list("techLib" vbpStr(let((r) r = errset(techGetTechLibName(lib) nil) if(r car(r) nil))))
        list("cellCount" vbpNum(let((r) r = errset(length(lib~>cells) nil) if(r car(r) nil)))))) out))
    vbpList(reverse(out))))

;; ---- section: cells of the target library -------------------------------------------------------------------------------
procedure(vbpSecCells()
  let((lib names n)
    lib = ddGetObj(vbpLib)
    names = nil
    n = 0
    foreach(c lib~>cells
      when(n < vbpMax names = cons(vbpStr(c~>name) names) n = n + 1))
    vbpObj(list(list("lib" vbpStr(vbpLib)) list("total" vbpNum(length(lib~>cells))) list("listed" vbpNum(n))
                list("names" vbpList(reverse(names)))))))

;; ---- section: tech file, valid layers, via definitions ------------------------------------------------------------------
procedure(vbpLayerEntry(e)
  if(listp(e) then vbpList(mapcar(lambda((x) vbpStr(x)) e)) else vbpStr(e)))

procedure(vbpSecTech()
  let((techLib tf layers vias r)
    r = errset(techGetTechLibName(ddGetObj(vbpLib)) nil)
    techLib = if(r car(r) nil)
    r = errset(techGetTechFile(ddGetObj(or(techLib vbpLib))) nil)
    tf = if(r car(r) nil)
    r = errset(leGetValidLayerList() nil)
    layers = if(r car(r) nil)
    r = errset(tf~>viaDefs nil)
    vias = if(r car(r) nil)
    vbpObj(list(
      list("techLib" vbpStr(techLib))
      list("techFileFound" vbpBool(tf))
      list("layerCount" vbpNum(length(layers)))
      list("layers" vbpList(mapcar(lambda((e) vbpLayerEntry(e)) layers)))
      list("viaDefCount" vbpNum(length(vias)))
      list("viaDefs" vbpList(mapcar(lambda((v) vbpObj(list(list("name" vbpStr(errset(v~>name nil) && car(errset(v~>name nil))))))) vias)))))))

;; ---- section: one sample layout (counts only, no coordinates of every shape) --------------------------------------------
procedure(vbpSecCell()
  let((cv keys out)
    cv = dbOpenCellViewByType(vbpLib vbpCell "layout" nil "r")
    unless(cv error("cannot open %s/%s/layout" vbpLib vbpCell))
    keys = nil
    foreach(s cv~>shapes
      let((k) k = strcat(vbpToS(s~>layerName) "/" vbpToS(s~>purpose))
        unless(member(k keys) keys = cons(k keys))))
    out = vbpObj(list(
      list("lib" vbpStr(vbpLib)) list("cell" vbpStr(vbpCell))
      list("bBox" vbpList(mapcar(lambda((pt) vbpList(mapcar(lambda((v) vbpNum(v)) pt))) cv~>bBox)))
      list("shapeCount" vbpNum(length(cv~>shapes)))
      list("shapesByLayerPurpose"
        vbpList(mapcar(lambda((k) vbpObj(list(list("key" vbpStr(k))
          list("count" vbpNum(length(setof(s cv~>shapes strcat(vbpToS(s~>layerName) "/" vbpToS(s~>purpose)) == k))))))) keys)))
      list("instanceCount" vbpNum(length(cv~>instances)))
      list("instances" vbpList(mapcar(lambda((i) vbpObj(list(list("name" vbpStr(i~>name)) list("cell" vbpStr(i~>cellName))))) cv~>instances)))
      list("terminals" vbpList(mapcar(lambda((tm) vbpStr(tm~>name)) cv~>terminals)))))
    dbClose(cv)
    out))

;; ---- driver -------------------------------------------------------------------------------------------------------------
;; r is the errset result of the section: (value) on success, nil if the section raised an error.
procedure(vbpSection(name file r)
  let((status data)
    status = if(r then "ok" else "error")
    data = if(r then car(r) else "null")
    vbpWrite(file vbpObj(list(list("section" vbpStr(name)) list("status" vbpStr(status)) list("data" data))))
    sprintf(nil "%s=%s" name status)))

procedure(vbpRun()
  let((res)
    errset(createDir(vbpOut) nil)
    res = list(
      vbpSection("functions" "probe_functions.json" errset(vbpSecFuncs() nil))
      vbpSection("libraries" "probe_libraries.json" errset(vbpSecLibs() nil))
      vbpSection("cells" "probe_cells.json" errset(vbpSecCells() nil))
      vbpSection("tech" "probe_tech.json" errset(vbpSecTech() nil))
      vbpSection("cell" "probe_cell.json" errset(vbpSecCell() nil)))
    buildString(res " ")))
