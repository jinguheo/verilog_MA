import { useEffect, useState } from 'react'

type Rect = [string, number, number, number, number]
type Pin = { n: string; dir: string; use: string; rects: Rect[] }
type Cell = { info: { size: [number, number] | null; site: string | null; pins: Pin[] } }
type Position = { x: number; y: number }

type Props = {
  libId: string
  libraryRowHeight: number
  cellName: string
  cell: Cell | null
  cells: Record<string, Cell> | null
  availableCells: string[]
  onSelectCell: (name: string) => void
  onOpenLibrary: () => void
}

const round = (value: number, digits = 3) => Number(value.toFixed(digits))
const sourceSiteWidth = (libId: string) => libId === 'sky130_fd_sc_hvl' ? 0.48 : 0.46
const EMPTY_CELLS: Record<string, Cell> = {}
type TargetPin = { name: string; use: string; rects: Rect[] }
type BatchResult = { name: string; source: [number, number] | null; target: [number, number] | null; sites: number; rows: number; pins: TargetPin[]; outsidePins: string[]; status: '초안 생성' | '핀 이탈' | '크기 없음' | '치수 오류' }

function pinCenter(pin: Pin, size: [number, number]): Position | null {
  const r = pin.rects[0]
  if (!r || size[0] <= 0 || size[1] <= 0) return null
  return { x: (r[1] + r[3]) / (2 * size[0]) * 100, y: (r[2] + r[4]) / (2 * size[1]) * 100 }
}

function transformCell(name: string, cell: Cell, sourceSite: number, sourceRow: number, targetSite: number, targetRow: number, siteDelta: number, pinDx: number, pinDy: number): BatchResult {
  const source = cell.info.size
  if (!source) return { name, source: null, target: null, sites: 0, rows: 0, pins: [], outsidePins: [], status: '크기 없음' }
  const sites = Math.round(source[0] / sourceSite) + siteDelta
  const rows = Math.max(1, Math.round(source[1] / sourceRow))
  const target: [number, number] = [round(targetSite * sites), round(targetRow * rows)]
  if (!Number.isFinite(target[0]) || !Number.isFinite(target[1]) || sites < 1 || !Number.isInteger(sites) || target[0] <= 0 || target[1] <= 0) {
    return { name, source, target: null, sites, rows, pins: [], outsidePins: [], status: '치수 오류' }
  }
  const pins: TargetPin[] = cell.info.pins.map(pin => {
    const dx = pin.use === 'signal' ? pinDx / 100 * target[0] : 0
    const dy = pin.use === 'signal' ? pinDy / 100 * target[1] : 0
    return { name: pin.n, use: pin.use, rects: pin.rects.map(r =>
      [r[0], round(r[1] / source[0] * target[0] + dx), round(r[2] / source[1] * target[1] + dy),
        round(r[3] / source[0] * target[0] + dx), round(r[4] / source[1] * target[1] + dy)] as Rect) }
  })
  const outsidePins = pins.filter(pin => pin.use === 'signal' && pin.rects.some(r =>
    r[1] < 0 || r[2] < 0 || r[3] > target[0] || r[4] > target[1])).map(pin => pin.name)
  return { name, source, target, sites, rows, pins, outsidePins, status: outsidePins.length ? '핀 이탈' : '초안 생성' }
}

