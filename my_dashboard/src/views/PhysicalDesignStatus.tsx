// Live-ish status for the Sample Test 4 ASIC track, shown only on the
// "Physical Design" (manufacturing) tab. TaskWorkspace's generic tasks{}
// entry describes the workflow in the abstract; this component reports what
// has actually run, with real numbers, so the tab is not just a checklist.
// Snapshot as of 2026-08-29 16:40 KST — refresh the numbers by hand after the
// next run finishes (see the "how to refresh" note at the bottom).

const toolchain = [
  ['flow', 'OpenLane 2 v2.3.10', 'Python 3.12 venv (~/.venvs/openlane312), native — not the ORFS/OpenROAD-from-source track, which was abandoned (see tools/wsl/README.md)'],
  ['PDK', 'sky130A via volare', '~/.volare/volare/sky130/versions/0fe599b2... — the copy the flow actually reads; a second copy at ~/eda/pdk is unused'],
  ['synthesis / P&R / STA', 'yosys (nix, with slang+pyosys) / OpenROAD / OpenSTA 2.6.0', 'the distro apt yosys (0.52) cannot run OpenLane\u2019s pyosys steps (-y) — only the nix-provided build works'],
  ['DRC / LVS / GDS', 'Magic 8.3.105 / netgen-lvs 1.5.133 / KLayout 0.30.0', 'all three signed off clean on every completed design so far'],
  ['host', 'WSL Ubuntu 26.04 (D:\\WSL\\Ubuntu)', '925 GB free; nothing installed touches C:'],
] as const

const blocks = [
  ['skid_buffer', '완료 · signoff clean', 'DRC 0 · LVS 0 · XOR 0 · antenna 0'],
  ['cnt_sat', '완료 · signoff clean', 'DRC 0 · LVS 0 · XOR 0 · antenna 0'],
  ['chan_ctrl', '완료 · signoff clean (실제 SDC 적용)', '단일 클럭. 폴백 SDC 대비 setup 여유 4.25→1.98ns로 낮아짐 — IO 제약이 없어서 좋아 보였던 것'],
  ['chan_top', '진행 중 · 30/78 단계 (mid-PnR STA)', '첫 시도(6/10ns)는 타이밍 신호오프 실패 → 원인 규명 후 SDC 수정(10/32ns)하여 재실행 중'],
] as const

const rootCauses = [
  ['axi_clk 도메인', 'pkt_check.sv의 CRC-32가 8단 crc32_byte_step을 조합 로직으로 직렬 연결 (각 단이 내부적으로 8비트 시프트-XOR 재귀) — 사실상 64단 조합 체인. axi_period=32ns에서 여유 확보.'],
  ['src_clk 도메인 (별개 원인)', 'skid_buffer.sv의 출력 mux가 pkt_align.sv의 가변 인덱스 바이트 누산기(nxt_data[byte_cnt_q*8+:8])에 물려 있음. axi_clk를 아무리 늘려도 최종 −3.23ns에서 안 움직인 이유 — 고정 6ns인 src_clk 내부 문제라 axi_clk와 무관했음. src_period=10ns에서 여유 확보.'],
] as const

// 상용 EDA/파운드리 PDK vs 이 프로젝트가 실제 쓰는 오픈소스 스택.
const eda = [
  ['접근 방법', '상용 (Synopsys Fusion Compiler/PrimeTime, Cadence Innovus/Tempus, Siemens Aprisa/Calibre)', '오픈소스 (yosys, OpenROAD, OpenSTA, Magic, KLayout, netgen)'],
  ['라이선스 비용', '연간 좌석당 수만~수십만 달러. 사내 유지보수 인력도 별도 필요', '무료. 이번 세션 설치 비용은 사람 시간뿐'],
  ['타이밍 signoff 정확도', 'ECSM/CCS 비선형 지연 모델, 통계적(OCV/AOCV/POCV) 변동, IR-drop 인지 타이밍까지 표준 지원', 'OpenSTA는 선형 근사 중심 — 상용 대비 마진을 더 크게 잡아야 안전. 이번 chan_top처럼 실제 위반을 잡아내는 데는 충분했음'],
  ['DFM/수율 최적화', 'CMP dummy fill, 리소그래피 시뮬레이션 기반 OPC 연동, 수율 예측 모델 포함', '기본 fill/DRC만 — 리소 시뮬레이션이나 수율 모델은 없음'],
  ['공정 노드', '고객사 계약에 따라 3~5nm 최신 노드까지 접근 가능', 'sky130(130nm), gf180(180nm) 등 공개된 구세대 노드로 제한'],
  ['IP 생태계', '메모리 컴파일러, 고속 SerDes, 아날로그 매크로 등 파운드리 인증 IP 다수', '거의 없음 — SRAM 매크로 정도만 커뮤니티 제공'],
  ['지원/책임', '파운드리·EDA 벤더의 공식 지원, 문제 발생 시 계약상 책임 소재 명확', '커뮤니티 기반. 이번 세션의 nix store 손상처럼 원인 불명 문제는 직접 복구해야 함'],
] as const

