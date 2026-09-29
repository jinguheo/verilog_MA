import { runReplaceThenAnnealing, type GameState, type HybridProgress } from './chipTetrisEngine'

export type ChipTetrisWorkerRequest = {
  id: number
  state: GameState
  iterations: number
}

export type ChipTetrisWorkerResponse =
  | { id: number; kind: 'progress'; progress: HybridProgress; elapsedMs: number }
  | { id: number; kind: 'result'; state: GameState; elapsedMs: number }

self.onmessage = (event: MessageEvent<ChipTetrisWorkerRequest>) => {
  const request = event.data
  const startedAt = performance.now()
  const state = runReplaceThenAnnealing(request.state, request.iterations, progress => {
    postMessage({
      id: request.id,
      kind: 'progress',
      progress,
      elapsedMs: performance.now() - startedAt,
    } satisfies ChipTetrisWorkerResponse)
  })
  postMessage({
    id: request.id,
    kind: 'result',
    state,
    elapsedMs: performance.now() - startedAt,
  } satisfies ChipTetrisWorkerResponse)
}
