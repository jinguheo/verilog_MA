// Macro Tetris의 무거운 솔버(Rip-up 전수 탐색, SOFT 모양 탐색, RePlAce→SA는 수 초
// 걸림)를 메인 스레드 밖에서 돌려 화면이 멈추지 않게 한다. 병렬 탐색은 이
// 워커를 여러 개 띄워 레인마다 하나씩 쓴다.
import { annealUntilBetter, cost, randomStart, ripUpReplace, runReplaceStyle, type AnnealResult, type Candidate, type State } from './macroTetrisModel'

export type SolverJob =
  | { kind: 'ripup'; state: State; passes: number; withShapes: boolean }
  | { kind: 'replace'; state: State; seed: number }
  // RePlAce로 정리한 뒤 SA가 그 결과보다 좋아질 때까지. randomize면 위치를 무작위로 흩뿌린 뒤 시작.
  | { kind: 'replaceSA'; state: State; seed: number; maxIters: number; randomize: boolean }
  // 주어진 배치(보통 지금까지의 최고)에서 바로 SA — 그보다 좋아질 때까지.
  | { kind: 'sa'; state: State; seed: number; maxIters: number }
export type SolverRequest = SolverJob & { id: number }
export type ReplaceSAResult = { replace: Candidate | null; anneal: AnnealResult }
// 중간 진행 상황 — 지금까지 찾은 최고 배치를 화면에 실시간으로 그리기 위함.
export type SolverProgress = { iters: number; best: number; target: number; state: State }

self.onmessage = (e: MessageEvent<SolverRequest>) => {
  const req = e.data
  if (req.kind === 'ripup') {
    postMessage({ id: req.id, result: ripUpReplace(req.state, req.passes, req.withShapes) })
    return
  }
  if (req.kind === 'replace') {
    postMessage({ id: req.id, result: runReplaceStyle(req.seed, req.state) })
    return
  }
  let start: State, target: number, replace: Candidate | null = null
  if (req.kind === 'replaceSA') {
    replace = runReplaceStyle(req.seed, req.randomize ? randomStart(req.state, req.seed) : req.state)
    start = replace.state
    target = replace.c.total
  } else {
    start = req.state
    target = cost(req.state).total
  }
  const anneal = annealUntilBetter(start, target, req.seed, req.maxIters,
    p => postMessage({ id: req.id, progress: { iters: p.iters, best: p.best, target, state: p.state } satisfies SolverProgress }))
  postMessage({ id: req.id, result: { replace, anneal } satisfies ReplaceSAResult })
}
