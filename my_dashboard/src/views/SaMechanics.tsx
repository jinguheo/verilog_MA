// SA(simulated annealing)가 이 대시보드에서 실제로 어떻게 구현되어 있는지, 단계·설정값·후보 영역을 그림으로 설명한다.
//  ① seed → 난수 → 블록별 후보 영역 → 시작 배치   ② 이동 하나의 전 과정(어느 블록, 어떤 후보 영역, 수락/거절)
//  ③ 온도(temperature)의 역할   ④ 설정값 역할 표   ⑤ 탐색 공간과 성능 차이 분석
// 배치·후보 수·난수·확률·점수는 모두 렌더링할 때 실제 엔진으로 계산한 값이다. 정적 표는 '측정'이라고 날짜와 조건을 적었다.
import { useEffect, useMemo, useRef, useState } from 'react'
import * as E from '../game/chipTetrisEngine'
import { SEQ, COLS, ROWS, rngOf, ringList, allCells, beamAsync, type P } from './chipSearch'

const p = { margin: '4px 0 8px', fontSize: 13, lineHeight: 1.8 } as const
const ul = { margin: '0 0 8px 18px', padding: 0, fontSize: 13, lineHeight: 1.8 } as const
const box = { padding: 10, borderRadius: 8, border: '1px solid var(--border-strong)', background: 'var(--surface)' } as const
const NAME: Record<string, string> = { adc: 'ADC MACRO', sram: 'SRAM MACRO', opamp: 'SAR NEAR', fifo: 'CDC EDGE', control: 'CAPTURE NEAR' }
const SHORT: Record<string, string> = { adc: 'ADC', sram: 'SRAM', opamp: 'SAR', fifo: 'CDC', control: 'CAP' }
const RULE: Record<string, string> = {
  adc: '모양 중심 x ≤ 0.42 × 열 수. 다른 블록과 겹치거나 보드 밖이면 불가.',
  sram: '모양 중심 x ≥ 0.55 × 열 수이고 ADC와의 거리 ≥ 2. 겹침·보드 밖 불가.',
  opamp: '필수 이웃 = ADC와 거리가 정확히 1(맞닿음). ADC 가장자리 바로 바깥 칸을 모양의 한 칸이 덮어야 함.',
  fifo: '필수 이웃 = SAR NEAR와 거리 정확히 1. 그리고 ADC에는 닿으면 안 됨.',
  control: '필수 이웃 = SRAM과 거리 정확히 1. 그리고 ADC에는 닿으면 안 됨.',
}
const f1 = (x: number) => x.toFixed(1)
const f2 = (x: number) => x.toFixed(2)
const pct = (x: number) => (x * 100 >= 10 ? (x * 100).toFixed(0) : (x * 100).toFixed(1)) + '%'
const BLOCK_COLOR = (id: E.BlockId) => E.BLOCKS[id].color

// ---------- 난수 기록 + 후보 뽑기 (chipSearch.drawLegal과 같은 규칙을 기록하며 수행) ----------
type Trial = { u: number[]; r: number; x: number; y: number; legal: boolean }
type Draw = { id: E.BlockId; ok: boolean; kind: 'ring' | 'free'; space: number; tries: number; trials: Trial[]; chosen?: P; before: E.Board; s2?: E.GameState; reason?: string }
function tracedRng(seed: number) { const r = rngOf(seed); const log: number[] = []; return { rnd: () => { const v = r(); log.push(v); return v }, log } }

function drawTraced(s: E.GameState, id: E.BlockId, rnd: () => number, log: number[]): Draw {
  const ring = ringList(s.board, id), nrot = E.rotationsFor(id).length
  const kind = ring ? 'ring' : 'free', space = ring ? ring.length : nrot * COLS * ROWS
  const base = { id, kind, space, before: s.board } as const
  if (ring && !ring.length) return { ...base, ok: false, tries: 0, trials: [], reason: '이웃 블록 주변에 후보 칸이 없음' }
  const trials: Trial[] = []
  for (let t = 0; t < 400; t++) {
    const mark = log.length
    let r: number, x: number, y: number
    if (ring) { [r, x, y] = ring[Math.floor(rnd() * ring.length)] } else { r = Math.floor(rnd() * nrot); x = Math.floor(rnd() * COLS); y = Math.floor(rnd() * ROWS) }
    const u = log.slice(mark)
    const ac = { id, rotation: r, x, y } as E.ActiveBlock
    const legal = E.isLegalPlacement(s.board, ac)
    if (trials.length < 5 || legal) trials.push({ u, r, x, y, legal })
    if (legal) return { ...base, ok: true, tries: t + 1, trials, chosen: { r, x, y }, s2: E.lockActive(s, ac, s.queue, s.hold) }
  }
  return { ...base, ok: false, tries: 400, trials, reason: '400번 뽑아도 합법 위치를 못 찾음' }
}

// 한 블록의 후보 영역: 뽑기 공간 전체와 그중 합법 위치(칸 덮음 횟수 = 히트맵), 이웃 띠
type Info = { space: number; legal: number; heat: number[][]; maxHeat: number; ringCells: boolean[][] | null }
function legalInfo(board: E.Board, id: E.BlockId): Info {
  const ring = ringList(board, id), cands = ring ?? allCells(id)
  const heat = Array.from({ length: ROWS }, () => Array<number>(COLS).fill(0)); let legal = 0, maxHeat = 0
  for (const [r, x, y] of cands) {
    if (!E.isLegalPlacement(board, { id, rotation: r, x, y } as E.ActiveBlock)) continue
    legal++
    for (const [px, py] of E.rotationsFor(id)[r]) { const cx = px + x, cy = py + y; if (cy >= 0 && cy < ROWS && cx >= 0 && cx < COLS) { heat[cy][cx]++; maxHeat = Math.max(maxHeat, heat[cy][cx]) } }
  }
  let ringCells: boolean[][] | null = null
  const req = E.BLOCKS[id].requiredNeighbor
  if (req) {
    ringCells = Array.from({ length: ROWS }, () => Array<boolean>(COLS).fill(false))
    const occ = new Set<string>(); board.forEach((row, y) => row.forEach((c, x) => { if (c?.id === req) occ.add(`${x},${y}`) }))
    for (const k of occ) { const [x, y] = k.split(',').map(Number); for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + dx, ny = y + dy; if (!occ.has(`${nx},${ny}`) && nx >= 0 && nx < COLS && ny >= 0 && ny < ROWS) ringCells[ny][nx] = true } }
  }
  return { space: ring ? ring.length : E.rotationsFor(id).length * COLS * ROWS, legal, heat, maxHeat, ringCells }
}

function HeatBoard({ board, info, chosen, id, width, label }: { board: E.Board; info?: Info | null; chosen?: P; id?: E.BlockId; width: number; label?: string }) {
  const cells = chosen && id ? E.rotationsFor(id)[chosen.r].map(([px, py]) => [px + chosen.x, py + chosen.y] as [number, number]) : []
  return <svg viewBox={`0 0 ${COLS} ${ROWS}`} width={width} height={width * ROWS / COLS} style={{ display: 'block', borderRadius: 4, border: '1px solid var(--border-strong)', background: 'var(--surface-muted)' }} role="img" aria-label={label ?? '배치 보드'}>
    {info && info.heat.flatMap((row, y) => row.map((h, x) => h > 0 && !board[y][x] ? <rect key={`h${x}-${y}`} x={x} y={y} width={1} height={1} fill="#f2994a" fillOpacity={0.18 + 0.62 * h / Math.max(1, info.maxHeat)}/> : null))}
    {board.flatMap((row, y) => row.map((c, x) => c ? <rect key={`${x}-${y}`} x={x + 0.04} y={y + 0.04} width={0.92} height={0.92} rx={0.08} fill={BLOCK_COLOR(c.id)}/> : null))}
    {info?.ringCells && info.ringCells.flatMap((row, y) => row.map((on, x) => on && !board[y][x] ? <rect key={`r${x}-${y}`} x={x + 0.08} y={y + 0.08} width={0.84} height={0.84} fill="none" stroke="#16a085" strokeWidth={0.14}/> : null))}
    {cells.map(([cx, cy]) => <rect key={`c${cx}-${cy}`} x={cx + 0.02} y={cy + 0.02} width={0.96} height={0.96} rx={0.1} fill={id ? BLOCK_COLOR(id) : '#999'} stroke="var(--text)" strokeWidth={0.22}/>)}
  </svg>
}

function Legend() {
  return <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, fontSize: 12, margin: '4px 0 8px' }}>
    {SEQ.map(id => <span key={id}><i style={{ display: 'inline-block', width: 12, height: 12, background: BLOCK_COLOR(id), borderRadius: 2, marginRight: 4, verticalAlign: -2 }}/>{NAME[id]}</span>)}
    <span><i style={{ display: 'inline-block', width: 12, height: 12, background: '#f2994a', opacity: 0.6, borderRadius: 2, marginRight: 4, verticalAlign: -2 }}/>합법 위치가 덮는 칸(진할수록 많이 덮음)</span>
    <span><i style={{ display: 'inline-block', width: 12, height: 12, border: '2px solid #16a085', borderRadius: 2, marginRight: 4, verticalAlign: -2, boxSizing: 'border-box' }}/>이웃 띠(뽑기 후보가 나오는 칸)</span>
    <span><i style={{ display: 'inline-block', width: 12, height: 12, border: '2px solid var(--text)', borderRadius: 2, marginRight: 4, verticalAlign: -2, boxSizing: 'border-box' }}/>이번에 뽑힌 위치</span>
  </div>
}

