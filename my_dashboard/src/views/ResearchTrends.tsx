// 연구 동향 탭 — placement·routing 최신 연구 정리(2026-10-17 조사). 우리가 재현하거나 측정한 값이 아니다.
// 확인 수준: A = 논문 원문 본문을 직접 읽음(EXPlace), B = 초록·요약 페이지만 읽음, C = 검색 결과 요약만 확인, D = 벤더·저자 자체 주장.
import ExplaceDeepDive from './ExplaceDeepDive'

const Lv = ({ v }: { v: 'A' | 'B' | 'C' | 'D' }) => {
  const m = { A: ['원문', '#1D9E75'], B: ['초록', '#378ADD'], C: ['검색 요약', '#BA7517'], D: ['자체 주장', '#A32D2D'] }[v]
  return <span style={{ fontSize: 11, padding: '1px 7px', borderRadius: 10, border: `1px solid ${m[1]}`, color: m[1], whiteSpace: 'nowrap' }}>{m[0]}</span>
}

const TAKEAWAYS: string[] = [
  '목적 함수가 proxy(macro HPWL)에서 배선 후 타이밍(TNS·WNS)과 DRC로 옮겨 가고 있다. EXPlace, PlaceReasoner-Beta, ISPD 대회 모두 평가를 post-route PPA로 한다.',
  '전문가 지식을 학습에 넣는 방식이 늘었다. EXPlace는 4개 규칙을 보상·상태에 넣고, "How Can RL Achieve Expert-level Placement?"는 전문가 레이아웃에서 보상 모델을 학습한다.',
  '새 모델 계열이 placement에 들어왔다: 생성 모델(FlowPlace, flow matching), VLM·멀티 에이전트(PlaceReasoner-Beta). 아직 초기 단계이고 설계 규모가 작다.',
  'routing 쪽은 알고리즘 교체보다 GPU 가속과 타이밍·전력·혼잡의 동시 최적화가 중심이며 ISPD 대회가 OpenROAD 기반으로 평가를 표준화하고 있다.',
  '실제 활용은 학술 신기법이 아니라 상용 도구(Cerebrus, DSO.ai)·OpenROAD·AlphaChip(제한된 블록)이다. 학술 RL/생성 모델의 tapeout 사용 증거는 찾지 못했다.',
  '평가 관행의 약점: 오래된 벤치마크(ICCAD 2015), 합계 기준 대표 수치, 설계 몇 개, 독립 재현 없음. EXPlace 분석에서 이를 구체적으로 확인했다.',
]

type Cat = { cat: string; works: string; opt: string; pro: string; con: string }
const LAND: Cat[] = [
  { cat: '해석적(analytical)', works: 'DREAMPlace(mixed-size), DREAMPlace 4.0(해석적+BBO, 타이밍 구동), AutoDMP(해석적+BBO), IncreMacro(해석적+MILP)', opt: '매끄러운 대용 목적(HPWL)을 gradient로 최적화', pro: '빠르고 표준 baseline, 표준셀과 macro를 함께 다룸', con: 'macro 규칙(주기, 계층, dataflow)을 넣기 어렵고 최종 TNS·WNS가 약함(EXPlace 비교 기준)' },
  { cat: 'BBO(블랙박스 탐색)', works: 'Hier-RTLMP(계층+SA, OpenROAD 통합), WireMask-BBO, LaMPlace(BBO+회귀)', opt: '평가 함수를 반복 호출하며 탐색', pro: '규칙·휴리스틱을 쉽게 반영(Hier-RTLMP는 OpenROAD-flow-scripts에 통합돼 있음)', con: '평가 비용이 크고, LaMPlace는 이력 데이터 의존' },
  { cat: '강화학습(RL)', works: 'AlphaChip, DeepPlace, MaskPlace, ChiPFormer, MaskRegulate, EfficientPlace, EffectivePlace, EXPlace', opt: 'macro를 순서대로 놓는 MDP, 보상 설계가 핵심', pro: '학습 후 추론이 빠르고(수 초) 규칙을 보상으로 반영', con: '설계별 학습 시간, proxy 보상, 재현성, 최신 벤치마크 비교 부족' },
  { cat: '생성 모델', works: 'FlowPlace(flow matching, DAC 2026)', opt: '배치 분포를 학습해 샘플링, 하드 제약으로 겹침 0', pro: '샘플링이 빠르다고 주장(10~50배)', con: '초록만 확인, baseline·수치 불명' },
  { cat: 'LLM/VLM 에이전트', works: 'PlaceReasoner-Beta(2026-09)', opt: 'VLM 플래너 + 기하·물리 검증기 + post-route 최적기의 닫힌 루프', pro: 'routed PPA를 루프에 직접 사용', con: '설계 8개, Beta, classical baseline 모음과 비교' },
]