function GeometryPreview({ title, size, pins, sourceSize, positions }: {
  title: string
  size: [number, number]
  pins: Pin[]
  sourceSize?: [number, number]
  positions?: Record<string, Position>
}) {
  const [width, height] = size
  const scale = Math.min(350 / width, 190 / height)
  const left = (420 - width * scale) / 2
  const top = (250 - height * scale) / 2
  const tx = (x: number) => left + x * scale
  const ty = (y: number) => top + (height - y) * scale
  const sx = sourceSize ? width / sourceSize[0] : 1
  const sy = sourceSize ? height / sourceSize[1] : 1
  const colors: Record<string, string> = { li1: '#1D9E75', met1: '#378ADD', met2: '#E6784E', met3: '#7F77DD' }

  return <div className="card" style={{ padding: 12, minWidth: 0 }}>
    <b style={{ fontSize: 12 }}>{title}</b>
    <svg viewBox="0 0 420 270" role="img" aria-label={`${title}: 셀 외곽과 핀 위치`} style={{ display: 'block', width: '100%', maxWidth: 500, margin: '6px auto' }}>
      <rect x={left} y={top} width={width * scale} height={height * scale} fill="var(--surface-1)" stroke="var(--text-primary)" strokeDasharray="5 3" strokeWidth={1.5}/>
      {pins.flatMap(pin => {
        const originalCenter = sourceSize ? pinCenter(pin, sourceSize) : null
        const requested = positions?.[pin.n] ?? originalCenter
        const dx = originalCenter && requested ? (requested.x - originalCenter.x) / 100 * width : 0
        const dy = originalCenter && requested ? (requested.y - originalCenter.y) / 100 * height : 0
        return pin.rects.map((r, i) => {
          const x1 = r[1] * sx + dx, y1 = r[2] * sy + dy
          const x2 = r[3] * sx + dx, y2 = r[4] * sy + dy
          return <rect key={`${pin.n}-${i}`} x={tx(x1)} y={ty(y2)} width={Math.max((x2 - x1) * scale, 1)} height={Math.max((y2 - y1) * scale, 1)}
            fill={pin.use === 'signal' ? colors[r[0]] ?? '#888' : '#c0504d'} opacity={0.72}>
            <title>{pin.n} · {r[0]}</title>
          </rect>
        })
      })}
      {pins.filter(pin => pin.use === 'signal' && pin.rects.length > 0).map(pin => {
        const original = sourceSize ? pinCenter(pin, sourceSize) : pinCenter(pin, size)
        const center = positions?.[pin.n] ?? original
        if (!center) return null
        return <text key={pin.n} x={tx(center.x / 100 * width)} y={ty(center.y / 100 * height) - 4}
          textAnchor="middle" fontSize={10} fontWeight={700} fill="var(--text-primary)">{pin.n}</text>
      })}
      <text x={left} y={Math.min(top + height * scale + 17, 267)} fontSize={10} fill="var(--text-secondary)">{round(width)} × {round(height)} µm</text>
    </svg>
  </div>
}

