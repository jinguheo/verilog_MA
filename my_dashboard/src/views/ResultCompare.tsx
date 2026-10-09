// 결과 비교 탭: (1) SA와 beam search가 각각 만든 최종 배치를 이 화면에서 실제로 돌려 나란히 비교, (2) 설계 후보 1·2 비교.
// 최종 배치·점수·점수 항목·블록 위치는 모두 렌더링할 때 엔진으로 계산한 값이다(손으로 쓴 숫자 없음).
import { useEffect, useRef, useState } from 'react'
import * as E from '../game/chipTetrisEngine'
import { SEQ, COLS, ROWS, TERMS, beamAsync, saTimed, saGuidedTimed, type Found } from './chipSearch'

const p = { margin: '4px 0 8px', fontSize: 13, lineHeight: 1.8 } as const
const ul = { margin: '0 0 8px 18px', padding: 0, fontSize: 13, lineHeight: 1.8 } as const
const box = { padding: 10, borderRadius: 8, border: '1px solid var(--border-strong)', background: 'var(--surface)' } as const
const NAME: Record<string, string> = { adc: 'ADC MACRO', sram: 'SRAM MACRO', opamp: 'SAR NEAR', fifo: 'CDC EDGE', control: 'CAPTURE NEAR' }
const SHORT: Record<string, string> = { adc: 'ADC', sram: 'SRAM', opamp: 'SAR', fifo: 'CDC', control: 'CAP' }
const f1 = (x: number) => x.toFixed(1)
const f2 = (x: number) => x.toFixed(2)

type Box = { id: E.BlockId; a: number; b: number; c: number; d: number }
function boxes(board: E.Board): Box[] {
  return SEQ.map(id => { let a = 99, b = 99, c = -1, d = -1; board.forEach((row, y) => row.forEach((cell, x) => { if (cell?.id === id) { a = Math.min(a, x); c = Math.max(c, x); b = Math.min(b, y); d = Math.max(d, y) } })); return { id, a, b, c, d } }).filter(x => x.c >= 0)
}

const contrib = (board: E.Board) => { const m = E.measureBoard(board); return TERMS.map(([k, w]) => -(m[k] as number) * w) }

function FinalBoard({ board, width, overlay }: { board: E.Board; width: number; overlay?: { other: E.Board } }) {
  const mine = boxes(board), other = overlay ? boxes(overlay.other) : []
  return <svg viewBox={`0 0 ${COLS} ${ROWS}`} width={width} height={width * ROWS / COLS} style={{ display: 'block', borderRadius: 4, border: '1px solid var(--border-strong)', background: 'var(--surface-muted)' }} role="img" aria-label="최종 배치">
    {board.flatMap((row, y) => row.map((c, x) => c ? <rect key={`${x}-${y}`} x={x + 0.04} y={y + 0.04} width={0.92} height={0.92} rx={0.08} fill={E.BLOCKS[c.id].color} fillOpacity={overlay ? 0.45 : 1}/> : null))}
    {!overlay && mine.map(o => <g key={o.id}><rect x={o.a - 0.05} y={o.b - 0.05} width={o.c - o.a + 1.1} height={o.d - o.b + 1.1} fill="none" stroke="var(--text)" strokeWidth={0.2}/>
      <text x={(o.a + o.c + 1) / 2} y={(o.b + o.d + 1) / 2 + 0.35} textAnchor="middle" fontSize={1.05} fontWeight={700} fill="#fff" stroke="#000" strokeWidth={0.05} paintOrder="stroke">{SHORT[o.id]}</text></g>)}
    {overlay && mine.map(o => <rect key={`m${o.id}`} x={o.a - 0.05} y={o.b - 0.05} width={o.c - o.a + 1.1} height={o.d - o.b + 1.1} fill="none" stroke="#1f6fe0" strokeWidth={0.28}/>)}
    {overlay && other.map(o => <rect key={`o${o.id}`} x={o.a + 0.1} y={o.b + 0.1} width={o.c - o.a + 0.8} height={o.d - o.b + 0.8} fill="none" stroke="#e67e22" strokeWidth={0.28} strokeDasharray="0.6 0.4"/>)}
    {overlay && mine.map(o => <text key={`t${o.id}`} x={(o.a + o.c + 1) / 2} y={(o.b + o.d + 1) / 2 + 0.35} textAnchor="middle" fontSize={1.05} fontWeight={700} fill="var(--text)">{SHORT[o.id]}</text>)}
  </svg>
}