type Lin = { y: string; w: string; what: string }
const LINEAGE: Lin[] = [
  { y: '2022', w: 'MaskPlace (NeurIPS)', what: '시각 표현 + wiremask 밀집 보상의 RL 배치. 이후 RL 계열의 기반(EXPlace도 wiremask·next-step mask 사용)' },
  { y: '2024', w: 'MaskRegulate (NeurIPS)', what: 'RL 정책을 "macro 배치자가 아니라 규제자"로. 주기(regularity) 보상을 추가 — EXPlace가 확장한 출발점' },
  { y: '2025', w: 'LaMPlace (ICLR)', what: '과거 배치·PPA 데이터로 마스크를 예측해 최종 지표를 겨냥하는 BBO. EXPlace의 가장 강한 비교 대상' },
  { y: '2026', w: 'EXPlace (ICLR 2026)', what: '전문가 지식 4종 + DPO 타이밍 미세조정. 아래 상세 분석' },
  { y: '2026-04', w: 'How Can RL Achieve Expert-level Placement? (DAC 2026)', what: '전문가 최종 레이아웃에서 보상 모델을 학습(보상 설계가 병목이라는 주장). 같은 연구 그룹' },
  { y: '2026-04', w: 'FlowPlace (DAC 2026)', what: 'flow matching 기반 생성 placement. 같은 그룹' },
  { y: '2026', w: 'Timing-driven detailed placement (DATE 2026)', what: 'EXPlace 참고문헌에 인용된 같은 그룹의 상세 배치 연구(내용은 읽지 않음)' },
]

type Paper = { name: string; lv: 'A' | 'B' | 'C' | 'D'; method: string; result: string; note: string }
const PAPERS: Paper[] = [
  { name: 'How Can RL Achieve Expert-level Placement? (arXiv 2604.25191, DAC 2026)', lv: 'B', method: '전문가 최종 레이아웃에서 단계별 궤적을 추정해 시연·선호로 쓰고 암묵적 보상 모델을 학습. 보상이 RL 병목이라는 주장', result: '설계 1개로도 학습되고 일반화된다고 주장. 초록에 수치·벤치마크 없음', note: '수치는 본문 확인 필요' },
  { name: 'FlowPlace (arXiv 2604.23658, DAC 2026)', lv: 'B', method: '마스크 유도 합성 데이터로 사전학습, 유연한 prior 주입의 flow 학습, 하드 제약 샘플링으로 겹침 없는 레이아웃', result: 'OpenROAD·ICCAD 2015에서 PPA 향상, 샘플링 10~50배 빠름, 겹침 0 (구체 수치·baseline은 초록에 없음)', note: 'diffusion의 느린 샘플링·겹침 문제를 겨냥' },
  { name: 'PlaceReasoner-Beta (arXiv 2609.21263, 2026-09-18)', lv: 'B', method: 'VLM 플래너가 floorplan 이미지·macro 사양·연결성으로 후보를 내고, 기하 검증기 → 물리 검증기(초기 구현 피드백) → post-route 최적기. 자체 벤치마크: 설계 8개 × 가로세로비 2종 = 16과제, floorplan·I/O 고정', result: 'DRC-clean 중 1:1 전 과제 최고 타이밍. post-route TNS 61.2%(1:1), 53.0%(2:1) 감소(classical baseline 모음 대비)', note: '설계 8개, 이름이 Beta, 비교가 baseline 모음 기준' },
  { name: 'GAP-LA: GPU layer assignment (arXiv 2507.13375, 수정 2026-01)', lv: 'B', method: '2D 전역 배선 경로를 3D로 바꾸는 층 배정을 GPU로 가속, 타이밍·전력·혼잡·via를 함께 최적화', result: 'ISPD 2025 대회 우승자 대비 WNS 0.3~9.9%, TNS 2.0~5.4% 개선, 최대 1,200만 net. 전력·혼잡은 유지', note: '런타임은 "경쟁력 있음"으로만 서술, 알고리즘 상세는 초록에 없음' },
  { name: 'Gradient-Guided RC Weighting for Timing-Driven Global Routing (ISPD \'26)', lv: 'C', method: '타이밍 기울기로 RC 가중을 유도하는 타이밍 구동 전역 배선', result: 'ISPD25 벤치마크에서 WNS 14.3%, TNS 18.5% 개선, 혼잡 비슷', note: '검색 결과 요약으로만 확인' },
  { name: 'ISPD 2024/2025 global routing contest, ISPD 2026 buffering·sizing contest', lv: 'C', method: '2024가 GPU·ML 기법을 전역 배선에 처음 도입, 2025는 업계 표준 입력과 OpenROAD 기반 평가. 2026 대회는 배치 후 buffering·sizing(혼잡 페널티 포함)', result: '대회 형식. 2026에는 routing 전용 대회를 찾지 못함', note: 'detailed routing은 TritonRoute(OpenROAD)가 오픈소스 기준이고 2026 신규 논문은 찾지 못함' },
]

