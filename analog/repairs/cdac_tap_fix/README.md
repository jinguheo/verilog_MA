# CDAC dummy-switch tap/nwell spacing repair (2026-10-05)

Goal: close the 6 remaining Magic DRC errors of `sky130_ef_ip__cdac3v_12bit`
(`Spacing of N-Diffusion or P-tap to MV nwell < 0.43um (diff/tap.18,20)`), two instances x three rects, both in
`cdac_dummy_switch`. Vendor sources are untouched; everything here is a verification copy.

## Cause
Inside `cdac_dummy_switch` the P-tap ring sits in a pwell island surrounded by an MV-nwell frame. On the top, bottom
and (cell-)right sides the ring is only 36 internal units = 0.18 um from the nwell edge; the rule wants 0.43 um.

## Fix (see `repaired/`, units are Magic internal units, 200 per um)
1. Move the island's three nwell edges outward by 50 (0.25 um): nwell frame + `pwell` island rects.
2. Keep the well-enclosure rules (nwell.5a/7: dnwell edge 0.4 um inside the nwell outer edge and 1.03 um outside the
   island edge): move the nwell outer edges and the dnwell edges outward by the same 50.
3. nwell.7 (`allnwell` to `dnwell` >= 4.5 um, `surround_ok`) requires the dnwell edge to stay at x' >= 84764 in the top
   cell, and the N-tap ring (`mvnsubdiff`, `mvnsubdiffcont`, `locali`) has to follow the new nwell outline: shift the
   ring's cell-right column outward by 50.
4. In `sky130_ef_ip__cdac3v_12bit.mag`: shift both dummy-switch instances by +50 in x (transform 133093 -> 133143) so
   the grown edge does not move toward its neighbour, and extend the bridging `dnwell`/`nwell` rects between the two
   dummies by 50 on each end.

## Result (CACE, same command as analog_runner, `cace_summary_*.md`)
| check | before | after |
|---|---|---|
| Magic DRC | 6 | **0** |
| Netgen LVS | 51 (pin-name mismatch, pre-existing) | 51, identical comparison output |
| KLayout DRC full | 2 (EF_SW_RST, pre-existing) | 2 |
| Magic area / width / height | unchanged | unchanged |

The CDAC / ADC bounding boxes did not change. XOR of the regenerated ADC GDS (before vs after) is confined to the
dummy-switch region (159..181 um x 138..155 um).

## Not done / still open
* The whole ADC (`sky130_ef_ip__adc3v_12bit`) still has 19 rects of the same rule outside the CDAC (comparator and top
  level); the standalone CDAC is clean.
* The repaired cells are not wired into the PPA3 macro GDS (`analog/build/.../_prboundary.gds`) yet.

Scripts: `run_magic.sh <tcl>` (Magic on `project/mag`), `cell_drc.tcl` (`CELL=<cell>`), `run_cace.sh`/`launch.sh` (full CACE).
