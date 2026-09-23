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

const ppa3PlacementPreset = {
  function: 'adc', pdk: 'sky130A', supply_v: '3.3', resolution_bits: '12',
  sample_rate_hz: '1000000', capacity_kb: '', word_width: '', ports: '',
  max_power_mw: '15', max_area_um2: '100000', performance_weight: '2', power_weight: '1', area_weight: '2',
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
  const [tab,setTab] = useState<'circuit' | 'requirements' | 'ppa_experiment' | 'ppa_experiment_2' | 'ppa_experiment_3' | 'vs_digital' | 'memory_design' | 'adc_dac'>('circuit')
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
  const applyPpa3PlacementPreset = () => {
    setForm(ppa3PlacementPreset)
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
      <button role="tab" aria-selected={tab === 'ppa_experiment_2'} className={tab === 'ppa_experiment_2' ? 'active' : ''} onClick={() => setTab('ppa_experiment_2')}>PPA 실험 2</button>
      <button role="tab" aria-selected={tab === 'ppa_experiment_3'} className={tab === 'ppa_experiment_3' ? 'active' : ''} onClick={() => setTab('ppa_experiment_3')}>PPA 실험 3</button>
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
    {tab === 'ppa_experiment_2' && <PpaExperimentTwo/>}
    {tab === 'ppa_experiment_3' && <PpaExperimentThree onApply={applyPpa3PlacementPreset}/>}
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
      <div className="card-title"><div><small className="kicker">BASELINE RESULT · 2026-09-20</small><h3>실험 1 기준 결과</h3></div><span className="analog-badge blocked">physical gate blocked</span></div>
      <p>후보 선정과 면적 측정은 완료됐지만, DRC/LVS 하드 게이트가 통과하지 않아 PEX와 Pareto 비교는 보류 상태입니다.</p>
      <div className="ppa-result-grid">
        <article><small>선정 후보</small><b>Efabless SKY130 12-bit SAR ADC</b><span>score 104 · selected</span></article>
        <article><small>면적</small><b>65,628.68 µm²</b><span>0.0656 mm² · 예산 0.5 mm² 통과</span></article>
        <article><small>KLayout DRC</small><b>0 violations</b><span>수정 전 GDS 기준 · 재검증 필요</span></article>
        <article><small>Magic DRC</small><b>103 violations</b><span className="warn-text">기준값 · CDAC 84 · 비교기 4 · 상위 15</span></article>
        <article><small>Netgen LVS</small><b>LVS match</b><span className="ok-text">pass · adapter fixed</span></article>
        <article><small>다음 단계</small><b>PEX / Pareto</b><span>DRC 0 · LVS match 이후 실행</span></article>
      </div>
    </section>
    <section className="ppa-result-card">
      <div className="card-title"><div><small className="kicker">LAYOUT FIX PLAN · CHECKPOINT</small><h3>현재 작업: CDAC 잔여 경계 DRC 6건</h3></div><span className="analog-badge blocked">6 remaining</span></div>
      <p>CACE는 GDS가 아니라 Magic 원본(.mag)을 우선 검사한다는 사실을 로그와 코드로 확인했습니다. analog-switch dependency를 공식 DRC/LVS 수정 커밋 <code>34a2361</code>로 올리고 EF_SW_RST stitching을 맞춰 CDAC Magic DRC를 84건에서 6건으로 줄였습니다.</p>
      <div className="ppa-result-grid">
        <article><small>CDAC 단독 DRC</small><b>6 violations</b><span className="warn-text">84 → 9 → 6 · 2026-09-23</span></article>
        <article><small>원인 규칙</small><b>diff/tap.18,20</b><span>MV nwell ↔ N-diff/P-tap ≥ 0.43 µm</span></article>
        <article><small>원본 정합성</small><b>검사 경로 확인 완료</b><span>CACE .mag 우선 · stale GDS 감지 누락 확인</span></article>
        <article><small>보존할 특성</small><b>매칭·공통중심</b><span>unit cap, dummy, 배선 길이와 기생성분의 좌우 균형 유지</span></article>
        <article><small>검증 순서</small><b>단위 → 배열 → 상위</b><span>Magic DRC 0 후 LVS, 그 다음 PEX/Pareto</span></article>
      </div>
      <p><b>왜 먼저 하는가:</b> CDAC의 커패시터 비율과 대칭은 12-bit 선형성(INL/DNL)에 직접 영향을 줍니다. 배치 단계에서 여유부를 예약하면 DRC 수정 때문에 나중에 커패시터 또는 guard ring을 비대칭으로 옮기는 위험과 재배선·기생 RC 증가를 줄일 수 있습니다.</p>
    </section>
    <section className="ppa-result-card">
      <div className="card-title"><div><small className="kicker">CHECKPOINT · 2026-09-23</small><h3>작업 현황 및 재개 순서</h3></div><span className="connection">paused checkpoint</span></div>
      <p>공식 dependency 수정과 EF_SW_RST 경계 보정은 검증됐습니다. 남은 6건은 CDAC 상위 조립의 대칭 U자형 tap 경계이며, CACE의 하위 .mag 날짜 처리 오류를 우회한 뒤 새 GDS·LVS를 다시 닫아야 합니다.</p>
      <div className="ppa-result-grid">
        <article><small>완료</small><b>후보·면적·LVS 확인</b><span>ADC 후보 선정 · 65,628.68 µm² · Netgen LVS match</span></article>
        <article><small>완료</small><b>switch dependency 교정</b><span><code>34a2361</code> · simple switch DRC 0</span></article>
        <article><small>완료</small><b>EF_SW_RST 경계 보정</b><span>단독 Magic DRC 3 → 0</span></article>
        <article><small>보류</small><b>PEX / Pareto</b><span>물리 하드 게이트가 열릴 때까지 측정하지 않음</span></article>
      </div>
      <div className="data-table"><table><thead><tr><th>순서</th><th>다음 할 일</th><th>완료 기준</th></tr></thead><tbody>
        <tr><td>1</td><td>잔여 6건의 CDAC 상위 tap/nwell stitching 경계를 대칭 보정</td><td>CDAC Magic DRC 6 → 0</td></tr>
        <tr><td>2</td><td>CACE 하위 .mag 날짜 처리 오류를 우회하고 GDS를 강제 재생성</td><td>현재 계층 해시와 GDS 일치</td></tr>
        <tr><td>3</td><td>새 GDS에서 KLayout DRC와 CDAC LVS 재실행</td><td>DRC 0 · LVS match</td></tr>
        <tr><td>4</td><td>비교기·상위 ADC DRC를 새 dependency 기준으로 재측정</td><td>전체 Magic/KLayout DRC 0</td></tr>
        <tr><td>5</td><td>PEX로 기생 RC 포함 성능·전력 재측정, Pareto 비교 실행</td><td>PPA 실측값으로 후보 비교</td></tr>
      </tbody></table></div>
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

function PpaExperimentTwo() {
  return <section className="card ppa-experiment ppa-experiment-two">
    <div className="card-title"><div><small className="kicker">PPA EXPERIMENT 2 · IMPLEMENTATION</small><h2>ADC Trigger Capture · 4 KB SRAM</h2></div><span className="analog-badge ok">RTL verified</span></div>
    <p>아날로그 입력을 기존 12-bit SAR ADC로 변환하고, 이벤트 전후 파형을 4 KB SRAM에 보관한 뒤 필요한 시점에 전송하는 경로입니다. <b>32-bit는 ADC 해상도가 아니라 SRAM 저장 word 폭</b>이며, 16-bit 레코드 두 개를 한 word에 저장합니다.</p>
    <div className="stats ppa-experiment-stats">
      <div className="stat-card"><small>ADC 목표</small><strong>12-bit</strong><span>1 MS/s SAR byte stream</span></div>
      <div className="stat-card"><small>저장 형식</small><strong>32-bit</strong><span>12-bit sample + 4-bit flags × 2</span></div>
      <div className="stat-card"><small>버퍼 용량</small><strong>4 KB</strong><span>1,024 × 32 · 최대 2,048 samples</span></div>
      <div className="stat-card"><small>관측 창</small><strong>2.048 ms</strong><span>1 MS/s 기준 · pre/post trigger</span></div>
    </div>

    <section className="ppa-result-card">
      <div className="card-title"><div><small className="kicker">CURRENT DATA PATH</small><h3>재사용하는 검증 경로</h3></div><span className="connection">non-invasive to experiment 1</span></div>
      <div className="capture-flow" role="img" aria-label="Analog input to SAR ADC, sample adapter, asynchronous FIFO, 4KB SRAM capture buffer, and readout interface">
        <div className="capture-stage analog"><b>Analog front end</b><span>VIN → S/H</span></div><em>→</em>
        <div className="capture-stage adc"><b>Existing SAR ADC</b><span>12-bit byte stream</span></div><em>→</em>
        <div className="capture-stage digital"><b>Sample adapter</b><span>byte → 12-bit record</span></div><em>→</em>
        <div className="capture-stage digital"><b>Async FIFO</b><span>ADC clk → system clk</span></div><em>→</em>
        <div className="capture-stage memory"><b>Capture SRAM</b><span>1,024 × 32 circular</span></div><em>→</em>
        <div className="capture-stage digital"><b>Readout</b><span>valid/ready + done</span></div>
      </div>
      <div className="ppa-result-grid">
        <article><small>재사용</small><b>sar_adc_ch</b><span>기존 SAR ADC의 low/high byte stream 사용</span></article>
        <article><small>재사용</small><b>prim_fifo_async</b><span>검증된 reset synchronizer와 CDC FIFO 사용</span></article>
        <article><small>구현</small><b>adc_byte_to_sample</b><span className="ok-text">12-bit 복원 · unit test pass</span></article>
        <article><small>구현</small><b>adc_capture_buffer</b><span className="ok-text">ring/pre-post/freeze/readout test pass</span></article>
        <article><small>구현</small><b>adc_stream_capture</b><span className="ok-text">full wrapper lint pass</span></article>
        <article><small>중요한 분리</small><b>캡처용 SRAM은 2번째 macro</b><span>기존 ADC calibration LUT의 4 KB와 별도 필요</span></article>
      </div>
    </section>

    <section className="ppa-result-card">
      <div className="card-title"><div><small className="kicker">LAYOUT EVIDENCE & FLOORPLAN INTENT</small><h3>실제 레이아웃 결과와 캡처 macro 배치 계획</h3></div><span className="analog-badge blocked">macro wrapper pending</span></div>
      <p>왼쪽은 현재 공개 ADC와 SRAM macro에서 확보한 실제 배치 이미지입니다. 오른쪽은 실험 2에서 해당 macro를 분리 배치할 계획을 표현한 floorplan으로, 물리 구현 결과가 아니므로 추정 이미지와 혼동하지 않게 표시합니다.</p>
      <div className="layout-evidence-grid">
        <figure><img src="/analog/adc_mid.png" alt="현재 사용 중인 SKY130 ADC 레이아웃 결과"/><figcaption><b>실제 ADC layout</b><br/>SAR ADC는 아날로그 섬으로 유지하고, 데이터 경계에서만 CDC를 둡니다.</figcaption></figure>
        <figure><img src="/analog/sram_mid.png" alt="현재 선택한 SRAM22 1024 by 32 macro 레이아웃 결과"/><figcaption><b>실제 SRAM22 layout</b><br/>1,024 × 32 macro의 물리 view를 재사용합니다. 캡처 buffer에는 별도 인스턴스가 필요합니다.</figcaption></figure>
        <figure className="capture-floorplan"><svg viewBox="0 0 520 260" role="img" aria-label="Experiment 2 planned floorplan with ADC island, CDC, capture SRAM and readout logic"><rect x="8" y="8" width="504" height="244" rx="12" className="floorplan-frame"/><rect x="32" y="45" width="116" height="160" rx="10" className="floorplan-adc"/><text x="90" y="112">ADC island</text><text x="90" y="139">3.3 V</text><rect x="174" y="75" width="88" height="100" rx="10" className="floorplan-digital"/><text x="218" y="116">CDC</text><text x="218" y="141">FIFO</text><rect x="292" y="36" width="144" height="178" rx="10" className="floorplan-memory"/><text x="364" y="106">Capture SRAM</text><text x="364" y="132">1024 × 32</text><text x="364" y="158">4 KB</text><rect x="454" y="75" width="36" height="100" rx="8" className="floorplan-digital"/><text x="472" y="106" transform="rotate(90 472 106)">Readout</text><path d="M148 125 H174 M262 125 H292 M436 125 H454" className="floorplan-wire"/><text x="32" y="232" className="floorplan-note">planned placement · macro location and PDN/routing to be measured</text></svg><figcaption><b>실험 2 floorplan 계획</b><br/>ADC·SRAM을 고정 macro로 먼저 놓고, 짧은 CDC 경로와 readout을 주변 digital 영역에 배치합니다.</figcaption></figure>
      </div>
    </section>

    <section className="ppa-result-card">
      <div className="card-title"><div><small className="kicker">EXECUTION STRATEGY</small><h3>한 번에 최적화하지 않는 이유와 순서</h3></div><span className="connection">constraint-first</span></div>
      <p>혼합신호 경로는 ADC 매칭·SRAM macro 배치·전원망·CDC·타이밍·라우팅이 서로 영향을 줍니다. 전부를 동시에 바꾸면 어느 변경이 PPA 또는 기능 악화의 원인인지 분리할 수 없고, 재현 가능한 기준점도 사라집니다. 그래서 불변 조건을 먼저 잠그고, 한 단계에서 하나의 위험만 줄입니다.</p>
      <div className="strategy-grid">
        <article><i>1</i><b>기능 기준점 고정</b><span>byte 조립, FIFO CDC, circular capture, backpressure를 RTL test/lint로 먼저 고정합니다.</span><small>현재: 완료</small></article>
        <article><i>2</i><b>macro/전원 영역 예약</b><span>ADC와 4 KB SRAM의 위치, 전압 domain, keep-out 및 배선 입출구를 먼저 정합니다.</span><small>다음: floorplan</small></article>
        <article><i>3</i><b>물리 경로 단위 검증</b><span>PDN → placement → CTS → detailed routing → DRC/LVS를 block별로 닫습니다.</span><small>그 다음: physical closure</small></article>
        <article><i>4</i><b>추출 후 PPA 비교</b><span>PEX/STA/전력에서 실제 RC와 switching activity를 반영해 trade-off를 수치화합니다.</span><small>마지막: Pareto</small></article>
      </div>
      <div className="data-table"><table><thead><tr><th>미리 결정할 것</th><th>지금 확정하면 피하는 재작업</th><th>결정 기준</th></tr></thead><tbody>
        <tr><td>SRAM macro 수·방향·pin side</td><td>후반 macro 이동, bus 재배선, congestion 재발</td><td>2번째 1,024 × 32 capture macro · readout 쪽 pin 접근성</td></tr>
        <tr><td>ADC/SRAM 전원 domain과 guard/keep-out</td><td>디지털 PDN 수정이 ADC noise/매칭을 깨는 일</td><td>ADC 3.3 V island 분리 · macro PG 연결 계획</td></tr>
        <tr><td>CDC 위치와 sample rate/clock budget</td><td>CTS 뒤 FIFO 이동, hold violation 재수정</td><td>ADC domain → FIFO → system domain 단일 경계</td></tr>
        <tr><td>trigger window·flags·readout ABI</td><td>SRAM word format과 firmware protocol의 동시 재설계</td><td>16-bit record × 2 · pre/post trigger · valid/ready</td></tr>
        <tr><td>block별 DRC/LVS gate</td><td>상위에서 원인 불명 수백 건을 되짚는 일</td><td>각 block DRC 0 · LVS match 후 상위 통합</td></tr>
      </tbody></table></div>
    </section>

    <section className="ppa-result-card">
      <div className="card-title"><div><small className="kicker">TOOL & VERIFICATION MATRIX</small><h3>단계별 실행 도구와 합격 조건</h3></div><span className="connection">measured, not assumed</span></div>
      <div className="data-table"><table><thead><tr><th>단계</th><th>사용 도구</th><th>무엇을 검증하는가</th><th>통과 기준 / 현재 상태</th></tr></thead><tbody>
        <tr><td>RTL 기능</td><td>Verilator · iverilog testbench</td><td>12-bit byte 복원, ring order, trigger pre/post, freeze, valid/ready</td><td><span className="ok-text">unit test pass</span> · capture buffer / byte adapter</td></tr>
        <tr><td>정적 RTL</td><td>Verilator lint</td><td>폭·latch·미연결·합성 가능 구조, wrapper 포함</td><td><span className="ok-text">lint pass</span> · stream capture wrapper</td></tr>
        <tr><td>합성 / STA</td><td>Yosys · OpenSTA</td><td>cell mapping, setup/hold, clock 정의와 timing budget</td><td>clock/IO 제약 확정 후 WNS ≥ 0, TNS = 0</td></tr>
        <tr><td>배치 · CTS · routing</td><td>OpenLane 2 · OpenROAD</td><td>floorplan, PDN, macro placement, placement, clock tree, global/detail route</td><td>macro 고정 후 congestion·antenna·DRC clean</td></tr>
        <tr><td>layout DRC</td><td>KLayout · Magic</td><td>제조 규칙, spacing/enclosure, antenna 및 physical geometry</td><td>각 block와 top 모두 <b>0 violations</b></td></tr>
        <tr><td>LVS</td><td>Netgen · Magic extraction</td><td>layout netlist가 schematic/RTL-derived netlist와 동일한지</td><td><b>LVS match</b> · pin/PG 포함</td></tr>
        <tr><td>기생 추출 / PPA</td><td>OpenRCX / SPEF · OpenSTA · OpenROAD reports</td><td>배선 RC를 포함한 timing, area, power proxy와 routing quality</td><td>PEX/STA 이후 PPA 수치 기록 · Pareto 비교</td></tr>
        <tr><td>아날로그 signoff</td><td>Xschem · ngspice / Xyce</td><td>ADC noise·settling·INL/DNL 및 전원/온도 corner</td><td>12-bit·1 MS/s 목표를 corner별로 측정</td></tr>
      </tbody></table></div>
      <p><b>현재 물리 PPA는 아직 not measured입니다.</b> 실험 1이 사용 중인 OpenLane/OpenROAD 자원을 건드리지 않고, 위 RTL 기준점과 macro wrapper를 먼저 완성한 뒤 별도 run으로 측정합니다.</p>
    </section>
  </section>
}

function PpaExperimentThree({ onApply }: { onApply: () => void }) {
  return <section className="card ppa-experiment">
    <div className="card-title"><div><small className="kicker">PPA EXPERIMENT 3 · IMPLEMENTED</small><h2>ADC·CDAC·SRAM 재사용 배치 기준</h2></div><span className="analog-badge ok">RTL + config ready</span></div>
    <p>PPA1의 실제 ADC 크기와 PPA2의 macro 분리 원칙을 재사용한 초기 placement 설정입니다. CDAC GDS 정합이 끝나기 전에는 자동 배치·라우팅을 실행하지 않고, 영역·여유부·핀 접근성만 고정합니다.</p>
    <div className="stats ppa-experiment-stats">
      <div className="stat-card"><small>ADC island</small><strong>0.0656 mm²</strong><span>PPA1 실측 · 223.71 × 293.37 µm</span></div>
      <div className="stat-card"><small>CDAC 수리 여유</small><strong>0.0344 mm²</strong><span>총 아날로그 영역 ≤ 0.10 mm²</span></div>
      <div className="stat-card"><small>SRAM 배치</small><strong>1024 × 32</strong><span>PPA2 capture macro · ADC 밖 digital 영역</span></div>
      <div className="stat-card"><small>고정 목표</small><strong>1 MS/s · 15 mW</strong><span>3.3 V · TT/25 °C · 2:1:2</span></div>
    </div>
    <section className="ppa-result-card">
      <div className="card-title"><div><small className="kicker">PLACEMENT CONSTRAINTS</small><h3>초기 floorplan 설정</h3></div><span className="connection">reuse PPA1 + PPA2</span></div>
      <div className="ppa-result-grid">
        <article><small>좌측</small><b>ADC / CDAC island</b><span>3.3 V 아날로그 영역 · CDAC 중심 대칭 보존</span></article>
        <article><small>경계</small><b>guard ring keep-out</b><span>CDAC 외곽 양쪽 동일 여유부 · digital PDN 차단</span></article>
        <article><small>중앙</small><b>CDC / sample adapter</b><span>ADC data pin 근처 · ADC clock ↔ system clock 단일 경계</span></article>
        <article><small>우측</small><b>4 KB capture SRAM</b><span>PPA2 1024 × 32 macro · readout pin이 외곽을 향하도록 배치</span></article>
      </div>
    </section>
    <section className="ppa-result-card">
      <div className="card-title"><div><small className="kicker">PPA3 CHECKPOINT · ACTIVE</small><h3>현재 작업과 실행 게이트</h3></div><span className="analog-badge blocked">gate 1 / 5</span></div>
      <p>PPA3의 floorplan 기준은 준비됐지만 자동 placement·routing은 아직 시작하지 않습니다. CDAC Magic DRC 잔여 6건과 새 GDS의 DRC/LVS가 닫혀야 배치 결과와 PPA 측정이 의미를 갖습니다.</p>
      <div className="ppa-result-grid">
        <article><small>구현 완료</small><b>RTL + OpenLane config</b><span className="ok-text">통합 top lint pass · 1250 × 600 µm · ADC/SRAM 고정 배치</span></article>
        <article><small>현재 게이트</small><b>CDAC physical closure</b><span className="warn-text">Magic DRC 6 · 새 GDS DRC/LVS 재검증 필요</span></article>
        <article><small>배치 실행 조건</small><b>CDAC DRC/LVS 통과</b><span>대칭축·dummy·guard ring·핀 접근성 보존</span></article>
        <article><small>최종 산출물</small><b>PEX 기반 PPA3</b><span>기생 RC 포함 성능·전력·면적과 Pareto 비교</span></article>
      </div>
    </section>
    <div className="data-table"><table><thead><tr><th>항목</th><th>PPA3 고정 설정</th><th>근거</th></tr></thead><tbody>
      <tr><td>성능 / PVT</td><td>12-bit · 1 MS/s · 3.3 V · TT/25 °C</td><td>PPA1 기준점 유지</td></tr>
      <tr><td>전력 / 면적</td><td>≤ 15 mW · ≤ 100,000 µm²</td><td>ADC 실측 65,628.68 µm² + CDAC 수리 여유</td></tr>
      <tr><td>아날로그 macro</td><td>좌측 고정 · CDAC 대칭축과 dummy/guard ring 보존</td><td>배치 변경으로 INL/DNL·기생 RC를 악화시키지 않음</td></tr>
      <tr><td>디지털 / SRAM</td><td>우측 분리 · CDC는 두 영역 사이</td><td>PPA2 capture path와 SRAM pin 접근성 재사용</td></tr>
      <tr><td>실행 게이트</td><td>GDS 정합 → CDAC DRC/LVS → top DRC/LVS → PEX</td><td>물리 통과 전 PPA 측정 금지</td></tr>
    </tbody></table></div>
    <button className="ppa-preset-button" type="button" onClick={onApply}>이 PPA 실험 3 설정을 현재 설계에 적용</button>
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