type Result = { dp: { top: Found[]; ms: number; legalChecks: number; K: number }; sa: NonNullable<Awaited<ReturnType<typeof saTimed>>>; guided: NonNullable<Awaited<ReturnType<typeof saGuidedTimed>>>; saSec: number; seed: number }
const cache = new Map<string, Result>()

function SaTrace({ sa, guided, dpV, dpMs }: { sa: Result['sa']; guided: Result['guided']; dpV: number; dpMs: number }) {
  const W = 640, H = 130, L = 44, R = 10, Tp = 8, B = 22
  const lo = Math.min(...sa.trace.map(t => t[1]), ...guided.trace.map(t => t[1]), dpV)
  const hi = Math.max(...sa.trace.map(t => t[1]), ...guided.trace.map(t => t[1]), dpV)
  const tmax = Math.max(sa.ms, guided.ms, dpMs)
  const X = (ms: number) => L + ms / tmax * (W - L - R), Y = (v: number) => Tp + (1 - (v - lo) / Math.max(1e-9, hi - lo)) * (H - Tp - B)
  return <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ maxWidth: W, display: 'block' }} role="img" aria-label="SA 최선 점수의 시간 변화와 beam search 결과">
    <line x1={X(dpMs)} x2={W - R} y1={Y(dpV)} y2={Y(dpV)} stroke="#1f6fe0" strokeWidth={1.4} strokeDasharray="5 3"/>
    <text x={W - R} y={Y(dpV) - 4} textAnchor="end" fontSize={10} fill="#1f6fe0">beam {f1(dpV)} ({(dpMs / 1000).toFixed(1)}초에 완료)</text>
    <circle cx={X(dpMs)} cy={Y(dpV)} r={4} fill="#1f6fe0"/>
    <polyline points={sa.trace.map(t => `${X(t[0])},${Y(t[1])}`).join(' ')} fill="none" stroke="#e67e22" strokeWidth={2}/>
    <polyline points={guided.trace.map(t => `${X(t[0])},${Y(t[1])}`).join(' ')} fill="none" stroke="#16a085" strokeWidth={2}/>
    <text x={4} y={12} fontSize={10} fill="currentColor">{f1(hi)}</text><text x={4} y={H - B + 2} fontSize={10} fill="currentColor">{f1(lo)}</text>
    <text x={L} y={H - 6} fontSize={10} fill="currentColor">시간 0 → {(tmax / 1000).toFixed(1)}초 · 주황 = 기존 SA · 초록 = beam 이후 SA</text>
  </svg>
}

