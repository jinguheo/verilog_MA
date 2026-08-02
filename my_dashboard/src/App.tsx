import { useEffect, useMemo, useState } from 'react'
import './pipeline.css'
import './task.css'
import './sample-test.css'
import './sample-diagnosis.css'
import './sample-detail.css'
import './sample-tabs.css'
import './tool-comparison.css'
import './rtl-guide.css'
import './software-guide.css'
import './toolchain.css'
import Sidebar from './components/Sidebar'
import StatCard from './components/StatCard'
import Toolchain from './components/Toolchain'
import KnowledgeDB from './views/KnowledgeDB'
import PipelineOverview from './views/PipelineOverview'
import SampleTest from './views/SampleTest'
import SampleTest2 from './views/SampleTest2'
import ToolComparison from './views/ToolComparison'
import TaskWorkspace, { type TaskId } from './views/TaskWorkspace'
import { fetchKnowledgeOverview } from './services/knowledgeDb'
import type { Overview } from './types'

const fallback: Overview = { generated_at: '', workspace: { path: 'D:\\MyWork\\verilog', exists: false }, summary: { sources: 0, available: 0, files: 0, agents_ready: 0, agents_total: 0 }, sources: [], agents: [] }

export default function App() {
  const [data, setData] = useState<Overview>(fallback)
  const [page, setPage] = useState('pipeline')
  const [selectedSource, setSelectedSource] = useState('overview')
  const [error, setError] = useState('')
  const load = () => fetchKnowledgeOverview().then(result => { setData(result); setError('') }).catch(() => setError('Knowledge API에 연결할 수 없습니다. 서버 상태를 확인해 주세요.'))
  useEffect(() => { load() }, [])
  const source = data.sources.find(item => item.id === selectedSource)
  const tabs = useMemo(() => [{ id: 'pipeline', label: 'General RTL Pipeline' }, { id: 'sample', label: '샘플 테스트 1' }, { id: 'sample2', label: '샘플 테스트 2' }, { id: 'knowledge', label: 'Knowledge DB', count: data.sources.length }, { id: 'tools', label: 'Tool Comparison' }], [data.sources.length])
  const title = page === 'pipeline' ? 'RTL Development Pipeline' : page === 'tools' ? 'EDA Tool Comparison' : page === 'knowledge' ? 'Knowledge DB Overview' : page === 'sample' ? 'Sample Test 1' : page === 'sample2' ? 'Sample Test 2' : 'Task Workspace'
  const subtitle = page === 'pipeline' ? '요구 사항부터 설계, 검증, signoff까지 task별 진행 상태를 한 화면에서 확인합니다.' : page === 'knowledge' ? '파이프라인 전 단계에서 사용하는 지식 소스와 연결 상태를 확인합니다.' : '단계별 해야 할 일, 산출물, 사용 소프트웨어를 확인합니다.'
  const knowledge = <><section className="stats"><StatCard label="데이터 소스" value={data.summary.sources} detail="등록된 지식 DB"/><StatCard label="연결 가능" value={data.summary.available} detail="현재 발견된 리소스"/><StatCard label="전체 파일" value={data.summary.files} detail="스캔 대상 파일"/><StatCard label="Agent 준비도" value={`${data.summary.agents_ready}/${data.summary.agents_total}`} detail="ready / total"/></section><section className="card"><div className="card-title"><div><small className="kicker">DATA SOURCE</small><h2>{selectedSource === 'overview' ? 'Knowledge sources' : source?.name}</h2></div><span className="connection">{selectedSource === 'overview' ? `${data.summary.available}/${data.summary.sources} 연결` : source?.connection || source?.status}</span></div>{selectedSource === 'overview' ? <div className="data-table"><table><thead><tr><th>소스</th><th>종류</th><th>상태</th><th>연결</th><th>경로</th><th>주요 데이터</th></tr></thead><tbody>{data.sources.map(item => <tr key={item.id} onClick={() => setSelectedSource(item.id)}><td><b>{item.name}</b></td><td>{item.kind}</td><td><span className={`status ${item.status}`}>{item.status === 'available' ? '연결됨' : '확인 필요'}</span></td><td>{item.connection || 'unknown'}</td><td className="truncate">{item.path}</td><td>{item.description}</td></tr>)}</tbody></table></div> : <KnowledgeDB source={source}/>}</section></>
  return <div className="app"><Sidebar tabs={tabs} current={page} onSelect={setPage}/><main><header><div><small className="kicker">MULTI-AGENT CONTROL PLANE</small><h1>{title}</h1><p>{subtitle}</p></div><button className="refresh" onClick={load}>새로고침</button></header>{error && <div className="notice">{error}</div>}{page === 'pipeline' ? <><section className="stats"><StatCard label="파이프라인 게이트" value={`${data.design_flow?.passed ?? 0}/${data.design_flow?.total ?? 0}`} detail="통과 / 전체"/><StatCard label="활성 Task" value={data.agents.length} detail="에이전트 기반 task"/><StatCard label="Knowledge Source" value={`${data.summary.available}/${data.summary.sources}`} detail="연결된 지식 소스"/><StatCard label="검증 환경" value={data.toolchain ? `${data.toolchain.available}/${data.toolchain.total}` : '-'} detail="사용 가능한 EDA 도구"/></section><PipelineOverview data={data}/><Toolchain toolchain={data.toolchain}/></> : page === 'tools' ? <ToolComparison/> : page === 'knowledge' ? knowledge : page === 'sample' ? <SampleTest/> : page === 'sample2' ? <SampleTest2/> : <TaskWorkspace taskId={page as TaskId} data={data}/>}<footer>읽기 전용 · {data.workspace.path}</footer></main></div>
}
