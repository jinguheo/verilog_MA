import type { PageMeta, PageSection } from '../pages'
import { SECTION_LABEL } from '../pages'

type Tab = Pick<PageMeta, 'id' | 'label' | 'icon' | 'section'> & { count?: number }
interface Props { tabs: Tab[]; current: string; onSelect: (id: string) => void }

export default function Sidebar({ tabs, current, onSelect }: Props) {
  // 같은 section의 첫 항목 앞에만 구분 라벨을 한 번 보여 준다.
  const firstOfSection = new Set<PageSection>()
  return <aside className="sidebar">
    <div className="brand"><div className="brand-mark">V</div><div><b>Veriolg MA</b><small>RTL Control Plane</small></div></div>
    <div className="workspace-card"><span className="pulse"/><div><small>WORKSPACE</small><b>verilog knowledge</b></div><em>LIVE</em></div>
    <nav>{tabs.map(tab => {
      const showLabel = tab.section !== 'overview' && !firstOfSection.has(tab.section)
      firstOfSection.add(tab.section)
      return <div className="nav-entry" key={tab.id}>
        {showLabel && <small className="nav-label">{SECTION_LABEL[tab.section]}</small>}
        <button className={current === tab.id ? 'active' : ''} onClick={() => onSelect(tab.id)}><i>{tab.icon}</i><span>{tab.label}</span>{tab.count !== undefined && <em>{tab.count}</em>}</button>
      </div>
    })}</nav>
    <div className="sidebar-footer"><span className="pulse"/> Pipeline monitor online</div>
  </aside>
}
