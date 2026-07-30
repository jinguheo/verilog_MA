import type { Source } from '../types'

function statusText(s: string){return s==='available'?'연결됨':s==='missing'?'없음':'외부 환경 필요'}
export default function KnowledgeDB({source}:{source?:Source}){
 if(!source) return <div className="data-table"><table><thead><tr><th>데이터 소스</th><th>종류</th><th>상태</th><th>경로</th><th>설명</th></tr></thead><tbody><tr><td colSpan={5}>왼쪽 탭에서 지식 DB를 선택하세요.</td></tr></tbody></table></div>
 return <><div className="source-heading"><div className={`source-icon ${source.color||''}`}>{source.icon}</div><div><h2>{source.name}</h2><p>{source.description}</p></div><span className={`status ${source.status}`}>{statusText(source.status)}</span></div><div className="metric-grid">{Object.entries(source.metrics).map(([key,value])=><div className="metric" key={key}><strong>{value}</strong><span>{key}</span></div>)}</div><div className="path-box"><b>연결 경로</b><code>{source.path}</code></div><h3 className="subheading">최근 샘플</h3>{source.samples.length?<div className="sample-list">{source.samples.map((sample,i)=><div key={`${sample.name}-${i}`}><b>{sample.name||sample.label||'record'}</b><span>{sample.detail||sample.path||''}</span></div>)}</div>:<div className="empty">표시할 샘플이 없습니다.</div>}</>
}
