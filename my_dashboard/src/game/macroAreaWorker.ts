// Macro Area Tetris의 무거운 계산(면적 탐색 한 번 = 후보 다이 최대 3개 × 진단·처리·Rip-up,
// 후보 생성 = 다이마다 16 + seed개 배치)을 메인 스레드 밖에서 돌린다.
import { generateForDie, ripUpD, searchTrial, type AreaOpts, type Die, type ShapeAttempt, type TrialResult, type Variant } from './macroAreaModel'
import type { State } from './macroTetrisModel'

export type AreaRequest =
  | { id: number; kind: 'trial'; die: Die; state: State; pct: number; opts: AreaOpts }
  | { id: number; kind: 'generate'; bases: { die: Die; state: State }[]; opts: AreaOpts; seeds: number; seedBase: number }
  | { id: number; kind: 'ripup'; die: Die; state: State }
export type AreaResponse =
  | { id: number; kind: 'attempt'; a: ShapeAttempt }
  | { id: number; kind: 'trial'; result: TrialResult }
  | { id: number; kind: 'variant'; v: Variant }
  | { id: number; kind: 'genProgress'; done: number; total: number }
  | { id: number; kind: 'generated'; found: number }
  | { id: number; kind: 'ripup'; state: State; before: number; after: number; moves: number }

self.onmessage = (e: MessageEvent<AreaRequest>) => {
  const req = e.data
  if (req.kind === 'trial') {
    const result = searchTrial({ die: req.die, state: req.state }, req.pct, req.opts, a => postMessage({ id: req.id, kind: 'attempt', a } satisfies AreaResponse))
    postMessage({ id: req.id, kind: 'trial', result } satisfies AreaResponse)
    return
  }
  if (req.kind === 'generate') {
    let found = 0
    req.bases.forEach((b, bi) => {
      generateForDie(b, req.opts, req.seeds, req.seedBase + bi * 1000,
        v => { found++; postMessage({ id: req.id, kind: 'variant', v } satisfies AreaResponse) })
      postMessage({ id: req.id, kind: 'genProgress', done: bi + 1, total: req.bases.length } satisfies AreaResponse)
    })
    postMessage({ id: req.id, kind: 'generated', found } satisfies AreaResponse)
    return
  }
  const r = ripUpD(req.die, req.state, 3)
  postMessage({ id: req.id, kind: 'ripup', state: r.state, before: r.before, after: r.after, moves: r.moves } satisfies AreaResponse)
}
