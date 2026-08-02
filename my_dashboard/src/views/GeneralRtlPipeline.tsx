import { useState } from 'react'
import TaskWorkspace, { type TaskId } from './TaskWorkspace'
import type { Overview } from '../types'

const tabs: Array<{ id: TaskId; label: string }> = [
  { id: 'requirements', label: 'Requirements' }, { id: 'architecture', label: 'Architecture' }, { id: 'rtl', label: 'RTL Design' }, { id: 'verification', label: 'Verification' }, { id: 'formal', label: 'Formal / Security' }, { id: 'manufacturing', label: 'Physical Design' }, { id: 'review', label: 'Review / Triage' },
]

export default function GeneralRtlPipeline({ data }: { data: Overview }) {
  const [active, setActive] = useState<TaskId>('requirements')
  return <section className="general-pipeline"><div className="section-heading"><small className="kicker">GENERAL RTL PIPELINE</small><h2>단계별 Task Workspace</h2><p>왼쪽 메뉴 대신 내부 탭에서 개발 단계별 작업, 산출물, 도구를 확인합니다.</p></div><div className="general-tabs" role="tablist">{tabs.map(tab => <button key={tab.id} role="tab" aria-selected={active === tab.id} className={active === tab.id ? 'active' : ''} onClick={() => setActive(tab.id)}>{tab.label}</button>)}</div><TaskWorkspace taskId={active} data={data}/></section>
}
