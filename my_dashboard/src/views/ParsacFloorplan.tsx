import { FormEvent, useEffect, useState } from 'react'

const API = 'http://127.0.0.1:8788/api/physical-design'
type Cost = { total: number; wirelength: number; edge_violations: number; width_penalty: number; height_penalty: number }
type Block = { name: string; instance?: string; x: number; y: number; width: number; height: number; width_um?: number; height_um?: number }
type Result = { source_model: string; best: { seed: number; cost: Cost; blocks: Block[] }; placement_validation?: { passed: boolean } }
type Job = { id: string; model: string; status: string; progress: number; stage: string; error?: string; result?: Result; artifacts?: Record<string, string | null> }
type Parsac = { installed: boolean; source: string; jobs: Job[]; models: { id: string; label: string }[] }

export default function ParsacFloorplan() {
  const [parsac, setParsac] = useState<Parsac | null>(null)
  const [job, setJob] = useState<Job | null>(null)
  const [message, setMessage] = useState('')
  const [form, setForm] = useState({ model: 'sample_test_4', steps: 3000, runs: 16, workers: 2 })

  const load = () => fetch(API).then(r => r.json()).then(data => setParsac(data.parsac)).catch(() => setMessage('PARSAC API에 연결할 수 없습니다.'))
  useEffect(() => { load() }, [])
  useEffect(() => {
    if (!job || !['queued', 'running'].includes(job.status)) return
    const timer = window.setInterval(async () => {
      const response = await fetch(`${API}/parsac/jobs/${job.id}`)
      if (!response.ok) return
      const next = await response.json()
      setJob(next)
      if (!['queued', 'running'].includes(next.status)) { setMessage(next.status === 'complete' ? '배치와 제약 변환이 완료됐습니다.' : next.error || '실행 실패'); load() }
    }, 1200)
    return () => window.clearInterval(timer)
  }, [job?.id, job?.status])

  const submit = async (event: FormEvent) => {
    event.preventDefault(); setMessage('작업을 등록하는 중...')
    const response = await fetch(`${API}/parsac/run`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) })
    const data = await response.json()
    if (!response.ok) { setMessage(data.message || '실행 요청 실패'); return }
    setJob(data); setMessage('백그라운드 실행을 시작했습니다. 다른 화면으로 이동해도 계속됩니다.')
  }
  const current = job || parsac?.jobs?.[0]
  const result = current?.result

  return <section className="card">
    <div className="card-title"><div><small className="kicker">PARSAC · WINDOWS NATIVE</small><h2>실측 블록 자동 배치</h2></div><span className={parsac?.installed ? 'ok-badge' : 'warning-badge'}>{parsac?.installed ? '설치됨' : '설치 확인 필요'}</span></div>
    <p className="rtl-guide-note">OpenLane 완료 결과에서 LEF 크기와 PPA를 읽고, PARSAC 병렬 탐색 후 경계·겹침을 독립 검증합니다. Sample Test 4는 OpenLane용 <code>macro_placement.cfg</code>와 <code>MACROS</code> JSON까지 생성합니다.</p>
    <form className="parsac-form" onSubmit={submit}>
      <label>모델<select value={form.model} onChange={e => setForm({...form, model: e.target.value})}>{parsac?.models?.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
      <label>탐색 단계<input type="number" min="10" max="1000000" value={form.steps} onChange={e => setForm({...form, steps: Number(e.target.value)})}/></label>
      <label>반복 수<input type="number" min="1" max="64" value={form.runs} onChange={e => setForm({...form, runs: Number(e.target.value)})}/></label>
      <label>동시 작업<input type="number" min="1" max="8" value={form.workers} onChange={e => setForm({...form, workers: Number(e.target.value)})}/></label>
      <button className="refresh" disabled={!!job && ['queued', 'running'].includes(job.status)}>배치 실행</button>
    </form>
    {current && <div className="parsac-progress"><div><b>{current.stage}</b><span>{current.status} · {current.progress}%</span></div><progress max="100" value={current.progress}/></div>}
    {message && <p className="rtl-guide-note">{message}</p>}
    {result && <div className="data-table"><table><thead><tr><th>검증</th><th>Seed / Cost</th><th>Wirelength</th><th>블록</th></tr></thead><tbody><tr><td><span className={result.placement_validation?.passed ? 'ok-badge' : 'warning-badge'}>{result.placement_validation?.passed ? '경계·겹침 통과' : '검토 필요'}</span></td><td>{result.best.seed} / {result.best.cost.total.toFixed(4)}</td><td>{result.best.cost.wirelength.toLocaleString()}</td><td>{result.best.blocks.length}</td></tr></tbody></table></div>}
    {result?.source_model.includes('Sample Test 4') && <p className="rtl-guide-note"><b>PPA 비교 상태:</b> 개별 블록의 실제 OpenLane PPA는 연결됐습니다. baseline/PARSAC 상위 설계 비교는 세 블록이 같은 계층의 직접 인스턴스가 아니므로 <span className="warning-badge">계층 top 통합 전 대기</span> 상태입니다.</p>}
    {current?.artifacts && <p className="rtl-guide-note">결과: <code>{current.artifacts.result}</code>{current.artifacts.macro_placement && <> · OpenLane 제약: <code>{current.artifacts.macro_placement}</code></>}</p>}
  </section>
}
