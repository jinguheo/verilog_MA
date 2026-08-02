import { useState } from 'react'
import SampleTabDetail, { type SampleTab } from './SampleTabDetail'

const tabs: Array<{id:SampleTab; label:string}> = [{id:'overview',label:'Overview'},{id:'design',label:'Design'},{id:'verification',label:'Verification'},{id:'uvm',label:'UVM Plan'},{id:'implementation',label:'Implementation'},{id:'documents',label:'Documents'}]

export default function SampleTest(){
 const [tab,setTab]=useState<SampleTab>('overview')
 return <><section className="task-hero"><small className="kicker">EXECUTED PIPELINE SAMPLE</small><h2>샘플 테스트 1 · OpenTitan prim_filter</h2><p>KG DB source · 2KB · Cycles=4 · AsyncOn=0</p><b>RTL·기능·formal·합성은 통과. 유일한 blocker는 물리 signoff 환경입니다.</b></section><section className="sample-summary"><span><b>5</b> PASS gates</span><span><b>1</b> environment blocker</span><span><b>4</b> simulation scenarios</span><span><b>6</b> synthesized cells</span></section><div className="sample-tabs" role="tablist">{tabs.map(item=><button key={item.id} role="tab" aria-selected={tab===item.id} className={tab===item.id?'active':''} onClick={()=>setTab(item.id)}>{item.label}</button>)}</div><section className="sample-tab-panel"><SampleTabDetail tab={tab}/></section></>
}
