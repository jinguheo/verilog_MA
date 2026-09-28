import { useEffect, useMemo, useState } from 'react'

const API = 'http://127.0.0.1:8788'

interface Macro {
  module: string
  instance: string
  x: number
  y: number
  width: number
  height: number
  orientation: string
  kind: 'analog' | 'memory' | 'digital'
  lef: string
  gds: string
}

interface Baseline {
  design: string
  source: string
  die: { x0: number; y0: number; width: number; height: number }
  core: { x0: number; y0: number; x1: number; y1: number }
  macros: Macro[]
  images: Array<{ name: string; label?: string; url: string }>
  flow: string[]
}

interface OptimizationResult {
  status: string
  placements: Macro[]
  candidate_pool: Array<{ rank: number; method: string; cost: number; estimated_manhattan_um: number; centerline_misalignment_um: number; placements: Macro[] }>
  metrics: Record<string, unknown>
  comparison?: unknown
  saved_to_history: boolean
  history_entries: OptimizationHistoryEntry[]
}

interface OptimizationTask {
  id: string
  status: 'queued' | 'running' | 'complete' | 'failed' | 'cancelled'
  stage: string
  progress: number
  current: number
  total: number
  seed: number
  iteration: number
  iterations_per_seed?: number
  evaluated?: number
  mode?: string
  error?: string
  result?: OptimizationResult
}

interface LayoutJob {
  id: string
  status: 'prepared' | 'queued' | 'running' | 'complete' | 'failed'
  progress: number
  stage: string
  placements: Macro[]
  checks: Record<string, string>
  artifacts: Record<string, string>
  images: Array<{ name: string; url: string }>
  error?: string
}

interface OptimizationHistoryEntry {
  id: string
  created_at: string
  baseline_label: string
  design: string
  metrics: {
    baseline: { hard_macro_utilization_pct: number; estimated_routing_length_um: number }
    candidate: { hard_macro_utilization_pct: number; estimated_routing_length_um: number }
    routing_reduction_um: number
    routing_reduction_pct: number
    improved: boolean
  }
  placements?: Array<{ instance: string; x: number; y: number; orientation: string }>
  verification?: { status: 'passed' | 'failed'; job_id?: string; verified_at?: string; checks: Record<string, string>; error?: string }
  screening?: { status: 'screened' | 'shortlisted' | 'screened-out'; job_id?: string; screened_at?: string; rank?: number; synthesis_reused?: boolean; metrics?: { estimated_wirelength_um?: number; setup_wns_ns?: number } }
}

interface VerificationBatch {
  id: string
  status: 'queued' | 'running' | 'complete'
  stage: string
  total: number
  current: number
  passed: number
  failed: number
  cached?: number
  phase?: 'screening' | 'signoff' | 'complete'
  shortlisted?: number
  signoff_total?: number
  screened_out?: number
}

async function request(path: string, options?: RequestInit) {
  const response = await fetch(API + path, options)
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(body.message || `HTTP ${response.status}`)
  return body
}

