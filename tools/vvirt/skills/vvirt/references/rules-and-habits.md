# Rules and designer habits

**Where rules come from.** `vvRuleSource()` names the file (the PDK's `sky130_fd_sc_hd__nom.tlef`): min width, spacing, area,
preferred direction, pitch, cut size/spacing/enclosure. It is routing-level data, not the full signoff rule set.
`vvRules("met2")` lists them; `vvDirections()` the preferred directions.

**Your own rules.** `vvSetRule("met3" "minSpace" 0.6)` overrides one rule (kinds `minWidth|minSpace|minArea`). Overrides are
reported in `vvCheckReport` → `ruleOverrides`; loading a profile resets them. Overrides can be stricter or looser than the PDK:
state which when you report.

**Profiles** (`tools/vvirt/profiles/*.json`): `rules` overrides plus `habits`: `directions`, `widthMultiple`, `spaceMultiple`,
`viasPerConnection`, `snapGrid`, `cellGap`, `alternateRowFlip`, `tapCell`, `tapEnds`. `vvLoadProfile("name")`, `vvProfile()` shows
what is active. Habits act only through `vvPlaceRow`, `vvViaStack`, `vvRoute`, `vvPinXY` (pin position after orientation).

**Typical sequence**
```
vvLoadProfile("habit_analog")
cv = dbOpenCellViewByType("mylib" "top" "layout" "maskLayout" "w")
vvPlaceRow(cv "A" list("inv_1" "nand2_1") list(0.0 0.0) 0)      ; records (name cell x orient): read the names (taps get *_TAP0/1)
vvPlaceRow(cv "B" list("buf_1" "inv_2") list(0.0 2.72) 1)
p0 = vvPinXY(cv "A2" "Y")  p1 = vvPinXY(cv "B1" "A")
vvViaStack(cv p0 "li1" "met2")  vvViaStack(cv p1 "li1" "met2")
vvRoute(cv "met2" p0 p1)
vvCheckReport(cv list("met1" "met2" "via" "mcon"))
```

**Report fields.** `vvCheckReport` → `status`, `checkedLayers` (layer + rule kinds applied), `enclosureChecks`,
`presentWithoutRule` (drawn but unchecked), `notChecked` (what no check here covers), `excludedBecauseInPlacedCells` (violations
that already exist inside the placed PDK cells alone and were left out), `ruleSource`, `profile`, `ruleOverrides`, `violations`
(records: `layer rule required bbox`). `vvOfficialDrcReport` → `status`, `deck`, `deckRelease`, `groupsRun`, `notRun`,
`violations` (records: `rule count`). All are named-field records: read them with `vvGet(report "status")`.
