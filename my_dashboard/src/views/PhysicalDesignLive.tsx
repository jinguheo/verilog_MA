import { FormEvent, useEffect, useState } from 'react'

const API = 'http://127.0.0.1:8788/api/physical-design'

type InstallItem = { installed: boolean; version?: string; name?: string; revision?: string; path?: string; image?: string }
type Tool = { name: string; status: string; purpose: string }
type Design = {
  name: string; config: string; top_module: string; rtl_count: number; rtl_found: number
  sdc: string; sdc_found: boolean; clock_port: string; clock_period?: number
  connected: boolean; missing: string[]
}
type PhysicalStatus = {
  generated_at: string
  installation: {
    wsl: InstallItem; docker: InstallItem; openlane: InstallItem; pdk: InstallItem
    tools: Tool[]
    smoke_test: Record<string, string | number>
  }
  designs: Design[]
  summary: { connected: number; total: number }
}

const emptyForm = {
  design_name: '', top_module: '', rtl_files: '', sdc_file: '',
  clock_port: 'clk', clock_period: '10', core_utilization: '40',
}

export default function PhysicalDesignLive() {
  const [data, setData] = useState<PhysicalStatus | null>(null)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [form, setForm] = useState(emptyForm)
  const [showForm, setShowForm] = useState(false)

  const load = () => fetch(API)
    .then(async response => {
      if (!response.ok) throw new Error(String(response.status))
      setData(await response.json())
      setError('')
    })
    .catch(() => setError('Physical Design API에 연결할 수 없습니다.'))

  useEffect(() => { load() }, [])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setMessage('저장 중...')
    const response = await fetch(API + '/configure', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...form,
        rtl_files: form.rtl_files.split(/\r?\n/).filter(Boolean),
        clock_period: Number(form.clock_period),
        core_utilization: Number(form.core_utilization),
      }),
    })
    const result = await response.json()
    if (!response.ok) {
      setMessage(result.message || '연결 구성 저장 실패')
      return
    }
    setMessage('연결 완료: ' + result.config)
    setForm(emptyForm)
    load()
  }

  const install = data ? [
    ['WSL / Ubuntu', data.installation.wsl],
    ['Docker Engine', data.installation.docker],
    ['OpenLane', data.installation.openlane],
    ['SKY130 PDK', data.installation.pdk],
  ] as const : []
  const smoke = data?.installation.smoke_test

  return <>
    <section className="card">
      <div className="card-title"><div><small className="kicker">LIVE INSTALLATION STATUS</small><h2>Physical Design 실행 환경</h2></div><button className="refresh" onClick={load}>상태 새로고침</button></div>
      {error && <div className="notice">{error}</div>}
      <div className="pd-install-grid">
        {install.map(([label, item]) => <article className="pd-install" key={label}>
          <i className={item.installed ? 'online' : ''}/><div><small>{label}</small><b>{item.installed ? '설치됨' : '확인 필요'}</b><span>{item.version || item.name}</span></div>
        </article>)}
      </div>
      {data && <div className="data-table"><table><thead><tr><th>검증</th><th>결과</th><th>세부 정보</th></tr></thead><tbody>
        <tr><td>OpenLane smoke test</td><td><span className={smoke?.status === 'passed' ? 'ok-badge' : 'warning-badge'}>{String(smoke?.status || 'unknown')}</span></td><td>{smoke?.stages} · {smoke?.duration}</td></tr>
        <tr><td>제조 검증</td><td><span className="ok-badge">DRC {smoke?.drc} · LVS {smoke?.lvs}</span></td><td>Antenna {smoke?.antenna} · setup/hold violation {smoke?.setup_violations}/{smoke?.hold_violations}</td></tr>
        <tr><td>PDK revision</td><td><code>sky130A</code></td><td className="truncate">{data.installation.pdk.revision}</td></tr>
      </tbody></table></div>}
      {data?.installation.tools.length ? <div className="pd-tools">{data.installation.tools.map(tool => <span key={tool.name}><b>{tool.name}</b> · {tool.purpose}</span>)}</div> : null}
    </section>

    <section className="card">
      <div className="card-title"><div><small className="kicker">RTL + SDC CONNECTION</small><h2>OpenLane 설계 입력 연결</h2></div><button className="refresh" onClick={() => setShowForm(!showForm)}>{showForm ? '닫기' : '새 연결'}</button></div>
      <p className="rtl-guide-note">RTL 목록, Top module, SDC, 기준 클럭을 하나의 OpenLane config로 묶습니다. SDC는 P&amp;R과 signoff STA 양쪽에 동일하게 연결됩니다.</p>
      {showForm && <form className="pd-form" onSubmit={submit}>
        <label>설계 이름<input required value={form.design_name} onChange={e => setForm({...form, design_name: e.target.value})} placeholder="my_core"/></label>
        <label>Top module<input required value={form.top_module} onChange={e => setForm({...form, top_module: e.target.value})} placeholder="my_core"/></label>
        <label className="wide">RTL 파일 절대 경로 — 한 줄에 하나<textarea required rows={5} value={form.rtl_files} onChange={e => setForm({...form, rtl_files: e.target.value})} placeholder={'D:\\MyWork\\Veriolg_MA\\rtl\\my_core.sv'}/></label>
        <label className="wide">SDC 절대 경로<input required value={form.sdc_file} onChange={e => setForm({...form, sdc_file: e.target.value})} placeholder="D:\\MyWork\\Veriolg_MA\\constraints\\my_core.sdc"/></label>
        <label>Clock port<input required value={form.clock_port} onChange={e => setForm({...form, clock_port: e.target.value})}/></label>
        <label>Clock period (ns)<input required type="number" min="0.01" step="0.01" value={form.clock_period} onChange={e => setForm({...form, clock_period: e.target.value})}/></label>
        <label>Core utilization (%)<input required type="number" min="10" max="80" value={form.core_utilization} onChange={e => setForm({...form, core_utilization: e.target.value})}/></label>
        <button className="refresh" type="submit">RTL/SDC 연결 저장</button>
        {message && <p className="wide rtl-guide-note">{message}</p>}
      </form>}
      <div className="data-table"><table><thead><tr><th>설계 / Top</th><th>RTL</th><th>SDC</th><th>Clock</th><th>연결 상태</th></tr></thead><tbody>
        {data?.designs.map(design => <tr key={design.config}><td><b>{design.name}</b><small className="pd-path">{design.config}</small></td><td>{design.rtl_found}/{design.rtl_count}</td><td className="truncate">{design.sdc_found ? design.sdc : '없음'}</td><td><code>{design.clock_port || '-'} · {design.clock_period ?? '-'}ns</code></td><td><span className={design.connected ? 'ok-badge' : 'warning-badge'}>{design.connected ? '연결 완료' : '확인 필요'}</span>{design.missing.length > 0 && <small className="pd-path">{design.missing.length} missing</small>}</td></tr>)}
        {data?.designs.length === 0 && <tr><td colSpan={5}>등록된 OpenLane config가 없습니다.</td></tr>}
      </tbody></table></div>
    </section>
  </>
}
