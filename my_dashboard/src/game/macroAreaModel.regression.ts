// Regression check for Macro Area Tetris's gate/legality/repair/export functions.
// Pins down behavior the UI already documents as fact (e.g. "the real signoff grid
// is already the floor for this topology" - see the "AREA FINDING" card in
// MacroAreaTetris.tsx) so a future edit to costD/gateReason/repairFrom can't
// silently change it without this failing.
//
// Run with: npx tsx src/game/macroAreaModel.regression.ts
import {
  realStart, searchTrial, isLegalD, costD, gateReason, diagnoseD, layoutSig, toAreaCfg,
  shapeVariantDies, SHRINK_LADDER, dieArea, rowCapacityD, requiredDensity, shapeStart, RESHAPE_PRESETS, type AreaOpts, type Die,
} from './macroAreaModel'
import type { Macro, State } from './macroTetrisModel'

const opts: AreaOpts = { density: 0.4, strict: true }
let failures = 0

function check(name: string, ok: boolean, detail: string) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` - ${detail}` : ''}`)
  if (!ok) failures++
}

// 1) The real signed-off hierarchical grid must still be legal and gate-clean.
const start = realStart()
const startCost = costD(start.state, start.die)
check('real start is legal', isLegalD(startCost), `overlap=${startCost.overlapPenalty} spacing=${startCost.spacingViolations} channel=${startCost.channelViolations}`)
check('real start passes gateReason', gateReason(start.die, start.state, startCost, opts) === null, String(gateReason(start.die, start.state, startCost, opts)))

// 2) The real grid is already the floor for this exact 4x2 topology - every rung
// of the shrink ladder must fail and the search must converge on attempt #1,
// matching the closed-form floor documented in MacroAreaTetris.tsx's "AREA
// FINDING" card (4x800+3x100+2x100=3700, 2x800+300+2x100=2100).
{
  let cur = { die: start.die, state: start.state }
  let pct: number = SHRINK_LADDER[0]
  let converged = false
  let rungs = 0
  for (let i = 0; i < SHRINK_LADDER.length; i += 1) {
    const r = searchTrial(cur, pct, opts)
    rungs += 1
    if (r.accepted) { cur = { die: r.accepted.die, state: r.accepted.state }; break }
    if (r.converged) { converged = true; break }
    pct = r.nextPct
  }
  check('realStart never accepts a smaller die (already at the floor)', converged, `stopped after ${rungs} rung(s)`)
  check('realStart converges within the full ladder length', rungs === SHRINK_LADDER.length, `rungs=${rungs} ladder=${SHRINK_LADDER.length}`)
}

// 3) Channel hard gate: a die with the same footprint but a sub-300um row
// channel must be flagged - this is the DPL-0034/0036 real-evidence gate, the
// one piece of this model that must never silently regress into a soft cost.
{
  const tightDie: Die = { w: start.die.w, h: 1900 } // was 2100; channel shrinks from 300 to 100um
  const squeezedMacros: Macro[] = start.state.macros.map(m => (m.y > 1000 ? { ...m, y: m.y - 200 } : m))
  const tightState: State = { macros: squeezedMacros, hubs: start.state.hubs }
  const reason = gateReason(tightDie, tightState, costD(tightState, tightDie), opts)
  check('300um->100um channel is rejected by gateReason', reason !== null && reason.includes('채널'), String(reason))
  const issues = diagnoseD(tightDie, tightState, opts)
  check('diagnoseD reports a channel issue for the same layout', issues.some(i => i.kind === 'channel'), issues.map(i => i.kind).join(','))
}

// 4) layoutSig: same coordinates -> same signature; a real (>DIE_SNAP) move ->
// a different signature. This backs the candidate-pool dedup/"rediscovered" logic.
{
  const sigA = layoutSig(start.die, start.state.macros)
  const sigB = layoutSig(start.die, start.state.macros.map(m => ({ ...m })))
  check('layoutSig is deterministic for identical layouts', sigA === sigB, '')
  const moved = start.state.macros.map((m, i) => (i === 0 ? { ...m, x: m.x + 20 } : m))
  check('layoutSig changes after a real (20um) move', layoutSig(start.die, moved) !== sigA, '')
}

// 5) toAreaCfg export must round-trip the die size and macro coordinates
// exactly - this text is pasted straight into config_hierarchical.json.
{
  const cfg = JSON.parse(toAreaCfg(start.die, start.state.macros, opts.density)) as {
    DIE_AREA: number[]
    PL_TARGET_DENSITY_PCT: number
    MACROS: { chan_top: { instances: Record<string, { location: number[]; orientation: string }> } }
  }
  check('exported DIE_AREA matches the die', cfg.DIE_AREA[2] === start.die.w && cfg.DIE_AREA[3] === start.die.h, JSON.stringify(cfg.DIE_AREA))
  const instances = Object.values(cfg.MACROS.chan_top.instances)
  check('exported instance count matches macro count', instances.length === start.state.macros.length, `${instances.length} vs ${start.state.macros.length}`)
  const firstMatches = instances[0].location[0] === Math.round(start.state.macros[0].x) && instances[0].location[1] === Math.round(start.state.macros[0].y)
  check('exported first macro location matches its coordinates', firstMatches, JSON.stringify(instances[0].location))
  check('exported PL_TARGET_DENSITY_PCT matches opts.density', cfg.PL_TARGET_DENSITY_PCT === Math.round(opts.density * 100), String(cfg.PL_TARGET_DENSITY_PCT))
}

// 6) dieArea sanity, since every %-shrink calculation divides by it.
check('dieArea(realStart) matches w*h', dieArea(start.die) === start.die.w * start.die.h, String(dieArea(start.die)))

// 7) shapeVariantDies: the closed-form row-count die sizes, hand-verified against
// the real topology (8 chan_top macros, 800x800, MIN_SPACING=100, CHANNEL_SAFE_MARGIN=300).
// NOTE: only the SIZES are pinned here. repairFrom does not yet successfully legalize
// the 3-row/4-row shapes (its row-reconstruction fallback only targets PIN_ESCAPE_MARGIN
// for the channel gap, not CHANNEL_SAFE_MARGIN - see the "2차원 다이 형상 탐색 · PARTIAL"
// card in MacroAreaTetris.tsx) - do not add a legalization assertion here until that's fixed.
{
  const shapes = shapeVariantDies(start.state.macros)
  const byArea = [...shapes].sort((a, b) => dieArea(a) - dieArea(b))
  check('shapeVariantDies includes the real 2-row floor (3700x2100)', shapes.some(d => d.w === 3700 && d.h === 2100), shapes.map(d => `${d.w}x${d.h}`).join(', '))
  check('shapeVariantDies includes the 3-row size (2800x3200, 8.96mm2)', shapes.some(d => d.w === 2800 && d.h === 3200), '')
  check('shapeVariantDies includes the 4-row size (1900x4300, 8.17mm2)', shapes.some(d => d.w === 1900 && d.h === 4300), '')
  check('shapeVariantDies excludes 1-row (aspect 7.3 > MAX_ASPECT)', !shapes.some(d => d.w === 7300 && d.h === 1000), '')
  check('2-row is the smallest-area shape (this topology has no smaller legal row count)', byArea[0].w === 3700 && byArea[0].h === 2100, byArea.map(d => `${d.w}x${d.h}=${(dieArea(d) / 1e6).toFixed(2)}mm2`).join(', '))
}

// 8) rowCapacityD vs the REAL OpenROAD cutrows output. Numbers read from the DEF ROW
// statements of the signed-off run daq_subsystem/runs/hierarchical_auto_20260924_142552
// (17-openroad-cutrows/daq_subsystem.def): 764 rows, 3,180 row segments, 2,274,156 um^2
// of site capacity, shortest segment 79.58 um (the 100 um inter-macro channel minus halo).
// The 800x800 / 590x1085 row counts come from chan_top's own real cutrows DEFs.
{
  const cap = rowCapacityD(start.die, start.state.macros)
  check('rowCapacityD reproduces the real daq_subsystem row count (764)', cap.rows === 764, String(cap.rows))
  check('rowCapacityD reproduces the real row-segment count (3180)', cap.segments === 3180, String(cap.segments))
  check('rowCapacityD reproduces the real site capacity (2,274,156 um^2) within 0.01%', Math.abs(cap.capacityUm2 - 2274156) / 2274156 < 1e-4, String(Math.round(cap.capacityUm2)))
  check('rowCapacityD reproduces the real shortest segment (79.58 um = 100 um channel - 2x halo, site-snapped)', Math.abs(cap.shortestSegUm - 79.58) < 0.01, cap.shortestSegUm.toFixed(2))
  check('real row capacity is below the naive die-minus-macros area', cap.capacityUm2 < cap.naiveFreeUm2, `${Math.round(cap.capacityUm2)} < ${Math.round(cap.naiveFreeUm2)}`)
  check('chan_top 800x800 core has the real 286 rows', rowCapacityD({ w: 800, h: 800 }, []).rows === 286, '')
  check('chan_top 590x1085 core has the real 390 rows', rowCapacityD({ w: 590, h: 1085 }, []).rows === 390, '')
  const req = requiredDensity(start.die, start.state.macros)
  check('requiredDensity on the real grid is the real-capacity ratio (~20.3%)', Math.abs(req - 460614 / 2274156) < 1e-3, `${(req * 100).toFixed(2)}%`)
}

// 9) Macro-shape presets (the ones actually run through OpenLane): the start layout of each must
// be legal under the current gates and have exactly the die the dashboard's AREA FINDING table
// lists - otherwise picking a shape in the UI would silently start from a broken layout.
{
  const expected: Record<string, string> = { '800x800': '3700x2100', '650x985': '3100x2470', '590x1085': '2860x2670', '500x1280': '2500x3060', '450x1422': '2300x3350' }
  for (const p of RESHAPE_PRESETS) {
    const st = shapeStart(p.key)
    const why = gateReason(st.die, st.state, costD(st.state, st.die), opts)
    check(`shapeStart(${p.key}) die matches the table`, `${st.die.w}x${st.die.h}` === expected[p.key], `${st.die.w}x${st.die.h}`)
    check(`shapeStart(${p.key}) start layout passes every gate`, why === null, String(why))
  }
}

if (failures > 0) {
  throw new Error(`${failures} regression(s) failed - see output above.`)
}
console.log('\nAll Macro Area Tetris regressions passed.')