function LiveCompare() {
  const [K, setK] = useState(8), [saSec, setSaSec] = useState(8), [seed, setSeed] = useState(1)
  const [res, setRes] = useState<Result | null>(null)
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const token = useRef(0)
  const run = async (k: number, sec: number, sd: number) => {
    const key = `${k}|${sec}|${sd}`
    if (cache.has(key)) { setRes(cache.get(key)!); setMsg(''); return }
    const my = ++token.current; setBusy(true); setRes(null)
    setMsg('beam search 계산 중…')
    const dp = await beamAsync(k, 4, m => { if (token.current === my) setMsg(`beam search: ${m}`) })
    if (token.current !== my) return
    setMsg(`SA 실행 중 (${sec}초)…`)
    const sa = await saTimed(sd, sec * 1000, 60, 1.5, (el, b) => { if (token.current === my) setMsg(`SA ${(el / 1000).toFixed(1)}/${sec}초 · 지금까지 최선 ${f1(b)}`) })
    if (token.current !== my) return
    if (!sa) { setMsg('SA의 합법 시작 배치를 만들지 못했습니다. seed를 바꿔 보세요.'); setBusy(false); return }
    setMsg(`beam 후보 기반 SA 실행 중 (${sec}초)…`)
    const guided = await saGuidedTimed(sd, sec * 1000, 60, 1.5,
      (el, b) => { if (token.current === my) setMsg(`beam→SA ${(el / 1000).toFixed(1)}/${sec}초 · 최선 ${f1(b)}`) }, dp.top)
    if (token.current !== my) return
    if (!guided) { setMsg('개선 SA의 합법 시작 배치를 만들지 못했습니다.'); setBusy(false); return }
    const r: Result = { dp: { ...dp, K: k }, sa, guided, saSec: sec, seed: sd }
    cache.set(key, r); setRes(r); setMsg(''); setBusy(false)
  }
  useEffect(() => { void run(K, saSec, seed); return () => { token.current++ } }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const dpBest = res?.dp.top[0], saBest = res?.sa.best
  const dpC = dpBest ? contrib(dpBest.board) : null, saC = saBest ? contrib(saBest.board) : null
  const dpBx = dpBest ? boxes(dpBest.board) : [], saBx = saBest ? boxes(saBest.board) : []
  const same = dpBx.filter(a => saBx.some(b => b.id === a.id && b.a === a.a && b.b === a.b && b.c === a.c && b.d === a.d)).length

  return <div>
    <p style={p}>같은 5블록 게임 점수에서 <b>beam search·기존 SA·beam 후보를 시작 풀로 쓰는 개선 SA</b>를 비교합니다. 개선 SA는 beam 계산 시간에 추가로 실행되므로 순수 SA와 동일 비용의 대조군은 아닙니다. 실제 DRC/STA 비교도 아닙니다.</p>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', margin: '4px 0 8px' }}>
      <label style={{ fontSize: 12 }}>빔 폭 K <select value={K} disabled={busy} onChange={e => setK(Number(e.target.value))}>{[8, 32].map(v => <option key={v} value={v}>{v}</option>)}</select></label>
      <label style={{ fontSize: 12 }}>SA 시간 <select value={saSec} disabled={busy} onChange={e => setSaSec(Number(e.target.value))}>{[8, 15, 30, 60].map(v => <option key={v} value={v}>{v}초</option>)}</select></label>
      <label style={{ fontSize: 12 }}>SA seed <select value={seed} disabled={busy} onChange={e => setSeed(Number(e.target.value))}>{[1, 2, 3, 4].map(v => <option key={v} value={v}>{v}</option>)}</select></label>
      <button type="button" className="active" disabled={busy} onClick={() => void run(K, saSec, seed)}>이 설정으로 실행</button>
      <button type="button" disabled={busy} onClick={() => { setSaSec(60); void run(K, 60, seed) }}>60초 심화 탐색</button>
      {busy && <span style={{ fontSize: 12, color: 'var(--warning)' }}>{msg}</span>}
      {!busy && msg && <span style={{ fontSize: 12, color: 'var(--danger)' }}>{msg}</span>}
    </div>
    {K === 32 && <p style={{ ...p, fontSize: 12, color: 'var(--text-secondary)' }}>K=32는 브라우저에서 20~40초 걸릴 수 있습니다(측정: node에서 13초).</p>}

    {res && dpBest && saBest && dpC && saC && <>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 18 }}>
        <div style={{ ...box, flex: 1, minWidth: 330 }}>
          <b style={{ fontSize: 13 }}>① beam search 최종 결과</b>
          <div style={{ margin: '6px 0' }}><FinalBoard board={dpBest.board} width={360}/></div>
          <div style={{ fontSize: 12, lineHeight: 1.7 }}>점수 <b style={{ fontSize: 15 }}>{f2(dpBest.value)}</b> · 위반 {E.measureBoard(dpBest.board).violations}건<br/>K={res.dp.K}, 4칸 버킷 키 · <b>{(res.dp.ms / 1000).toFixed(1)}초</b> · 합법성 검사 {res.dp.legalChecks.toLocaleString()}회<br/>결정적: 다시 돌려도 같은 결과</div>
        </div>
        <div style={{ ...box, flex: 1, minWidth: 330 }}>
          <b style={{ fontSize: 13 }}>② SA 최종 결과 (무작위 합법 시작 → 이동 {res.sa.moves.toLocaleString()}회)</b>
          <div style={{ margin: '6px 0' }}><FinalBoard board={saBest.board} width={360}/></div>
          <div style={{ fontSize: 12, lineHeight: 1.7 }}>점수 <b style={{ fontSize: 15 }}>{f2(saBest.value)}</b> · 위반 {E.measureBoard(saBest.board).violations}건<br/>seed {res.seed}, 시작 {f1(res.sa.start.value)} → 최선 · <b>{(res.sa.ms / 1000).toFixed(1)}초</b> · 수락 {res.sa.acc}회, 불법 {res.sa.illegal}회<br/>seed마다 결과가 다름(위에서 seed를 바꿔 보세요)</div>
        </div>
      </div>

      <div style={{ ...box, marginTop: 12 }}>
        <b style={{ fontSize: 13 }}>②-1 beam→개선 SA — 합법 후보 직접 생성·중복 회피·다양한 매크로 위상 보관</b>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, marginTop: 6 }}>
          <FinalBoard board={res.guided.best.board} width={360}/>
          <div style={{ fontSize: 12, lineHeight: 1.8 }}>
            최고 점수 <b style={{ fontSize: 15 }}>{f2(res.guided.best.value)}</b> · 위반 {E.measureBoard(res.guided.best.board).violations}건<br/>
            beam 시작 {f1(res.guided.start.value)} · SA {(res.guided.ms / 1000).toFixed(1)}초 · 총 {((res.dp.ms + res.guided.ms) / 1000).toFixed(1)}초 · 평가 {res.guided.evaluated.toLocaleString()}회<br/>
            이동 {res.guided.moves.toLocaleString()}회 · 수락 {res.guided.accepted.toLocaleString()}회 · 중복 제거 {res.guided.duplicates.toLocaleString()}회<br/>
            생성 실패(표본 내 합법 후속 후보 없음) {res.guided.deadEnds.toLocaleString()}회 · 합법성 검사 {res.guided.legalChecks.toLocaleString()}회 · 재시작 {res.guided.restarts}회<br/>
            서로 다른 매크로 위상별 보관 후보 {res.guided.diverse.length}개 (상위 12개)
          </div>
        </div>
        <div className="data-table" style={{ marginTop: 8 }}><table><thead><tr><th>동일 게임 점수 비교</th><th>beam search</th><th>기존 SA</th><th>beam→개선 SA</th></tr></thead><tbody>
          <tr><td>최고 점수 ↑</td><td>{f2(dpBest.value)}</td><td>{f2(saBest.value)}</td><td>{f2(res.guided.best.value)}</td></tr>
          <tr><td>실행 시간</td><td>{(res.dp.ms / 1000).toFixed(1)}초</td><td>{(res.sa.ms / 1000).toFixed(1)}초</td><td>{((res.dp.ms + res.guided.ms) / 1000).toFixed(1)}초 (beam 포함)</td></tr>
          <tr><td>후보 다양성</td><td>최종 {res.dp.top.length}개</td><td>최고 1개만 기록</td><td>매크로 위상 {res.guided.diverse.length}개</td></tr>
        </tbody></table></div>
        <p style={{ ...p, fontSize: 12, color: 'var(--text-secondary)' }}>품질 우선 하이브리드에는 beam 계산 시간이 추가됩니다. beam은 고정 K, SA는 시간 예산이므로 동일 평가 횟수 실험은 아닙니다. 개선 SA는 확정된 게임 hard rule만 사전 제거하며 Magic DRC 통과를 주장하지 않습니다.</p>
      </div>

      <div style={{ ...box, marginTop: 12 }}>
        <b style={{ fontSize: 13 }}>③ 두 결과 겹쳐 보기 — 파랑 실선 = beam search, 주황 점선 = SA</b>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 18, alignItems: 'flex-start', marginTop: 6 }}>
          <FinalBoard board={dpBest.board} width={360} overlay={{ other: saBest.board }}/>
          <div style={{ flex: 1, minWidth: 280, fontSize: 13, lineHeight: 1.8 }}>
            <b>같은 위치·모양의 블록: {same} / {dpBx.length}개</b>
            <div className="data-table" style={{ marginTop: 4 }}><table><thead><tr><th>블록</th><th>beam search 위치(칸) → µm</th><th>SA 위치(칸) → µm</th><th>차이</th></tr></thead><tbody>
              {SEQ.map(id => { const a = dpBx.find(b => b.id === id), b = saBx.find(x => x.id === id); if (!a || !b) return null
                const dx = b.a - a.a, dy = b.b - a.b, sameShape = (a.c - a.a === b.c - b.a) && (a.d - a.b === b.d - b.b)
                return <tr key={id}><td>{NAME[id]}</td><td>({a.a},{a.b}) {a.c - a.a + 1}×{a.d - a.b + 1} → ({a.a * 50},{a.b * 50})</td><td>({b.a},{b.b}) {b.c - b.a + 1}×{b.d - b.b + 1} → ({b.a * 50},{b.b * 50})</td>
                  <td style={{ color: dx || dy || !sameShape ? 'var(--warning)' : 'var(--success)', fontWeight: 700 }}>{dx || dy || !sameShape ? `${dx >= 0 ? '+' : ''}${dx}, ${dy >= 0 ? '+' : ''}${dy}칸${sameShape ? '' : ' · 모양 다름'}` : '같음'}</td></tr> })}
            </tbody></table></div>
          </div>
        </div>
      </div>

      <div style={{ ...box, marginTop: 12 }}>
        <b style={{ fontSize: 13 }}>④ 점수가 어디서 갈렸나 — 항목별 기여 (0에 가까울수록 좋음)</b>
        <div className="data-table" style={{ marginTop: 6 }}><table><thead><tr><th>점수 항목 (가중치)</th><th>beam search</th><th>SA</th><th>SA − beam search</th></tr></thead><tbody>
          {TERMS.map(([k, w, label], i) => (dpC[i] === 0 && saC[i] === 0) ? null : <tr key={k}><td>{label} ({w})</td><td>{f2(dpC[i])}</td><td>{f2(saC[i])}</td>
            <td style={{ color: saC[i] - dpC[i] < -1e-9 ? 'var(--danger)' : saC[i] - dpC[i] > 1e-9 ? 'var(--success)' : undefined, fontWeight: 700 }}>{saC[i] - dpC[i] >= 0 ? '+' : ''}{f2(saC[i] - dpC[i])}</td></tr>)}
          <tr style={{ fontWeight: 700 }}><td>합계</td><td>{f2(dpC.reduce((a, b) => a + b, 0))}</td><td>{f2(saC.reduce((a, b) => a + b, 0))}</td><td>{f2(saC.reduce((a, b) => a + b, 0) - dpC.reduce((a, b) => a + b, 0))}</td></tr>
          <tr><td>엔진 점수(검증)</td><td>{f2(dpBest.value)} {Math.abs(dpC.reduce((a, b) => a + b, 0) - dpBest.value) < 1e-6 ? '✓ 일치' : '✗ 불일치'}</td><td>{f2(saBest.value)} {Math.abs(saC.reduce((a, b) => a + b, 0) - saBest.value) < 1e-6 ? '✓ 일치' : '✗ 불일치'}</td><td></td></tr>
        </tbody></table></div>
        <p style={{ ...p, fontSize: 12, color: 'var(--text-secondary)' }}>값이 0인 항목은 두 방법 모두 0이라 생략했습니다. 표의 가중치는 엔진 점수식에서 읽은 값이고, 합계가 엔진 점수와 일치하는지 위에서 검증합니다. 빨강 = SA가 더 나쁜 항목, 초록 = SA가 더 좋은 항목.</p>
      </div>

      <div style={{ ...box, marginTop: 12 }}>
        <b style={{ fontSize: 13 }}>⑤ 시간에 따른 비교</b>
        <SaTrace sa={res.sa} guided={res.guided} dpV={dpBest.value} dpMs={res.dp.ms}/>
      </div>

      <ul style={{ ...ul, marginTop: 10 }}>
        <li><b>읽는 법:</b> beam search는 <b>한 번에</b> 정해진 결과를 내고, SA는 시간이 가면서 점수가 올라가는 곡선을 그립니다. 같은 시간에서 beam search가 앞서는 것이 보통이지만, SA에 시간과 운이 주어지면 같은 값에 닿기도 합니다(배경 지식 4·9절의 측정).</li>
        <li><b>한계:</b> 점수는 게임 proxy이며 실제 DRC·LVS가 아닙니다. 여기서 보이는 것은 한 번의 실행(SA는 seed 하나)이라 일반화하려면 seed를 바꿔 반복해야 합니다.</li>
      </ul>
    </>}
  </div>
}