type Use = { who: string; what: string; lv: 'A' | 'B' | 'C' | 'D'; caveat: string }
const USE: Use[] = [
  { who: 'AlphaChip (Google)', what: 'Google 발표: TPU v5e 10개, v5p 15개, Trillium 25개 블록, Axion CPU 7개 블록. MediaTek이 외부 도입', lv: 'D', caveat: '제한된 블록이며 사람이 대부분 수행. 최신 벤치마크와의 직접 비교가 없다는 비판이 계속됨(2024 Nature addendum 이후에도)' },
  { who: 'Cadence Cerebrus', what: '2021년 이후 1,000개 이상 production 설계 배포 주장, PPA 7~20% 개선(벤더 주장)', lv: 'D', caveat: '독립 검증 없음. 2022 고객 사례: MediaTek 한 블록 면적 5%·전력 6% 이상 절감, Renesas TNS 75% 개선(약 4년 전)' },
  { who: 'Synopsys DSO.ai', what: '2023-02에 상용 tapeout 100건 발표(3배 이상 생산성, 전력 최대 25% 절감 주장). 이후 건수는 2차 자료만 있음', lv: 'D', caveat: '벤더 보고. Cerebrus·OpenROAD 건수와 정의가 달라 직접 비교 불가' },
  { who: 'OpenROAD / OpenLane', what: '공식 문서: SKY130·GF180에서 600건 이상 tapeout의 물리 구현에 사용(Efabless MPW, chipIgnite)', lv: 'C', caveat: '구현 건수이지 양산 칩 수가 아님. OpenLane은 유지보수 모드' },
  { who: '학술 RL·생성 모델 (EXPlace 등)', what: '실제 tapeout 사용 증거를 찾지 못함', lv: 'C', caveat: '모두 벤치마크 수준. 상용 도구가 placer를 학습 모델로 대체했다기보다 flow 파라미터 탐색에 RL을 쓴다는 것은 일반 지식이며 이번 조사에서 확인한 사실이 아님' },
]

const SRC: { label: string; href: string; note: string }[] = [
  { label: 'EXPlace (ICLR 2026) — OpenReview/PDF', href: 'https://proceedings.iclr.cc/paper_files/paper/2026/hash/cbc1ad2066f0afebbcea930c5688fc1f-Abstract-Conference.html', note: 'PDF 본문 직접 추출해 읽음 (원문)' },
  { label: 'EXPlace 코드 (GitHub)', href: 'https://github.com/lamda-bbo/EXPlace', note: 'README 확인' },
  { label: 'How Can RL Achieve Expert-level Placement? (arXiv 2604.25191)', href: 'https://arxiv.org/abs/2604.25191', note: '초록' },
  { label: 'FlowPlace (arXiv 2604.23658)', href: 'https://arxiv.org/abs/2604.23658', note: '초록' },
  { label: 'PlaceReasoner-Beta (arXiv 2609.21263)', href: 'https://arxiv.org/abs/2609.21263', note: '초록' },
  { label: 'GAP-LA (arXiv 2507.13375)', href: 'https://arxiv.org/abs/2507.13375', note: '초록' },
  { label: 'ISPD 2025 global routing contest', href: 'https://dl.acm.org/doi/10.1145/3698364.3715706', note: '검색 요약' },
  { label: 'ISPD \'26 timing-driven global routing', href: 'https://dl.acm.org/doi/10.1145/3764386.3779588', note: '검색 요약' },
  { label: 'How AlphaChip transformed computer chip design (Google DeepMind)', href: 'https://deepmind.google/blog/how-alphachip-transformed-computer-chip-design/', note: '자체 주장' },
  { label: 'AlphaChip 논쟁 (Wikipedia)', href: 'https://en.wikipedia.org/wiki/AlphaChip_(controversy)', note: '2차 자료' },
  { label: 'Synopsys 100 tape-outs (2023)', href: 'https://www.prnewswire.com/news-releases/ai-designed-chips-reach-scale-with-first-100-commercial-tape-outs-using-synopsys-technology-301739936.html', note: '벤더 보도자료' },
  { label: 'OpenROAD 문서', href: 'https://openroad.readthedocs.io/en/latest/main/README.html', note: '검색 요약(600+ tapeout)' },
]