// ---------- 시작 배치: seed → 난수 → 블록별 뽑기. 막다른 길이면 같은 난수 흐름에서 처음부터 다시 ----------
type Attempt = { draws: Draw[]; ok: boolean }
function startRun(rnd: () => number, log: number[]): { attempts: Attempt[]; ps: P[]; state: E.GameState } | null {
  const attempts: Attempt[] = []
  for (let a = 0; a < 60; a++) {
    let s = E.createGame(0); const draws: Draw[] = []; const ps: P[] = []; let ok = true
    for (const id of SEQ) { const d = drawTraced(s, id, rnd, log); draws.push(d); if (!d.ok) { ok = false; break } ps.push(d.chosen!); s = d.s2! }
    attempts.push({ draws, ok })
    if (ok) return { attempts, ps, state: s }
  }
  return null
}

function StartPart() {
  const [seed, setSeed] = useState(1)
  const [step, setStep] = useState(0)
  const run = useMemo(() => { const { rnd, log } = tracedRng(seed); return startRun(rnd, log) }, [seed])
  const first8 = useMemo(() => { const r = rngOf(seed); return Array.from({ length: 8 }, () => r()) }, [seed])
  const names = ['seed와 난수', ...SEQ.map(id => `${SHORT[id]} 뽑기`), '시작 배치']
  const final = run?.attempts[run.attempts.length - 1]
  const d = step >= 1 && step <= SEQ.length ? final?.draws[step - 1] : undefined
  const info = useMemo(() => d ? legalInfo(d.before, d.id) : null, [d])
  const startV = run ? E.evaluatePlacement(run.state.board) : 0
  return <div>
    <p style={p}>SA는 <b>기존 배치 없이</b> 시작합니다. 같은 seed는 항상 같은 난수열을 만들기 때문에 같은 시작 배치가 나옵니다(재현 가능). 아래는 실제 엔진으로 돌린 값입니다.</p>
    <div style={{ display: 'flex', gap: 10, alignItems: 'center', margin: '4px 0' }}>
      <label style={{ fontSize: 12 }}>seed <select value={seed} onChange={e => { setSeed(Number(e.target.value)); setStep(0) }}>{[1, 2, 3, 4, 5, 6].map(v => <option key={v} value={v}>{v}</option>)}</select></label>
      {run && run.attempts.length > 1 && <span style={{ fontSize: 12, color: 'var(--warning)' }}>이 seed는 막다른 길을 {run.attempts.length - 1}번 만나 {run.attempts.length}번째 시도에서 성공했습니다.</span>}
    </div>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, margin: '6px 0' }}>{names.map((n, i) => <button key={n} type="button" className={i === step ? 'active' : ''} onClick={() => setStep(i)} style={{ fontSize: 12 }}>{i}. {n}</button>)}</div>
    <div style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
      <button type="button" disabled={step === 0} onClick={() => setStep(step - 1)}>← 이전</button>
      <button type="button" className="active" disabled={step === names.length - 1} onClick={() => setStep(step + 1)}>다음 단계 →</button>
    </div>
    {!run && <div style={box}><span style={{ fontSize: 13, color: 'var(--danger)' }}>60번 시도해도 합법 시작 배치를 만들지 못했습니다.</span></div>}

    {run && step === 0 && <div style={box}>
      <b style={{ fontSize: 13 }}>0. seed에서 난수가 나오는 방식</b>
      <p style={p}>seed = <b>{seed}</b>를 난수 생성기(mulberry32)에 넣으면 0 이상 1 미만의 수가 순서대로 나옵니다. 이 수열이 <b>모든 선택(어느 위치를 뽑을지, 어느 블록을 고칠지, 나빠지는 이동을 받아들일지)</b>을 정합니다. 처음 8개:</p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, margin: '4px 0 8px' }}>{first8.map((v, i) => <code key={i} style={{ padding: '2px 6px', borderRadius: 4, border: '1px solid var(--border-strong)', fontSize: 12 }}>u{i + 1} = {v.toFixed(4)}</code>)}</div>
      <p style={p}>시작 배치는 블록 5개를 <b>ADC → SRAM → SAR → CDC → CAP 순서</b>로 하나씩 놓아 만듭니다. 한 블록을 놓는 방법은 두 가지입니다.</p>
      <div className="data-table"><table><thead><tr><th>블록 종류</th><th>뽑는 공간 (후보 목록)</th><th>난수 → 위치</th></tr></thead><tbody>
        <tr><td>하드 매크로 (ADC, SRAM) — 제약이 위치뿐</td><td>보드 전체: 모양 수 × {COLS} × {ROWS} 칸</td><td>u1 → 모양 번호 = floor(u1 × 모양 수), u2 → x = floor(u2 × {COLS}), u3 → y = floor(u3 × {ROWS}) <b>(난수 3개)</b></td></tr>
        <tr><td>이웃 블록 (SAR, CDC, CAP) — 필수 이웃 옆</td><td><b>이웃 띠 후보</b>: 필수 이웃 블록에 맞닿는 바깥 칸을 모양의 한 칸이 덮는 (모양, x, y) 전부</td><td>u1 → 번호 = floor(u1 × 후보 수), 그 번호의 (모양, x, y) <b>(난수 1개)</b></td></tr>
      </tbody></table></div>
      <p style={p}>뽑은 위치가 하드 규칙을 어기면 <b>그 위치를 버리고 다시 뽑습니다</b>(최대 400번). 합법 위치가 하나도 없는 막다른 길이면 같은 난수 흐름에서 처음부터 다시 시작합니다. 점수는 여기서 쓰지 않습니다 — 시작 배치는 <b>합법이기만 하면 됩니다.</b></p>
    </div>}

    {run && d && <div style={box}>
      <b style={{ fontSize: 13 }}>{step}. {NAME[d.id]} 뽑기 — {d.kind === 'ring' ? '이웃 띠에서' : '보드 전체에서'} 뽑음</b>
      <p style={{ ...p, color: 'var(--text-secondary)' }}>규칙: {RULE[d.id]}</p>
      <Legend/>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
        <div>
          <HeatBoard board={d.before} info={info} chosen={d.chosen} id={d.id} width={340} label={`${NAME[d.id]} 후보 영역`}/>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>{NAME[d.id]}을 놓기 직전의 보드. 주황 = 합법 위치가 덮는 칸{d.kind === 'ring' ? ', 초록 테두리 = 이웃 띠' : ''}, 굵은 테두리 = 뽑힌 위치</div>
        </div>
        <div style={{ flex: 1, minWidth: 300 }}>
          <div className="data-table"><table><thead><tr><th>값</th><th>이 단계의 실제 값</th></tr></thead><tbody>
            <tr><td>뽑기 공간(후보 목록 크기)</td><td><b>{d.space.toLocaleString()}</b>개 {d.kind === 'ring' ? '(이웃 띠 후보)' : `(모양 ${E.rotationsFor(d.id).length} × ${COLS} × ${ROWS})`}</td></tr>
            <tr><td>그중 합법 위치</td><td><b>{info?.legal.toLocaleString()}</b>개</td></tr>
            <tr><td>한 번 뽑아 합법일 확률</td><td>{info ? <><b>{pct(info.legal / d.space)}</b> → 평균 {(d.space / Math.max(1, info.legal)).toFixed(1)}번 뽑아야 합법</> : ''}</td></tr>
            <tr><td>이번에 뽑은 횟수</td><td><b>{d.tries}</b>번째에 합법</td></tr>
          </tbody></table></div>
          <b style={{ fontSize: 12, display: 'block', marginTop: 8 }}>난수 → 위치 (뽑은 순서대로{d.tries > d.trials.length ? `, 앞 ${d.trials.length - 1}번과 마지막만` : ''})</b>
          <div className="data-table"><table><thead><tr><th>#</th><th>난수</th><th>계산</th><th>(모양, x, y)</th><th>판정</th></tr></thead><tbody>
            {d.trials.map((t, i) => <tr key={i} style={t.legal ? { fontWeight: 700, color: 'var(--success)' } : { color: 'var(--text-secondary)' }}>
              <td>{t.legal ? d.tries : i + 1}</td><td>{t.u.map(v => v.toFixed(3)).join(', ')}</td>
              <td>{d.kind === 'ring' ? `${t.u[0].toFixed(3)} × ${d.space} → ${Math.floor(t.u[0] * d.space)}번 후보` : `모양 ${t.r}, x ${t.x}, y ${t.y}`}</td><td>({t.r}, {t.x}, {t.y})</td><td>{t.legal ? '합법 → 채택' : '규칙 위반 → 버림'}</td></tr>)}
          </tbody></table></div>
          <p style={p}>{d.kind === 'ring' ? <>이웃 블록은 후보가 이미 <b>"맞닿는 위치"</b>로 좁혀져 있어서 보드 전체에서 뽑는 것보다 효율적이고 난수도 1개만 씁니다. 그래도 겹침이나 ADC 접촉 규칙 때문에 위 표의 비율만큼 버려집니다.</> : <>매크로는 보드 어디든 뽑을 수 있어서 대부분의 뽑기가 영역 규칙에 걸려 버려집니다. 그래서 시도 횟수가 많아지고, <b>이 거부 표집이 SA 이동 시간의 상당 부분</b>입니다(⑤ 성능 분석).</>}</p>
        </div>
      </div>
    </div>}

    {run && step === SEQ.length + 1 && <div style={box}>
      <b style={{ fontSize: 13 }}>{step}. 시작 배치 — 합법이기만 한 무작위 배치</b>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'flex-start' }}>
        <HeatBoard board={run.state.board} width={360} label="시작 배치"/>
        <div style={{ flex: 1, minWidth: 280 }}>
          <div className="data-table"><table><thead><tr><th>블록</th><th>뽑은 횟수</th><th>(모양, x, y)</th></tr></thead><tbody>
            {final!.draws.map(dr => <tr key={dr.id}><td>{NAME[dr.id]}</td><td>{dr.tries}번</td><td>({dr.chosen!.r}, {dr.chosen!.x}, {dr.chosen!.y})</td></tr>)}
          </tbody></table></div>
          <p style={p}>시작 점수는 <b>{f1(startV)}</b>입니다. 규칙은 모두 지켰지만 점수는 좋지 않습니다(점수는 높을수록 좋고 0이 한계). SA는 이 배치를 <b>이동 하나씩 고쳐</b> 나갑니다 — 다음 탭에서 이동 하나를 끝까지 따라갑니다.</p>
        </div>
      </div>
    </div>}
  </div>
}

