// Regression check for Macro Tetris's legality/cost model, pinned to the only
// three real OpenLane outcomes known for daq_subsystem hierarchical placement:
//   - grid layout (config_hierarchical.json)              -> PASS (signed off)
//   - 100um-channel layout (config_hierarchical_macrotetris.json) -> FAIL, DPL-0036
//   - scattered layout (config_hierarchical_macrotetris_v2.json)  -> FAIL, GRT-0118
//
// Run with: npx tsx src/game/macroTetrisModel.regression.ts
//
// Before the 2026-09-28 pinAccessViolations legal gate, the model scored the
// scattered (actually-failed) layout BETTER than the real passing grid layout
// on every metric except channel width - this script exists so that kind of
// mis-ranking can never silently come back after a future cost-function edit.
import { cost, isLegal, preSignoffProxy, REAL_RUN_HUBS, REAL_RUN_MACROS, type Macro } from './macroTetrisModel'

type RealRun = { name: string; expectLegal: boolean; why: string; locations: [number, number][] }

const REAL_RUNS: RealRun[] = [
  {
    name: 'grid (config_hierarchical.json)',
    expectLegal: true,
    why: 'signed off - RUN hierarchical_auto_20260924_142552',
    locations: [[100, 100], [1000, 100], [1900, 100], [2800, 100], [100, 1200], [1000, 1200], [1900, 1200], [2800, 1200]],
  },
  {
    name: '100um channel (config_hierarchical_macrotetris.json)',
    expectLegal: false,
    why: 'FAIL - OpenLane DetailedPlacement DPL-0036, hold-repair buffers had no legal site',
    locations: [[100, 300], [1000, 300], [1900, 300], [2800, 300], [100, 1200], [1000, 1200], [1900, 1200], [2800, 1200]],
  },
  {
    name: 'scattered (config_hierarchical_macrotetris_v2.json)',
    expectLegal: false,
    why: 'FAIL - OpenLane GlobalRouting GRT-0118 congestion, macrotetris_v2_20260926_133315',
    locations: [[94, 1221], [1899, 984], [998, 992], [1888, 81], [985, 91], [2809, 1207], [2799, 301], [76, 305]],
  },
]

function runToMacros(locations: [number, number][]): Macro[] {
  return locations.map(([x, y], i) => ({ ...REAL_RUN_MACROS[i], x, y }))
}

let failures = 0
const scored = REAL_RUNS.map(run => {
  const macros = runToMacros(run.locations)
  const c = cost({ macros, hubs: REAL_RUN_HUBS.map(h => ({ ...h })) })
  const p = preSignoffProxy(c)
  const legal = isLegal(c)
  const ok = legal === run.expectLegal
  if (!ok) failures++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${run.name}`)
  console.log(`      expect legal=${run.expectLegal} (${run.why}) -> got legal=${legal}`)
  console.log(`      total=${Math.round(c.total)} wl=${Math.round(c.wl)} congestionCells=${c.congestionCells} pinAccessViolations=${c.pinAccessViolations} channelViolations=${c.channelViolations} leftover=${c.usableLeftoverPct}% confidence=${p.confidence}`)
  return { run, c, legal }
})

// Ranking property: among the legal candidates, the real signed-off grid layout
// should not be beaten by anything that is known to have failed real OpenLane.
// (Once mis-classified failures are excluded from isLegal this is automatic,
// but it is checked explicitly so a future change to isLegal that lets a known
// failure back in as "legal" trips this even if it forgets to update expectLegal.)
const legalScored = scored.filter(s => s.legal)
const gridEntry = scored.find(s => s.run.name.startsWith('grid'))
if (gridEntry?.legal) {
  for (const s of legalScored) {
    if (s === gridEntry) continue
    if (s.c.total < gridEntry.c.total) {
      console.log(`FAIL  ranking: "${s.run.name}" (known-failed in real OpenLane, but currently legal) scored better (${Math.round(s.c.total)}) than the real passing grid layout (${Math.round(gridEntry.c.total)})`)
      failures++
    }
  }
}

if (failures > 0) {
  // Thrown (not process.exit) so this file needs no @types/node - the
  // dashboard's tsconfig only targets the browser DOM lib. Node/tsx still
  // exits non-zero on an uncaught exception, which is all a regression
  // check needs.
  throw new Error(`${failures} regression(s) failed - see output above.`)
}
console.log('\nAll real-evidence regressions passed.')
