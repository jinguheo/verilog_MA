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
import SampleTest3 from './views/SampleTest3'
import SampleTest4 from './views/SampleTest4'
import ToolComparison from './views/ToolComparison'
import TaskWorkspace, { type TaskId } from './views/TaskWorkspace'
import { fetchKnowledgeOverview } from './services/knowledgeDb'
import type { Overview } from './types'

const fallback: Overview = { generated_at: '', workspace: { path: 'D:\\MyWork\\Veriolg_MA', exists: false }, summary: { sources: 0, available: 0, files: 0, agents_ready: 0, agents_total: 0 }, sources: [], agents: [] }

export default function App() {
  const [data, setData] = useState<Overview>(fallback)
  const [page, setPage] = useState('pipeline')
  const [selectedSource, setSelectedSource] = useState('overview')
  const [error, setError] = useState('')
  const load = () => fetchKnowledgeOverview().then(result => { setData(result); setError('') }).catch(() => setError('Knowledge API is unavailable. Check the server status.'))
  useEffect(() => { load() }, [])
  const source = data.sources.find(item => item.id === selectedSource)
  const tabs = useMemo(() => [
    { id: 'pipeline', label: 'General RTL Pipeline' }, { id: 'sample', label: 'Sample Test 1' },
    { id: 'sample2', label: 'Sample Test 2' }, { id: 'sample3', label: 'Sample Test 3' }, { id: 'sample4', label: 'Sample Test 4' },
    { id: 'knowledge', label: 'Knowledge DB', count: data.sources.length }, { id: 'tools', label: 'Tool Comparison' },
  ], [data.sources.length])
  const title = page === 'pipeline' ? 'RTL Development Pipeline' : page === 'tools' ? 'EDA Tool Comparison' : page === 'knowledge' ? 'Knowledge DB Overview' : page === 'sample' ? 'Sample Test 1' : page === 'sample2' ? 'Sample Test 2' : page === 'sample3' ? 'Sample Test 3 — Data Acquisition Subsystem' : page === 'sample4' ? 'Sample Test 4 — Multi-channel DAQ/DMA' : 'Task Workspace'
  const knowledge = <section className="card"><div className="card-title"><div><small className="kicker">DATA SOURCE</small><h2>{selectedSource === 'overview' ? 'Knowledge sources' : source?.name}</h2></div><span className="connection">{data.summary.available}/{data.summary.sources} available</span></div>{selectedSource === 'overview' ? <div className="data-table"><table><thead><tr><th>Source</th><th>Type</th><th>Status</th><th>Path</th><th>Description</th></tr></thead><tbody>{data.sources.map(item => <tr key={item.id} onClick={() => setSelectedSource(item.id)}><td><b>{item.name}</b></td><td>{item.kind}</td><td>{item.status}</td><td className="truncate">{item.path}</td><td>{item.description}</td></tr>)}</tbody></table></div> : <KnowledgeDB source={source}/>}</section>
  const pipeline = <><section className="stats"><StatCard label="Pipeline gates" value={`${data.design_flow?.passed ?? 0}/${data.design_flow?.total ?? 0}`} detail="passed / total"/><StatCard label="Active tasks" value={data.agents.length} detail="agent-based tasks"/><StatCard label="Knowledge sources" value={`${data.summary.available}/${data.summary.sources}`} detail="available / registered"/><StatCard label="Verification tools" value={data.toolchain ? `${data.toolchain.available}/${data.toolchain.total}` : '-'} detail="available / total"/></section><PipelineOverview data={data}/><Toolchain toolchain={data.toolchain}/></>
  const content = page === 'pipeline' ? pipeline : page === 'tools' ? <ToolComparison/> : page === 'knowledge' ? knowledge : page === 'sample' ? <SampleTest/> : page === 'sample2' ? <SampleTest2/> : page === 'sample3' ? <SampleTest3/> : page === 'sample4' ? <SampleTest4/> : <TaskWorkspace taskId={page as TaskId} data={data}/>
  return <div className="app"><Sidebar tabs={tabs} current={page} onSelect={setPage}/><main><header><div><small className="kicker">MULTI-AGENT CONTROL PLANE</small><h1>{title}</h1><p>Design, verification and implementation evidence in one workspace.</p></div><button className="refresh" onClick={load}>Refresh</button></header>{error && <div className="notice">{error}</div>}{content}<footer>Local workspace · {data.workspace.path}</footer></main></div>
}
