import { FormEvent, useEffect, useMemo, useRef, useState } from 'react'
import AnalogVsDigital from './AnalogVsDigital'
import MemoryDesign from './MemoryDesign'
import AdcDacComparison from './AdcDacComparison'

const API = 'http://127.0.0.1:8788'

type Tool = { name:string; status:string; purpose:string; path:string }
type CatalogItem = { id:string; name:string; function:string; pdk:string[]; kind:string; maturity:string; installed:boolean; path:string; evidence:string[]; artifacts:Record<string,number> }
type Candidate = { id:string; name:string; score:number; eligible:boolean; blockers:string[]; reasons:string[]; kind:string; maturity:string; installed:boolean; evidence:string[]; ppa:{status:string} }
type Stage = { id:string; label:string; description:string; status:string }
type Study = { id:string; created_at:string; requirements:{function:string; pdk:string; supply_v?:number|null; resolution_bits?:number|null; sample_rate_hz?:number|null; capacity_kb?:number|null; word_width?:number|null; ports?:number|null; max_power_mw?:number|null; max_area_um2?:number|null; weights?:{performance:number;power:number;area:number}}; selection:{status:string; recommended:string|null; candidates:Candidate[]}; optimization_policy:{hard_gates:string[]; objective:string}; stages:Stage[] }
type MemoryMacro = { macro:string; width_bits:number; depth_words:number; capacity_kb:number; ports:number; area_um2?:number; complete:boolean; views:Record<string,string[]> }
type Job = { id:string; study_id:string; candidate_id:string; candidate_name:string; action:string; status:string; created_at:string; started_at?:string; finished_at?:string; error?:string; result?:{passed?:boolean; complete?:boolean; metrics?:Record<string,number>; statuses?:Record<string,string>; views?:Record<string,number>; area_um2?:number; area_source?:string; log_tail?:string; run_path?:string; output_path?:string; file_count?:number; blocked_reason?:string; resource_gate?:string; missing_views?:string[]; selected?:MemoryMacro} }
type AnalogData = {
  installation:{
    pdk?:{name:string; path_wsl:string; status:string}
    tools?:Tool[]
    optimization?:Record<string,string>
    safety_policy?:Record<string,string>
    catalog_total:number
    catalog_installed:number
    catalog:CatalogItem[]
  }
  studies:Study[]
  jobs:Job[]
}

const balancedPpaPreset = {
  function: 'adc', pdk: 'sky130A', supply_v: '3.3', resolution_bits: '12',
  sample_rate_hz: '1000000', capacity_kb: '', word_width: '', ports: '',
  max_power_mw: '20', max_area_um2: '500000', performance_weight: '2', power_weight: '1', area_weight: '1',
}

const optimalSramPreset = {
  function: 'sram', pdk: 'sky130A', supply_v: '1.8', resolution_bits: '',
  sample_rate_hz: '25000000', capacity_kb: '4', word_width: '32', ports: '1',
  max_power_mw: '', max_area_um2: '400000', performance_weight: '1', power_weight: '1', area_weight: '1',
}

const initialForm = {...balancedPpaPreset}

const functionLabels:Record<string,string> = {
  adc:'ADC', dac:'DAC', comparator:'Comparator', ldo:'LDO',
  temperature_sensor:'Temperature sensor', custom_analog:'Custom analog',
  sram:'SRAM macro / array', memory_controller:'External memory controller',
}

function numericBody(form:typeof initialForm) {
  const body:Record<string,string|number> = { function:form.function, pdk:form.pdk }
  Object.entries(form).forEach(([key,value]) => {
    if (key !== 'function' && key !== 'pdk' && value !== '') body[key] = Number(value)
  })
  return body
}