const pdkAccess = [
  ['상용 파운드리 PDK (TSMC, Samsung, GlobalFoundries 등)', '서명된 NDA + 파운드리와의 고객 계약(웨이퍼 발주 약정 포함하는 경우 많음)이 있어야 파일을 받을 수 있습니다. 개인이나 학습 목적으로는 접근 자체가 불가능합니다.'],
  ['sky130 (이 프로젝트가 쓰는 것)', 'SkyWater가 Google 후원으로 2020년 오픈소스화. NDA 없이 누구나 무료로 volare 같은 도구로 즉시 받을 수 있습니다. 대신 130nm — 최신 상용 칩과는 세대 차이가 있는 공정입니다.'],
  ['gf180, ASAP7 등 다른 오픈 PDK', 'gf180(GlobalFoundries 180nm)도 NDA 없이 공개됐고, ASAP7은 실제 파운드리가 아닌 ASU/ARM의 예측 모델(7nm급 특성을 흉내낸 가상 PDK) — 둘 다 실제 최신 상용 제조로 이어지지 않습니다.'],
] as const

// 왜 RTL 설계부터 제조까지 오래 걸리는가 — chan_top 경험을 근거로.
const whySlow = [
  ['배치·배선 전에는 진짜 타이밍을 알 수 없다', '배선 지연은 실제 셀 위치와 배선 길이가 정해져야 계산됩니다(RC 추출). 그래서 RTL 시뮬레이션 단계의 클럭 주기(6/10ns)는 "논리적으로 말이 되는가"만 검증했을 뿐, 실제로 그 속도로 동작하는지는 배치·배선을 끝내야 알 수 있었습니다. chan_top이 바로 이 사례 — 시뮬레이션에서는 통과했지만 실제 합성·배치 후에는 10배 가까운 초과 위반이 나왔습니다.'],
  ['클럭 도메인마다, 코너마다 따로 검증해야 한다', 'chan_top 하나에만 클럭 도메인 2개(src_clk/axi_clk)가 있고, 각 도메인을 공정·전압·온도 조합(코너) 9가지에서 전부 확인해야 합니다. 하나라도 위반이면 signoff 실패 — 검증해야 할 조합이 곱셈으로 늘어납니다.'],
  ['원인 진단 자체가 여러 단계를 거칩니다', '이번에 "왜 안 닫히는가"를 알아내는 데 넷리스트에서 실제 신호명 확인 → 배치·배선된 설계 + 기생 성분 추출 → 클럭 주기 스윕까지 여러 단계가 필요했습니다. 코드 버그처럼 한 줄을 고쳐서 되는 게 아니라, 물리적 원인(배선 길이, 셀 지연)을 추적해야 합니다.'],
  ['한 번의 실수를 되돌릴 수 없다', '소프트웨어는 배포 후에도 패치할 수 있지만, 칩은 제조(테이프아웃)가 끝나면 물리적으로 고정됩니다. 최신 공정 마스크 세트 하나가 수백만 달러, 제작 기간이 수개월이라 "일단 만들고 고치자"가 통하지 않습니다 — 그래서 DRC/LVS/타이밍/안테나 등 모든 신호오프 항목이 100% 통과할 때까지 반복합니다.'],
  ['검증 도구가 여러 개, 서로 다른 관점으로 겹쳐서 확인합니다', 'DRC(제조 규칙), LVS(회로도 일치), STA(타이밍), 안테나(플라즈마 손상), IR drop(전원), XOR(레이아웃 회귀) — 이번 chan_ctrl·chan_top 모두 이 항목들을 전부 통과해야 했습니다. 하나의 종합 테스트가 아니라 독립된 여러 게이트를 순서대로 통과해야 하는 구조입니다.'],
] as const

