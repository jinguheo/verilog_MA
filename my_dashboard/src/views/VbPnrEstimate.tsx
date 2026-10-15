// VB 탭 — 이미 있는 배치(DEF)를 불러와 빠르게 점검한 결과. 데이터는 tools/vvirt/examples/pnr_estimate.py --dashboard 가 만든다.
import { useState } from 'react'
import pnr from '../data/vbPnr.json'

interface Finding { kind: string; severity: string; bbox: number[]; msg: string }
interface Eco { op: string; from?: number[]; dx?: number; master?: string; near?: number[]; alt?: string; why?: string; name?: string; to?: number[] }
interface Rules { site_um: number; row_um: number; lu_um: number; tap_dist_um: number | null; source: Record<string, string> }
interface Exp { instances: number; wires: number; vias: number; patches: number; chunks: number; lib: string; cell: string; tech_lef: string; verified: boolean; unverified_orientations: string[]; verify?: { instances_compared: number; boxes_differ: number; shapes_in_cellview: number } }
interface Run { rules: Rules; route_check?: { counts: { short: number; spacing: number }; layers_checked: Record<string, number>; tech_lef: string }; export?: Exp; def: string; seconds: { read: number; estimate: number }; stats: Record<string, number>; findings: Finding[]; congestion: Finding[]; eco: Eco[] }
const RUNS = pnr as unknown as Record<string, Run>
const TITLE: Record<string, string> = { ppa3_antfix4: 'ADC x=40 (탭 없는 띠가 생긴 배치)', ppa3_adcslew2: 'ADC x=30.24 (수정한 배치)' }
const KIND: Record<string, string> = { tap_far: '탭에서 너무 멂 (래치업/nwell 부유)', overlap: '셀 겹침', route_short: '배선 단락', route_spacing: '배선 간격 부족', outside_die: '다이 밖', off_grid: '격자 어긋남', congestion: '배선 혼잡 후보' }

const f1 = (v: number) => v.toFixed(1)