function formFromStudy(study:Study) {
  const requirement = study.requirements
  const preset = requirement.function === 'sram' ? optimalSramPreset : balancedPpaPreset
  const value = (item:number|null|undefined, fallback:string) => item == null ? fallback : String(item)
  return {
    ...preset, function:requirement.function, pdk:requirement.pdk,
    supply_v:value(requirement.supply_v,preset.supply_v),
    resolution_bits:value(requirement.resolution_bits,preset.resolution_bits),
    sample_rate_hz:value(requirement.sample_rate_hz,preset.sample_rate_hz),
    capacity_kb:value(requirement.capacity_kb,preset.capacity_kb),
    word_width:value(requirement.word_width,preset.word_width), ports:value(requirement.ports,preset.ports),
    max_power_mw:value(requirement.max_power_mw,preset.max_power_mw),
    max_area_um2:value(requirement.max_area_um2,preset.max_area_um2),
    performance_weight:value(requirement.weights?.performance,preset.performance_weight),
    power_weight:value(requirement.weights?.power,preset.power_weight),
    area_weight:value(requirement.weights?.area,preset.area_weight),
  }
}

export default function AnalogDesign() {
  const [data,setData] = useState<AnalogData|null>(null)
  const [form,setForm] = useState(initialForm)
  const [active,setActive] = useState<Study|null>(null)
  const [error,setError] = useState('')
  const [busy,setBusy] = useState(false)
  const [tab,setTab] = useState<'circuit' | 'requirements' | 'ppa_experiment' | 'vs_digital' | 'memory_design' | 'adc_dac'>('circuit')
  const formHydrated = useRef(false)
  const load = () => fetch(API + '/api/analog').then(async response => {
    if (!response.ok) throw new Error('Analog API 응답 오류')
    const result = await response.json() as AnalogData
    setData(result)
    const latest = result.studies[0] ?? null
    setActive(current => current ? result.studies.find(study => study.id === current.id) ?? current : latest)
    if (!formHydrated.current) {
      if (latest) setForm(formFromStudy(latest))
      formHydrated.current = true
    }
    setError('')
  }).catch(reason => setError(String(reason)))
  useEffect(() => { load() }, [])
  useEffect(() => {
    if (!data?.jobs?.some(job => job.status === 'queued' || job.status === 'running')) return
    const timer = window.setInterval(load, 2500)
    return () => window.clearInterval(timer)
  }, [data?.jobs])

  const selected = useMemo(() => active?.selection.candidates.find(item => item.id === active.selection.recommended), [active])
  const set = (key:string,value:string) => setForm(current => ({...current,[key]:value}))
  const setFunction = (value:string) => {
    if (value === 'sram') setForm({...optimalSramPreset})
    else if (value === 'adc') setForm({...balancedPpaPreset})
    else setForm(current => ({...current,function:value}))
  }
  const applyBalancedPpaPreset = () => {
    setForm(balancedPpaPreset)
    setTab('requirements')
  }
  const restoreRecommendedValues = () => {
    setForm(active ? formFromStudy(active) : {...balancedPpaPreset})
  }
  const submit = async (event:FormEvent) => {
    event.preventDefault(); setBusy(true); setError('')
    try {
      const response = await fetch(API + '/api/analog/select', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(numericBody(form))})
      const result = await response.json()
      if (!response.ok) throw new Error(result.message ?? '선정 요청 실패')
      setActive(result as Study)
      await load()
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { setBusy(false) }
  }
  const run = async (action:string) => {
    if (!active || !selected) return
    setBusy(true); setError('')
    try {
      const response = await fetch(API + '/api/analog/run', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body:JSON.stringify({study_id:active.id,candidate_id:selected.id,action}),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.message ?? '실행 요청 실패')
      await load()
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { setBusy(false) }
  }

  if (!data) return <section className="card"><p className="empty">{error || '아날로그 설계 데이터를 불러오는 중입니다…'}</p></section>
  const installation = data.installation
  return <div className="analog-page">
    {error && <div className="notice">{error}</div>}
    <section className="stats">
      <div className="stat-card"><small>Public design resources</small><strong>{installation.catalog_installed}/{installation.catalog_total}</strong><span>로컬 설치 / 등록</span></div>
      <div className="stat-card"><small>Analog toolchain</small><strong>{installation.tools?.filter(tool=>tool.status==='available').length ?? 0}</strong><span>Xschem · SPICE · DRC/LVS · CACE</span></div>
      <div className="stat-card"><small>PDK</small><strong>{installation.pdk?.name ?? '-'}</strong><span>{installation.pdk?.status ?? 'unknown'}</span></div>
      <div className="stat-card"><small>Requirement studies</small><strong>{data.studies.length}</strong><span>선정 이력</span></div>
    </section>

    <section className="card analog-policy">
      <div className="card-title"><div><small className="kicker">SIGNOFF POLICY</small><h2>검증 가능한 결과만 최적화</h2></div><span className="connection">DRC 0 · LVS match</span></div>
      <p>DRC와 LVS는 점수 항목이 아니라 필수 통과 조건입니다. PEX 이후 실제 측정된 성능·전력·면적만 Pareto 비교에 사용하며, 아직 실행하지 않은 값은 <code>not_measured</code>로 표시합니다.</p>
    </section>

    <div className="analog-tabs" role="tablist" aria-label="아날로그 및 메모리 작업">
      <button role="tab" aria-selected={tab === 'circuit'} className={tab === 'circuit' ? 'active' : ''} onClick={() => setTab('circuit')}>전체 아날로그 회로도</button>
      <button role="tab" aria-selected={tab === 'requirements'} className={tab === 'requirements' ? 'active' : ''} onClick={() => setTab('requirements')}>현재 설계</button>
      <button role="tab" aria-selected={tab === 'ppa_experiment'} className={tab === 'ppa_experiment' ? 'active' : ''} onClick={() => setTab('ppa_experiment')}>PPA 실험 1</button>
      <button role="tab" aria-selected={tab === 'vs_digital'} className={tab === 'vs_digital' ? 'active' : ''} onClick={() => setTab('vs_digital')}>아날로그·메모리·디지털 차이</button>
      <button role="tab" aria-selected={tab === 'memory_design'} className={tab === 'memory_design' ? 'active' : ''} onClick={() => setTab('memory_design')}>메모리 셀 설계</button>
      <button role="tab" aria-selected={tab === 'adc_dac'} className={tab === 'adc_dac' ? 'active' : ''} onClick={() => setTab('adc_dac')}>ADC vs DAC 상세</button>
    </div>
    {tab === 'circuit' && <AnalogCircuitOverview catalog={installation.catalog}/>} 
    <div hidden={tab !== 'requirements'}>
    <div className="analog-two-column">
      <section className="card">
        <div className="card-title"><div><small className="kicker">REQUIREMENT → CANDIDATE</small><h2>요구사항 기반 회로 선정</h2></div></div>
        <form className="analog-form" onSubmit={submit}>
          <label>기능<select value={form.function} onChange={e=>setFunction(e.target.value)}>{Object.entries(functionLabels).map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></label>
          <label>PDK<select value={form.pdk} onChange={e=>set('pdk',e.target.value)}><option value="sky130A">sky130A</option><option value="ihp-sg13g2">IHP SG13G2</option></select></label>
          <label>공급전압 (V)<input type="number" step="0.1" min="0" value={form.supply_v} onChange={e=>set('supply_v',e.target.value)}/></label>
          <label>해상도 (bit)<input type="number" min="1" value={form.resolution_bits} onChange={e=>set('resolution_bits',e.target.value)}/></label>
          <label>샘플률 (Hz)<input type="number" min="0" value={form.sample_rate_hz} onChange={e=>set('sample_rate_hz',e.target.value)}/></label>
          <label>메모리 용량 (KB)<input type="number" min="0" value={form.capacity_kb} onChange={e=>set('capacity_kb',e.target.value)}/></label>
          <label>Word width<input type="number" min="1" value={form.word_width} onChange={e=>set('word_width',e.target.value)}/></label>
          <label>Ports<input type="number" min="1" value={form.ports} onChange={e=>set('ports',e.target.value)}/></label>
          <label>최대 전력 (mW)<input type="number" min="0" value={form.max_power_mw} onChange={e=>set('max_power_mw',e.target.value)}/></label>
          <label>최대 면적 (µm²)<input type="number" min="0" value={form.max_area_um2} onChange={e=>set('max_area_um2',e.target.value)}/></label>
          <fieldset><legend>PPA 가중치</legend>
            <label>성능<input type="number" min="0" value={form.performance_weight} onChange={e=>set('performance_weight',e.target.value)}/></label>
            <label>전력<input type="number" min="0" value={form.power_weight} onChange={e=>set('power_weight',e.target.value)}/></label>
            <label>면적<input type="number" min="0" value={form.area_weight} onChange={e=>set('area_weight',e.target.value)}/></label>
          </fieldset>
          <div className="analog-form-baseline">
            <span>수정 기준: <b>{selected?.name ?? 'SKY130A 균형형 ADC'}</b></span>
            <button type="button" onClick={restoreRecommendedValues}>최적 후보 기준값 복원</button>
          </div>
          <button className="analog-submit" disabled={busy}>{busy ? '분석 중…' : '후보 선정 실행'}</button>
        </form>
        <p className="analog-hint">SRAM은 bitcell array·decoder·sense amp·write driver를 포함하는 내부 매크로 트랙입니다. PSRAM/QSPI controller는 외부 메모리를 제어하는 디지털 RTL 트랙으로 별도 표시됩니다.</p>
      </section>

      <section className="card">
        <div className="card-title"><div><small className="kicker">CURRENT DESIGN</small><h2>{active ? functionLabels[active.requirements.function] ?? active.requirements.function : '아직 실행되지 않음'}</h2></div>{active && <span className="connection">{active.selection.status}</span>}</div>
        {!active ? <p className="empty">왼쪽에서 요구사항을 입력해 첫 분석을 실행하세요.</p> : <>
          <div className="analog-recommend">
            <small>추천 후보</small><b>{selected?.name ?? '호환 후보 없음'}</b>
            <span>{selected ? selected.kind + ' · score ' + selected.score + ' · PPA ' + selected.ppa.status : 'PDK와 기능 조건을 만족하는 공개 후보가 없습니다.'}</span>
          </div>
          <div className="analog-stage-list">{active.stages.map((stage,index)=><div key={stage.id} className={'analog-stage '+stage.status}><i>{index+1}</i><div><b>{stage.label}</b><span>{stage.description}</span></div><em>{stage.status}</em></div>)}</div>
          <div className="analog-actions">
            <button onClick={()=>run('artifact_audit')} disabled={busy}>산출물 감사</button>
            {selected && ['sky130_ef_adc3v_12bit','sky130_ef_cdac3v_12bit','sky130_ef_ccomp3v'].includes(selected.id) && <>
              <button onClick={()=>run('area')} disabled={busy}>면적 측정</button>
              <button onClick={()=>run('drc')} disabled={busy}>Magic DRC</button>
              <button onClick={()=>run('lvs')} disabled={busy}>Netgen LVS</button>
              <button className="primary" onClick={()=>run('physical_signoff')} disabled={busy}>전체 물리 검증</button>
            </>}
            {selected && ['openfasoc_temp','openfasoc_ldo'].includes(selected.id) && <>
              <button onClick={()=>run('generate_verilog')} disabled={busy}>Verilog 생성</button>
              <button className="primary" onClick={()=>run('generate_macro')} disabled={busy}>GDS 매크로 생성</button>
            </>}
            {selected && ['sky130_sram_macros','sram22_sky130_macros'].includes(selected.id) && <button className="primary" onClick={()=>run('select_memory_macro')} disabled={busy}>요구조건 SRAM 선정</button>}
          </div>
        </>}
      </section>
    </div>

    <section className="card">
      <div className="card-title"><div><small className="kicker">EXECUTION EVIDENCE</small><h2>실제 실행 작업</h2></div><span className="connection">{data.jobs?.length ?? 0} jobs</span></div>
      {!data.jobs?.length ? <p className="empty">후보를 선정한 뒤 산출물 감사 또는 CACE 검증을 실행하세요.</p> :
      <div className="analog-job-list">{data.jobs.map(job=><details key={job.id} open={job.status==='running'||job.status==='blocked'}>
        <summary><span className={'analog-badge '+(job.status==='complete'?'ok':job.status==='blocked'||job.status==='failed'?'blocked':'running')}>{job.status}</span><b>{job.action}</b><span>{job.candidate_name}</span><code>{job.id}</code></summary>
        <div className="analog-job-result">
          {job.error && <p className="notice">{job.error}</p>}
          {job.result?.blocked_reason && <p className="notice">{job.result.blocked_reason}</p>}
          {job.result?.metrics && <p><b>측정값</b><span>{Object.entries(job.result.metrics).map(([key,value])=>key+'='+value).join(' · ') || '-'}</span></p>}
          {job.result?.statuses && <p><b>검증 상태</b><span>{Object.entries(job.result.statuses).map(([key,value])=>key+'='+value).join(' · ') || '-'}</span></p>}
          {job.result?.views && <p><b>매크로 뷰</b><span>{Object.entries(job.result.views).map(([key,value])=>key+'='+value).join(' · ')}</span></p>}
          {job.result?.area_um2 != null && <p><b>최소 LEF 면적</b><span>{job.result.area_um2} µm² · {job.result.area_source}</span></p>}
          {job.result?.run_path && <p><b>증거 경로</b><code>{job.result.run_path}</code></p>}
          {job.result?.output_path && <p><b>생성 경로</b><code>{job.result.output_path} · {job.result.file_count ?? 0} files</code></p>}
          {job.result?.selected && <p><b>선정 SRAM</b><span>{job.result.selected.macro} · {job.result.selected.depth_words}×{job.result.selected.width_bits}bit · {job.result.selected.capacity_kb}KB · {job.result.selected.area_um2 ?? '-'} µm²</span></p>}
          {!!job.result?.missing_views?.length && <p><b>누락 뷰</b><span>{job.result.missing_views.join(' · ')}</span></p>}
          {job.result?.log_tail && <pre>{job.result.log_tail}</pre>}
        </div>
      </details>)}</div>}
    </section>

    {active && <section className="card">
      <div className="card-title"><div><small className="kicker">RANKED RESULTS</small><h2>후보별 근거와 차단 조건</h2></div></div>
      <div className="data-table"><table><thead><tr><th>후보</th><th>종류</th><th>점수</th><th>판정</th><th>근거 / 차단</th><th>PPA</th></tr></thead><tbody>
        {active.selection.candidates.map(item=><tr key={item.id}><td><b>{item.name}</b><small className="analog-sub">{item.maturity}</small></td><td>{item.kind}</td><td>{item.score}</td><td><span className={'analog-badge '+(item.eligible?'ok':'blocked')}>{item.eligible?'eligible':'blocked'}</span></td><td>{[...item.reasons,...item.blockers].join(' · ')}</td><td><code>{item.ppa.status}</code></td></tr>)}
      </tbody></table></div>
    </section>}

    <section className="card">
      <div className="card-title"><div><small className="kicker">INSTALLED KNOWLEDGE & IP</small><h2>공개 아날로그·메모리 자원</h2></div><span className="connection">{installation.catalog_installed} installed</span></div>
      <div className="analog-tools">{installation.tools?.map(tool=><div key={tool.name}><i className={tool.status==='available'?'online':''}/><b>{tool.name}</b><span>{tool.purpose}</span><code>{tool.path}</code></div>)}</div>
      <div className="data-table analog-catalog"><table><thead><tr><th>자원</th><th>기능 / PDK</th><th>형태</th><th>검증 근거</th><th>산출물</th><th>상태</th></tr></thead><tbody>
        {installation.catalog.map(item=><tr key={item.id}><td><b>{item.name}</b><small className="analog-sub">{item.maturity}</small></td><td>{item.function}<small className="analog-sub">{item.pdk.join(', ')}</small></td><td>{item.kind}</td><td>{item.evidence.join(' · ')}</td><td>{Object.entries(item.artifacts).map(([key,value])=>key + ' ' + value).join(' · ') || '-'}</td><td><span className={'analog-badge '+(item.installed?'ok':'blocked')}>{item.installed?'installed':'missing'}</span></td></tr>)}
      </tbody></table></div>
    </section>
    </div>
    {tab === 'ppa_experiment' && <PpaExperimentOne onApply={applyBalancedPpaPreset}/>}
    {tab === 'vs_digital' && <AnalogVsDigital tools={installation.tools ?? []} catalog={installation.catalog}/>} 
    {tab === 'memory_design' && <MemoryDesign/>}
    {tab === 'adc_dac' && <AdcDacComparison/>}
  </div>
}

function PpaExperimentOne({ onApply }: { onApply: () => void }) {
  return <section className="card ppa-experiment">
    <div className="card-title"><div><small className="kicker">PPA EXPERIMENT 1</small><h2>SKY130A 균형형 ADC 기준점</h2></div><span className="connection">baseline</span></div>
    <p>첫 Pareto 비교를 위한 보수적 기준점입니다. 수치는 목표 조건이며, 전력·면적·성능은 PEX와 물리 검증 이후의 실측값으로 갱신합니다.</p>
    <div className="stats ppa-experiment-stats">
      <div className="stat-card"><small>공정 / 기능</small><strong>SKY130A</strong><span>12-bit ADC</span></div>
      <div className="stat-card"><small>동작 조건</small><strong>3.3 V</strong><span>TT · 25 °C</span></div>
      <div className="stat-card"><small>성능 목표</small><strong>1 MS/s</strong><span>성능 가중치 2</span></div>
      <div className="stat-card"><small>PPA 예산</small><strong>20 mW</strong><span>면적 ≤ 0.5 mm²</span></div>
    </div>
    <section className="ppa-result-card">
      <div className="card-title"><div><small className="kicker">EXECUTION RESULT · 2026-09-20</small><h3>실험 1 현재 상태</h3></div><span className="analog-badge blocked">physical gate blocked</span></div>
      <p>후보 선정과 면적 측정은 완료됐지만, DRC/LVS 하드 게이트가 통과하지 않아 PEX와 Pareto 비교는 보류 상태입니다.</p>
      <div className="ppa-result-grid">
        <article><small>선정 후보</small><b>Efabless SKY130 12-bit SAR ADC</b><span>score 104 · selected</span></article>
        <article><small>면적</small><b>65,628.68 µm²</b><span>0.0656 mm² · 예산 0.5 mm² 통과</span></article>
        <article><small>KLayout DRC</small><b>0 violations</b><span className="ok-text">pass</span></article>
        <article><small>Magic DRC</small><b>103 violations</b><span className="warn-text">fail · CDAC 84 · 비교기 4 · 상위 15</span></article>
        <article><small>Netgen LVS</small><b>LVS match</b><span className="ok-text">pass · adapter fixed</span></article>
        <article><small>다음 단계</small><b>PEX / Pareto</b><span>DRC 0 · LVS match 이후 실행</span></article>
      </div>
    </section>
    <section className="ppa-result-card">
      <div className="card-title"><div><small className="kicker">LAYOUT FIX PLAN · ACTIVE</small><h3>현재 작업: CDAC 우선 배치 검토</h3></div><span className="analog-badge blocked">CDAC first</span></div>
      <p>103건 중 84건이 CDAC에 반복되어 있습니다. 동일한 단위 커패시터 배열을 먼저 고쳐야 한 번의 수정이 배열 전체에 일관되게 적용되고, 이후 비교기·상위 통합 배치를 다시 깨뜨리지 않습니다.</p>
      <div className="ppa-result-grid">
        <article><small>원인 규칙</small><b>diff/tap.18,20</b><span>MV nwell ↔ N-diff/P-tap ≥ 0.43 µm</span></article>
        <article><small>배치 제약</small><b>대칭 여유부 확보</b><span>CDAC 외곽의 MV nwell·guard ring을 양쪽 동일하게 확장/이동</span></article>
        <article><small>보존할 특성</small><b>매칭·공통중심</b><span>unit cap, dummy, 배선 길이와 기생성분의 좌우 균형 유지</span></article>
        <article><small>검증 순서</small><b>단위 → 배열 → 상위</b><span>Magic DRC 0 후 LVS, 그 다음 PEX/Pareto</span></article>
      </div>
      <p><b>왜 먼저 하는가:</b> CDAC의 커패시터 비율과 대칭은 12-bit 선형성(INL/DNL)에 직접 영향을 줍니다. 배치 단계에서 여유부를 예약하면 DRC 수정 때문에 나중에 커패시터 또는 guard ring을 비대칭으로 옮기는 위험과 재배선·기생 RC 증가를 줄일 수 있습니다.</p>
    </section>

    <div className="data-table"><table><thead><tr><th>항목</th><th>설정값</th><th>판정</th></tr></thead><tbody>
      <tr><td>후보 선정</td><td>SKY130A 호환 공개 ADC / 매크로</td><td>PDK·기능 조건 충족</td></tr>
      <tr><td>성능</td><td>12-bit · 1 MS/s</td><td>요구 성능 달성</td></tr>
      <tr><td>전력 / 면적</td><td>≤ 20 mW · ≤ 500,000 µm²</td><td>PEX 이후 실측값</td></tr>
      <tr><td>물리 검증</td><td>Magic DRC · Netgen LVS · PEX</td><td>DRC 0 · LVS match</td></tr>
      <tr><td>Pareto</td><td>성능 : 전력 : 면적 = 2 : 1 : 1</td><td>지배 후보 제외</td></tr>
    </tbody></table></div>
    <button className="ppa-preset-button" type="button" onClick={onApply}>이 설정값을 요구사항 기반 회로에 적용</button>
  </section>
}

function AnalogCircuitOverview({ catalog }: { catalog: CatalogItem[] }) {
  const installed = (id:string) => catalog.find(item => item.id === id)?.installed ? 'installed' : 'missing'
  return <section className="card analog-circuit-overview">
    <div className="card-title"><div><small className="kicker">IMPLEMENTED ANALOG & MEMORY MAP</small><h2>전체 설계 회로도</h2></div><span className="connection">SKY130A · evidence-based</span></div>
    <p className="analog-circuit-intro">현재까지 도입·검증한 공개 IP와 통합 경로입니다. 초록 표시는 로컬 설치, 주황 표시는 물리 signoff가 아직 남은 경로입니다.</p>
    <div className="analog-schematic-wrap">
      <svg className="analog-schematic" viewBox="0 0 1200 650" role="img" aria-label="ADC, 온도센서, LDO, SRAM 및 PSRAM의 아날로그 메모리 설계 회로도">
        <defs><marker id="arrow" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto"><path d="M0,0 L0,6 L9,3 z"/></marker></defs>
        <path className="schematic-wire signal" d="M185 190 H255" markerEnd="url(#arrow)"/><path className="schematic-wire signal" d="M415 190 H485" markerEnd="url(#arrow)"/><path className="schematic-wire signal" d="M645 190 H715" markerEnd="url(#arrow)"/><path className="schematic-wire digital" d="M875 190 H1005" markerEnd="url(#arrow)"/>
        <path className="schematic-wire power" d="M340 455 V305 H560 V255" markerEnd="url(#arrow)"/><path className="schematic-wire digital" d="M595 455 V335 H1050 V255" markerEnd="url(#arrow)"/><path className="schematic-wire digital" d="M870 455 V365 H1050 V255" markerEnd="url(#arrow)"/>
        <g className="schematic-block input"><rect x="35" y="130" width="150" height="120" rx="14"/><text x="110" y="165" textAnchor="middle" className="block-title">아날로그 입력</text><text x="110" y="193" textAnchor="middle">VINP / VINM</text><text x="110" y="216" textAnchor="middle">3.3 V domain</text></g>
        <g className="schematic-block adc"><rect x="255" y="115" width="160" height="150" rx="14"/><text x="335" y="150" textAnchor="middle" className="block-title">Sample &amp; Hold</text><text x="335" y="180" textAnchor="middle">12-bit CDAC</text><text x="335" y="208" textAnchor="middle">공개 SKY130 IP</text><text x="335" y="235" textAnchor="middle" className="block-status">{installed('sky130_ef_adc3v_12bit')}</text></g>
        <g className="schematic-block adc"><rect x="485" y="115" width="160" height="150" rx="14"/><text x="565" y="150" textAnchor="middle" className="block-title">Comparator</text><text x="565" y="180" textAnchor="middle">clocked 3.3 V</text><text x="565" y="208" textAnchor="middle">SAR decision</text><text x="565" y="235" textAnchor="middle" className="block-status">KLayout DRC 0</text></g>
        <g className="schematic-block digital-block"><rect x="715" y="115" width="160" height="150" rx="14"/><text x="795" y="150" textAnchor="middle" className="block-title">SAR Control</text><text x="795" y="180" textAnchor="middle">12-bit code</text><text x="795" y="208" textAnchor="middle">level shifting</text><text x="795" y="235" textAnchor="middle" className="block-status warn">Magic DRC 103 · LVS match</text></g>
        <g className="schematic-block interface"><rect x="1005" y="115" width="155" height="150" rx="14"/><text x="1082" y="150" textAnchor="middle" className="block-title">Digital SoC</text><text x="1082" y="180" textAnchor="middle">ADC data bus</text><text x="1082" y="208" textAnchor="middle">control / status</text></g>
        <g className="schematic-block sensor"><rect x="105" y="430" width="180" height="125" rx="14"/><text x="195" y="467" textAnchor="middle" className="block-title">Temperature Sensor</text><text x="195" y="495" textAnchor="middle">OpenFASoC</text><text x="195" y="522" textAnchor="middle" className="block-status">Verilog generated</text></g>
        <g className="schematic-block power-block"><rect x="430" y="430" width="165" height="125" rx="14"/><text x="512" y="467" textAnchor="middle" className="block-title">Digital LDO</text><text x="512" y="495" textAnchor="middle">regulated rails</text><text x="512" y="522" textAnchor="middle" className="block-status warn">macro queued</text></g>
        <g className="schematic-block memory"><rect x="700" y="430" width="170" height="125" rx="14"/><text x="785" y="467" textAnchor="middle" className="block-title">SRAM22 Macro</text><text x="785" y="495" textAnchor="middle">1024 × 32 bit</text><text x="785" y="522" textAnchor="middle" className="block-status">4 KB · 7 views</text></g>
        <g className="schematic-block interface"><rect x="960" y="430" width="185" height="125" rx="14"/><text x="1052" y="467" textAnchor="middle" className="block-title">PSRAM / QSPI</text><text x="1052" y="495" textAnchor="middle">external controller</text><text x="1052" y="522" textAnchor="middle" className="block-status">verified RTL</text></g>
        <text x="215" y="405" className="wire-label">thermal telemetry</text><text x="455" y="335" className="wire-label">regulated analog supply</text><text x="720" y="405" className="wire-label">memory mapped data path</text>
      </svg>
    </div>
    <div className="analog-circuit-legend"><span><i className="legend-signal"/> analog signal</span><span><i className="legend-power"/> regulated power</span><span><i className="legend-digital"/> digital / memory bus</span><span><i className="legend-warning"/> signoff pending</span></div>
    <div className="analog-circuit-facts">
      <article><b>ADC evidence</b><span>면적 65,628.68 µm² · KLayout DRC 0 · Netgen LVS match · Magic DRC 103 (CDAC 84 / 비교기 4 / 상위 통합 15)</span></article>
      <article><b>Magic DRC 진단</b><span><code>diff/tap.18,20</code> 단일 규칙군: MV nwell과 N-diff/P-tap 간격 0.43 µm. 반복 CDAC 배열 경계에 집중되어 PDK·레이아웃 검토가 필요합니다.</span></article>
      <article><b>SRAM integration</b><span>SRAM22 4KB·32bit·1-port · LEF/GDS/Liberty/SPICE/Verilog 준비</span></article>
      <article><b>Generator status</b><span>온도센서·LDO Verilog 생성 완료 · 물리 매크로 생성은 OpenLane 작업 종료 후 실행</span></article>
    </div>
  </section>
}