export default function PhysicalDesignStatus() {
  return <>
    <section className="card"><div className="card-title"><div><small className="kicker">LIVE STATUS · 2026-08-29 16:40</small><h2>Sample Test 4 — ASIC 물리 설계 진행 상황</h2></div><span className="warning-badge">chan_top 진행 중</span></div>
      <div className="data-table"><table><thead><tr><th>블록</th><th>상태</th><th>근거</th></tr></thead><tbody>{blocks.map(([name, status, note]) => <tr key={name}><td><code>{name}</code></td><td>{status.includes('완료') ? <span className="ok-badge">{status}</span> : <span className="warning-badge">{status}</span>}</td><td>{note}</td></tr>)}</tbody></table></div>
      <p className="rtl-guide-note">산출물 위치: <code>samples/sample_test_4/asic/&lt;block&gt;/runs/RUN_*/final/</code> (GDS·LEF·netlist·SPEF·5-corner .lib). RTL은 이 작업 중 어느 것도 수정되지 않았습니다.</p>
    </section>
    <section className="card"><div className="card-title"><div><small className="kicker">TOOLCHAIN — 실제 사용 중</small><h2>WSL 기반 오픈소스 RTL-to-GDS</h2></div></div>
      <div className="data-table"><table><thead><tr><th>영역</th><th>도구</th><th>비고</th></tr></thead><tbody>{toolchain.map(([area, tool, note]) => <tr key={area}><td>{area}</td><td><b>{tool}</b></td><td>{note}</td></tr>)}</tbody></table></div>
    </section>
    <section className="card"><div className="card-title"><div><small className="kicker">chan_top — 타이밍 실패 원인 규명</small><h2>두 개의 독립된 조합 로직 병목</h2></div></div>
      <div className="check-list">{rootCauses.map(([title, detail]) => <p key={title}><b>{title}</b><span>{detail}</span></p>)}</div>
      <p className="rtl-guide-note">둘 다 실측 기반 진단입니다 — 넷리스트에서 실제 시작점 신호명을 확인하고(<code>fifo_rptr_q[2]</code>, <code>u_pkt_align.u_skid.skid_valid_q</code>), 배치·배선 완료된 설계 + 추출된 SPEF 기생 성분으로 클럭 주기를 스윕해 실제로 닫히는 지점을 찾았습니다 (매 시도마다 전체 P&R을 다시 돌리지 않고 OpenSTA/OpenROAD 배치 스크립트로 수 초 안에 확인). RTL 파이프라이닝(CRC 체인, 바이트 누산기)을 하면 더 빠른 클럭도 가능하지만 이번엔 시도하지 않았습니다 — 10/32ns는 "RTL 변경 없이 닫히는" 답입니다.</p>
    </section>
    <section className="card"><div className="card-title"><div><small className="kicker">상용 EDA vs 오픈소스 — 무엇이 다른가</small><h2>왜 실제 반도체 회사는 이 도구들을 안 쓰는가</h2></div></div>
      <div className="data-table"><table><thead><tr><th>항목</th><th>상용 EDA</th><th>이 프로젝트(오픈소스)</th></tr></thead><tbody>{eda.map(([item, commercial, oss]) => <tr key={item}><td><b>{item}</b></td><td>{commercial}</td><td>{oss}</td></tr>)}</tbody></table></div>
      <p className="rtl-guide-note">오픈소스가 "가짜"라는 뜻이 아닙니다 — 이번에 chan_ctrl과 chan_top(진행 중)에서 나온 DRC/LVS/타이밍 수치는 실제 sky130 공정 규칙 기준으로 계산된 진짜 결과입니다. 다만 상용 도구가 표준으로 갖춘 정확도·자동화·공정 접근 범위가 없어서, 실제 양산칩 signoff에는 아직 못 미칩니다.</p>
    </section>
    <section className="card"><div className="card-title"><div><small className="kicker">파운드리 PDK 접근 — NDA가 갈라놓는 것</small><h2>왜 sky130으로만 "진짜 제조"를 해볼 수 있는가</h2></div></div>
      <div className="check-list">{pdkAccess.map(([name, detail]) => <p key={name}><b>{name}</b><span>{detail}</span></p>)}</div>
    </section>
    <section className="card"><div className="card-title"><div><small className="kicker">왜 RTL→제조가 오래 걸리는가</small><h2>chan_top에서 실제로 겪은 이유들</h2></div></div>
      <div className="check-list">{whySlow.map(([title, detail]) => <p key={title}><b>{title}</b><span>{detail}</span></p>)}</div>
      <p className="rtl-guide-note">요약하면: 소프트웨어는 "짐작 → 실행 → 관찰"이 초 단위로 돌지만, 칩 설계는 "짐작(RTL) → 배치·배선(수십 분~수 시간) → 관찰(신호오프)"의 한 바퀴가 훨씬 느리고, 실패 시 되돌릴 수 없는 제조 단계가 끝에 있어서 그 앞의 모든 검증을 최대한 촘촘히 해야 합니다.</p>
    </section>
    <section className="card"><div className="card-title"><div><small className="kicker">GDS 레이아웃 보기</small><h2>완성된 블록은 바로 확인 가능</h2></div></div>
      <div className="check-list">
        <p><b>대시보드에서</b><span>Sample Test 4 → Layout 탭 — 렌더링된 이미지 (전체 다이 / 60µm / 20µm 배율), sky130A 레이어 색상 적용.</span></p>
        <p><b>KLayout GUI로 직접</b><span><code>tools\open_layout.bat &lt;design&gt;</code> — WSL의 KLayout이 WSLg를 통해 Windows 화면에 바로 뜹니다. 추가 설치 불필요.</span></p>
      </div>
      <p className="rtl-guide-note">이 카드는 스냅샷입니다 — 자동 갱신되지 않습니다. chan_top 재실행이 끝나면 상단 상태 표와 결과를 다시 반영해야 합니다. 최신 로그: <code>tools/wsl/logs/87e_chan_top_fixed.log</code>, run 디렉터리: <code>samples/sample_test_4/asic/chan_top/runs/</code> 최신 항목.</p>
    </section>
  </>
}