function CandidateCompare() {
  const rows: Array<[string, string, string]> = [
    ['핵심 아이디어', '평가에서 나온 위반을 원인 특징값으로 기록(위반 기억)하고, 규칙을 알면 처음부터 규칙에 맞게 후보를 만든다', '적은 수의 서로 다른 실험으로 규칙·timing을 보정하고, 부분 배치를 기억하는 beam search로 후보를 체계적으로 확장한다'],
    ['탐색 방식', '진화(부모 선택·변이) + 규칙 유도 변이, 간격 예산 생성기', 'beam search(상태 = 배치 집합·점유·경계 여유 등, 전이 = 다음 블록의 위치·방향·shape)'],
    ['규칙·실패 활용', '확정된 위반은 평가 전에 차단, 가설은 벌점, 검증된 해결법은 재사용. 위반 임계값은 L1 스윕으로 이분 탐색', '확정 규칙은 전이에서 즉시 가지치기, 불확실한 규칙은 soft risk. 실행 결과를 규칙 기억에 반영'],
    ['중복 실행 방지', '(설계에 명시 없음)', '배치 signature + 설정 fingerprint로 같은 실험을 다시 돌리지 않음'],
    ['평가 단계', 'L0 게임 proxy → L1 floorplan·tap·PDN → L2 → L3', '같은 L0 ~ L3 funnel'],
    ['지금까지 측정된 것', '간격 DP가 전수 탐색과 일치(1.7435), 무작위 위치의 규칙 통과율 33~70%(균등 가정 모델), 조각 규칙 실측(9.66 µm 위반, 25.3 µm 무위반)', 'beam K=32 −133.1(13초, 4칸 버킷), K=32~256에서 −133.14로 수렴, 정확한 키 K=128(−135.0, 72초)보다 5배 빠르고 점수도 좋음. SA 처음부터 60초 최고 −140.8'],
    ['구현 상태', '미착수 (시제품만: 간격 DP, 규칙 통과율 계산)', '미착수 (시제품만: beam search, 상태 키 요약)'],
    ['위험·한계', '조각 임계값 T 미측정, "ADC 이동으로 위반 해소"는 가설(실행이 중간에 끊김), 규칙이 불완전하면 후보를 잘라낼 수 있음', 'beam은 최적 비보장, 점수는 proxy, 상태 요약(병합)은 근사'],
    ['잘 맞는 상황', '규칙·위반 이력이 풍부하고 후보를 규칙에 맞게 직접 만들 수 있을 때', '블록을 순서대로 놓는 단계 구조이고 서로 다른 상위 후보를 빠르게 얻고 싶을 때'],
  ]
  return <div>
    <div className="data-table"><table><thead><tr><th></th><th>설계 후보 1 · 규칙 인지 진화</th><th>설계 후보 2 · beam search 보조 탐색</th></tr></thead><tbody>
      {rows.map(r => <tr key={r[0]}><td><b>{r[0]}</b></td><td>{r[1]}</td><td>{r[2]}</td></tr>)}
    </tbody></table></div>
    <ul style={ul}>
      <li><b>서로 배타적이지 않습니다.</b> 후보 1의 위반 기억과 규칙 특징값은 후보 2 beam search의 <b>전이 가지치기와 risk 입력</b>이 되고, 후보 2의 beam은 후보 1의 <b>후보 생성기</b>로 쓸 수 있습니다(제안, 아직 구현·검증 전).</li>
      <li><b>둘 다 아직 설계 단계입니다.</b> 위 "측정된 것"은 시제품 실험이고, 설계안 자체의 성능을 의미하지 않습니다.</li>
    </ul>
  </div>
}

export default function ResultCompare() {
  return <div>
    <details open style={{ marginTop: 4 }}><summary style={{ cursor: 'pointer', fontSize: 14, fontWeight: 700 }}>1. SA와 beam search가 만든 최종 배치 비교 (이 화면에서 실행)</summary><div style={{ marginTop: 6 }}><LiveCompare/></div></details>
    <details open style={{ marginTop: 12, borderTop: '1px solid var(--border)', paddingTop: 8 }}><summary style={{ cursor: 'pointer', fontSize: 14, fontWeight: 700 }}>2. 설계 후보 1과 2 비교</summary><div style={{ marginTop: 6 }}><CandidateCompare/></div></details>
  </div>
}