// ---------- 이동 하나의 전 과정 ----------
type Result = 'accept' | 'accept-worse' | 'reject' | 'illegal'
type Act = { j: number; mode: 'prefix' | 'redraw' | 'keep'; draw?: Draw; keepLegal?: boolean; before: E.Board }
type Move = {
  t: number; T: number; uI: number; uS: number; i: number; suffix: boolean; acts: Act[]; failAt?: number
  curV: number; propV?: number; delta?: number; prob?: number; u?: number; result: Result; bestV: number; before: E.Board; after?: E.Board; curAfter: number
}
function runMoves(seed: number, T0: number, N: number): { start: E.Board; startV: number; startAttempts: number; moves: Move[] } | null {
  const { rnd, log } = tracedRng(seed)
  const st0 = startRun(rnd, log); if (!st0) return null
  let cur = st0.ps, states: E.GameState[] = [E.createGame(0)]
  for (let j = 0; j < SEQ.length; j++) { const ac = { id: SEQ[j], rotation: cur[j].r, x: cur[j].x, y: cur[j].y } as E.ActiveBlock; states.push(E.lockActive(states[j], ac, states[j].queue, states[j].hold)) }
  let curV = E.evaluatePlacement(states[SEQ.length].board), best = curV
  const startV = curV, T1 = 1.5, moves: Move[] = []
  for (let t = 1; t <= N; t++) {
    const T = T0 * Math.pow(T1 / T0, (t - 1) / Math.max(1, N - 1))
    const uI = rnd(), i = Math.floor(uI * SEQ.length), uS = rnd(), suffix = uS < 0.5
    const before = states[SEQ.length].board
    const acts: Act[] = []; for (let j = 0; j < i; j++) acts.push({ j, mode: 'prefix', before: states[j].board })
    const ns = states.slice(0, i + 1), np = cur.slice(0, i); let ok = true, failAt: number | undefined
    for (let j = i; j < SEQ.length; j++) {
      const st = ns[j]
      if (j === i || suffix) {
        const d = drawTraced(st, SEQ[j], rnd, log); acts.push({ j, mode: 'redraw', draw: d, before: st.board })
        if (!d.ok) { ok = false; failAt = j; break }
        np.push(d.chosen!); ns.push(d.s2!)
      } else {
        const ac = { id: SEQ[j], rotation: cur[j].r, x: cur[j].x, y: cur[j].y } as E.ActiveBlock, legal = E.isLegalPlacement(st.board, ac)
        acts.push({ j, mode: 'keep', keepLegal: legal, before: st.board })
        if (!legal) { ok = false; failAt = j; break }
        np.push(cur[j]); ns.push(E.lockActive(st, ac, st.queue, st.hold))
      }
    }
    const base: Move = { t, T, uI, uS, i, suffix, acts, failAt, curV, result: 'illegal', bestV: best, before, curAfter: curV }
    if (!ok) { moves.push(base); continue }
    const v = E.evaluatePlacement(ns[SEQ.length].board), delta = v - curV, prob = delta >= 0 ? 1 : Math.exp(delta / T)
    const u = delta >= 0 ? undefined : rnd()
    const accepted = delta >= 0 || (u as number) < prob
    if (accepted) { cur = np; states = ns; curV = v; if (v > best) best = v }
    moves.push({ ...base, propV: v, delta, prob, u, result: !accepted ? 'reject' : delta >= 0 ? 'accept' : 'accept-worse', bestV: best, after: ns[SEQ.length].board, curAfter: curV })
  }
  return { start: st0.state.board, startV, startAttempts: st0.attempts.length, moves }
}

const RES_COLOR: Record<Result, string> = { accept: '#1D9E75', 'accept-worse': '#e67e22', reject: '#8a94a6', illegal: '#d64545' }
const RES_LABEL: Record<Result, string> = { accept: '수락 (좋아짐)', 'accept-worse': '수락 (나빠졌지만 확률로 받아들임)', reject: '거절 (나빠졌고 확률에서 탈락)', illegal: '불법 (합법 위치를 못 찾아 이동 포기)' }

function MoveChart({ start, moves, idx, onPick }: { start: number; moves: Move[]; idx: number; onPick: (i: number) => void }) {
  const W = 680, H = 150, L = 44, R = 10, Tp = 10, B = 22
  const cur = [start, ...moves.map(m => m.curAfter)], best = [start, ...moves.map(m => m.bestV)]
  const all = [...cur, ...best]; const lo = Math.min(...all), hi = Math.max(...all)
  const X = (i: number) => L + i / Math.max(1, moves.length) * (W - L - R), Y = (v: number) => Tp + (1 - (v - lo) / Math.max(1e-9, hi - lo)) * (H - Tp - B)
  return <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ maxWidth: W, display: 'block' }} role="img" aria-label="이동별 현재·최선 점수">
    <polyline points={cur.map((v, i) => `${X(i)},${Y(v)}`).join(' ')} fill="none" stroke="#5a8dee" strokeWidth={1.5}/>
    <polyline points={best.map((v, i) => `${X(i)},${Y(v)}`).join(' ')} fill="none" stroke="#1D9E75" strokeWidth={2}/>
    {moves.map((m, i) => <circle key={i} cx={X(i + 1)} cy={Y(m.curAfter)} r={i + 1 === idx ? 4.5 : 2.2} fill={RES_COLOR[m.result]} stroke={i + 1 === idx ? 'var(--text)' : 'none'} strokeWidth={1.2} onClick={() => onPick(i + 1)} style={{ cursor: 'pointer' }}/>)}
    <text x={4} y={14} fontSize={10} fill="currentColor">{f1(hi)}</text><text x={4} y={H - B + 2} fontSize={10} fill="currentColor">{f1(lo)}</text>
    <text x={L} y={H - 6} fontSize={10} fill="currentColor">파랑 = 현재 점수, 초록 = 지금까지 최선, 점 색 = 이동 결과 (눌러서 이동 선택)</text>
  </svg>
}

