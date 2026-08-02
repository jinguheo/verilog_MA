import { useState } from 'react'
import type { Overview } from '../types'
import GeneralRtlPipeline from './GeneralRtlPipeline'

const stageForAgent = (name: string) => {
  if (name.includes('requirements')) return '요구 사항'
  if (name.includes('architecture')) return '설계 / 스펙'
  if (name.includes('rtl')) return 'RTL 설계'
  if (name.includes('verification') || name.includes('uvm')) return '검증'
  if (name.includes('formal')) return 'Formal / Security'
  if (name.includes('manufacturing')) return '물리 설계'
  if (name.includes('review') || name.includes('triage')) return '리뷰 / 이슈'
  return 'Knowledge DB'
}

const stageOrder = ['요구 사항', '설계 / 스펙', 'RTL 설계', '검증', 'Formal / Security', '물리 설계', '리뷰 / 이슈', 'Knowledge DB']
const statusText = (status: string) => status === 'implemented' ? '준비 완료' : status === 'external-required' ? '외부 환경 필요' : '진행 준비'

export default function PipelineOverview({ data }: { data: Overview }) {
  const [page, setPage] = useState<'overview' | 'tasks'>('overview')
  return <><div className="pipeline-pages" data-page={page} role="tablist"><button role="tab" aria-selected={page === 'overview'} className={page === 'overview' ? 'active' : ''} onClick={() => setPage('overview')}>Overview</button><button role="tab" aria-selected={page === 'tasks'} className={page === 'tasks' ? 'active' : ''} onClick={() => setPage('tasks')}>단계별 Task</button></div>{page === 'overview' ? <PipelineOverviewBase data={data}/> : <GeneralRtlPipeline data={data}/>}</>
}

function PipelineOverviewBase({ data }: { data: Overview }) {
  const checks = data.design_flow?.checks ?? []
  const groups = stageOrder.map(stage => ({ stage, agents: data.agents.filter(agent => stageForAgent(agent.name) === stage) })).filter(group => group.agents.length)
  return <>
    <section className="pipeline-card"><div className="card-title"><div><small className="kicker">END-TO-END RTL FLOW</small><h2>전체 개발 파이프라인</h2></div><span className="connection">{data.design_flow?.passed ?? 0}/{data.design_flow?.total ?? 0} 게이트 통과</span></div><div className="pipeline-flow">{checks.map((check, index) => <div className={`pipeline-step ${check.status}`} key={check.gate}><span>{String(index + 1).padStart(2, '0')}</span><b>{check.gate}</b><small>{check.label}</small><em>{check.status === 'pass' ? 'PASS' : 'BLOCKED'}</em></div>)}</div>{data.design_flow?.note && <p className="pipeline-note">{data.design_flow.note}</p>}</section>
    <section className="pipeline-section"><div className="section-heading"><small className="kicker">TASK OWNERSHIP</small><h2>단계별 Task 현황</h2><p>각 단계의 에이전트 상태와 담당 범위를 확인합니다.</p></div><div className="stage-grid">{groups.map(group => <article className="stage-card" key={group.stage}><h3>{group.stage}</h3>{group.agents.map(agent => <div className="agent" key={agent.name}><i className={agent.status}/><div><b>{agent.label}</b><small>{agent.name}</small></div><span className={agent.status}>{statusText(agent.status)}</span></div>)}</article>)}</div></section>
    <section className="card pipeline-kb"><div><small className="kicker">KNOWLEDGE FOUNDATION</small><h2>Knowledge DB</h2><p>Graphify, Vector/Embedding, Code KG, Spec, RTL Source DB를 연결해 모든 task에 컨텍스트를 제공합니다.</p></div><div className="kb-summary"><b>{data.summary.available}/{data.summary.sources}</b><span>연결된 지식 소스</span></div></section>
  </>
}
