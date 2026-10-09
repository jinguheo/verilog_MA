// Regression check for the Chip Tetris search code used by the Evolution SA page
// (engine shapes, score decomposition, beam search, LNS-SA, gap DP, placement order, cancellation).
//
// Run with: npx tsx src/views/chipSearch.regression.ts      (about 15 seconds)
//
// The pinned numbers were measured on 2026-10-09 with the 23-shape engine and the rotationsFor cache.
// If a number moves, either the engine/score changed on purpose (update the number and the dashboard text
// that quotes it) or something broke. Thrown (not process.exit) so this file needs no @types/node.
import * as E from '../game/chipTetrisEngine'
import { TERMS, beamAsync, SEQ } from './chipSearch'
import { lnsSaTimed, gapDpFine, gapCostFns } from './chipCombo'

let failures = 0
const check = (name: string, ok: boolean, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`); if (!ok) failures++ }
const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol
const hash = (s: string) => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0; return h.toString(16) }

async function main() {
  // 1. 모양: 수와 수동 회전 순환, 그리고 기존 모양의 번호가 바뀌지 않았는지
  const counts = { adc: E.rotationsFor('adc').length, sram: E.rotationsFor('sram').length, opamp: E.rotationsFor('opamp').length, fifo: E.rotationsFor('fifo').length, control: E.rotationsFor('control').length }
  check('shape counts adc 2 / sram 1 / SAR 23 / CDC 8 / CAP 23', counts.adc === 2 && counts.sram === 1 && counts.opamp === 23 && counts.fifo === 8 && counts.control === 23, JSON.stringify(counts))
  check('hand rotation cycles only the original shapes (SAR 8 / CDC 6 / CAP 8)', E.playRotationCount('opamp') === 8 && E.playRotationCount('fifo') === 6 && E.playRotationCount('control') === 8)
  check('original SAR shapes 0-7 keep their index', hash(JSON.stringify(E.rotationsFor('opamp').slice(0, 8))) === ORIGINAL_SAR_HASH, hash(JSON.stringify(E.rotationsFor('opamp').slice(0, 8))))
  check('every neighbor shape stays within 5 cells per side', (['opamp', 'fifo', 'control'] as const).every(id => E.rotationsFor(id).every(sh => Math.max(...sh.map(p => p[0])) < 5 && Math.max(...sh.map(p => p[1])) < 5)))

  // 2. beam search: 현재 엔진에서의 값
  const b8 = await beamAsync(8, 4)
  check('beam K=8 (4-cell key) best −134.77', near(b8.top[0].value, -134.77, 0.005) && b8.top.length === 8, b8.top[0].value.toFixed(2))
  const b32 = await beamAsync(32, 0)
  check('beam K=32 (exact key) best −132.70', near(b32.top[0].value, -132.7, 0.005), b32.top[0].value.toFixed(2))
  const best = b32.top[0]
  check('best layout has 0 violations', E.measureBoard(best.board).violations === 0)

  // 3. 점수 분해: 항목 합 = evaluatePlacement
  const m = E.measureBoard(best.board)
  const sum = TERMS.reduce((a, [k, w]) => a - (m[k] as number) * w, 0)
  check('score terms add up to evaluatePlacement', near(sum, E.evaluatePlacement(best.board), 1e-6), `${sum.toFixed(4)} vs ${E.evaluatePlacement(best.board).toFixed(4)}`)

  // 4. 놓는 순서: 선행 조건을 어기면 상태가 사라지고, CAP이 CDC보다 먼저면 크게 나빠진다
  const bad = await beamAsync(4, 4, undefined, ['opamp', 'adc', 'fifo', 'sram', 'control'])
  check('placing SAR before ADC leaves no legal state', bad.top.length === 0 && bad.stoppedAt === 'opamp', String(bad.stoppedAt))
  const capFirst = await beamAsync(8, 4, undefined, ['adc', 'sram', 'opamp', 'control', 'fifo'])
  check('placing CAP before CDC scores −522.61', near(capFirst.top[0].value, -522.61, 0.005), capFirst.top[0].value.toFixed(2))

  // 5. 중단 신호
  const cancelled = await beamAsync(32, 4, undefined, undefined, () => true)
  check('cancel signal stops beam search immediately', cancelled.top.length === 0 && cancelled.ms < 200, `${cancelled.ms.toFixed(0)} ms`)

  // 6. LNS-SA: 시작보다 나빠지지 않고 합법·위반 0
  const lns = await lnsSaTimed(1, 4000, 5, 1, b8.top[0], 40, 3)
  check('LNS-SA from the K=8 result never ends below its start', lns.best.value >= b8.top[0].value - 1e-9, `${b8.top[0].value.toFixed(2)} -> ${lns.best.value.toFixed(2)}, ${lns.moves} moves`)
  check('LNS-SA result is legal with 0 violations', E.measureBoard(lns.best.board).violations === 0)
  const stopped = await lnsSaTimed(1, 60000, 5, 1, b8.top[0], 40, 3, undefined, () => true)
  check('cancel signal stops LNS-SA immediately', stopped.moves <= 1 && stopped.ms < 1000, `${stopped.ms.toFixed(0)} ms`)

  // 7. 간격 DP: 정밀 격자와 거친 격자의 값, 그리고 전수 탐색과의 일치
  const fine = gapDpFine(0.5, 15), coarse = gapDpFine(5, 15)
  check('gap DP at 0.5 um: cost 1.6535, gaps 32.5 / 116.5 / 32.5', near(fine.best, 1.6535, 0.001) && near(fine.gaps[0], 32.5, 0.01) && near(fine.gaps[1], 116.5, 0.01) && near(fine.gaps[2], 32.5, 0.01), `${fine.best.toFixed(4)} ${fine.gaps.join('/')}`)
  const { gapCost, leftEdge, macroCost } = gapCostFns(5), LU = Math.round(coarse.L / 5), Tu = 3
  const ok = (g: number) => g === 0 || g >= Tu
  let brute = Infinity
  for (let g0 = 0; g0 <= LU; g0++) { if (!ok(g0)) continue; for (let g1 = 0; g1 <= LU - g0; g1++) { if (!ok(g1)) continue; const g2 = LU - g0 - g1; if (!ok(g2)) continue
    brute = Math.min(brute, gapCost(0, g0 * 5) + macroCost(leftEdge(0, g0)) + gapCost(1, g1 * 5) + macroCost(leftEdge(1, g0 + g1)) + gapCost(2, g2 * 5)) } }
  check('gap DP at 5 um equals brute force (1.7435)', near(coarse.best, brute, 1e-9) && near(coarse.best, 1.7435, 0.001), `${coarse.best.toFixed(4)} vs ${brute.toFixed(4)}`)

  console.log(`\nplacement sequence: ${SEQ.join(' -> ')}`)
  if (failures > 0) throw new Error(`${failures} regression(s) failed - see output above.`)
  console.log('All chip search regressions passed.')
}

// 기존 SAR 모양 0~7의 JSON을 djb2로 접은 값(2026-10-09, 모양을 늘리기 전 엔진과 같은 순서)
const ORIGINAL_SAR_HASH = '3367d40f'
void main()
