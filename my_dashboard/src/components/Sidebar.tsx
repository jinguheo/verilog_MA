interface Props { tabs: Array<{id:string; label:string; count?:number}>; current:string; onSelect:(id:string)=>void }

const icons: Record<string, string> = { pipeline: '◈', requirements: 'R', architecture: 'A', rtl: '⌘', verification: '✓', formal: 'F', manufacturing: 'P', review: '↗', sample: '1', analog: 'A', knowledge: 'K' }

export default function Sidebar({tabs,current,onSelect}: Props) {
  return <aside className="sidebar">
    <div className="brand"><div className="brand-mark">V</div><div><b>Veriolg MA</b><small>RTL Control Plane</small></div></div>
    <div className="workspace-card"><span className="pulse"/><div><small>WORKSPACE</small><b>verilog knowledge</b></div><em>LIVE</em></div>
    <nav>{tabs.map(tab => <div className="nav-entry" key={tab.id}>{tab.id === 'sample' && <small className="nav-label">EXECUTED RUNS</small>}{tab.id === 'knowledge' && <small className="nav-label">KNOWLEDGE LAYER</small>}<button className={current===tab.id?'active':''} onClick={()=>onSelect(tab.id)}><i>{icons[tab.id]}</i><span>{tab.label}</span>{tab.count!==undefined&&<em>{tab.count}</em>}</button></div>)}</nav>
    <div className="sidebar-footer"><span className="pulse"/> Pipeline monitor online</div>
  </aside>
}