export default function PdkChangeExperiment({ libId, libraryRowHeight, cellName, cell, cells, availableCells, onSelectCell, onOpenLibrary }: Props) {
  const cellsByName = cells ?? EMPTY_CELLS
  const [targetNm, setTargetNm] = useState(90)
  const [siteWidth, setSiteWidth] = useState(0.32)
  const [rowHeight, setRowHeight] = useState(1.88)
  const [siteDelta, setSiteDelta] = useState(0)
  const [pinDx, setPinDx] = useState(0)
  const [pinDy, setPinDy] = useState(0)
  const [selectedNames, setSelectedNames] = useState<string[]>([])
  const [batchResults, setBatchResults] = useState<BatchResult[] | null>(null)
  const [cellFilter, setCellFilter] = useState('')

  const sourceSize = cell?.info.size ?? null
  const pins = cell?.info.pins ?? []
  const signalPins = pins.filter(pin => pin.use === 'signal' && pin.rects.length > 0)
  const ratio = targetNm / 130

  useEffect(() => {
    setSelectedNames(Object.keys(cellsByName).filter(name => cellsByName[name]?.info.size))
    setBatchResults(null)
  }, [libId, cells])

  useEffect(() => {
    if (!sourceSize) return
    const widthSite = sourceSiteWidth(libId)
    setSiteWidth(round(widthSite * ratio))
    setRowHeight(round(libraryRowHeight * ratio))
    setSiteDelta(0)
    setPinDx(0)
    setPinDy(0)
    setBatchResults(null)
  }, [libId, libraryRowHeight])

  const suggestDimensions = () => {
    if (!Number.isFinite(ratio) || ratio <= 0) return
    const widthSite = sourceSiteWidth(libId)
    setSiteWidth(round(widthSite * ratio))
    setRowHeight(round(libraryRowHeight * ratio))
    setSiteDelta(0)
    setPinDx(0)
    setPinDy(0)
    setBatchResults(null)
  }

  const changeTargetNode = (value: number) => {
    setTargetNm(value)
    if (!Number.isFinite(value) || value <= 0) return
    const nextRatio = value / 130
    const widthSite = sourceSiteWidth(libId)
    setSiteWidth(round(widthSite * nextRatio))
    setRowHeight(round(libraryRowHeight * nextRatio))
    setSiteDelta(0)
    setPinDx(0)
    setPinDy(0)
    setBatchResults(null)
  }

  const focused = cell ? transformCell(cellName, cell, sourceSiteWidth(libId), libraryRowHeight, siteWidth, rowHeight, siteDelta, pinDx, pinDy) : null
  const targetSize = focused?.target
  const positions = Object.fromEntries(signalPins.map(pin => {
    const center = sourceSize ? pinCenter(pin, sourceSize) : null
    return [pin.n, { x: (center?.x ?? 0) + pinDx, y: (center?.y ?? 0) + pinDy }]
  })) as Record<string, Position>
  const validInput = Number.isFinite(targetNm) && targetNm > 0 && Number.isFinite(siteWidth) && siteWidth > 0
    && Number.isFinite(rowHeight) && rowHeight > 0 && Number.isInteger(siteDelta) && Number.isFinite(pinDx) && Number.isFinite(pinDy)
  const runBatch = () => {
    if (!validInput) return
    setBatchResults(selectedNames.map(name => transformCell(name, cellsByName[name], sourceSiteWidth(libId), libraryRowHeight, siteWidth, rowHeight, siteDelta, pinDx, pinDy)))
  }
  const toggleCell = (name: string) => {
    setSelectedNames(current => current.includes(name) ? current.filter(item => item !== name) : [...current, name])
    setBatchResults(null)
  }
  const downloadResults = () => {
    if (!batchResults) return
    const payload = { kind: 'virtual-lef-batch', verified: false, sourcePdk: 'sky130A', sourceLibrary: libId,
      targetNodeNm: targetNm, conditions: { siteWidth, rowHeight, siteDelta, pinOffsetPercent: [pinDx, pinDy] }, cells: batchResults }
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `virtual-pdk-${libId}-${targetNm}nm.json`
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  const setCondition = (setter: (value: number) => void) => (value: number) => { setter(value); setBatchResults(null) }
  const inputStyle = { width: 95, padding: '6px 8px', border: '1px solid var(--border-strong)', borderRadius: 5, background: 'var(--surface-1)', color: 'var(--text-primary)' }
  const field = (label: string, value: number, setter: (v: number) => void, step: number, min?: number) =>
    <label style={{ display: 'grid', gap: 4, fontSize: 12 }}><span>{label}</span><input type="number" value={value} step={step} min={min} onChange={e => setter(Number(e.target.value))} style={inputStyle}/></label>

  return <section className="card">
    <div className="card-title"><div><small className="kicker">가상 LEF 실험 · 제조 검증 아님</small><h2>PDK 변경 실험</h2></div><button type="button" onClick={onOpenLibrary}>원본 라이브러리 보기</button></div>
    <p className="chip-note" style={{ marginBottom: 12 }}>설치된 {libId} 셀의 LEF 외곽과 핀을 출발점으로 새 공정의 배치 형상을 가정합니다. 목표 공정의 실제 PDK·Liberty·GDS는 연결하지 않으므로 타이밍, 전력, DRC, LVS 결과를 예측하거나 통과로 판정하지 않습니다.</p>
    <div className="card" style={{ padding: 12, marginBottom: 14 }}>
      <b>기존 배치를 활용한 셀 내부 P&R</b>
      <p className="chip-note" style={{ margin: '8px 0' }}>기존 셀의 소자 배치와 내부 배선을 새 공정 설계의 시작점으로 재사용할 수 있습니다. 복잡한 셀은 새 간격·핀 접근성·배선 충돌에 맞춰 재배치와 재배선이 필요할 수 있습니다.</p>
      <p className="chip-note" style={{ margin: 0 }}><b>현재 기능은 변경 초안만 생성하며 셀 내부 P&R은 실행하지 않습니다.</b> 실제 90 nm 셀의 P&R 결과로 인정하려면 변경된 내부 형상을 GDS로 만들고, 목표 90 nm PDK의 설계 규칙으로 DRC를 통과해야 합니다. 연결 일치 여부는 LVS로 별도 검증해야 합니다. 목표 PDK가 없는 상태에서는 통과 여부를 판정할 수 없습니다.</p>
    </div>
    <div className="data-table" style={{ marginBottom: 14 }}><table><thead><tr><th>여기서 직접 변경 가능한 조건</th><th>화면에 반영되는 내용</th></tr></thead><tbody>
      <tr><td>적용 대상 셀</td><td>현재 라이브러리의 전체 셀 또는 직접 체크한 일부 셀</td></tr>
      <tr><td>목표 노드 표기 (nm)</td><td>130 nm 원본 대비 초기 site 폭·행 높이 비율을 즉시 다시 제안</td></tr>
      <tr><td>가상 site 폭 (µm)</td><td>셀의 한 칸 폭과 전체 가로 크기</td></tr>
      <tr><td>셀별 site 수 증감</td><td>선택한 모든 셀의 원본 site 수에 같은 정수 값을 더함</td></tr>
      <tr><td>가상 행 높이 (µm)</td><td>모든 셀의 한 행 높이. 원본이 여러 행이면 그 수를 유지</td></tr>
      <tr><td>신호 핀 X·Y 이동 (%)</td><td>모든 신호 핀을 같은 비율로 이동하고 셀 밖 이탈을 검사</td></tr>
    </tbody></table></div>
    <p className="chip-note" style={{ marginBottom: 14 }}>공정 코너(TT/SS/FF), 전압, 온도, 층별 폭·간격, 트랜지스터 형상은 현재 계산 모델이 없어 선택 항목으로 제공하지 않습니다. 핀 도형 크기는 셀 크기에 맞춰 함께 늘거나 줄지만 직접 편집하지 않습니다.</p>
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'end', gap: 12, marginBottom: 14 }}>
      <label style={{ display: 'grid', gap: 4, fontSize: 12 }}><span>원본 셀 · {libId}</span><select value={availableCells.includes(cellName) ? cellName : ''} onChange={e => onSelectCell(e.target.value)} style={{ ...inputStyle, width: 210 }}>
        {!availableCells.includes(cellName) && <option value="">셀을 선택하세요</option>}
        {availableCells.map(name => <option key={name} value={name}>{name}</option>)}
      </select></label>
      {field('목표 노드 표기 (nm)', targetNm, changeTargetNode, 1, 1)}
      <button type="button" onClick={suggestDimensions} disabled={targetNm <= 0}>초기값으로 재설정</button>
    </div>
    {!cell && <p className="chip-note">원본 셀 데이터를 불러오는 중입니다.</p>}
    {cell && !sourceSize && <p className="chip-note">이 셀에는 LEF 크기 정보가 없어 형상을 실험할 수 없습니다.</p>}
    {sourceSize && <>
      <p className="chip-note" style={{ marginBottom: 12 }}>초기값은 {targetNm}/130의 단순 비율로 만든 편집 시작점입니다. 공정 이름의 숫자가 실제 도형 배율을 뜻하지 않으며, 아래 값을 직접 조정할 수 있습니다.</p>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'end', gap: 12, marginBottom: 14 }}>
        {field('가상 site 폭 (µm)', siteWidth, setCondition(setSiteWidth), 0.001, 0.001)}
        {field('site 수 증감 (전체)', siteDelta, setCondition(setSiteDelta), 1)}
        {field('가상 행 높이 (µm)', rowHeight, setCondition(setRowHeight), 0.001, 0.001)}
        {field('핀 X 이동 (%)', pinDx, setCondition(setPinDx), 1)}
        {field('핀 Y 이동 (%)', pinDy, setCondition(setPinDy), 1)}
        <span className="chip-note">선택 셀 목표 크기: <b>{targetSize ? `${targetSize[0]} × ${targetSize[1]} µm` : '치수를 확인하세요'}</b></span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))', gap: 12 }}>
        <GeometryPreview title={`원본 · ${libId}__${cellName}`} size={sourceSize} pins={pins}/>
        {targetSize ? <GeometryPreview title={`가상 · ${targetNm} nm`} size={targetSize} pins={pins} sourceSize={sourceSize} positions={positions}/>
          : <div className="card" style={{ padding: 12 }}>양수 site 폭·행 높이와 유효한 site 수 증감을 입력하세요.</div>}
      </div>
      <div className="data-table" style={{ marginTop: 14, maxHeight: 240 }}>
        <table><thead><tr><th>신호 핀</th><th>원본 중심 (µm)</th><th>가상 중심 (µm)</th></tr></thead><tbody>
          {signalPins.map(pin => {
            const original = pinCenter(pin, sourceSize)!
            const current = positions[pin.n]
            return <tr key={pin.n}><td><code>{pin.n}</code></td>
              <td>{round(original.x / 100 * sourceSize[0], 2)}, {round(original.y / 100 * sourceSize[1], 2)}</td>
              <td>{targetSize ? `${round(current.x / 100 * targetSize[0], 2)}, ${round(current.y / 100 * targetSize[1], 2)}` : '—'}</td></tr>
          })}
        </tbody></table>
      </div>
      {!!focused?.outsidePins.length && <p className="init-error" style={{ marginTop: 10 }}>선택 셀에서 외곽을 벗어난 핀: {focused.outsidePins.join(', ')}.</p>}
    </>}
    <div className="card" style={{ padding: 12, marginTop: 14 }}>
      <b style={{ fontSize: 12 }}>일괄 변경 대상 · {selectedNames.length}/{availableCells.length}셀</b>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, margin: '8px 0' }}>
        <button type="button" onClick={() => { setSelectedNames(availableCells.filter(name => cellsByName[name]?.info.size)); setBatchResults(null) }}>전체 선택</button>
        <button type="button" onClick={() => { setSelectedNames(cell ? [cellName] : []); setBatchResults(null) }}>현재 셀만</button>
        <button type="button" onClick={() => { setSelectedNames([]); setBatchResults(null) }}>선택 해제</button>
        <input aria-label="셀 목록 검색" value={cellFilter} onChange={e => setCellFilter(e.target.value)} placeholder="셀 이름 검색" style={{ ...inputStyle, width: 150 }}/>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, maxHeight: 150, overflow: 'auto', padding: 4 }}>
        {availableCells.filter(name => name.toLowerCase().includes(cellFilter.toLowerCase())).map(name =>
          <label key={name} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '3px 6px', border: '1px solid var(--border)', borderRadius: 5, fontSize: 11 }}>
            <input type="checkbox" checked={selectedNames.includes(name)} onChange={() => toggleCell(name)}/>{name}
          </label>)}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginTop: 10 }}>
        <button type="button" onClick={runBatch} disabled={!validInput || selectedNames.length === 0}>선택 셀 일괄 적용</button>
        <span className="chip-note">PDK 원본 파일은 수정하지 않고, 가상 LEF 치수·핀 위치를 메모리에서 계산합니다.</span>
      </div>
    </div>
    {batchResults && <div className="card" style={{ padding: 12, marginTop: 14 }}>
      <div className="card-title"><div><small className="kicker">가상 변경 결과</small><h3>{batchResults.length}셀 처리 · 초안 {batchResults.filter(r => r.status === '초안 생성').length} · 핀 이탈 {batchResults.filter(r => r.status === '핀 이탈').length} · 치수 문제 {batchResults.filter(r => r.status === '치수 오류' || r.status === '크기 없음').length}</h3></div>
        <button type="button" onClick={downloadResults}>결과 JSON 저장</button></div>
      <div className="data-table" style={{ maxHeight: 360 }}><table><thead><tr><th>셀</th><th>원본 (µm)</th><th>가상 (µm)</th><th>site×행</th><th>형상 검사</th></tr></thead><tbody>
        {[...batchResults].sort((a, b) => a.status.localeCompare(b.status)).map(r => <tr key={r.name} onClick={() => onSelectCell(r.name)} style={{ cursor: 'pointer' }}>
          <td><code>{r.name}</code></td><td>{r.source?.join(' × ') ?? '—'}</td><td>{r.target?.join(' × ') ?? '—'}</td><td>{r.target ? `${r.sites} × ${r.rows}` : '—'}</td>
          <td>{r.status}{r.outsidePins.length ? ` (${r.outsidePins.join(', ')})` : ''}</td></tr>)}
      </tbody></table></div>
    </div>}
    <p className="chip-note" style={{ marginTop: 12 }}><b>현재 판정: 가상·미검증, 셀 내부 P&R 미실행.</b> 초안 생성은 셀 크기와 핀 외곽만 계산되었다는 뜻입니다. 실제 이식은 변경 GDS와 목표 90 nm PDK 기준 DRC 통과가 필요하며, LVS·PVT도 별도 검증해야 합니다.</p>
  </section>
}