export default function ResearchTrends() {
  return <>
    <section className="card vb-card">
      <div className="card-title"><div><small className="kicker">RESEARCH TRENDS</small><h2>placement · routing 연구 동향 (2026)</h2></div><span className="connection">2026-10-17 조사 · 직접 측정 아님</span></div>
      <p className="vb-lead">최신 placement·routing 논문의 방법론과 실제 활용을 정리했습니다. 근거 수준을 칸마다 표시했습니다:
        <Lv v="A"/> 원문 본문을 직접 읽음 · <Lv v="B"/> 초록·요약 페이지 · <Lv v="C"/> 검색 결과 요약 · <Lv v="D"/> 벤더·저자 자체 주장.
        EXPlace만 원문을 끝까지 읽었고 나머지는 대부분 초록 수준이므로, 수치는 해당 논문의 주장으로 읽으세요.</p>
      <h3 className="vb-sub">큰 흐름</h3>
      <ul className="vb-limits">{TAKEAWAYS.map((s, i) => <li key={i}>{s}</li>)}</ul>

      <h3 className="vb-sub">접근 방식 지형도</h3>
      <div className="data-table"><table>
        <thead><tr><th>접근</th><th>대표 작업</th><th>무엇을 최적화</th><th>강점</th><th>약점</th></tr></thead>
        <tbody>{LAND.map(c => <tr key={c.cat}><td><b>{c.cat}</b></td><td>{c.works}</td><td>{c.opt}</td><td>{c.pro}</td><td>{c.con}</td></tr>)}</tbody>
      </table></div>
      <p className="vb-note">분류는 EXPlace 논문의 Table 1(방법 유형)과 해당 논문 초록을 따랐습니다. "약점"은 EXPlace 논문의 비교와 주장에 기댄 것이라 해당 그룹의 시각이 반영되어 있습니다.</p>

      <h3 className="vb-sub">연구 계보 (EXPlace 참고문헌 기준)</h3>
      <div className="data-table"><table>
        <thead><tr><th>시기</th><th>작업</th><th>내용</th></tr></thead>
        <tbody>{LINEAGE.map(l => <tr key={l.w}><td>{l.y}</td><td><b>{l.w}</b></td><td>{l.what}</td></tr>)}</tbody>
      </table></div>
    </section>

    <ExplaceDeepDive/>

    <section className="card vb-card">
      <div className="card-title"><div><small className="kicker">OTHER PAPERS</small><h2>그 밖의 최신 논문 (placement · routing)</h2></div><span className="connection">대부분 초록 수준</span></div>
      <div className="data-table"><table>
        <thead><tr><th>논문</th><th>확인</th><th>방법</th><th>보고된 결과</th><th>비고</th></tr></thead>
        <tbody>{PAPERS.map(p => <tr key={p.name}><td><b>{p.name}</b></td><td><Lv v={p.lv}/></td><td>{p.method}</td><td>{p.result}</td><td>{p.note}</td></tr>)}</tbody>
      </table></div>
    </section>

    <section className="card vb-card">
      <div className="card-title"><div><small className="kicker">IN PRACTICE</small><h2>실제 활용 사례</h2></div><span className="connection">대부분 벤더·저자 주장</span></div>
      <div className="data-table"><table>
        <thead><tr><th>대상</th><th>활용 내용</th><th>확인</th><th>주의</th></tr></thead>
        <tbody>{USE.map(u => <tr key={u.who}><td><b>{u.who}</b></td><td>{u.what}</td><td><Lv v={u.lv}/></td><td>{u.caveat}</td></tr>)}</tbody>
      </table></div>
      <p className="vb-note">Cadence의 "production 설계 수", Synopsys의 "상용 tapeout 수", OpenROAD의 "구현 수"는 정의와 기간이 달라 서로 비교하면 안 됩니다. 독립적인 Cerebrus 대 DSO.ai 비교 자료는 찾지 못했습니다.</p>

      <h3 className="vb-sub">출처와 확인 정도</h3>
      <ul className="vb-limits">{SRC.map(s => <li key={s.href}><a href={s.href} target="_blank" rel="noreferrer">{s.label}</a> — {s.note}</li>)}</ul>
      <p className="vb-note">이 탭은 조사 정리이며 우리 설계에서 재현하거나 측정한 값이 아닙니다. 방법을 우리 Macro Tetris에 적용하는 아이디어는 EXPlace 상세 분석의 마지막 표에 가설로 적었습니다.</p>
    </section>
  </>
}