function MoveDetail({ mv, T0 }: { mv: Move; T0: number }) {
  const infos = useMemo(() => mv.acts.map(a => a.mode === 'redraw' ? legalInfo(a.before, SEQ[a.j]) : null), [mv])
  const redraws = mv.acts.filter(a => a.mode === 'redraw')
  return <div style={box}>
    <b style={{ fontSize: 13 }}>이동 {mv.t} — 결과: <span style={{ color: RES_COLOR[mv.result] }}>{RES_LABEL[mv.result]}</span></b>
    <div className="data-table" style={{ marginTop: 6 }}><table><thead><tr><th>단계</th><th>무슨 일이 일어났나</th><th>난수</th></tr></thead><tbody>
      <tr><td>① 블록 고르기</td><td>5개 블록 중 <b>{NAME[SEQ[mv.i]]}</b> (번호 {mv.i}) = floor(u × 5)</td><td>u = {mv.uI.toFixed(3)} → {mv.uI.toFixed(3)} × 5 = {(mv.uI * 5).toFixed(2)}</td></tr>
      <tr><td>② 뒤 블록도 다시?</td><td>{mv.suffix ? <><b>예</b> — {NAME[SEQ[mv.i]]} 뒤의 블록 {SEQ.length - 1 - mv.i}개도 모두 다시 뽑음</> : <><b>아니오</b> — 뒤 블록은 지금 위치를 유지하고 <b>합법인지만 다시 확인</b></>} (u &lt; 0.5이면 예)</td><td>u = {mv.uS.toFixed(3)}</td></tr>
      <tr><td>③ 후보 뽑기</td><td>{redraws.length}개 블록을 다시 뽑음 (아래 그림). 앞 블록이 바뀌면 뒤 블록의 후보 영역도 달라집니다.</td><td>블록마다 위 "난수 → 위치" 규칙</td></tr>
      <tr><td>④ 점수 비교</td><td>{mv.propV === undefined ? '합법 완성 배치를 만들지 못해 이동을 버림' : <>현재 {f1(mv.curV)} → 제안 {f1(mv.propV)} (Δ = {mv.delta! >= 0 ? '+' : ''}{f1(mv.delta!)})</>}</td><td></td></tr>
      <tr><td>⑤ 수락 판정</td><td>{mv.propV === undefined ? '—' : mv.delta! >= 0 ? <>좋아졌으므로 <b>무조건 수락</b></> : <>나빠졌으므로 확률 p = e<sup>Δ/T</sup> = e<sup>{f1(mv.delta!)}/{f1(mv.T)}</sup> = <b>{pct(mv.prob!)}</b> 로 수락. 난수 u = {mv.u!.toFixed(3)} {mv.u! < mv.prob! ? '< p → 수락' : '≥ p → 거절'}</>}</td><td>{mv.u !== undefined ? `u = ${mv.u.toFixed(3)}` : ''}</td></tr>
      <tr><td>온도</td><td>이 이동의 T = <b>{f1(mv.T)}</b> (T0 = {T0}에서 시작해 이동이 진행되면서 지수로 내려감)</td><td></td></tr>
    </tbody></table></div>
    <Legend/>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, margin: '6px 0' }}>
      {mv.acts.filter(a => a.mode !== 'prefix').map(a => {
        const id = SEQ[a.j], inf = infos[mv.acts.indexOf(a)]
        return <div key={a.j} style={{ maxWidth: 250 }}>
          <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 2 }}>{SHORT[id]}: {a.mode === 'redraw' ? '다시 뽑기' : '유지(합법 재확인)'}</div>
          {a.mode === 'redraw' && a.draw && <>
            <HeatBoard board={a.before} info={inf} chosen={a.draw.chosen} id={id} width={240} label={`${SHORT[id]} 후보 영역`}/>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>뽑기 공간 {a.draw.space.toLocaleString()} → 합법 {inf?.legal.toLocaleString()}개 ({inf ? pct(inf.legal / a.draw.space) : ''}) · <b>{a.draw.ok ? `${a.draw.tries}번째에 채택 (${a.draw.chosen!.r}, ${a.draw.chosen!.x}, ${a.draw.chosen!.y})` : a.draw.reason}</b></div></>}
          {a.mode === 'keep' && <><HeatBoard board={a.before} width={240} label={`${SHORT[id]} 유지`}/><div style={{ fontSize: 11, marginTop: 2, color: a.keepLegal ? 'var(--success)' : 'var(--danger)' }}>그 자리에 그대로 두면 {a.keepLegal ? '합법 ✓' : '규칙 위반 ✗ → 이동 전체를 불법 처리'}</div></>}
        </div>
      })}
    </div>
    {mv.acts.some(a => a.mode === 'prefix') && <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '2px 0' }}>앞 블록 {mv.i}개({SEQ.slice(0, mv.i).map(x => SHORT[x]).join(', ')})는 그대로 둡니다.</p>}
    {mv.after && <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, marginTop: 8 }}>
      <div><div style={{ fontSize: 12, marginBottom: 2 }}><b>이동 전</b> (현재 {f1(mv.curV)})</div><HeatBoard board={mv.before} width={260}/></div>
      <div><div style={{ fontSize: 12, marginBottom: 2 }}><b>제안 배치</b> ({f1(mv.propV!)}) → {mv.result === 'reject' ? '버림' : '채택'}</div><HeatBoard board={mv.after} width={260}/></div>
    </div>}
  </div>
}

function MovePart() {
  const [seed, setSeed] = useState(1)
  const [T0, setT0] = useState(15)
  const [idx, setIdx] = useState(1)
  const run = useMemo(() => runMoves(seed, T0, 80), [seed, T0])
  const mv = run?.moves[Math.min(idx, run.moves.length) - 1]
  const counts = run ? run.moves.reduce((a, m) => { a[m.result]++; return a }, { accept: 0, 'accept-worse': 0, reject: 0, illegal: 0 } as Record<Result, number>) : null
  return <div>
    <p style={p}>시작 배치 다음부터는 <b>이동 하나를 제안하고, 점수로 받아들일지 정하는 일</b>을 반복합니다. 아래는 같은 seed·온도로 이동 80번을 실제 엔진으로 돌린 기록입니다. 이동을 골라 그 안에서 어떤 후보 영역이 계산되고 무엇이 뽑혔는지 봅니다.</p>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', margin: '4px 0' }}>
      <label style={{ fontSize: 12 }}>seed <select value={seed} onChange={e => { setSeed(Number(e.target.value)); setIdx(1) }}>{[1, 2, 3, 4, 5, 6].map(v => <option key={v} value={v}>{v}</option>)}</select></label>
      <label style={{ fontSize: 12 }}>시작 온도 T0 <select value={T0} onChange={e => { setT0(Number(e.target.value)); setIdx(1) }}>{[5, 15, 60, 200].map(v => <option key={v} value={v}>{v}</option>)}</select></label>
      {counts && <span style={{ fontSize: 12 }}>80번 중: 수락(좋아짐) {counts.accept} · 수락(나빠짐) {counts['accept-worse']} · 거절 {counts.reject} · 불법 {counts.illegal}</span>}
    </div>
    {run && <MoveChart start={run.startV} moves={run.moves} idx={idx} onPick={setIdx}/>}
    <div style={{ display: 'flex', gap: 8, margin: '6px 0' }}>
      <button type="button" disabled={idx <= 1} onClick={() => setIdx(idx - 1)}>← 이전 이동</button>
      <input type="range" min={1} max={80} value={idx} onChange={e => setIdx(Number(e.target.value))} aria-label="이동 번호" style={{ flex: 1, maxWidth: 360 }}/>
      <button type="button" className="active" disabled={idx >= 80} onClick={() => setIdx(idx + 1)}>다음 이동 →</button>
      <span style={{ fontSize: 12, alignSelf: 'center' }}>이동 {idx}/80</span>
    </div>
    {mv ? <MoveDetail mv={mv} T0={T0}/> : <div style={box}><span style={{ fontSize: 13, color: 'var(--warning)' }}>시작 배치를 만들지 못했습니다.</span></div>}
  </div>
}

