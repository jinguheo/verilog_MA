// beam search + SA + 간격 DP 결합 설계, 측정 결과, 그리고 GA(유전 알고리즘) 가능성 분석.
// 표의 숫자는 2026-10-09에 Node에서 같은 엔진(모양 23개, rotationsFor 캐시)으로 잰 값이며 날짜·조건을 적었다.
// 아래 '결합 실행' 버튼은 이 브라우저에서 같은 파이프라인을 실제로 돌린다(점수·시간·간격은 모두 그때 계산한 값).
import { useState } from 'react'
import * as E from '../game/chipTetrisEngine'
import { COLS, ROWS, beamAsync, type Found } from './chipSearch'
import { lnsSaTimed, gapDpFine, gapCostOf, rowKind } from './chipCombo'

const p = { margin: '4px 0 8px', fontSize: 13, lineHeight: 1.8 } as const
const ul = { margin: '0 0 8px 18px', padding: 0, fontSize: 13, lineHeight: 1.8 } as const
const box = { padding: 10, borderRadius: 8, border: '1px solid var(--border-strong)', background: 'var(--surface)' } as const
const f1 = (x: number) => x.toFixed(1)
const f2 = (x: number) => x.toFixed(2)
const SHORT: Record<string, string> = { adc: 'ADC', sram: 'SRAM', opamp: 'SAR', fifo: 'CDC', control: 'CAP' }

function MiniBoard({ board, width }: { board: E.Board; width: number }) {
  const ids = (['adc', 'sram', 'opamp', 'fifo', 'control'] as const).map(id => { let a = 99, b = 99, c = -1, d = -1; board.forEach((row, y) => row.forEach((cell, x) => { if (cell?.id === id) { a = Math.min(a, x); c = Math.max(c, x); b = Math.min(b, y); d = Math.max(d, y) } })); return { id, a, b, c, d } }).filter(o => o.c >= 0)
  return <svg viewBox={`0 0 ${COLS} ${ROWS}`} width={width} height={width * ROWS / COLS} style={{ display: 'block', borderRadius: 4, border: '1px solid var(--border-strong)', background: 'var(--surface-muted)' }} role="img" aria-label="결합 탐색 결과 배치">
    {board.flatMap((row, y) => row.map((c, x) => c ? <rect key={`${x}-${y}`} x={x + 0.04} y={y + 0.04} width={0.92} height={0.92} rx={0.08} fill={E.BLOCKS[c.id].color}/> : null))}
    {ids.map(o => <text key={o.id} x={(o.a + o.c + 1) / 2} y={(o.b + o.d + 1) / 2 + 0.35} textAnchor="middle" fontSize={1.05} fontWeight={700} fill="#fff" stroke="#000" strokeWidth={0.05} paintOrder="stroke">{SHORT[o.id]}</text>)}
  </svg>
}

function Pipeline() {
  const W = 700, H = 150
  const stage = (x: number, w: number, t: string, s1: string, s2: string, c: string) => <g key={t}>
    <rect x={x} y={20} width={w} height={74} rx={8} fill={c} fillOpacity={0.18} stroke={c} strokeWidth={1.4}/>
    <text x={x + w / 2} y={42} textAnchor="middle" fontSize={13} fontWeight={700} fill="currentColor">{t}</text>
    <text x={x + w / 2} y={62} textAnchor="middle" fontSize={11} fill="currentColor">{s1}</text>
    <text x={x + w / 2} y={78} textAnchor="middle" fontSize={11} fill="currentColor">{s2}</text></g>
  const arrow = (x: number, label: string) => <g key={label}><line x1={x} y1={57} x2={x + 30} y2={57} stroke="currentColor" strokeWidth={1.5}/><polygon points={`${x + 30},57 ${x + 24},53 ${x + 24},61`} fill="currentColor"/><text x={x + 15} y={46} textAnchor="middle" fontSize={9} fill="currentColor">{label}</text></g>
  return <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ maxWidth: W, display: 'block' }} role="img" aria-label="beam search, LNS-SA, 간격 DP 결합 흐름">
    {stage(4, 190, '① beam search', 'K=8 (≈2초)', '넓게·빠르게 위상 후보', '#2e86de')}
    {arrow(196, '상위 N')}
    {stage(228, 230, '② LNS-SA', '걷어내고 작은 beam으로 재배치', '순서 바꾸기 포함 · T0≈5', '#e67e22')}
    {arrow(460, '최선')}
    {stage(492, 204, '③ 간격 DP', '행 종류당 1회 (≈10 ms)', 'µm 간격·sliver 규칙 확정', '#16a085')}
    <text x={8} y={118} fontSize={11} fill="currentColor">공통: 합법 위치 목록 캐시 · 배치 서명 중복 제거 · 모양 목록 캐시 · 하드 규칙은 생성할 때 한 번만 검사</text>
    <text x={8} y={136} fontSize={11} fill="currentColor">③ 이후: 서로 다른 위상만 L1~L3 실제 검증으로 (위상 키로 중복 제거)</text>
  </svg>
}