export default function VbPnrEstimate() {
  const names = Object.keys(RUNS)
  const [sel, setSel] = useState(names[0])
  const r = RUNS[sel]
  if (!r) return null
  const s = r.stats
  const errs = r.findings.filter(f => f.severity === 'error')
  return <section className="card vb-card">
    <div className="card-title"><div><small className="kicker">PLACEMENT CHECK</small><h2>기존 배치를 불러와 빠르게 점검 (P&amp;R 추정)</h2></div><span className="connection">{(r.seconds.read + r.seconds.estimate).toFixed(1)}초</span></div>
    <p className="vb-lead">새로 만들지 않고 <b>이미 있는 배치(DEF)</b>를 읽어 몇 초 안에 점검합니다. 결과는 아래 표·그림과, Virtuoso에서 실제 레이아웃 위에 얹어 볼 수 있는 <b>마커 SKILL</b>로 줍니다. 마커는 별도 레이어(marker/drawing)에만 그려서 사람이 확인하고 지우면 됩니다. 고칠 것은 <b>최소 수정</b>(매크로 하나 이동, 탭 하나 추가)만 제안합니다.</p>
    <div className="vb-chips">{names.map(n => <button key={n} className={n === sel ? 'on' : ''} onClick={() => setSel(n)}>{TITLE[n] ?? n}</button>)}</div>
    <div className="stats ppa-experiment-stats">
      <div className="stat-card"><small>합법성 (겹침 / 격자 / 다이 밖)</small><strong>{s.overlaps} / {s.off_grid} / {r.findings.filter(f => f.kind === 'outside_die').length}</strong><span>셀 {s.components.toLocaleString()}개 · 밀도 최대 {f1(s.max_bin_density * 100)}%</span></div>
      <div className="stat-card"><small>탭 점검 (17µm 안에 탭)</small><strong className={s.tap_far_rows ? 'bad-text' : 'ok-text'}>{s.tap_far_rows}행 부족</strong><span>탭 {s.taps.toLocaleString()}개</span></div>
      <div className="stat-card"><small>선 길이 (HPWL → 실제 배선)</small><strong>{f1(s.hpwl_um / 1000)} mm → {f1((s.routed_um ?? 0) / 1000)} mm</strong><span>{s.routed_over_hpwl ? `${s.routed_over_hpwl.toFixed(2)}배 · 비아 ${s.vias.toLocaleString()}` : '배선 없음'}</span></div>
      {r.route_check && <div className="stat-card"><small>배선 규칙 (tech LEF 간격)</small><strong className={r.route_check.counts.short + r.route_check.counts.spacing ? 'bad-text' : 'ok-text'}>단락 {r.route_check.counts.short} · 간격 {r.route_check.counts.spacing}</strong><span>금속 {Object.keys(r.route_check.layers_checked).length}층 검사</span></div>}
      <div className="stat-card"><small>혼잡 후보 (RUDY)</small><strong>{s.rudy_hot_bins ?? 0}칸</strong><span>최대 {s.rudy_max ? f1(s.rudy_max) : '-'} (평균 {s.rudy_mean ? s.rudy_mean.toFixed(2) : '-'})</span></div>
    </div>

    <h3 style={{ margin: '14px 0 4px', fontSize: 14 }}>발견 사항 {errs.length ? `(오류 ${errs.length}건)` : '(오류 없음)'}</h3>
    {r.findings.length === 0 ? <p className="vb-note">오류 후보가 없습니다.</p> :
      <div className="data-table"><table><thead><tr><th>종류</th><th>위치 (x0,y0 – x1,y1 µm)</th><th>내용</th></tr></thead><tbody>
        {r.findings.map((f, i) => <tr key={i}><td>{KIND[f.kind] ?? f.kind}</td><td><code>{f.bbox.map(f1).join(', ')}</code></td><td>{f.msg}</td></tr>)}
      </tbody></table></div>}

    <h3 style={{ margin: '14px 0 4px', fontSize: 14 }}>최소 수정 제안 ({r.eco.length}건)</h3>
    {r.eco.length === 0 ? <p className="vb-note">제안할 수정이 없습니다.</p> :
      <div className="data-table"><table><thead><tr><th>동작</th><th>위치</th><th>이유 / 대안</th></tr></thead><tbody>
        {r.eco.map((e, i) => <tr key={i}><td><code>{e.op}</code>{e.master ? ` ${e.master.replace('sky130_fd_sc_hd__', '')}` : e.name ? ` ${e.name}` : ''}</td>
          <td><code>{e.from && e.to ? `${e.from.map(f1).join(', ')} → ${e.to.map(f1).join(', ')}` : (e.near ?? e.to ?? []).map(f1).join(', ')}</code></td><td>{e.why}{e.alt ? ` — ${e.alt}` : ''}</td></tr>)}
      </tbody></table></div>}

    <h3 style={{ margin: '14px 0 4px', fontSize: 14 }}>배치 그림 (빨강 = 오류, 주황 = 혼잡 후보)</h3>
    <img src={`/vb/pnr/${sel}.svg`} alt="배치와 발견 사항 오버레이" style={{ width: '100%', maxHeight: 520, objectFit: 'contain', background: 'var(--surface-2, #fff)', border: '1px solid var(--line, #ddd)', borderRadius: 6 }}/>
    <p className="vb-note">Virtuoso에 얹기: <a href={`/vb/pnr/${sel}_overlay.il`} download>{sel}_overlay.il</a> 을 받아 브리지 클라이언트로 보내거나 CIW에서 load 하세요. 기본은 <code>testlib</code> 안의 새 셀에 그리며, 실제 레이아웃 셀에 얹으려면 <code>--lib 라이브러리 --cell 셀</code>을 주고 다시 만드세요. 생성: <code>python3 tools/vvirt/examples/pnr_estimate.py &lt;run 폴더&gt; --dashboard</code></p>
    <h3 style={{ margin: '14px 0 4px', fontSize: 14 }}>쓴 규칙과 출처 — 코드에 적은 값이 아니라 PDK 파일에서 읽음</h3>
    <div className="data-table"><table><thead><tr><th>값</th><th>출처</th></tr></thead><tbody>
      <tr><td>사이트 {r.rules.site_um} × 행 높이 {r.rules.row_um} µm</td><td><code>{r.rules.source.site_um}</code></td></tr>
      <tr><td>래치업 거리 {r.rules.lu_um} µm (LU.2 / LU.3)</td><td><code>{r.rules.source.lu_um}</code></td></tr>
      {r.rules.tap_dist_um && <tr><td>플로우가 쓴 탭 간격 {r.rules.tap_dist_um} µm</td><td><code>{r.rules.source.tap_dist_um}</code></td></tr>}
      {r.route_check && <tr><td>배선 폭·간격·비아 모양</td><td><code>techlef/{r.route_check.tech_lef}</code> (넓은 금속은 SPACINGTABLE 값)</td></tr>}
    </tbody></table></div>

    {r.export && <>
      <h3 style={{ margin: '14px 0 4px', fontSize: 14 }}>Virtuoso로 넘기기 — 밖에서 만든 배치·배선 결과를 SKILL로 변환</h3>
      <p className="vb-note">P&amp;R은 밖(OpenROAD)에서 PDK 규칙으로 끝내고, 결과만 브리지로 넣습니다. 인스턴스 {r.export.instances.toLocaleString()}개 · 배선 사각형 {r.export.wires.toLocaleString()} · 비아 {r.export.vias.toLocaleString()} · 패치 {r.export.patches} → <code>{r.export.lib}/{r.export.cell}</code>, SKILL 파일 {r.export.chunks}개 + 불러오기 스크립트. {r.export.verify ? <>가상 Virtuoso에 실제로 적재해 인스턴스 {r.export.verify.instances_compared.toLocaleString()}개의 상자를 DEF와 비교: <b>{r.export.verify.boxes_differ}개 불일치</b> (도형 {r.export.verify.shapes_in_cellview.toLocaleString()}개). 이 검증 실행은 가상 Virtuoso에 없는 셀(decap_12 약 1만 개, ADC·SRAM 매크로)을 뺀 수치입니다. </> : null}범위를 줄이려면 <code>--window x0 y0 x1 y1</code>.</p>
      <p className="vb-note">넘기지 않는 것: 넷·핀 연결(스키매틱 구동 핀이 필요), 전원 스트라이프, 대상 라이브러리에 없는 마스터(예: <code>sky130_ef_sc_hd__decap_12</code>, 매크로는 <code>--macro-lib</code> 지정). 회전·뒤집힘 방향 FE/FW는 Cadence 대응 표를 검증하지 못해 표시만 합니다{r.export.unverified_orientations.length ? ` (이 설계에서 사용: ${r.export.unverified_orientations.join(', ')})` : ' (이 설계에서는 사용 안 함)'}. 가상 Virtuoso와의 일치는 <b>같은 모델끼리의 일관성</b>이지 실제 Cadence 결과와의 일치는 아닙니다. 명령: <code>python3 tools/vvirt/examples/pnr_export.py &lt;run 폴더&gt; --verify</code></p>
    </>}

    <p className="vb-note"><b>이 점검이 보는 것과 못 보는 것.</b> 보는 것: 셀 겹침·격자·다이 밖, 탭 거리(래치업), 선 길이 추정, 배선 혼잡 후보. 못 보는 것: 타이밍·안테나·실제 DRC/LVS(DEF에는 매크로 내부와 셀 핀·장애물 도형이 없어 배선과 핀 사이 단락·면적·엔클로저·안테나는 못 봄), 연결 정확성(넷리스트 대조는 아직 연결하지 않음). 통과해도 서명(signoff)을 대신하지 않습니다. 근거: <code>{r.def}</code>에서 읽음.</p>
  </section>
}