// ---------- 온도의 역할 ----------
const MEASURED_DELTA: Array<[string, string, string, string]> = [
  ['ADC만 다시 (뒤 유지)', '7%', '0.0%', '−61.6'], ['ADC + 뒤 전부', '39%', '0.0%', '−693.6'],
  ['SRAM만 다시', '45%', '0.0%', '−113.4'], ['SRAM + 뒤 전부', '100%', '0.0%', '−540.7'],
  ['SAR만 다시', '11%', '0.0%', '−16.2'], ['SAR + 뒤 전부', '100%', '0.0%', '−333.1'],
  ['CDC만 다시', '82%', '0.0%', '−47.3'], ['CDC + 뒤 전부', '100%', '0.0%', '−350.0'],
  ['CAP만 다시', '100%', '0.0%', '−379.1'], ['CAP (뒤 없음, 같은 이동)', '100%', '0.0%', '−392.6'],
]
function TempPart() {
  const [T, setT] = useState(15)
  const [T0, setT0] = useState(60)
  const [T1, setT1] = useState(1)
  const ds = [-5, -20, -60, -150, -300, -700]
  const W = 520, H = 130, L = 36, R = 8, Tp = 8, B = 22
  const tx = (f: number) => L + f * (W - L - R)
  const ty = (v: number) => Tp + (1 - Math.log10(v / T1 + 0) / Math.max(1e-9, Math.log10(Math.max(T0, T1 * 1.0001) / T1))) * (H - Tp - B)
  const curve = Array.from({ length: 41 }, (_, k) => { const f = k / 40; return [f, T0 * Math.pow(T1 / T0, f)] as const })
  return <div>
    <p style={p}><b>온도 T는 "나빠지는 이동을 얼마나 너그럽게 받아들일지"를 정하는 값입니다.</b> 이동으로 점수가 Δ만큼 변했을 때(좋아지면 Δ &gt; 0, 나빠지면 Δ &lt; 0) 수락 확률은 이렇습니다.</p>
    <ul style={ul}>
      <li>Δ ≥ 0 (좋아짐 또는 같음): <b>항상 수락</b>.</li>
      <li>Δ &lt; 0 (나빠짐): 확률 <b>p = e<sup>Δ/T</sup></b>로 수락. 난수 u를 뽑아 u &lt; p이면 수락, 아니면 거절. T가 크면 p가 커져 거의 다 받아들이고, T가 작으면 p ≈ 0이라 <b>좋아지는 이동만</b> 남습니다.</li>
      <li>온도는 시간이 가며 T0에서 T1로 <b>지수로 내려갑니다</b>: T(진행도) = T0 × (T1/T0)<sup>진행도</sup>. 처음에는 넓게 돌아다니고 끝에는 한 곳으로 모이는 것이 목적입니다.</li>
    </ul>
    <div style={box}>
      <b style={{ fontSize: 13 }}>① 같은 Δ가 온도에 따라 수락될 확률 (실제 계산)</b>
      <div style={{ margin: '6px 0' }}><label style={{ fontSize: 12 }}>T = {T} <input type="range" min={0} max={100} value={Math.round(Math.log(T / 1.5) / Math.log(300 / 1.5) * 100)} onChange={e => setT(Math.round(1.5 * Math.pow(300 / 1.5, Number(e.target.value) / 100) * 10) / 10)} style={{ verticalAlign: 'middle', width: 260 }}/></label></div>
      <div className="data-table"><table><thead><tr><th>Δ (나빠진 양)</th>{[5, 15, 60, 200].map(t => <th key={t}>T = {t}</th>)}<th>T = {T} (슬라이더)</th></tr></thead><tbody>
        {ds.map(d => <tr key={d}><td>{d}</td>{[5, 15, 60, 200].map(t => <td key={t}>{pct(Math.exp(d / t))}</td>)}<td><b>{pct(Math.exp(d / T))}</b></td></tr>)}
      </tbody></table></div>
      <p style={p}>예를 들어 점수가 <b>−300</b> 나빠지는 이동은 T=60에서 {pct(Math.exp(-300 / 60))}, T=5에서는 사실상 0입니다. 반대로 −5처럼 작은 악화는 T=5에서도 {pct(Math.exp(-5 / 5))}로 받아들입니다. <b>T는 "이 문제에서 흔한 Δ의 크기"에 맞춰야 의미가 있습니다.</b></p>
    </div>
    <div style={{ ...box, marginTop: 10 }}>
      <b style={{ fontSize: 13 }}>② 이 문제에서 흔한 Δ는 얼마인가 (측정, 2026-10-09)</b>
      <p style={p}>beam search가 찾은 좋은 배치(−134.77)에서 이동 유형마다 400번씩 제안해 보았습니다(Node, 모양 23개 엔진). <b>점수가 올라간(개선) 이동은 한 번도 없었습니다.</b> 합법인 이동의 Δ 중앙값은 다음과 같습니다.</p>
      <div className="data-table"><table><thead><tr><th>이동 유형</th><th>제안 중 합법</th><th>개선</th><th>합법 이동 Δ 중앙값</th><th>T=5 수락확률</th><th>T=60 수락확률</th></tr></thead><tbody>
        {MEASURED_DELTA.map(([name, legal, imp, med]) => { const d = Number(med.replace('−', '-')); return <tr key={name}><td>{name}</td><td>{legal}</td><td>{imp}</td><td>{med}</td><td>{pct(Math.exp(d / 5))}</td><td>{pct(Math.exp(d / 60))}</td></tr> })}
      </tbody></table></div>
      <p style={p}>좋은 배치 근처에서는 <b>제안하는 이동 대부분이 점수를 수십~수백 점 깎습니다.</b> T가 이 크기(수백)에 못 미치면 그런 이동은 거의 거절되어 현재 배치에 머물고, T가 너무 크면 좋은 배치도 곧 버려서 다시 무작위 걷기가 됩니다. 이 문제에서 어느 쪽이 나은지는 ④·⑤에서 측정합니다.</p>
    </div>
    <div style={{ ...box, marginTop: 10 }}>
      <b style={{ fontSize: 13 }}>③ 냉각 곡선 — T0, T1을 바꾸면 온도가 어떻게 내려가나</b>
      <div style={{ display: 'flex', gap: 12, margin: '6px 0' }}>
        <label style={{ fontSize: 12 }}>T0 <select value={T0} onChange={e => setT0(Number(e.target.value))}>{[5, 15, 60, 200].map(v => <option key={v} value={v}>{v}</option>)}</select></label>
        <label style={{ fontSize: 12 }}>T1 <select value={T1} onChange={e => setT1(Number(e.target.value))}>{[0.5, 1, 1.5, 3].map(v => <option key={v} value={v}>{v}</option>)}</select></label>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ maxWidth: W, display: 'block' }} role="img" aria-label="냉각 곡선">
        <polyline points={curve.map(([f, t]) => `${tx(f)},${ty(t)}`).join(' ')} fill="none" stroke="#c0a02b" strokeWidth={2}/>
        <text x={4} y={14} fontSize={10} fill="currentColor">T0 {T0}</text><text x={4} y={H - B + 2} fontSize={10} fill="currentColor">T1 {T1}</text>
        <text x={L} y={H - 6} fontSize={10} fill="currentColor">0 (시작) ──────── 진행도 ──────── 1 (끝). 세로축은 로그 눈금</text>
      </svg>
      <p style={p}>이동 {'N'}번 중 k번째의 온도는 T0 × (T1/T0)<sup>(k−1)/(N−1)</sup>입니다(화면 ② 탭), 시간 기준 실행(⑤의 SA)에서는 진행도 = 경과 시간 / 예산입니다.</p>
    </div>
  </div>
}

// ---------- 설정값 역할 ----------
function SettingsPart() {
  return <div>
    <p style={p}>이 대시보드의 SA(<code>chipSearch.ts</code>의 <code>saTimed</code>)에는 아래 설정이 있습니다. "측정된 영향"이 비어 있는 것은 <b>아직 안 잰 것</b>입니다.</p>
    <div className="data-table"><table><thead><tr><th>설정</th><th>값</th><th>역할</th><th>측정된 영향</th></tr></thead><tbody>
      <tr><td><b>seed</b></td><td>1, 2, 3 …</td><td>난수열을 정함 → 시작 배치, 매 이동의 선택, 수락 판정이 모두 결정됨. 같은 seed·설정이면 이동 횟수가 같을 때 결과가 같음(시간 기준 실행은 속도에 따라 이동 수가 달라 완전 재현은 아님)</td><td><b>크다</b>: 같은 설정에서 seed별 최선 점수가 −133 ~ −181 (표준편차 약 17~19)</td></tr>
      <tr><td><b>예산</b> (시간 또는 이동 횟수)</td><td>8~60초</td><td>얼마나 오래 이동을 시도하는지. 온도 진행도도 이 예산 기준</td><td>측정: ⑤의 긴 실행 표</td></tr>
      <tr><td><b>T0</b> (시작 온도)</td><td>대시보드 기본 60, 시험 5~200</td><td>처음에 나빠지는 이동을 얼마나 받아들일지</td><td><b>크다</b>: 8초·seed 6개 중앙값이 T0=5에서 −136.2, 15에서 −138.0, 60에서 −144.5, 200에서 −171.5</td></tr>
      <tr><td><b>T1</b> (끝 온도)</td><td>1 (단계 그림은 1.5)</td><td>끝에서 얼마나 "좋아지는 이동만" 남기는지</td><td>미측정</td></tr>
      <tr><td><b>냉각 방식</b></td><td>지수: T0 × (T1/T0)^진행도</td><td>온도를 내리는 모양</td><td>미측정 (선형 등과 비교 안 함)</td></tr>
      <tr><td><b>이동할 블록</b></td><td>5개 중 균등</td><td>매번 어느 블록을 고칠지</td><td>미측정 (블록별 가중 안 함)</td></tr>
      <tr><td><b>뒤 블록도 다시</b></td><td>50%</td><td>블록 하나만 옮기면 뒤 블록이 새 앞 블록과 맞지 않아 불법이 되는 일이 많아서, 절반은 뒤를 통째로 다시 뽑음</td><td>부분 측정: 뒤를 유지하면 합법 제안 비율이 7~11%(ADC, SAR)로 낮고, 다시 뽑으면 39~100% (이동 통계)</td></tr>
      <tr><td><b>뽑기 방식</b></td><td>균등 무작위 + 거부</td><td>매크로는 보드 전체에서, 이웃 블록은 이웃 띠에서 뽑고 규칙 위반이면 버리고 다시 뽑음. 최대 400번</td><td>측정: 이동 1번이 5~15 ms (캐시 전), 대부분이 뽑기와 접두 상태 재생성</td></tr>
      <tr><td><b>막다른 길 재시작</b></td><td>최대 60번</td><td>시작 배치를 만들다 합법 위치가 없으면 처음부터 다시</td><td>seed 1~6 중 재시작이 있었던 경우는 화면 ①에서 확인</td></tr>
      <tr><td><b>평가 함수</b></td><td><code>evaluatePlacement</code></td><td>합법 완성 배치에만 점수를 매김. beam search와 같은 식</td><td>식과 항목은 "beam search 점수" 화면 참고</td></tr>
    </tbody></table></div>
    <p style={p}>설정값의 바탕에 있는 구조를 한 줄로 쓰면: <b>"합법 배치만 만들고(하드 규칙은 뽑을 때 걸러냄), 점수로 받아들일지 정한다(소프트 비용은 점수에 들어감)"</b>입니다. 규칙을 나중에 한꺼번에 검사하지 않습니다.</p>
  </div>
}

