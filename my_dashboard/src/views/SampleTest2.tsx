import { useState } from 'react'
import SampleTest2TabDetail, { type SampleTest2Tab } from './SampleTest2TabDetail'

const tabs: Array<{ id: SampleTest2Tab; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'design', label: 'Design' },
  { id: 'verification', label: 'Verification' },
  { id: 'uvm', label: 'UVM Plan' },
  { id: 'implementation', label: 'Implementation' },
  { id: 'documents', label: 'Documents' },
]

export default function SampleTest2() {
  const [tab, setTab] = useState<SampleTest2Tab>('overview')

  return <>
    <section className="task-hero">
      <small className="kicker">HIERARCHICAL PIPELINE SAMPLE</small>
      <h2>샘플 테스트 2 · OpenTitan prim_fifo_sync</h2>
      <p>Width=8 · Depth=4 · top/submodule/package 계층을 포함한 FIFO 검증 샘플입니다.</p>
      <b>Top: prim_fifo_sync · Submodule: prim_fifo_sync_cnt · Package: prim_util_pkg</b>
    </section>
    <section className="sample-summary">
      <span><b>3</b> design units</span>
      <span><b>5</b> UVM requirements — PASS</span>
      <span><b>5</b> formal properties — PASS</span>
      <span><b>4/4</b> reachable coverage bins</span>
    </section>
    <div className="sample-tabs" role="tablist">
      {tabs.map(item => <button key={item.id} role="tab" aria-selected={tab === item.id} className={tab === item.id ? 'active' : ''} onClick={() => setTab(item.id)}>{item.label}</button>)}
    </div>
    <section className="sample-tab-panel"><SampleTest2TabDetail tab={tab}/></section>
  </>
}