type Live = { rows: Array<{ name: string; v: number; sec: number; note: string }>; beamTop: Found[]; lns: Found; gap: ReturnType<typeof gapDpFine>; kind: ReturnType<typeof rowKind>; kindCount: Map<string, number>; coarseCost: number }
function LiveCombo() {
  const [busy, setBusy] = useState(false), [msg, setMsg] = useState(''), [sec, setSec] = useState(8), [res, setRes] = useState<Live | null>(null)
  const run = async () => {
    setBusy(true); setRes(null)
    setMsg('① beam search K=8 …'); const b8 = await beamAsync(8, 4)
    const start = b8.top[0]
    setMsg(`② LNS-SA ${sec}초 …`)
    const lns = await lnsSaTimed(1, sec * 1000, 5, 1, start, 40, 3, (el, best) => setMsg(`② LNS-SA ${(el / 1000).toFixed(1)}/${sec}초 · 최선 ${f2(best)}`))
    setMsg('비교용 beam search K=32 …'); const b32 = await beamAsync(32, 4)
    setMsg('③ 간격 DP …')
    const kind = rowKind(lns.best.board), gap = gapDpFine(0.5, 15)
    const kc = new Map<string, number>(); b32.top.forEach(f => { const k = rowKind(f.board); const key = `${k.sameRow ? '같은 행' : '다른 행'}·${k.adcLeft ? 'ADC 왼쪽' : 'ADC 오른쪽'}`; kc.set(key, (kc.get(key) ?? 0) + 1) })
    setRes({
      rows: [
        { name: 'beam search K=8 (시작점)', v: start.value, sec: b8.ms / 1000, note: '결정적' },
        { name: `beam K=8 → LNS-SA ${sec}초`, v: lns.best.value, sec: (b8.ms + lns.ms) / 1000, note: `이동 ${lns.moves}회 중 ${lns.accepted}회 수락` },
        { name: 'beam search K=32 (비교)', v: b32.top[0].value, sec: b32.ms / 1000, note: '결정적, 서로 다른 후보 32개' },
      ], beamTop: b32.top, lns: lns.best, gap, kind, kindCount: kc, coarseCost: gapCostOf(kind.gaps),
    })
    setMsg(''); setBusy(false)
  }
  return <div style={{ ...box, marginTop: 10 }}>
    <b style={{ fontSize: 13 }}>결합 실행 — 이 브라우저에서 ① → ② → ③을 실제로 돌립니다</b>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', margin: '6px 0' }}>
      <label style={{ fontSize: 12 }}>LNS-SA 시간 <select value={sec} disabled={busy} onChange={e => setSec(Number(e.target.value))}>{[4, 8, 15].map(v => <option key={v} value={v}>{v}초</option>)}</select></label>
      <button type="button" className="active" disabled={busy} onClick={() => { void run() }}>{busy ? '계산 중…' : `결합 실행 (약 ${sec + 10}초)`}</button>
      {busy && <span style={{ fontSize: 12, color: 'var(--warning)' }}>{msg}</span>}
    </div>
    {res && <>
      <div className="data-table"><table><thead><tr><th>방법</th><th>최종 점수 (높을수록 좋음)</th><th>시간</th><th>비고</th></tr></thead><tbody>
        {res.rows.map(r => <tr key={r.name}><td>{r.name}</td><td><b>{f2(r.v)}</b></td><td>{r.sec.toFixed(1)}초</td><td>{r.note}</td></tr>)}
      </tbody></table></div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, marginTop: 8, alignItems: 'flex-start' }}>
        <div><MiniBoard board={res.lns.board} width={330}/><div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>② 이후 최선 배치 · 점수 {f2(res.lns.value)} · 위반 {E.measureBoard(res.lns.board).violations}건</div></div>
        <div style={{ flex: 1, minWidth: 280 }}>
          <b style={{ fontSize: 12 }}>③ 간격 DP — 거친 간격(50 µm 칸)을 µm로 확정</b>
          <div className="data-table"><table><thead><tr><th></th><th>g0 (ADC 왼쪽)</th><th>g1 (사이)</th><th>g2 (SRAM 오른쪽)</th><th>비용</th></tr></thead><tbody>
            <tr><td>거친 배치 그대로 (µm)</td><td>{res.kind.gaps[0]}</td><td>{res.kind.gaps[1]}</td><td>{res.kind.gaps[2]}</td><td>{res.kind.sameRow && res.kind.adcLeft ? res.coarseCost.toFixed(3) : '—'}</td></tr>
            <tr><td>간격 DP 결과 (0.5 µm 칸)</td><td><b>{f1(res.gap.gaps[0])}</b></td><td><b>{f1(res.gap.gaps[1])}</b></td><td><b>{f1(res.gap.gaps[2])}</b></td><td><b>{res.gap.best.toFixed(3)}</b> ({res.gap.ms.toFixed(0)} ms)</td></tr>
          </tbody></table></div>
          <p style={p}>간격 DP는 <b>행 종류가 같으면 결과가 같습니다.</b> beam K=32가 만든 서로 다른 후보 {res.beamTop.length}개의 행 종류: {[...res.kindCount.entries()].map(([k, v]) => `${k} ${v}개`).join(', ')}. 그래서 <b>후보마다 돌리지 않고 행 종류당 1번</b>({res.gap.ms.toFixed(0)} ms)만 돌리면 됩니다. 거친 간격의 합은 {res.kind.gaps[0] + res.kind.gaps[1] + res.kind.gaps[2]} µm이고 DP가 나누는 길이는 L = {f1(res.gap.L)} µm입니다 — <b>50 µm 칸의 보드와 실제 µm 사이의 차이를 이 단계가 흡수</b>합니다. 비용식은 알고리즘을 보이기 위한 예시입니다(간격 DP 화면 참고).</p>
        </div>
      </div>
    </>}
  </div>
}