// ---------- 탐색 공간과 성능 차이 분석 ----------
type SpaceRow = { id: E.BlockId; space: number; legal: number }
function SpaceProbe() {
  const [rows, setRows] = useState<SpaceRow[] | null>(null)
  const [hist, setHist] = useState<{ scores: number[]; beam: number | null } | null>(null)
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])   // 탭을 떠나면 계산을 멈춘다
  const run = async () => {
    setBusy(true); setRows(null); setHist(null)
    const tick = () => new Promise<void>(r => setTimeout(r, 0))
    // (a) 무작위 합법 접두 6개에서 블록마다 뽑기 공간과 합법 위치 수의 평균
    const acc: Record<string, { space: number[]; legal: number[] }> = {}; SEQ.forEach(id => { acc[id] = { space: [], legal: [] } })
    for (let s = 1; s <= 6; s++) {
      setMsg(`후보 영역 측정 ${s}/6`); await tick(); if (!alive.current) return
      const { rnd, log } = tracedRng(300 + s); let st = E.createGame(0)
      for (const id of SEQ) { const inf = legalInfo(st.board, id); acc[id].space.push(inf.space); acc[id].legal.push(inf.legal); const d = drawTraced(st, id, rnd, log); if (!d.ok) break; st = d.s2! }
    }
    const mean = (a: number[]) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0
    setRows(SEQ.map(id => ({ id, space: mean(acc[id].space), legal: mean(acc[id].legal) })))
    // (b) 무작위 합법 완성 배치 300개의 점수 분포
    const scores: number[] = []; const { rnd, log } = tracedRng(777)
    for (let k = 0; k < 300; k++) {
      let st = E.createGame(0), ok = true
      for (const id of SEQ) { const d = drawTraced(st, id, rnd, log); if (!d.ok) { ok = false; break } st = d.s2! }
      if (ok) scores.push(E.evaluatePlacement(st.board))
      if (k % 15 === 0) { setMsg(`무작위 합법 배치 점수 ${k}/300`); await tick(); if (!alive.current) return }
    }
    setHist({ scores, beam: null })
    setMsg('beam search K=8 계산 중…'); const b = await beamAsync(8, 4, undefined, undefined, () => !alive.current)
    if (!alive.current) return
    setHist({ scores, beam: b.top[0]?.value ?? null }); setMsg(''); setBusy(false)
  }
  const est = rows ? rows.reduce((a, r) => a * Math.max(1, r.legal), 1) : 0
  const bins = (() => {
    if (!hist || !hist.scores.length) return null
    const lo = Math.min(...hist.scores, hist.beam ?? 0), hi = Math.max(...hist.scores, hist.beam ?? -1e9), n = 24, w = (hi - lo) / n || 1
    const counts = Array<number>(n).fill(0); hist.scores.forEach(v => { counts[Math.min(n - 1, Math.floor((v - lo) / w))]++ })
    return { lo, hi, w, n, counts, max: Math.max(...counts) }
  })()
  return <div style={{ ...box, marginTop: 10 }}>
    <b style={{ fontSize: 13 }}>실시간 측정 — SA가 접근할 수 있는 공간은 얼마나 넓고, 좋은 배치는 얼마나 드문가</b>
    <div style={{ display: 'flex', gap: 10, alignItems: 'center', margin: '6px 0' }}>
      <button type="button" className="active" disabled={busy} onClick={() => { void run() }}>{busy ? '측정 중…' : '측정 실행 (약 10~30초)'}</button>
      {busy && <span style={{ fontSize: 12, color: 'var(--warning)' }}>{msg}</span>}
    </div>
    {rows && <>
      <div className="data-table"><table><thead><tr><th>블록</th><th>뽑기 공간 (평균)</th><th>합법 위치 (평균)</th><th>한 번 뽑아 합법일 확률</th></tr></thead><tbody>
        {rows.map(r => <tr key={r.id}><td>{NAME[r.id]}</td><td>{Math.round(r.space).toLocaleString()}</td><td>{Math.round(r.legal).toLocaleString()}</td><td>{pct(r.legal / Math.max(1, r.space))}</td></tr>)}
      </tbody></table></div>
      <p style={p}>무작위 합법 접두 6개에서 잰 평균입니다. 블록별 합법 위치 수의 곱 ≈ <b>{est.toExponential(1)}</b> 가지의 합법 완성 배치가 있다는 거친 추정입니다(앞 선택이 뒤 후보 수를 바꾸는 효과와 같은 배치가 겹치는 효과는 무시한 <b>추정치</b>). SA는 이론상 이 전체에서 움직일 수 있고, beam search는 단계마다 K개 가지만 확장하므로 훨씬 좁은 부분만 봅니다.</p>
    </>}
    {bins && hist && <>
      <b style={{ fontSize: 12 }}>무작위 합법 배치 {hist.scores.length}개의 점수 분포 <span style={{ fontWeight: 400 }}>(300번 무작위로 놓아 보았고, 나머지 {300 - hist.scores.length}번은 중간에 합법 위치가 없는 막다른 길이었습니다 — SRAM의 합법 위치가 평균 {rows ? Math.round(rows.find(r => r.id === 'sram')!.legal) : 2}개뿐이라 ADC를 놓고 나면 SRAM이 들어갈 곳이 거의 없기 때문)</span></b>
      <svg viewBox="0 0 560 150" width="100%" style={{ maxWidth: 560, display: 'block' }} role="img" aria-label="무작위 합법 배치 점수 분포">
        {bins.counts.map((c, k) => <rect key={k} x={30 + k * (510 / bins.n)} y={110 - 95 * c / bins.max} width={510 / bins.n - 2} height={95 * c / bins.max} fill="#5a8dee" fillOpacity={0.7}/>)}
        <line x1={30} y1={110} x2={540} y2={110} stroke="currentColor" strokeWidth={0.5}/>
        {hist.beam !== null && <><line x1={30 + (hist.beam - bins.lo) / (bins.hi - bins.lo || 1) * 510} y1={14} x2={30 + (hist.beam - bins.lo) / (bins.hi - bins.lo || 1) * 510} y2={110} stroke="#1D9E75" strokeWidth={2}/><text x={Math.min(430, 34 + (hist.beam - bins.lo) / (bins.hi - bins.lo || 1) * 510)} y={12} fontSize={10} fill="#1D9E75">beam search K=8: {f1(hist.beam)}</text></>}
        <text x={30} y={126} fontSize={10} fill="currentColor">{f1(bins.lo)}</text><text x={500} y={126} fontSize={10} fill="currentColor">{f1(bins.hi)}</text>
        <text x={30} y={142} fontSize={10} fill="currentColor">점수(높을수록 좋음) — 막대 높이 = 그 점수대의 무작위 배치 수</text>
      </svg>
      <p style={p}>무작위로 뽑은 합법 배치 중 가장 좋은 것은 <b>{f1(Math.max(...hist.scores))}</b>, 중앙값은 <b>{f1([...hist.scores].sort((a, b) => a - b)[Math.floor(hist.scores.length / 2)])}</b>입니다.{hist.beam !== null && <> beam search 점수 {f1(hist.beam)} 이상인 무작위 배치는 <b>{hist.scores.filter(v => v >= hist.beam!).length}개</b>(전체 {hist.scores.length}개 중)입니다. 즉 <b>합법 배치는 많지만 좋은 배치는 극히 드뭅니다.</b> 공간이 넓다는 것은 SA에게 장점이 아니라 "찾아야 할 곳이 넓다"는 뜻입니다.</>}</p>
    </>}
  </div>
}

