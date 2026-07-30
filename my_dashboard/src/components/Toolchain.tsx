import type { Overview } from '../types'

export default function Toolchain({toolchain}:{toolchain: Overview['toolchain']}){
  if(!toolchain)return null
  return <section className="card toolchain"><div className="card-title"><div><small className="kicker">VERIFICATION ENVIRONMENT</small><h2>Simulator / EDA Toolchain</h2></div><span className={`connection ${toolchain.simulator_ready?'':'warning'}`}>{toolchain.available}/{toolchain.total} 감지됨</span></div><div className="tool-grid">{Object.entries(toolchain.tools).map(([name,tool])=><div className="tool" key={name}><i className={tool.available?'online':'offline'}/><div><b>{name}</b><small>{tool.available?tool.path:tool.purpose}</small></div><span>{tool.available?'ready':'필요'}</span></div>)}</div>{!toolchain.simulator_ready&&<div className="notice">Verilator 또는 Icarus가 설치되지 않아 RTL 시뮬레이션을 실행할 수 없습니다.</div>}</section>
}