export default function ActualLayoutFlow() {
  const [baseline, setBaseline] = useState<Baseline | null>(null)
  const [placements, setPlacements] = useState<Macro[]>([])
  const [job, setJob] = useState<LayoutJob | null>(null)
  const [optimizationTask, setOptimizationTask] = useState<OptimizationTask | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [image, setImage] = useState('')
  const [imageLabel, setImageLabel] = useState('')
  const [optimization, setOptimization] = useState<Record<string, unknown> | null>(null)
  const [history, setHistory] = useState<OptimizationHistoryEntry[]>([])
  const [historyOpen, setHistoryOpen] = useState(false)
  const [verificationOnly, setVerificationOnly] = useState(false)
  const [verificationBatch, setVerificationBatch] = useState<VerificationBatch | null>(null)
  const [showCellClusters, setShowCellClusters] = useState(true)

  const initialize = async () => {
    setBusy(true)
    try {
      const data = await request('/api/layout-candidates')
      setBaseline(data.baseline)
      setPlacements(data.baseline.macros)
      setOptimization(null)
      const baselineImage = data.baseline.images.at(-1)
      setImage(baselineImage?.url ?? '')
      setImageLabel(baselineImage?.name === 'ppa3-routing.png' ? 'PPA3 detailed routing' : baselineImage?.label ?? `${data.baseline.design} layout`)
      setHistory(data.optimization_history ?? [])
      setVerificationBatch(data.verification_batch ?? null)
      setError('')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => { void initialize() }, [])
  useEffect(() => {
    if (!job || !['queued', 'running'].includes(job.status)) return
    const timer = window.setInterval(async () => {
      try {
        const updated = await request(`/api/layout-candidates/jobs/${job.id}`)
        setJob(updated)
        if (updated.images?.length) {
          setImage(updated.images[0].url)
          setImageLabel('PPA3 current candidate routed layout')
        }
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : String(reason))
      }
    }, 2500)
    return () => window.clearInterval(timer)
  }, [job])
  useEffect(() => {
    // SA/constrained candidate generation runs on the backend as a cancellable
    // background job (32 seeds x 240 SA iterations) instead of one blocking
    // POST - a client-side Stop can only drop the HTTP connection, it cannot
    // halt server-side CPU work that isn't checking a cancellation flag. This
    // polls task status/progress and picks up the result once complete.
    if (!optimizationTask || !['queued', 'running'].includes(optimizationTask.status)) return
    const timer = window.setInterval(async () => {
      try {
        const updated: OptimizationTask = await request(`/api/layout-candidates/optimize/${optimizationTask.id}`)
        setOptimizationTask(updated)
        if (updated.status === 'complete' && updated.result) {
          const result = updated.result
          setPlacements(result.placements)
          setOptimization(result.metrics)
          setJob(null)
          if (result.saved_to_history && result.history_entries?.length) {
            const ids = new Set(result.history_entries.map(item => item.id))
            setHistory(items => [...result.history_entries, ...items.filter(item => !ids.has(item.id))])
            setHistoryOpen(true)
          }
        }
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : String(reason))
      }
    }, 400)
    return () => window.clearInterval(timer)
  }, [optimizationTask])
  useEffect(() => {
    if (!verificationBatch || !['queued', 'running'].includes(verificationBatch.status)) return
    const timer = window.setInterval(async () => {
      try {
        const updated = await request(`/api/layout-candidates/verification-batches/${verificationBatch.id}`)
        setVerificationBatch(updated)
        if (updated.status === 'complete') {
          const data = await request('/api/layout-candidates')
          setHistory(data.optimization_history ?? [])
          setVerificationOnly(true)
        }
      } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    }, 3000)
    return () => window.clearInterval(timer)
  }, [verificationBatch?.id, verificationBatch?.status])

  const payload = useMemo(() => ({ placements: placements.map(({ instance, x, y, orientation }) => ({ instance, x, y, orientation })) }), [placements])
  const update = (instance: string, key: 'x' | 'y' | 'orientation', value: string) => setPlacements(items => items.map(item => item.instance === instance ? { ...item, [key]: key === 'orientation' ? value : Number(value) } : item))
  const prepare = async () => {
    setBusy(true)
    try {
      const result = await request('/api/layout-candidates/prepare', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      setJob(result); setError('')
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { setBusy(false) }
  }
  const optimize = async (mode: 'constrained' | 'sa') => {
    setBusy(true)
    try {
      const task: OptimizationTask = await request('/api/layout-candidates/optimize', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...payload, mode }) })
      setOptimizationTask(task); setError('')
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { setBusy(false) }
  }
  const cancelOptimize = async () => {
    if (!optimizationTask) return
    try {
      const updated: OptimizationTask = await request(`/api/layout-candidates/optimize/${optimizationTask.id}/cancel`, { method: 'POST' })
      setOptimizationTask(updated)
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
  }
  const run = async () => {
    setBusy(true)
    try {
      const body = job?.status === 'prepared' ? { candidate_id: job.id } : payload
      const result = await request('/api/layout-candidates/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      setJob(result); setError('')
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { setBusy(false) }
  }
  const verifyHistory = async () => {
    setBusy(true)
    try {
      const result = await request('/api/layout-candidates/verify-history', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ limit: 10 }) })
      setVerificationBatch(result); setHistoryOpen(true); setError('')
      if (result.status === 'complete') {
        const data = await request('/api/layout-candidates')
        setHistory(data.optimization_history ?? [])
        setVerificationOnly(true)
      }
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { setBusy(false) }
  }

  if (!baseline) return <section className="actual-layout-flow"><div className="actual-flow-head"><div><small>ACTUAL LAYOUT CANDIDATE</small><h3>실제 후보 초기화</h3></div><button onClick={initialize} disabled={busy}>{busy ? 'Loading…' : 'Retry'}</button></div>{error && <p className="actual-error">{error}</p>}</section>

  const wireEstimate = (items: Macro[]) => {
    const adc = items.find(item => item.kind === 'analog')
    const sram = items.find(item => item.kind === 'memory')
    if (!adc || !sram) return 0
    return Math.abs(adc.x + adc.width / 2 - sram.x - sram.width / 2) + Math.abs(adc.y + adc.height / 2 - sram.y - sram.height / 2)
  }
  const floorplanFigure = (items: Macro[], label: string, kind: 'baseline' | 'candidate') => {
    const adc = items.find(item => item.kind === 'analog')
    const sram = items.find(item => item.kind === 'memory')
    return <figure className={`candidate-floorplan ${kind}`}>
      <figcaption><b>{label}</b><span>wire ≈ {wireEstimate(items).toFixed(1)} µm</span></figcaption>
      <svg viewBox={`0 0 ${baseline.die.width} ${baseline.die.height}`} role="img" aria-label={`${label} ADC SRAM floorplan`}>
        <rect className="candidate-die" x="1" y="1" width={baseline.die.width - 2} height={baseline.die.height - 2}/>
        <rect className="candidate-core" x={baseline.core.x0} y={baseline.die.height - baseline.core.y1} width={baseline.core.x1 - baseline.core.x0} height={baseline.core.y1 - baseline.core.y0}/>
        {adc && sram && <line className="candidate-net" x1={adc.x + adc.width / 2} y1={baseline.die.height - adc.y - adc.height / 2} x2={sram.x + sram.width / 2} y2={baseline.die.height - sram.y - sram.height / 2}/>} 
        {items.map(item => <g key={item.instance} className={`candidate-macro ${item.kind}`}><rect x={item.x} y={baseline.die.height - item.y - item.height} width={item.width} height={item.height}/><text x={item.x + item.width / 2} y={baseline.die.height - item.y - item.height / 2}>{item.kind === 'analog' ? 'ADC' : item.kind === 'memory' ? 'SRAM' : 'DIGITAL'}</text><text className="candidate-coordinate" x={item.x + item.width / 2} y={baseline.die.height - item.y - item.height / 2 + 30}>({item.x.toFixed(0)}, {item.y.toFixed(0)})</text></g>)}
      </svg>
    </figure>
  }
  const historyLayout = (item: OptimizationHistoryEntry): Macro[] => baseline.macros.map(macro => {
    const saved = item.placements?.find(placement => placement.instance === macro.instance)
    return saved ? { ...macro, ...saved } : macro
  })
  const optimizing = optimizationTask ? ['queued', 'running'].includes(optimizationTask.status) : false
  const visibleHistory = verificationOnly ? history.filter(item => item.verification?.status === 'passed') : history
  const passedHistory = history.filter(item => item.verification?.status === 'passed')
  const candidateState = (item: OptimizationHistoryEntry) => item.verification?.status === 'passed' ? 'DRC/LVS PASS' : item.verification?.status === 'failed' ? 'DRC/LVS FAIL' : item.screening?.status === 'shortlisted' ? `SCREEN TOP ${item.screening.rank ?? ''}` : item.screening?.status === 'screened-out' ? `SCREEN OUT · #${item.screening.rank ?? '-'}` : '검증 대기'

  return <section className="actual-layout-flow">
    <div className="actual-flow-head"><div><small>OFFLINE PPA3 BASELINE → AI CANDIDATES</small><h3>{baseline.design}</h3><p>별도로 실행한 PPA3 OpenLane 결과의 macro 좌표와 실제 LEF/GDS 치수를 기준선으로 불러옵니다.</p></div><span>{baseline.die.width} × {baseline.die.height} µm</span></div>
    <section className="layout-flow-comparison">
      <div className="layout-flow-comparison-head"><div><small>CURRENT vs PREVIOUS</small><h4>현재 적용 방식과 기존 적용 방식</h4></div><span>V2 vs V1</span></div>
      <div className="layout-flow-lanes">
        <article className="evolved">
          <header><div><small>현재 적용·전환 방식 · V2</small><b>Routing-feedback 반복 최적화</b></div><span>PASS-ONLY</span></header>
          <ol className="detailed-flow-list">
            <li className="active"><i>1</i><p><b>격자 탐색으로 macro 후보군 생성</b><span>10 µm 좌표에서 boundary·overlap·40 µm halo를 먼저 제거해 비싼 툴 실행 전 legal 후보만 만듭니다.</span><em>GRID SEARCH</em></p></li>
            <li className="active"><i>2</i><p><b>Macro Re-place + SA로 후보 변형</b><span>Re-place는 macro 하나를 rip-up한 뒤 legal 위치 중 cost가 좋아지는 위치로 이동합니다. SA는 exp(Δ/T) 확률로 일부 나쁜 이동도 받아 local minimum을 벗어나고 best-ever를 보존합니다. 이동 폭을 10µm(격자 그대로) → 1µm로 coarse-to-fine 축소하며 그때그때 cost를 직접 계산해서, 10µm 격자 40,500개 전수조사로는 못 찾는 격자 사이 좌표까지 정밀화합니다(실측: grid 최적 566.4 → SA 정밀화 후 550.8, −2.8%). 32 seed × 240 iteration을 백엔드 background job으로 돌리며 seed/iteration 진행률을 폴링으로 보여주고, 협력적 취소 체크로 중지 버튼이 실제로 CPU 계산을 멈춥니다(브라우저 요청만 끊는 게 아님).</span><em>RE-PLACE · SIMULATED ANNEALING · COARSE-TO-FINE · ASYNC JOB</em></p></li>
            <li className="next"><i>3</i><p><b>OpenROAD RePlAce 표준셀 배치</b><span>현재 실제 P&R은 일반 RePlAce 배치입니다. 게임에는 기능군 clustering이 구현됐지만, 실제 flow의 adapter·CDC·capture·readout soft-region constraint 연결은 다음 개선 항목입니다.</span><em>OPENROAD GPL · CLUSTER NEXT</em></p></li>
            <li className="next"><i>4</i><p><b>빠른 global routing 평가</b><span>상세배선 전에 wirelength·routing overflow/congestion·setup timing을 측정해 실제 배선 가능성이 낮은 후보를 탈락시킵니다.</span><em>FASTROUTE · STA</em></p></li>
            <li className="active"><i>5</i><p><b>10개 빠른 선별 → Top 3</b><span>공통 합성 checkpoint와 기존 signature·screen 결과를 재사용하고, post-global-route wirelength·WNS가 좋은 최대 3개만 signoff로 보냅니다.</span><em>FUNNEL · CACHE</em></p></li>
            <li className="active"><i>6</i><p><b>Top 3만 DRC/LVS 순차 실행</b><span>선별 run의 checkpoint에서 이어서 TritonRoute, Magic/KLayout DRC와 Netgen LVS를 한 번에 하나씩 실행합니다.</span><em>RESUME · OPENLANE SIGNOFF</em></p></li>
            <li className="active"><i>7</i><p><b>DRC/LVS 모두 통과한 후보만 유지</b><span>TritonRoute·Magic·KLayout DRC와 Netgen LVS가 모두 PASS인 후보만 검증 후보 목록에 남깁니다.</span><em>PASS-ONLY GATE</em></p></li>
            <li className="next"><i>8</i><p><b>통과 후보 중 PPA best 승격</b><span>통과 후보의 실제 area·worst-corner timing·route wirelength를 비교해 가장 좋은 후보를 새 current best로 승격합니다.</span><em>PPA RANKING</em></p></li>
            <li className="next"><i>9</i><p><b>새 best를 변형해 다음 세대 탐색</b><span>새 best를 elite로 보존하고 주변 좌표를 다시 Re-place/SA로 변형합니다. 연속 무개선이면 수렴으로 종료합니다.</span><em>FEEDBACK LOOP</em></p></li>
          </ol>
        </article>
        <article className="legacy">
          <header><div><small>기존 적용 방식 · V1</small><b>단일 최소비용 후보</b></div><span>ONE SHOT</span></header>
          <ol className="detailed-flow-list">
            <li><i>1</i><p><b>실제 macro 형상 입력</b><span>ADC·SRAM LEF 크기, core 경계와 PPA3 기준 좌표를 읽습니다.</span><em>LEF · CONFIG</em></p></li>
            <li><i>2</i><p><b>10 µm 격자 조합 생성</b><span>ADC 왼쪽 영역과 SRAM 오른쪽 영역의 약 40,500개 좌표 조합을 만듭니다.</span><em>EXHAUSTIVE GRID</em></p></li>
            <li><i>3</i><p><b>Hard constraint 필터</b><span>core 이탈, macro overlap과 ADC↔SRAM 40 µm keep-out 위반 후보를 제거합니다.</span><em>LEGALITY CHECK</em></p></li>
            <li><i>4</i><p><b>가중 비용 계산</b><span>Manhattan wire + 2.5×수직 정렬 오차 + 4×edge penalty + 기준 좌표 이탈을 계산합니다.</span><em>WEIGHTED COST</em></p></li>
            <li><i>5</i><p><b>Cost 1등만 선택</b><span>합법 후보 중 추정 비용이 가장 낮은 배치 하나만 OpenLane으로 전달합니다.</span><em>TOP-1</em></p></li>
            <li><i>6</i><p><b>Macro 좌표 고정</b><span>선택된 ADC·SRAM 위치를 CFG/JSON에 기록하며 이후 flow에서 macro는 다시 움직이지 않습니다.</span><em>FIXED MACRO</em></p></li>
            <li><i>7</i><p><b>전체 OpenLane 재실행</b><span>합성부터 표준셀 배치, CTS, global/detailed routing과 signoff를 후보 하나에 수행합니다.</span><em>FULL FLOW</em></p></li>
            <li><i>8</i><p><b>단일 결과 확인</b><span>DRC/LVS/STA 결과와 GDS 이미지를 확인하지만 다른 후보와 실제 routing 결과를 비교하지 않습니다.</span><em>SINGLE RESULT</em></p></li>
            <li><i>9</i><p><b>Feedback 없이 종료</b><span>congestion·timing 결과가 다음 macro 후보 생성에 되돌아가지 않아 local 개선 반복이 없습니다.</span><em>NO EVOLUTION</em></p></li>
          </ol>
        </article>
      </div>
      <div className="flow-implementation-status"><span className="done"><b>현재 사용 가능</b> 후보 10개 fast GRT/STA · 합성/checkpoint/결과 재사용 · Top 3 signoff · 기존 기준+PASS 후보 영구 관리 · SA/제약기반 생성이 취소 가능한 background job(진행률 폴링, 협력적 취소)으로 실행</span><span className="next"><b>다음 개선</b> 실제 PPA best 자동 승격 · 통과 best를 다음 세대 SA seed로 자동 연결</span></div>
      <section className="future-optimization-roadmap">
        <div className="roadmap-head"><div><small>NEXT IMPROVEMENTS · ACTUAL P&amp;R</small><h4>현재 방식에서 추가로 개선할 부분</h4></div><span>게임 구현과 실제 툴 연결을 구분</span></div>
        <div className="roadmap-grid">
          <article className="game-done"><header><b>표준셀 기능 clustering</b><em>GAME DONE · P&amp;R NEXT</em></header><p>게임은 adapter·CDC·capture·readout 기능군을 모아 평가합니다. 다음에는 합성 hierarchy로 셀 목록을 만들고 OpenROAD group/region constraint를 적용한 뒤, unconstrained 배치와 congestion·timing을 비교합니다.</p><small>검증: RePlAce → GlobalRoute overflow → STA WNS/TNS</small></article>
          <article className="game-done"><header><b>SA 탐색 범위 확장</b><em>GRID-DECOUPLED · MACRO-COUNT NEXT</em></header><p>SA는 원래 grid 단계가 미리 만든 legal-position 표(legal_by_position)에서 조회만 했습니다 — grid가 이미 전수조사(40,500개)한 것과 같은 공간이라 새 위치를 발견할 수 없었습니다. 지금은 그때그때 cost를 직접 계산(evaluate)하고 이동 폭을 10µm→1µm로 줄여가며 격자 사이 좌표까지 찾습니다. 다만 여전히 macro는 ADC·SRAM 정확히 2개로 하드코딩돼 있어(analog 1개·memory 1개가 아니면 에러) macro 개수를 늘리려면 별도 재작성이 필요합니다. 그다음엔 soft-cluster의 중심·크기·밀도도 state에 포함하되 개별 표준셀 전체를 SA로 직접 움직이지 않아 탐색 폭발을 막습니다.</p><small>검증: grid top-1(566.4) vs SA 정밀화(550.8, −2.8%) 비교</small></article>
          <article><header><b>Congestion heatmap feedback</b><em>NEXT</em></header><p>GRT overflow가 난 tile을 다음 세대 cost에 penalty로 되돌려 같은 혼잡 배치를 반복 생성하지 않도록 합니다.</p><small>검증: FastRoute congestion report</small></article>
          <article><header><b>PPA best 자동 승격</b><em>NEXT</em></header><p>DRC/LVS PASS 후보만 area·wirelength·worst-corner timing으로 정규화해 best를 정하고, 그 배치를 다음 SA seed로 자동 사용합니다.</p><small>검증: signoff metrics + pass-only gate</small></article>
          <article><header><b>변경 영향 기반 선택 검증</b><em>LATER</em></header><p>macro/cluster 이동 폭이 작은 후보는 full LVS 전에 incremental route·local DRC를 먼저 수행합니다. 최종 승격 전에는 full DRC/LVS를 생략하지 않습니다.</p><small>검증: incremental precheck → full signoff</small></article>
          <article><header><b>다중 corner 조기 탈락</b><em>LATER</em></header><p>대표 corner에서 크게 실패한 후보는 나머지 corner와 detailed route를 건너뛰고, 경계 후보만 전체 corner로 확장합니다.</p><small>검증: early STA gate → MCMM signoff</small></article>
        </div>
      </section>
    </section>
    <div className="actual-layout-grid">
      <div>
        <svg className="actual-die" viewBox={`0 0 ${baseline.die.width} ${baseline.die.height}`} role="img" aria-label="actual ADC and SRAM macro floorplan">
          <defs><pattern id="standard-cell-rows" width="18" height="12" patternUnits="userSpaceOnUse"><rect width="18" height="12" className="std-row-base"/><path d="M0 1 H18 M0 11 H18 M9 1 V11" className="std-row-line"/></pattern></defs>
          <rect className="die-outline" x="1" y="1" width={baseline.die.width - 2} height={baseline.die.height - 2}/>
          <rect className="standard-cell-field" x={baseline.core.x0} y={baseline.die.height - baseline.core.y1} width={baseline.core.x1 - baseline.core.x0} height={baseline.core.y1 - baseline.core.y0}/>
          <rect className="core-outline" x={baseline.core.x0} y={baseline.die.height - baseline.core.y1} width={baseline.core.x1 - baseline.core.x0} height={baseline.core.y1 - baseline.core.y0}/>
          <text className="standard-cell-label" x={baseline.core.x0 + 14} y={baseline.die.height - baseline.core.y1 + 24}>STANDARD-CELL ROWS · DIGITAL LOGIC AREA</text>
          {placements.map(item => <g key={item.instance} className={`actual-macro ${item.kind}`}>
            <rect x={item.x} y={baseline.die.height - item.y - item.height} width={item.width} height={item.height}/>
            <text x={item.x + item.width / 2} y={baseline.die.height - item.y - item.height / 2}>{item.kind === 'analog' ? '12-bit ADC' : item.kind === 'memory' ? 'SRAM 1024×32' : item.module}</text>
            <text className="coord" x={item.x + item.width / 2} y={baseline.die.height - item.y - item.height / 2 + 24}>({item.x.toFixed(1)}, {item.y.toFixed(1)}) µm</text>
          </g>)}
        </svg>
        <div className="actual-legend"><span><i className="analog"/>ADC hard macro</span><span><i className="memory"/>SRAM hard macro</span><span><i className="standard-cells"/>Standard-cell rows</span><span><i className="core"/>Core boundary</span></div>
        <div className="actual-function-legend">
          <article className="adapter"><i/><p><b>Byte adapter</b><span>ADC의 low/high byte를 12-bit sample로 조립</span></p></article>
          <article className="cdc"><i/><p><b>CDC FIFO</b><span>ADC clock에서 system clock으로 안전하게 전달</span></p></article>
          <article className="capture"><i/><p><b>Capture control</b><span>ring buffer 주소·trigger·pre/post window 제어</span></p></article>
          <article className="readout"><i/><p><b>Readout / DMA</b><span>SRAM 데이터를 valid/ready stream으로 출력</span></p></article>
          <article className="infrastructure"><i/><p><b>Clock / reset / filler</b><span>CTS buffer, reset sync, tie·filler·decap cell</span></p></article>
        </div>
      </div>
      <div className="actual-controls">
        {placements.map(item => <fieldset key={item.instance}><legend>{item.kind.toUpperCase()} · {item.module}</legend><small>{item.width.toFixed(2)} × {item.height.toFixed(2)} µm</small><div><label>X <input type="number" step="1" value={item.x} onChange={event => update(item.instance, 'x', event.target.value)}/></label><label>Y <input type="number" step="1" value={item.y} onChange={event => update(item.instance, 'y', event.target.value)}/></label><label>Orient <select value={item.orientation} onChange={event => update(item.instance, 'orientation', event.target.value)}><option>N</option><option>S</option><option>FN</option><option>FS</option></select></label></div><code>{item.instance}</code></fieldset>)}
        <div className="actual-actions"><button onClick={initialize} disabled={busy} title="offline PPA3 OpenLane 결과를 반영한 config의 MACROS 좌표와 ADC/SRAM LEF 크기로 복원">Offline PPA3로 초기화</button><button onClick={() => optimize('constrained')} disabled={busy || optimizing}>제약기반 후보 생성</button><button onClick={() => optimize('sa')} disabled={busy || optimizing}>SA 기반 후보 생성</button>{optimizing && <button className="stop" onClick={cancelOptimize}>중지</button>}<small className="actual-init-source"><b>초기값 출처</b> 별도 offline PPA3 OpenLane 실행 → ppa3_adc_capture/config.json MACROS 좌표 + ADC/SRAM LEF 실제 크기</small><button onClick={prepare} disabled={busy}>후보 DEF 설정 준비</button><button className="run" onClick={run} disabled={busy || job?.status === 'running' || job?.status === 'queued'}>OpenLane 끝까지 실행</button><button className="history-button" onClick={() => setHistoryOpen(value => !value)}>개선 히스토리 ({history.length})</button></div>
        {optimizationTask && <div className={`actual-job ${optimizationTask.status}`}>
          <div><b>{optimizationTask.status.toUpperCase()}</b><span>{optimizationTask.stage}</span></div>
          <progress max="100" value={optimizationTask.progress}/>
          <small>
            {optimizationTask.mode === 'sa' || optimizationTask.mode === 'hybrid'
              ? `seed ${optimizationTask.seed}/32 · iteration ${optimizationTask.iteration}/${optimizationTask.iterations_per_seed ?? 240}`
              : `격자 후보 ${optimizationTask.current}/${optimizationTask.total}`}
            {optimizationTask.evaluated !== undefined && ` · ${optimizationTask.evaluated.toLocaleString()} legal 평가`}
          </small>
          {optimizationTask.error && <p>{optimizationTask.error}</p>}
        </div>}
        {optimization && <div className="optimization-result"><b>{optimization.generation_mode === 'sa' ? 'MACRO RE-PLACE + SA' : 'CONSTRAINT-BASED GRID SEARCH'}</b><span>pool {String(optimization.candidate_pool_size)}</span><span>grid {String(optimization.grid_candidates)}</span><span>SA {String(optimization.replace_sa_candidates)}</span><span>{Number(optimization.candidates_evaluated).toLocaleString()} legal evaluations</span><span>wire {String(optimization.estimated_manhattan_um)} µm</span><span>alignment {String(optimization.centerline_misalignment_um)} µm</span><span>halo {String(optimization.halo_um)} µm</span></div>}
        {error && <p className="actual-error">{error}</p>}
      </div>
    </div>
    {optimization && <section className="candidate-visual-comparison">
      <div className="candidate-visual-head"><div><small>OFFLINE ROUTED BASELINE · NOT SIGNOFF</small><h4>Offline PPA3 best → AI 개선 후보</h4></div><strong>−{Math.max(0, wireEstimate(baseline.macros) - wireEstimate(placements)).toFixed(1)} µm</strong></div>
      <div className="candidate-floorplan-grid">{floorplanFigure(baseline.macros, 'Offline PPA3 current best', 'baseline')}<div className="candidate-arrow"><b>→</b><span>{Number(optimization.candidates_evaluated).toLocaleString()}개 평가</span></div>{floorplanFigure(placements, 'AI 개선 후보', 'candidate')}</div>
      <div className="candidate-moves">{placements.map(item => { const before = baseline.macros.find(base => base.instance === item.instance); return before && <span key={item.instance}><b>{item.kind === 'analog' ? 'ADC' : item.kind === 'memory' ? 'SRAM' : item.module}</b> ({before.x.toFixed(0)}, {before.y.toFixed(0)}) → ({item.x.toFixed(0)}, {item.y.toFixed(0)})</span> })}</div>
    </section>}
    {historyOpen && <section className="optimization-history">
      <div className="optimization-history-head"><div><small>BASELINE + SIGNOFF PASS REGISTRY</small><h4>기존 방식과 통과 후보 통합 관리</h4></div><div className="history-head-actions"><button className={verificationOnly ? 'active' : ''} onClick={() => setVerificationOnly(value => !value)}>{verificationOnly ? '✓ DRC/LVS 통과만' : '전체 후보 보기'}</button><button onClick={verifyHistory} disabled={busy || history.length === 0 || verificationBatch?.status === 'queued' || verificationBatch?.status === 'running'}>10개 선별 → Top 3 Signoff</button><button onClick={() => setHistoryOpen(false)}>닫기</button></div></div>
      <div className="managed-candidate-strip"><article><small>LEGACY · V1</small><b>Offline PPA3 기준 후보</b><span>ROUTED · SIGNOFF 미완료 · 항상 보존</span></article><article><small>VERIFIED REGISTRY</small><b>{passedHistory.length}개 통과 후보</b><span>TritonRoute + Magic/KLayout DRC + Netgen LVS PASS만 보존</span></article><article><small>SAVING POLICY</small><b>10 → 최대 3</b><span>합성 재사용 · screen cache · 같은 run에서 signoff 재개</span></article></div>
      {verificationBatch && <div className={`verification-batch ${verificationBatch.status}`}><div><b>{verificationBatch.status === 'complete' ? '퍼널 검증 완료' : verificationBatch.phase === 'signoff' ? 'Top 후보 Signoff 중' : '빠른 GRT/STA 선별 중'}</b><span>{verificationBatch.stage}</span></div><progress max={(verificationBatch.phase === 'signoff' ? verificationBatch.signoff_total : verificationBatch.total) || 1} value={verificationBatch.current}/><strong>{verificationBatch.current}/{verificationBatch.phase === 'signoff' ? verificationBatch.signoff_total : verificationBatch.total}</strong><small>SHORTLIST {verificationBatch.shortlisted ?? 0} · PASS {verificationBatch.passed} · FAIL {verificationBatch.failed} · CACHE {verificationBatch.cached ?? 0}</small></div>}
      <div className="history-layout-lineage">
        <div className="history-layout-card origin"><div><b>Offline PPA3 best</b><span>ROUTED · NOT SIGNOFF</span></div>{floorplanFigure(baseline.macros, 'Offline PPA3 baseline', 'baseline')}</div>
        {[...visibleHistory].reverse().map((item, index) => <div className="history-lineage-step" key={item.id}><div className="history-lineage-arrow"><b>→</b><span>−{item.metrics.routing_reduction_pct.toFixed(2)}%</span></div><div className={`history-layout-card improved ${item.verification?.status ?? item.screening?.status ?? 'pending'}`}><div><b>개선 #{index + 1}</b><span className={`verification-state ${item.verification?.status ?? 'pending'}`}>{candidateState(item)}</span></div>{floorplanFigure(historyLayout(item), `AI best #${index + 1}`, 'candidate')}<small>wire −{item.metrics.routing_reduction_um.toFixed(1)} µm · ({item.placements?.map(position => `${position.x.toFixed(0)},${position.y.toFixed(0)}`).join(' / ') || '좌표 없음'})</small>{item.screening?.metrics?.estimated_wirelength_um !== undefined && <small>GRT wire {item.screening.metrics.estimated_wirelength_um.toFixed(1)} µm · WNS {item.screening.metrics.setup_wns_ns?.toFixed(3) ?? '-'} ns · 합성 {item.screening.synthesis_reused ? '재사용' : '실행'}</small>}{item.verification?.status === 'failed' && <small className="verification-failure">{Object.entries(item.verification.checks).filter(([, state]) => state !== 'pass').map(([name, state]) => `${name}:${state}`).join(' · ')}</small>}</div></div>)}
        {visibleHistory.length === 0 && <div className="history-empty-candidate"><b>{verificationOnly ? '통과 후보 없음' : '다음 개선 후보'}</b><span>{verificationOnly ? 'DRC와 LVS를 모두 통과한 후보만 이 보기에 남습니다.' : '기준보다 좋아진 후보가 생성되면 여기에 layout이 누적됩니다.'}</span></div>}
      </div>
      {visibleHistory.length === 0 ? <p>현재 필터 조건에 맞는 개선 후보가 없습니다.</p> : <div className="optimization-history-table"><table><thead><tr><th>후보 상태</th><th>생성 시각</th><th>Utilization 기준 → 후보</th><th>Routing 길이 기준 → 후보</th><th>개선</th></tr></thead><tbody>
        {visibleHistory.map(item => <tr key={item.id}><td><b className={`verification-state ${item.verification?.status ?? 'pending'}`}>{item.verification?.status?.toUpperCase() ?? 'PENDING'}</b><small>{item.verification?.job_id ?? 'OpenLane 미실행'}</small></td><td><b>{new Date(item.created_at).toLocaleString('ko-KR')}</b><small>{item.design}</small></td><td>{item.metrics.baseline.hard_macro_utilization_pct.toFixed(3)}% → <strong>{item.metrics.candidate.hard_macro_utilization_pct.toFixed(3)}%</strong></td><td>{item.metrics.baseline.estimated_routing_length_um.toFixed(1)} µm → <strong>{item.metrics.candidate.estimated_routing_length_um.toFixed(1)} µm</strong></td><td className="history-improvement">−{item.metrics.routing_reduction_um.toFixed(1)} µm<br/><small>{item.metrics.routing_reduction_pct.toFixed(2)}% 단축</small></td></tr>)}
      </tbody></table></div>}
      <p className="history-note">기준은 PPA2에서 확립해 PPA3에 재사용한 macro 배치입니다. Routing 길이는 실제 배선 전 ADC↔SRAM 중심점 Manhattan 추정치이며, 최종값은 OpenLane detailed routing 결과로 확인합니다.</p>
    </section>}
    <div className="signoff-pipeline">
      {baseline.flow.map((stage, index) => {
        const keys = ['openroad_pnr', 'tritonroute_drc', 'magic_drc', 'klayout_drc', 'lvs', 'sta']
        const state = index < keys.length ? job?.checks?.[keys[index]] : job?.images?.length ? 'pass' : 'not-run'
        return <div key={stage} className={state === 'pass' ? 'pass' : state === 'executed' ? 'executed' : ''}><i>{index + 1}</i><span>{stage}</span><b>{state ?? 'not-run'}</b></div>
      })}
    </div>
    {job && <div className={`actual-job ${job.status}`}><div><b>{job.status.toUpperCase()}</b><span>{job.stage}</span></div><progress max="100" value={job.progress}/><code>{job.id}</code>{job.error && <p>{job.error}</p>}</div>}
    {image && <figure className="actual-layout-image"><div className="actual-layout-image-frame"><span>{job?.images?.length ? 'PPA3 AI CANDIDATE' : 'PPA3 DETAILED ROUTING'}</span><button className="cluster-overlay-toggle" onClick={() => setShowCellClusters(value => !value)}>{showCellClusters ? '기능군 숨기기' : '표준셀 기능군 보기'}</button><img src={image} alt={`${imageLabel} rendered by KLayout`}/>{showCellClusters && <div className="std-cluster-overlay" aria-label="standard-cell functional cluster guide"><div className="cluster adapter"><b>ADC BYTE ADAPTER</b><small>sample 조립</small></div><div className="cluster cdc"><b>CDC FIFO</b><small>clock crossing</small></div><div className="cluster capture"><b>CAPTURE CTRL</b><small>주소·trigger</small></div><div className="cluster readout"><b>READOUT / DMA</b><small>stream 출력</small></div><div className="cluster infra"><b>CLK · RESET · FILLER</b><small>전 영역 분산</small></div></div>}</div><figcaption><b>{job?.images?.length ? imageLabel : 'PPA3 detailed routing'}</b> · 큰 형상은 ADC/SRAM hard macro, 미세 반복 형상은 표준셀과 배선입니다. 색 영역은 RTL dataflow 기반 <strong>soft cluster 설명 영역</strong>이며 개별 셀의 확정 좌표는 아닙니다.</figcaption></figure>}
    <p className="actual-caveat"><b>구성 및 게임 연결:</b> 크게 보이는 고정 hard macro는 ADC와 SRAM 두 개이며, byte adapter·CDC FIFO·capture control·readout은 주변의 standard cell 영역에 배치됩니다. 아래 AI Chip Tetris는 같은 <code>ppa3_adc_capture_top</code> 구조를 설명하지만 현재 실제 좌표와 자동 동기화되지는 않는 교육용 격자 시뮬레이터입니다.</p>
    <p className="actual-caveat">실행 버튼은 별도 candidate config와 run tag를 생성하므로 기준 config와 과거 run을 덮어쓰지 않습니다. 최종 판정은 OpenLane 결과의 Magic/KLayout DRC, Netgen LVS, STA checker 상태를 사용합니다.</p>
  </section>
}