function AnalysisPart() {
  return <div>
    <p style={p}><b>질문:</b> SA는 완성된 배치 어디로든 움직일 수 있어 탐색 영역이 더 넓은데, 왜 같은 문제에서 beam search보다 결과가 나쁘게 나왔는가? 아래는 <b>2026-10-09에 이 엔진으로 잰 것</b>(Node에서 실행, 모양 23개 엔진, <code>rotationsFor</code> 캐시 후)과 이 화면에서 직접 돌려 볼 수 있는 측정입니다. 확정/가설을 구분해서 적었습니다.</p>
    <SpaceProbe/>

    <div style={{ ...box, marginTop: 10 }}>
      <b style={{ fontSize: 13 }}>1. 같은 시간에 하는 일의 양 (측정)</b>
      <div className="data-table"><table><thead><tr><th>항목</th><th>beam search</th><th>SA</th></tr></thead><tbody>
        <tr><td>한 단위 비용</td><td>후보 1개 검사 ≈ 0.8 ms (22,193번 검사에 17.9초, 캐시 전)</td><td>이동 1번 ≈ 5.5 ms(블록 1개) ~ 14.9 ms(뒤 전부) (캐시 전, 모양 8개)</td></tr>
        <tr><td>8초 동안</td><td>K=8은 약 1.5~2.2초에 끝남 (캐시 후)</td><td>이동 약 2,200~3,900번 (캐시 후) / 640~710번 (캐시 전, 모양 8개). 점수를 계산한 배치는 그중 약 2/3</td></tr>
        <tr><td>캐시의 효과</td><td colSpan={2}>모양 목록(<code>rotationsFor</code>)을 매번 다시 만들던 것을 한 번만 만들게 함: beam K=8 6.5초 → 1.5초(모양 8개), 42.6초 → 2.2초(모양 23개). SA 이동 수 약 5배</td></tr>
      </tbody></table></div>
      <p style={p}>시간당 처리량은 구현 차이이고, <b>캐시 전의 SA는 8초에 이동이 700번 정도라 탐색 자체가 매우 짧았습니다.</b> "결과 비교" 탭의 실시간 SA도 캐시 전에는 이 영향을 받았습니다.</p>
    </div>

    <div style={{ ...box, marginTop: 10 }}>
      <b style={{ fontSize: 13 }}>2. 온도 설정 (측정, 8초 · seed 6개 · T1 = 1 · 접두 상태를 재사용하는 빠른 SA)</b>
      <div className="data-table"><table><thead><tr><th>T0</th><th>최선 점수 중앙값</th><th>평균 (표준편차)</th><th>가장 좋은 seed</th><th>수락률</th><th>seed별 최선</th></tr></thead><tbody>
        <tr><td>5</td><td><b>−136.19</b></td><td>−143.0 (18.9)</td><td>−133.12</td><td>5.2%</td><td>−133 −181 −133 −138 −135 −138</td></tr>
        <tr><td>15</td><td>−138.03</td><td>−143.8 (16.4)</td><td>−135.06</td><td>6.6%</td><td>−137 −177 −135 −139 −139 −135</td></tr>
        <tr><td>60 (기존 기본값)</td><td>−144.53</td><td>−150.8 (17.8)</td><td>−135.06</td><td>10.6%</td><td>−151 −179 −135 −137 −164 −138</td></tr>
        <tr><td>200</td><td>−171.50</td><td>−171.4 (34.0)</td><td>−134.79</td><td>15.6%</td><td>−215 −150 −139 −193 −196 −135</td></tr>
      </tbody></table></div>
      <p style={p}>8초·seed 6개의 빠른 SA(접두 상태 재사용)에서는 T0=5가 중앙값 −136.19로 beam search K=8(−134.77)과 비슷했고 T0=60(−144.53)보다 나았습니다. 그러나 <b>대시보드의 SA(<code>saTimed</code>)로 15초·seed 4개를 다시 재면 순서가 뒤집힙니다</b>: T0=60은 중앙값 −136.4, T0=5는 −140.2(60초에서는 −140.1 대 −134.1). 즉 <b>T0 5~60은 seed 4~6개(표준편차 17~19)로는 구별되지 않고, 확실한 것은 T0=200이 나쁘다는 것뿐입니다.</b> 이 문서의 이전 판은 "기본 T0=60이 너무 뜨거워서 SA가 나빠 보였다"고 적었지만 그 주장은 철회합니다. 이전에 SA가 −150 ~ −190으로 보였던 것은 온도보다 <b>구현 속도</b>가 큰 몫이었던 것으로 보입니다: 같은 T0=60 SA의 15초 중앙값이 캐시 전 −173.6 → 캐시 후 −136.4이고 이동 수가 약 5배가 되었습니다(모양 수도 달랐으므로 원인을 단정하지는 않습니다).</p>
      <b style={{ fontSize: 13 }}>2-1. 대시보드 SA(saTimed) 재측정 (2026-10-09, seed 1~4, T1=1.5, 현재 엔진)</b>
      <div className="data-table"><table><thead><tr><th>T0</th><th>15초 중앙값 (최고 ~ 최악)</th><th>60초 중앙값 (최고 ~ 최악)</th></tr></thead><tbody>
        <tr><td>60</td><td>−136.4 (−132.9 ~ −165.8)</td><td>−140.1 (−133.2 ~ −147.6)</td></tr>
        <tr><td>5</td><td>−140.2 (−133.1 ~ −163.4)</td><td>−134.1 (−132.7 ~ −143.0)</td></tr>
      </tbody></table></div>
      <p style={p}>이동의 약 1/3이 합법 완성 배치를 만들지 못해 버려집니다(15초에 17,641회 중 5,758회, T0=5에서는 28,094회 중 9,266회).</p>
    </div>

    <div style={{ ...box, marginTop: 10 }}>
      <b style={{ fontSize: 13 }}>2-2. 시간을 늘리면 (측정, 기존 기본 온도 T0=60 · seed 4개 · 접두 상태를 재사용하는 빠른 SA)</b>
      <div className="data-table"><table><thead><tr><th>예산</th><th>최선 점수 중앙값</th><th>가장 좋은 seed</th><th>seed별 최선</th></tr></thead><tbody>
        <tr><td>8초</td><td>−156.63</td><td>−133.03</td><td>−133 −136 −178 −178</td></tr>
        <tr><td>40초</td><td><b>−134.23</b></td><td>−133.22</td><td>−157 −133 −135 −134</td></tr>
        <tr><td>비교: beam search</td><td colSpan={3}>K=32가 모양 8개 엔진에서 3.7초 −133.14(4칸 키), 모양 23개·현재 엔진에서 4.6~5.3초 −132.74(4칸 키) / −132.70(정확한 키)</td></tr>
      </tbody></table></div>
      <p style={p}>기본 온도에서도 <b>시간을 5배(40초) 주면 중앙값이 −134.2</b>까지 옵니다. 같은 문제에서 beam search K=32는 정확한 키로 5.3초에 −132.70(4칸 키 4.6초에 −132.74)이므로 <b>SA가 이 점수대에 닿는 시간은 beam search의 약 8배</b>입니다. 같은 seed 1이라도 8초 실행 결과가 위 표(−133)와 2번 표의 T0=60 줄(−151)에서 다릅니다 — <b>시간 기준 실행은 이동 수가 그때그때 달라서 같은 seed여도 재현되지 않습니다.</b> 이동 횟수를 고정하면 재현됩니다(화면 ⑤ 아래 "직접 돌려 보기").</p>
    </div>

    <div style={{ ...box, marginTop: 10 }}>
      <b style={{ fontSize: 13 }}>3. 이동 제안이 거칠다 (측정, 가설과 구분)</b>
      <ul style={ul}>
        <li><b>측정:</b> beam search의 좋은 배치(−134.77)에서 모든 이동 유형 400번씩 제안했을 때 <b>개선은 0건</b>이었습니다. SA를 3초 돌린 시점의 배치(−163.5)에서는 개선이 0~1.0%이고 개선 폭도 최대 +18.1이었습니다. 대부분의 이동이 수십~수백 점을 깎습니다(② 탭).</li>
        <li><b>측정:</b> 제안한 이동의 합법 비율이 낮은 유형이 있습니다. "ADC만 다시 + 뒤 유지"는 7%, "SAR만 다시 + 뒤 유지"는 11%만 합법이라 대부분 헛수고입니다.</li>
        <li><b>가설(미검증):</b> 블록을 "균등 무작위 위치"로 다시 뽑는 것이 원인입니다. 좋은 배치 근처를 조금씩 바꾸는 이동(±1~2칸, 모양만 바꾸기, 뒤 블록은 이웃 띠에서 가장 좋은 곳으로 다시 놓기)으로 바꾸면 더 효율적일 가능성이 큽니다. 이 이동 방식은 아직 구현해서 재 보지 않았습니다. (기존 9절의 "국소 이동 SA"는 beam 결과가 이미 국소 최적이라 개선하지 못했다는 측정이었고, 이 가설과는 다른 실험입니다.)</li>
      </ul>
    </div>

    <div style={{ ...box, marginTop: 10 }}>
      <b style={{ fontSize: 13 }}>4. 모양을 8개에서 23개로 늘렸을 때 (측정)</b>
      <div className="data-table"><table><thead><tr><th>방법</th><th>모양 8개 (SAR·CAP) / 6개 (CDC)</th><th>모양 23개 / 8개</th></tr></thead><tbody>
        <tr><td>beam search K=8 (4칸 버킷)</td><td>−136.51 (1.5초)</td><td>−134.77 (2.2초)</td></tr>
        <tr><td>beam search K=32</td><td>−133.14 (3.7초)</td><td>−132.74 (5.8초)</td></tr>
        <tr><td>SA T0=60, 8초, seed 8개, 접두 재사용 SA 중앙값</td><td>−144.6 (최고 −134.6)</td><td>−180.2 (최고 −147.5)</td></tr>
        <tr><td>같은 설정, 접두 재사용 없는 SA 중앙값</td><td>−166.3 (최고 −145.6)</td><td>−167.2 (최고 −141.3)</td></tr>
      </tbody></table></div>
      <p style={p}>beam search는 모양이 늘어도 소폭만 좋아졌고(−136.51 → −134.77, 1.3%), SA는 한 구현에서는 크게 나빠졌지만(−144.6 → −180.2) 다른 구현(같은 알고리즘, 접두만 재사용 안 함)에서는 변화가 없었습니다(−166.3 → −167.2). 두 구현의 합친 평균은 −158.7 → −171.5(각 16회)로 <b>"공간이 커지면 SA가 나빠진다"는 약한 증거</b>일 뿐 결론은 아닙니다. 새 모양을 쓰면 점수가 크게 좋아지지 않는 이유는 점수식에 "나눠 놓으면 이득"을 주는 항이 없기 때문입니다(배선 길이가 늘거나 격리 감점이 붙을 뿐).</p>
    </div>

    <div style={{ ...box, marginTop: 10 }}>
      <b style={{ fontSize: 13 }}>5. 결론 — 탐색 영역이 넓은데 왜 결과가 나쁜가</b>
      <ol style={ul}>
        <li><b>(측정)</b> 합법 배치는 많지만 좋은 배치는 극히 드뭅니다(위 분포). 넓은 영역은 <b>찾아야 할 곳이 넓다</b>는 뜻이지 좋은 해가 더 많다는 뜻이 아닙니다.</li>
        <li><b>(측정)</b> 좋은 배치 근처에서 SA가 제안하는 이동은 거의 전부 점수를 깎아서, <b>온도가 이 Δ 크기에 맞지 않으면 사실상 무작위 재시작</b>이 될 수 있습니다. 다만 측정에서는 T0 5~60이 seed 4~6개로 구별되지 않았고(위 2-1표), T0=200만 확실히 나빴습니다. 시간을 더 주면 기본 온도에서도 40초에 중앙값 −134.2에 닿았습니다.</li>
        <li><b>(측정)</b> 구현이 느렸습니다. 모양 목록을 매번 만들고 앞 블록 상태를 매번 다시 만들어 8초에 이동이 700번 안팎이었고, 캐시 후 약 5배가 되었습니다. 같은 SA의 15초 중앙값도 −173.6 → −136.4로 바뀌었습니다(모양 수도 달랐음). <b>이전 "SA가 훨씬 나쁘다"의 큰 몫은 이것이었던 것으로 보입니다.</b></li>
        <li><b>(측정)</b> beam search는 이웃 블록을 <b>이웃 띠의 모든 후보</b>에서 고릅니다. SA는 같은 띠에서 <b>무작위로 하나</b> 고릅니다. beam search가 한 단계에서 후보 수백 개를 전부 보는 일을 SA는 이동 수백 번에 걸쳐 확률적으로 합니다.</li>
        <li><b>(약한 증거)</b> 후보 모양이 늘면 SA는 더 어려워집니다.</li>
        <li><b>(해석)</b> SA에게 유리한 쪽은 beam search의 약점인 <b>부분 점수와 순서 의존</b>이 없다는 점입니다. 같은 문제에서 beam search는 순서에 따라 −133에서 −553까지 갈렸습니다(beam search 화면의 순서 실험).</li>
      </ol>
      <p style={p}><b>개선 제안(미구현):</b> ① T0와 냉각 스케줄을 seed 10개 이상으로 다시 재기(지금은 구별 안 됨) ② 좋은 배치 근처의 작은 이동(위치 ±k칸, 모양 바꾸기)을 이동 집합에 추가 ③ 뒤 블록을 무작위가 아니라 이웃 띠에서 점수가 가장 좋은 곳으로 다시 놓기(대규모 이웃 탐색) ④ beam search로 상위 K개를 만든 뒤 그중에서 SA 시작 ⑤ 여러 seed를 짧게 돌리고 가장 좋은 것만 이어서 돌리기. 효과는 각각 재 봐야 압니다.</p>
    </div>
  </div>
}

