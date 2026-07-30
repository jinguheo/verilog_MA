import { useEffect, useMemo, useState } from 'react'
import Sidebar from './components/Sidebar'
import StatCard from './components/StatCard'
import Toolchain from './components/Toolchain'
import KnowledgeDB from './views/KnowledgeDB'
import { fetchKnowledgeOverview } from './services/knowledgeDb'
import type { Overview } from './types'

const fallback: Overview = {generated_at:'', workspace:{path:'D:\\MyWork\\verilog',exists:false}, summary:{sources:0,available:0,files:0,agents_ready:0,agents_total:0},sources:[],agents:[]}

export default function App(){
  const [data,setData]=useState<Overview>(fallback)
  const [selected,setSelected]=useState('overview')
  const [error,setError]=useState('')
  const load=()=>fetchKnowledgeOverview().then(x=>{setData(x);setError('')}).catch(()=>setError('Knowledge API가 실행되지 않았습니다. python ..\\dashboard_server.py를 먼저 실행하세요.'))
  useEffect(()=>{load()},[])
  const source=data.sources.find(x=>x.id===selected)
  const tabs=useMemo(()=>[{id:'overview',label:'전체 개요',count:data.sources.length},...data.sources.map(x=>({id:x.id,label:x.short_name,count:x.status==='available'?1:0}))],[data.sources])
  return <div className="app">
    <Sidebar tabs={tabs} current={selected} onSelect={setSelected}/>
    <main>
      <header><div><small className="kicker">MULTI-AGENT CONTROL PLANE</small><h1>Knowledge DB Overview</h1><p>RTL 지식 DB와 MA 실행 컨텍스트를 한 곳에서 확인합니다.</p></div><button className="refresh" onClick={load}>↻ 새로고침</button></header>
      <section className="stats"><StatCard label="데이터 소스" value={data.summary.sources} detail="등록된 지식 DB"/><StatCard label="연결 가능" value={data.summary.available} detail="현재 발견된 저장소"/><StatCard label="전체 파일" value={data.summary.files} detail="스캔 대상 파일"/><StatCard label="Agent 준비도" value={`${data.summary.agents_ready}/${data.summary.agents_total}`} detail="ready / total"/></section>
      {error&&<div className="notice">{error}</div>}
      <section className="card"><div className="card-title"><div><small className="kicker">DATA SOURCE</small><h2>{selected==='overview'?'Knowledge sources':source?.name}</h2></div><span className="connection">{selected==='overview'?`${data.summary.available}/${data.summary.sources} 연결됨`:source?.connection||source?.status}</span></div>
        {selected==='overview'?<div className="data-table"><table><thead><tr><th>소스</th><th>종류</th><th>상태</th><th>운영 형태</th><th>경로</th><th>주요 데이터</th></tr></thead><tbody>{data.sources.map(x=><tr key={x.id} onClick={()=>setSelected(x.id)}><td><b>{x.name}</b></td><td>{x.kind}</td><td><span className={`status ${x.status}`}>{x.status==='available'?'파일 확인됨':'확인 필요'}</span></td><td>{x.connection||'unknown'}</td><td className="truncate">{x.path}</td><td>{x.description}</td></tr>)}</tbody></table></div>:<KnowledgeDB source={source}/>} 
      </section>
      <Toolchain toolchain={data.toolchain}/>
      <section className="lower"><div className="card"><div className="card-title"><div><small className="kicker">AGENT READINESS</small><h2>Agent 연결 상태</h2></div></div>{data.agents.map(a=><div className="agent" key={a.name}><i className={a.status}/><div><b>{a.label}</b><small>{a.name}</small></div><span className={a.status}>{a.status}</span></div>)}</div><div className="card"><div className="card-title"><div><small className="kicker">TRACEABILITY</small><h2>지식 연결 정책</h2></div></div><div className="trace"><p><b>Code KG</b><span>모듈·포트·인스턴스 구조 사실</span></p><p><b>Graphify</b><span>아키텍처·커뮤니티 문맥</span></p><p><b>OpenKB / Spec</b><span>문서·요구사항·근거</span></p></div></div></section>
      <footer>읽기 전용 · {data.workspace.path}</footer>
    </main>
  </div>
}
