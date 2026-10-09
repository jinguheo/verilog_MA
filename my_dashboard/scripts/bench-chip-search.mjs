// Reproducible L0 proxy benchmark. No OpenLane/DRC/STA is launched.
import { build } from 'esbuild'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const seconds = Number(process.argv.find(x => x.startsWith('--seconds='))?.split('=')[1] ?? 4)
const seeds = (process.argv.find(x => x.startsWith('--seeds='))?.split('=')[1] ?? '1,2,3')
  .split(',').map(Number)
const widths = (process.argv.find(x => x.startsWith('--beam='))?.split('=')[1] ?? '8,32')
  .split(',').map(Number)
if (!(seconds > 0) || seeds.some(x => !Number.isInteger(x)) || widths.some(x => !Number.isInteger(x) || x <= 0))
  throw new Error('Use --seconds=N --seeds=1,2,3 --beam=8,32')
const temp = await mkdtemp(join(tmpdir(), 'chip-search-bench-'))
try {
  const outfile = join(temp, 'chipSearch.mjs')
  await build({ entryPoints: [resolve('src/views/chipSearch.ts')], outfile, bundle: true,
    platform: 'node', format: 'esm', logLevel: 'silent' })
  const { SEQ, buildFrom, beamAsync, saTimed, saGuidedTimed } =
    await import(pathToFileURL(outfile).href)
  const results = { model: 'Chip Tetris L0 proxy, not DRC/STA', seconds, beam: [], seeds: [] }
  let seedPool = [], beamMs = 0
  for (const K of widths) {
    const b = await beamAsync(K, 4)
    results.beam.push({ K, score: b.top[0]?.value, ms: Math.round(b.ms),
      legalChecks: b.legalChecks, candidates: b.top.length })
    if (K === Math.max(...widths)) { seedPool = b.top; beamMs = b.ms }
  }
  for (const seed of seeds) {
    const old = await saTimed(seed, seconds * 1000, 60, 1.5)
    const guided = await saGuidedTimed(seed, seconds * 1000, 60, 1.5)
    const hybrid = await saGuidedTimed(seed, seconds * 1000, 60, 1.5, undefined, seedPool)
    results.seeds.push({
      seed,
      old: old && { score: old.best.value, ms: Math.round(old.ms),
        moves: old.moves, rejectedMoves: old.illegal },
      guided: guided && { score: guided.best.value, ms: Math.round(guided.ms),
        moves: guided.moves, evaluated: guided.evaluated,
        duplicates: guided.duplicates, generationFailures: guided.deadEnds,
        diverse: guided.diverse.length,
        allDiverseLegal: guided.diverse.every(f => !!buildFrom(f.ps, SEQ.length)) },
      beamGuided: hybrid && { score: hybrid.best.value, msIncludingBeam: Math.round(beamMs + hybrid.ms),
        moves: hybrid.moves, evaluated: hybrid.evaluated, diverse: hybrid.diverse.length,
        allDiverseLegal: hybrid.diverse.every(f => !!buildFrom(f.ps, SEQ.length)) },
    })
  }
  console.log(JSON.stringify(results, null, 2))
} finally {
  await rm(temp, { recursive: true, force: true })
}