// ---------- 같은 seed로 T0만 바꿔 직접 돌려 보기 ----------
type LiveRow = { T0: number; seed: number; best: number; accRate: number; worse: number; moves: number; ms: number }
function saN(seed: number, N: number, T0: number): LiveRow | null {
  const { rnd, log } = tracedRng(seed)
  const st0 = startRun(rnd, log); if (!st0) return null
  let cur = st0.ps, states: E.GameState[] = [E.createGame(0)]
  for (let j = 0; j < SEQ.length; j++) { const ac = { id: SEQ[j], rotation: cur[j].r, x: cur[j].x, y: cur[j].y } as E.ActiveBlock; states.push(E.lockActive(states[j], ac, states[j].queue, states[j].hold)) }
  let curV = E.evaluatePlacement(states[SEQ.length].board), best = curV, acc = 0, worse = 0, evals = 0
  const t0 = performance.now()
  for (let t = 0; t < N; t++) {
    const T = T0 * Math.pow(1 / T0, t / Math.max(1, N - 1))
    const i = Math.floor(rnd() * SEQ.length), suffix = rnd() < 0.5
    const ns = states.slice(0, i + 1), np = cur.slice(0, i); let ok = true
    for (let j = i; j < SEQ.length && ok; j++) {
      const st = ns[j]
      if (j === i || suffix) { const d = drawTraced(st, SEQ[j], rnd, log); if (!d.ok) { ok = false; break } np.push(d.chosen!); ns.push(d.s2!) }
      else { const ac = { id: SEQ[j], rotation: cur[j].r, x: cur[j].x, y: cur[j].y } as E.ActiveBlock; if (!E.isLegalPlacement(st.board, ac)) { ok = false; break } np.push(cur[j]); ns.push(E.lockActive(st, ac, st.queue, st.hold)) }
    }
    log.length = 0
    if (!ok) continue
    evals++
    const v = E.evaluatePlacement(ns[SEQ.length].board)
    if (v >= curV || rnd() < Math.exp((v - curV) / T)) { if (v < curV) worse++; cur = np; states = ns; curV = v; acc++; if (v > best) best = v }
  }
  return { T0, seed, best, accRate: evals ? acc / evals : 0, worse, moves: N, ms: performance.now() - t0 }
}

function LiveSa() {
  const [rows, setRows] = useState<LiveRow[]>([])
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])   // 탭을 떠나면 계산을 멈춘다
  const run = async () => {
    setBusy(true); setRows([]); const out: LiveRow[] = []
    for (const T0 of [5, 15, 60, 200]) for (const seed of [1, 2]) {
      setMsg(`T0=${T0}, seed ${seed} 계산 중… (${out.length + 1}/8)`); await new Promise(r => setTimeout(r, 20))
      if (!alive.current) return
      const r = saN(seed, 3000, T0); if (r) { out.push(r); setRows([...out]) }
    }
    setMsg(''); setBusy(false)
  }
  return <div style={{ ...box, marginTop: 10 }}>
    <b style={{ fontSize: 13 }}>SA 직접 돌려 보기 — 같은 seed에서 T0만 바꿔 이동 3,000번</b>
    <p style={p}>이동 횟수를 고정(시간 기준이 아님)해서 이 브라우저에서 같은 조건으로 돌립니다(약 1분). <b>seed가 2개뿐이라 점수의 순위는 뒤섞여 나올 수 있고</b>, 온도가 점수를 어떻게 바꾸는지의 근거는 위 측정(seed 6개·8초)입니다. 이 표에서 확실히 보이는 것은 <b>T0가 클수록 수락률과 "나빠진 이동을 받아들인 수"가 늘어난다</b>는 점입니다.</p>
    <div style={{ display: 'flex', gap: 10, alignItems: 'center', margin: '6px 0' }}>
      <button type="button" className="active" disabled={busy} onClick={() => { void run() }}>{busy ? '계산 중…' : '실행 (T0 4가지 × seed 2개, 약 1분)'}</button>
      {busy && <span style={{ fontSize: 12, color: 'var(--warning)' }}>{msg}</span>}
    </div>
    {rows.length > 0 && <div className="data-table"><table><thead><tr><th>T0</th><th>seed</th><th>최선 점수</th><th>수락률</th><th>나빠진 이동을 받아들인 수</th><th>시간</th></tr></thead><tbody>
      {rows.map(r => <tr key={`${r.T0}-${r.seed}`}><td>{r.T0}</td><td>{r.seed}</td><td><b>{f1(r.best)}</b></td><td>{pct(r.accRate)}</td><td>{r.worse}</td><td>{(r.ms / 1000).toFixed(1)}초</td></tr>)}
    </tbody></table></div>}
  </div>
}

export default function SaMechanics() {
  const [tab, setTab] = useState<'start' | 'move' | 'temp' | 'set' | 'analysis'>('start')
  const TABS: Array<[typeof tab, string]> = [['start', '① seed → 시작 배치'], ['move', '② 이동 하나의 전 과정'], ['temp', '③ 온도(temperature)'], ['set', '④ 설정값 역할'], ['analysis', '⑤ 탐색 공간·성능 차이 분석']]
  return <div>
    <p style={p}>beam search 화면처럼 SA가 <b>어떻게 구현되어 있는지</b>를 실제 엔진 값으로 한 단계씩 보여 줍니다. 순서: seed에서 난수가 나오고 → 블록마다 후보 영역에서 위치가 뽑혀 시작 배치가 되고 → 이동 하나가 제안·판정되고 → 온도가 그 판정을 조절합니다.</p>
    <div className="analog-tabs" role="tablist" aria-label="SA 설명" style={{ marginBottom: 8 }}>
      {TABS.map(([id, label]) => <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>{label}</button>)}
    </div>
    {tab === 'start' && <StartPart/>}
    {tab === 'move' && <MovePart/>}
    {tab === 'temp' && <TempPart/>}
    {tab === 'set' && <SettingsPart/>}
    {tab === 'analysis' && <><AnalysisPart/><LiveSa/></>}
  </div>
}