export default function CombinedSearch() {
  return <div>
    <p style={p}><b>질문:</b> beam search, DP, SA는 서로 결합할 수 있는가? 결합하면 각자의 장점을 쓰고 같은 일을 되풀이하는 것을 줄일 수 있는가? 아래는 <b>설계 → 같은 시간 예산으로 비교 측정 → 직접 실행</b> 순서입니다. 측정은 모두 2026-10-09, 같은 엔진(모양 23개·캐시)에서 했고 확정/가설을 구분해 적었습니다.</p>

    <div style={box}>
      <b style={{ fontSize: 13 }}>1. 결합 구조 — 각자 잘하는 일만 맡긴다</b>
      <Pipeline/>
      <div className="data-table"><table><thead><tr><th>단계</th><th>맡는 일</th><th>이 방법이 잘하는 이유</th><th>맡기지 않는 일</th></tr></thead><tbody>
        <tr><td><b>① beam search</b></td><td>거친 위상 후보를 넓게 만든다</td><td>하드 규칙을 만들 때 거르고, 이웃 띠의 후보를 모두 본다</td><td>순서 선택(부분 점수라 순서에 민감), 마무리 미세 조정</td></tr>
        <tr><td><b>② LNS-SA</b></td><td>완성 배치에서 일부 블록을 걷어내고 작은 beam(K=2~3)으로 다시 놓는다. 걷어낼 블록과 다시 놓는 <b>순서</b>가 무작위</td><td>완성 점수로 판단하므로 부분 점수 문제가 없다. 이동 안의 재배치는 beam이 해서 무작위 뽑기를 되풀이하지 않는다</td><td>처음부터 넓게 찾기(느리고 온도에 민감)</td></tr>
        <tr><td><b>③ 간격 DP</b></td><td>선택된 위상의 µm 간격을 규칙(0 또는 ≥ T) 아래 정확히 정한다</td><td>1D 분할이라 정확해를 보장, 규칙을 하드로 처리</td><td>2D 위상 선택(NP-hard 계열이라 시도하지 않음)</td></tr>
      </tbody></table></div>
      <ul style={ul}>
        <li><b>SA의 이동을 "무작위 위치 뽑기"에서 "일부를 걷어내고 beam으로 다시 놓기"로 바꾼 것</b>이 결합의 핵심입니다. 이 방식을 큰 이웃 탐색(large neighborhood search, LNS)이라 부릅니다. SA는 <b>어느 구간을 다시 놓을지와 결과를 받아들일지</b>를, beam은 <b>그 구간 안에서 고르기</b>를 맡습니다.</li>
        <li>간격 DP는 게임 점수에 항이 없는 규칙(sliver)을 보장하는 단계입니다. 점수가 같은 후보들이 간격 DP 앞에서는 같은 결과를 얻기 때문에 점수 비교용 단계가 아니라 <b>확정 단계</b>입니다.</li>
      </ul>
    </div>

    <div style={{ ...box, marginTop: 10 }}>
      <b style={{ fontSize: 13 }}>2. 같은 일을 되풀이하지 않는 방법과 근거</b>
      <div className="data-table"><table><thead><tr><th>중복되는 일</th><th>줄이는 방법</th><th>근거</th></tr></thead><tbody>
        <tr><td>같은 접두 보드에서 합법 위치를 매번 다시 찾기</td><td>(보드 서명, 블록) → 합법 위치 목록 캐시를 단계들이 공유</td><td>측정: LNS-SA는 이 캐시로 8초에 이동 약 250회. 지금 다른 창의 guided SA도 같은 캐시를 씀</td></tr>
        <tr><td>모양 목록 재생성</td><td><code>rotationsFor</code> 캐시</td><td>측정: beam K=8 6.5초 → 1.5초(모양 8개), 42.6초 → 2.2초(모양 23개)</td></tr>
        <tr><td>SA가 앞 블록 상태를 매번 처음부터 다시 만듦</td><td>현재 배치의 접두 상태를 저장해 재사용</td><td>측정: SA 이동 수 약 1.4배</td></tr>
        <tr><td>간격 DP를 후보마다</td><td>행 종류당 1번, 결과를 캐시</td><td>측정: beam K=32의 서로 다른 후보 32개가 모두 같은 행 종류(같은 행·ADC 왼쪽) → 32번이 아니라 1번(10 ms)</td></tr>
        <tr><td>같은 배치를 다시 평가·검증</td><td>배치 서명으로 중복 제거, L1~L3로는 위상 키로 중복 제거한 것만</td><td>설계 (L1~L3 연결은 미구현)</td></tr>
        <tr><td>beam 결과에 ±2칸 국소 SA</td><td><b>하지 않는다</b></td><td>측정: 개선 0 (배경 지식 9절)</td></tr>
        <tr><td>SA를 무작위 시작 seed 여러 개로</td><td>무작위 대신 beam 결과에서 시작</td><td>측정: 무작위 시작 SA는 seed 5개 중 값이 −133.7 ~ −177.8로 크게 흔들림. 무작위 합법 배치 최고는 −307</td></tr>
        <tr><td>SA 온도 탐색</td><td>T0를 이동의 Δ 크기에 맞춰 약 5로 고정</td><td>측정: 11절 ⑤. T0=60은 8초에 중앙값 −151.9</td></tr>
      </tbody></table></div>
    </div>

    <div style={{ ...box, marginTop: 10 }}>
      <b style={{ fontSize: 13 }}>3. 같은 시간 예산으로 비교한 측정 (seed 5개, beam 시작 방법은 beam K=8 단계의 약 2초를 예산에 포함)</b>
      <div className="data-table"><table><thead><tr><th>방법</th><th>예산 8초: 중앙값 (최저 ~ 최고)</th><th>예산 20초: 중앙값 (최저 ~ 최고)</th></tr></thead><tbody>
        <tr><td><b>참고: beam K=8 단독</b></td><td colSpan={2}>−134.77 (1.8초, 결정적)</td></tr>
        <tr><td><b>참고: beam K=32 단독</b></td><td colSpan={2}>−132.74 (4.7초, 결정적) &nbsp;|&nbsp; K=64도 −132.74 (8.2초), K=128 4칸 키 −132.74 (15.6초), <b>K=128 2칸 키 −132.70 (18.0초)</b></td></tr>
        <tr><td>SA 무작위 시작, T0=5</td><td>−134.76 (−177.8 ~ −133.7)</td><td>−134.76 (−177.0 ~ −133.2)</td></tr>
        <tr><td>SA 무작위 시작, T0=60</td><td>−151.90 (−179.1 ~ −134.4)</td><td>−137.11 (−166.1 ~ −134.3)</td></tr>
        <tr><td>beam → SA (무작위 재뽑기 이동, T0=5)</td><td>−133.24 (−134.77 ~ −132.74)</td><td>−132.90 (−134.77 ~ −132.70)</td></tr>
        <tr><td>beam → 다른 창의 guided SA (T0=60)</td><td>−134.77 (−134.77 ~ −133.97)</td><td>−134.77 (모두 같음)</td></tr>
        <tr><td>beam → 다른 창의 guided SA (T0=5)</td><td>−134.77 (모두 같음)</td><td>−134.77 (−134.77 ~ −132.70, 1/5만 개선)</td></tr>
        <tr><td><b>beam → LNS-SA</b> (후보 20, 작은 beam 폭 2, T0=5)</td><td>−132.74 (−134.32 ~ −132.70)</td><td>−132.74 (−132.90 ~ −132.70)</td></tr>
        <tr><td><b>beam → LNS-SA</b> (후보 40, 작은 beam 폭 3, T0=5)</td><td><b>−132.70</b> (−133.22 ~ −132.70)</td><td><b>−132.70 (5개 모두)</b></td></tr>
        <tr><td><b>beam → LNS-SA</b> (후보 20, 폭 2, T0=15)</td><td>−132.90 (−133.72 ~ −132.70)</td><td><b>−132.70 (5개 모두)</b></td></tr>
        <tr><td>beam 상위 4개에서 각각 LNS-SA (시간 1/4씩)</td><td>−133.03 (−133.95 ~ −132.70)</td><td><b>−132.70</b> (−132.74 ~ −132.70)</td></tr>
        <tr><td>beam → GA (균등 교차, 집단 20, 돌연변이 5%)</td><td>−134.77 (모두 같음)</td><td>−134.77 (모두 같음)</td></tr>
        <tr><td>beam → GA (매크로는 A·이웃은 B 교차, 돌연변이 20%)</td><td>−134.77 (모두 같음)</td><td>−134.77 (모두 같음)</td></tr>
        <tr><td>GA 무작위 시작 (집단 30, 돌연변이 15%)</td><td>−152.47 (−162.8 ~ −136.2)</td><td>−152.47 (−161.5 ~ −136.2)</td></tr>
      </tbody></table></div>
      <ul style={ul}>
        <li><b>이 점수식의 천장은 −132.70 근처입니다(측정).</b> beam의 K를 키우고 키(상태 병합) 정밀도를 올려도 −132.70에서 더 오르지 않았고, 결합도 같은 값에서 멈췄습니다. 값 −132.70 이상을 만든 방법은 없었습니다(천장이라는 <b>증명은 없습니다</b>).</li>
        <li><b>결합은 beam K=8(−134.77) 대비 +2.07(1.5%) 개선했고, 20초에는 5개 seed가 모두 천장에 닿았습니다.</b> 다만 <b>beam K=32 단독(−132.74, 4.7초) 대비로는 점수 차이가 0.04</b>이고 시간도 더 걸립니다. <b>"결합이 beam을 이긴다"고 말할 수 있는 증거는 이 문제(블록 5개)에서 없습니다.</b> 같은 천장에 도달하는 길이 두 가지(K를 키우기 / 결합)라는 것이 측정된 사실입니다.</li>
        <li><b>다른 창의 guided SA는 beam 풀을 받아도 개선이 거의 없었습니다</b>(−134.77 유지). 무작위 위치 뽑기·±2칸 이동으로는 beam의 좋은 배치를 넘지 못하는 것과 같은 이유입니다(11절 ⑤: 좋은 배치 근처의 이동은 개선 0건). LNS는 이동 단위가 "블록 하나가 아니라 일부를 beam으로 재구성"이라 달랐습니다.</li>
        <li><b>가설(미검증):</b> 블록·제약이 훨씬 많은 문제(매크로 수십 개)에서는 beam의 K를 키우는 비용이 가파르게 늘어, 그때 LNS 결합이 더 유리할 수 있습니다. 이 프로젝트의 5블록에서는 보이지 않습니다.</li>
      </ul>
    </div>

    <div style={{ ...box, marginTop: 10 }}>
      <b style={{ fontSize: 13 }}>4. GA(유전 알고리즘)가 필요한가 — 가능성 분석 (측정 포함)</b>
      <p style={p}>GA는 <b>집단</b>을 두고 <b>선택(좋은 개체를 뽑음) → 교차(두 부모의 일부를 섞음) → 돌연변이</b>를 반복합니다. 위 3절의 마지막 세 줄이 이 문제에서 실제로 돌린 GA입니다(블록 위치를 부모에서 물려받고, 합법이 아니면 합법 위치를 다시 뽑아 <b>수리</b>하며, 토너먼트 선택과 엘리트 2개 보존).</p>
      <div className="data-table"><table><thead><tr><th>GA 설정</th><th>교차 중 같은 부모끼리</th><th>교차 한 번당 수리</th><th>8초 후 서로 다른 개체</th><th>결과</th></tr></thead><tbody>
        <tr><td>beam 상위 8개로 시작, 균등 교차, 돌연변이 5%</td><td>96% (seed 5개 합 17,355번 중 16,722번)</td><td>0.12회</td><td>20개 중 2~6개</td><td>개선 <b>0</b></td></tr>
        <tr><td>beam 상위 8개로 시작, 매크로·이웃 분할 교차, 돌연변이 20%</td><td>48% (11,839번 중 5,643번)</td><td>0.39회</td><td>20개 중 9~16개</td><td>개선 <b>0</b></td></tr>
        <tr><td>무작위 시작(집단 30), 균등 교차, 돌연변이 15%</td><td>53% (17,002번 중 8,981번)</td><td>0.45회</td><td>30개 중 15~22개</td><td>−152.5 (SA T0=5의 −134.8보다 나쁨)</td></tr>
      </tbody></table></div>
      <ul style={ul}>
        <li><b>(측정) 집단이 금방 하나로 모입니다.</b> 첫 줄에서는 교차의 96%가 같은 부모끼리라 새로운 배치가 나오지 않았습니다(20초에는 98%). 돌연변이를 20%로 올리고 교차 방식을 바꾸면 다양성은 유지되지만 점수는 오르지 않았습니다(둘째 줄).</li>
        <li><b>(측정) 교차의 수리 비용이 큽니다.</b> 필수 이웃 규칙 때문에 부모 A의 ADC와 부모 B의 SAR를 섞으면 맞닿지 않는 경우가 있어, 다양성이 유지되는 설정에서는 교차 한 번당 약 0.4회 위치를 다시 뽑아야 했습니다. 수리가 많을수록 교차가 부모의 좋은 부분을 물려주지 못하고 무작위 뽑기가 됩니다.</li>
        <li><b>(해석) GA의 전제인 "좋은 부분 구조를 섞으면 더 좋은 해"가 이 점수식에서는 성립하지 않습니다.</b> 점수의 큰 항(배선 길이, 같은 종류 클러스터, 매크로 여유)은 블록 <b>쌍</b>의 상호작용이라, 한 부모의 ADC 위치와 다른 부모의 SAR 위치가 따로 좋아도 합치면 좋다는 보장이 없습니다. 5블록에서는 beam이 이미 상호작용을 단계마다 직접 평가합니다.</li>
        <li><b>(측정) 무작위 시작 GA는 SA보다 나쁩니다</b> (−152.5 대 −134.8, 같은 시간). 선택이 "좋은 것 중 무작위"로 이루어져 탐색이 거칠고, 평가 횟수당 점수가 오르는 속도가 느립니다.</li>
        <li><b>그래도 GA의 아이디어가 쓸모 있는 곳(가설, 미검증):</b> ① <b>다양성 유지</b>가 필요한 L1~L3 후보 선정(비싼 검증에 3개만 보낼 때 서로 다른 위상을 고르는 틀), ② 매크로가 수십 개로 늘어 "서브 블록 묶음(예: ADC+SAR 클러스터)"이 독립적으로 좋아지는 경우, ③ 설계 후보 1(규칙 인지 진화)처럼 <b>위반 기억으로 규칙을 아는 교차</b>(규칙을 어기는 조합은 아예 만들지 않음)를 쓰는 경우.</li>
      </ul>
      <p style={p}><b>결론:</b> 지금 5블록 문제에서 GA는 <b>필요하지 않습니다</b>(측정 대신 근거 있는 해석). LNS-SA가 "좋은 해 근처의 큰 이동 + 확률적 수락"을 이미 하고 있고, 집단 선택·교차가 추가로 주는 것이 측정되지 않았습니다. 문제가 커지면 다시 재 볼 가치가 있습니다.</p>
    </div>

    <div style={{ ...box, marginTop: 10 }}>
      <b style={{ fontSize: 13 }}>5. 실제 L1(floorplan·tap·PDN)과 연결하면 — 이번에 확인한 것과 하지 않은 것</b>
      <p style={p}>"L1을 연결해서 재 보기"를 목표로 했지만 <b>실제 OpenLane L1은 돌리지 않았습니다.</b> 이유는 아래 ①②이고, 대신 L0 점수가 L1에 보낼 후보를 제대로 고르는지부터 쟀습니다(2026-10-09, Node, 같은 엔진).</p>
      <ol style={ul}>
        <li><b>L1은 매크로 위치만 봅니다.</b> OpenLane의 floorplan·tap·PDN 단계에는 SAR·CDC·CAP 같은 이웃 영역이 배치되지 않고 ADC와 SRAM의 위치만 입력됩니다. beam·LNS가 만든 상위 후보 35개(beam K=32 상위 32 + LNS 최선 3)를 매크로 위상(모양·위치)으로 묶으면 <b>2개뿐</b>입니다: ADC (모양 0, 칸 0,6)과 (모양 1, 0,7), SRAM은 모두 (9,2). 점수가 −140 이상인 35개가 전부 이 둘로 모입니다. 즉 L1을 돌려도 <b>구별되는 것은 2개</b>이고, 간격 DP가 µm 간격을 확정하면 둘의 간격은 이미 정해집니다.</li>
        <li><b>실제 L1 근거는 한 위상뿐입니다.</b> 지식 DB(<code>drc_knowledge.json</code>)의 실측 3건은 모두 ADC (40,150) µm, SRAM (430,65) µm입니다. ADC를 x=30.24로 옮기는 <code>adcshift</code> 실행은 Magic DRC 단계에서 멈춰 있어 아직 결과가 없습니다(<b>미측정</b>). 면적 후보 8개(<code>area_candidate_*</code>)의 L1은 다른 창이 <code>physical_runs_started: 0</code>으로 관리하고 있어 제가 따로 돌리면 충돌합니다.</li>
      </ol>
      <p style={p}><b>L0 점수로 매크로 위상 333개를 모두 훑어 보았습니다.</b> ADC×SRAM 합법 조합이 333개이고, 위상마다 나머지 3블록을 beam(K=4)으로 놓았을 때의 최고 점수를 비교했습니다(위상 하나 약 0.35초, 전체 115초). K=4라서 위상별 점수는 K=32보다 약간 낮은 값입니다(예: 같은 위상이 K=4에서 −134.77, K=32에서 −132.74).</p>
      <div className="data-table"><table><thead><tr><th>점수 계산</th><th>최고 점수</th><th>최고에서 5 / 10 / 20 / 50점 이내 위상 수</th><th>실제 PPA3 위치에 가장 가까운 위상</th></tr></thead><tbody>
        <tr><td>기존 L0 (전체 항)</td><td>−133.92</td><td><b>3 / 3 / 7 / 27</b></td><td><b>87위 / 333</b> · 점수 −239.10 (최고와 105.2점 차)</td></tr>
        <tr><td>구멍·높이 합·최대 높이·울퉁불퉁함 항 제거</td><td>−79.00</td><td><b>21 / 49 / 69 / 177</b></td><td><b>14위 / 333</b> · 점수 −82.50 (최고와 3.5점 차)</td></tr>
      </tbody></table></div>
      <p style={p}>"실제 PPA3 위치에 가장 가까운 위상"은 ADC (40,150) µm → 칸 (0.8, 3), SRAM (430,65) µm → 칸 (8.6, 1.3)을 반올림한 ADC (1,3), SRAM (9,1)입니다(근사).</p>
      <ul style={ul}>
        <li><b>(측정) 실제 위치와 최선 위상의 105점 차이 중 약 77점이 "빈 구멍" 항입니다.</b> 최선 위상은 구멍 1개(−3.2)인데 실제 위치 쪽은 구멍 25개(−80.0)이고, 배선 길이는 −85.0 대 −109.0, 높이 합은 −24.1 대 −27.0입니다. ADC를 보드 가운데쯤에 두면 그 아래 칸이 비어 "구멍"으로 세지기 때문입니다.</li>
        <li><b>(해석) 이 항들은 테트리스의 "아래가 비면 감점"이라서 물리적 근거가 없습니다.</b> 매크로 아래가 비어 있는 것은 그냥 여유 면적입니다. 그런데도 L0의 위상 순위는 이 항이 거의 정하고 있고, ADC가 보드 아래쪽에 붙는 배치가 최선으로 나옵니다. 설계 후보 1의 "L0와 실제 결과의 상관은 미측정"이 이 지점에서 실제로 문제가 됩니다(실제로 통과 근처까지 간 위치가 L0에서는 87위).</li>
        <li><b>(측정) 그 항을 빼면 L0는 위상을 거의 구별하지 못합니다.</b> 최고에서 10점 이내가 49개로 늘고, 5점 이내 21개 중 18개가 ADC 칸 x=0입니다. 즉 L0는 "어느 위상을 L1에 보낼지"를 정해 주지 못하고, <b>실제 L1이 필요한 후보가 수십 개</b>입니다. 단, 항을 뺀 점수가 옳다는 검증도 없습니다(이 표는 민감도 분석).</li>
      </ul>
      <p style={p}><b>제안(미구현, 효과 미측정):</b> ① L1 후보는 L0 상위만 뽑지 않고 <b>실제로 통과 근처까지 간 기준 위상(antfix5)을 항상 포함</b>하고, 나머지는 <b>ADC x 오프셋 스윕(30.24 + 0·5·…·30 µm, 약 7회)</b>처럼 조각 규칙을 직접 시험하는 위상으로 채웁니다. ② 위상 순위에는 구멍·높이·울퉁불퉁함 항을 쓰지 않거나 가중치를 크게 낮춘 점수를 따로 쓰고, <b>L1 결과가 쌓이면 가중치를 보정</b>합니다. ③ 매크로 위상이 정해지면 이웃 영역 배치(beam → LNS-SA)와 µm 간격(간격 DP)은 L1 이후에 해도 되므로, <b>L1 입력은 "매크로 위상 + 간격 DP의 µm 좌표"</b>로 충분합니다. 다른 창의 면적 후보(compact-balanced 등)와 합쳐 하나의 L1 후보 목록으로 관리해야 중복 실행이 없습니다.</p>
    </div>

    <LiveCombo/>
  </div>
}
