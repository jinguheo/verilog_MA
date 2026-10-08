// 여러 standard cell을 한 줄(row)에 놓고 내부 넷을 met1로 배선하는 후보군 실험.
//  · 복잡한 standard cell(2~5셀): 배치 가짓수가 최대 31만이라 전수 탐색으로 정확한 최적을 구한다.
//  · 더 복잡한 standard cell(6~10셀): 가짓수가 천만~수십조라 SA(simulated annealing)로 찾는다(6셀은 전수로 검증 가능).
// 2셀 실험과 같은 가상 규칙·비용 모델이다. 배치 = 셀 순서 × 셀별 N/FN × 간격 0..2 site, 각 2핀 넷은 가장 좋은
// met1 트랙 하나로 배선(핀 → 트랙이 핀 도형을 벗어날 때만 수직 이동 → 트랙 → 핀), 넷끼리는 독립(같은 트랙 공유
// 충돌은 검사하지 않음). 셀과 핀 이름은 전부 실제 sky130_fd_sc_hd이고, 클록·전원·외부 입력은 넷에 넣지 않았다.
import { useEffect, useMemo, useRef, useState } from 'react'
import PlacementMethodsExplainer from './PlacementMethodsExplainer'
import SubsetDpExplainer from './SubsetDpExplainer'

type Rect = [string, number, number, number, number]
type Pin = { n: string; use: string; rects: Rect[] }
type SourceCell = { devices: unknown[]; info: { size: [number, number] | null; pins: Pin[] } }
type SourceData = Record<string, SourceCell>
export type SaRules = { site: number; row: number; m1Pitch: number; m1Width: number; railHalf: number }
export type SaWeights = { bend: number; vertical: number; area: number }

const SOURCE_SITE = 0.46
const MAX_GAP = 2
const MAX_EXHAUSTIVE_N = 6
const round = (n: number) => Number(n.toFixed(3))
const fmtN = (n: number) => n.toLocaleString()
const fmtBig = (x: number) => { if (x < 1e15) return x.toLocaleString(); const e = Math.floor(Math.log10(x)); return `${(x / 10 ** e).toFixed(2)}×10^${e}` }

type Inst = { name: string; cell: string }
type NetDef = { name: string; from: [number, string]; to: [number, string] }
export type Circuit = { id: string; tier: 1 | 2 | 3; label: string; fn: string; insts: Inst[]; nets: NetDef[] }

// "u.PIN>v.PIN" 한 줄이 드라이버 → 싱크 2핀 넷 하나다. 팬아웃은 같은 드라이버에서 여러 줄로 쓴다.
function circuit(id: string, tier: 1 | 2 | 3, label: string, fn: string, cells: string[], edges: string[]): Circuit {
  const insts = cells.map(s => { const [name, cell] = s.split('='); return { name, cell } })
  const idx = new Map(insts.map((x, i) => [x.name, i] as const))
  const nets = edges.map((e, k) => {
    const [a, b] = e.split('>'), [an, ap] = a.split('.'), [bn, bp] = b.split('.')
    const s = idx.get(an), d = idx.get(bn)
    if (s === undefined || d === undefined) throw new Error(`${id}: bad net ${e}`)
    return { name: `n${k + 1}`, from: [s, ap] as [number, string], to: [d, bp] as [number, string] }
  })
  return { id, tier, label, fn, insts, nets }
}

// 기존 고정 10셀 회로 — 시간 분석 표(n개 앞부분만 쓰는 방식)와 후보 "혼합 로직 10셀"이 같이 쓴다.
const INSTS: Inst[] = [
  { name: 'u0', cell: 'nand2_1' }, { name: 'u1', cell: 'inv_1' }, { name: 'u2', cell: 'mux2_1' }, { name: 'u3', cell: 'and2_1' },
  { name: 'u4', cell: 'xor2_1' }, { name: 'u5', cell: 'nor2_1' }, { name: 'u6', cell: 'or2_1' }, { name: 'u7', cell: 'a21oi_1' },
  { name: 'u8', cell: 'buf_1' }, { name: 'u9', cell: 'nand2_1' },
]
const NETS: NetDef[] = [
  { name: 'n1', from: [0, 'Y'], to: [1, 'A'] }, { name: 'n2', from: [1, 'Y'], to: [2, 'A0'] }, { name: 'n3', from: [0, 'Y'], to: [2, 'S'] },
  { name: 'n4', from: [2, 'X'], to: [3, 'A'] }, { name: 'n5', from: [1, 'Y'], to: [3, 'B'] }, { name: 'n6', from: [3, 'X'], to: [4, 'A'] },
  { name: 'n7', from: [2, 'X'], to: [4, 'B'] }, { name: 'n8', from: [4, 'X'], to: [5, 'A'] }, { name: 'n9', from: [0, 'Y'], to: [5, 'B'] },
  { name: 'n10', from: [5, 'Y'], to: [6, 'A'] }, { name: 'n11', from: [3, 'X'], to: [6, 'B'] }, { name: 'n12', from: [6, 'X'], to: [7, 'A1'] },
  { name: 'n13', from: [4, 'X'], to: [7, 'B1'] }, { name: 'n14', from: [7, 'Y'], to: [8, 'A'] }, { name: 'n15', from: [8, 'X'], to: [9, 'A'] },
  { name: 'n16', from: [5, 'Y'], to: [9, 'B'] },
]
const demoCircuit = (n: number): Circuit => ({ id: `demo${n}`, tier: n <= 5 ? 1 : 2, label: `데모 ${n}셀`, fn: '', insts: INSTS.slice(0, n), nets: NETS.filter(e => e.from[0] < n && e.to[0] < n) })

// ---- 반복 구조 회로 생성기 (3단계 후보) ----
const range = (k: number) => Array.from({ length: k }, (_, i) => i)
const faCells = (i: number) => [`p${i}=xor2_1`, `s${i}=xor2_1`, `g${i}=and2_1`, `c${i}=and2_1`, `k${i}=or2_1`]
const faEdges = (i: number) => [`p${i}.X>s${i}.A`, `p${i}.X>c${i}.A`, `g${i}.X>k${i}.A`, `c${i}.X>k${i}.B`, ...(i > 0 ? [`k${i - 1}.X>s${i}.B`, `k${i - 1}.X>c${i}.B`] : [])]
const adder = (bits: number) => ({ cells: range(bits).flatMap(faCells), edges: range(bits).flatMap(faEdges) })
function adderReg(bits: number): [string[], string[]] {
  const a = adder(bits)
  return [[...a.cells, ...range(bits).map(i => `q${i}=dfxtp_1`)], [...a.edges, ...range(bits).map(i => `s${i}.X>q${i}.D`)]]
}
// N비트 동기 카운터: DFF N개 + 반전 1 + 토글 XOR (N-1) + 캐리 AND (N-2) + 상위 비트 출력 버퍼 bufs개
function counterN(bits: number, bufs = 0): [string[], string[]] {
  const cells = [...range(bits).map(i => `d${i}=dfxtp_1`), 'i0=inv_1', ...range(bits - 1).map(i => `x${i + 1}=xor2_1`), ...range(bits - 2).map(i => `a${i + 1}=and2_1`), ...range(bufs).map(i => `b${i}=buf_1`)]
  const edges = ['d0.Q>i0.A', 'i0.Y>d0.D', 'd0.Q>x1.B', 'd0.Q>a1.A', 'd1.Q>x1.A', 'd1.Q>a1.B', 'x1.X>d1.D']
  for (let j = 2; j <= bits - 1; j++) {
    edges.push(`a${j - 1}.X>x${j}.B`, `d${j}.Q>x${j}.A`, `x${j}.X>d${j}.D`)
    if (j <= bits - 2) edges.push(`a${j - 1}.X>a${j}.A`, `d${j}.Q>a${j}.B`)
  }
  range(bufs).forEach(i => edges.push(`d${bits - 1 - i}.Q>b${i}.A`))
  return [cells, edges]
}
function regPar8(): [string[], string[]] {
  const cells = [...range(8).map(i => `m${i}=mux2_1`), ...range(8).map(i => `q${i}=dfxtp_1`), ...range(4).map(i => `xl${i}=xor2_1`), 'xm0=xor2_1', 'xm1=xor2_1', 'xz=xor2_1']
  const edges = [...range(8).flatMap(i => [`m${i}.X>q${i}.D`, `q${i}.Q>m${i}.A0`]), ...range(4).flatMap(k => [`q${2 * k}.Q>xl${k}.A`, `q${2 * k + 1}.Q>xl${k}.B`]),
    'xl0.X>xm0.A', 'xl1.X>xm0.B', 'xl2.X>xm1.A', 'xl3.X>xm1.B', 'xm0.X>xz.A', 'xm1.X>xz.B']
  return [cells, edges]
}
function alu(slices: number): [string[], string[]] {
  const cells = range(slices).flatMap(i => [`g${i}=and2_1`, `o${i}=or2_1`, `p${i}=xor2_1`, `s${i}=xor2_1`, `c${i}=and2_1`, `k${i}=or2_1`, `m${i}=mux4_1`, `q${i}=dfxtp_1`, `b${i}=buf_1`])
  const edges = range(slices).flatMap(i => [`p${i}.X>s${i}.A`, `p${i}.X>c${i}.A`, `p${i}.X>m${i}.A2`, `g${i}.X>m${i}.A0`, `g${i}.X>k${i}.A`, `o${i}.X>m${i}.A1`, `c${i}.X>k${i}.B`, `s${i}.X>m${i}.A3`, `m${i}.X>q${i}.D`, `q${i}.Q>b${i}.A`,
    ...(i > 0 ? [`k${i - 1}.X>s${i}.B`, `k${i - 1}.X>c${i}.B`] : [])])
  return [cells, edges]
}

// ---- 후보군: 1단계 = 2~5셀(전수 탐색), 2단계 = 6~10셀(SA), 3단계 = 20~50셀(SA) ----
export const CANDIDATES: Circuit[] = [
  circuit('mux_and', 1, 'MUX2 → AND2', '위쪽 2셀 실험과 같은 쌍 — S로 고른 값을 AND2의 B에 연결', ['m=mux2_1', 'a=and2_1'], ['m.X>a.B']),
  circuit('toggle', 1, '토글 F/F (XOR + DFF)', 'Q를 반전해 다시 D로 — 클록마다 출력이 뒤집힘', ['x=xor2_1', 'q=dfxtp_1'], ['x.X>q.D', 'q.Q>x.A']),
  circuit('en_reg', 1, '인에이블 레지스터 (MUX2 + DFF)', 'EN=0이면 Q를 되먹임해 값 유지, EN=1이면 새 값 저장', ['m=mux2_1', 'q=dfxtp_1'], ['m.X>q.D', 'q.Q>m.A0']),
  circuit('ha_fa', 1, '반가산기 2개 + OR (3셀)', '반가산기 둘과 OR로 만든 전가산기', ['h0=ha_1', 'h1=ha_1', 'o=or2_1'], ['h0.SUM>h1.A', 'h0.COUT>o.A', 'h1.COUT>o.B']),
  circuit('aoi_oai', 1, 'AOI 2개 → OAI → 인버터 (4셀)', 'AND-OR-INVERT 두 개의 결과를 OAI로 합친 뒤 반전', ['a=a21oi_1', 'b=a21oi_1', 'o=o21ai_1', 'i=inv_1'], ['a.Y>o.A1', 'b.Y>o.A2', 'o.Y>i.A']),
  circuit('eq2', 1, '2비트 동등 비교기 (4셀)', '두 비트가 모두 같을 때만 1 — XNOR 둘을 AND하고 반전', ['x1=xnor2_1', 'x0=xnor2_1', 'a=and2_1', 'i=inv_1'], ['x1.Y>a.A', 'x0.Y>a.B', 'a.X>i.A']),
  circuit('mux4', 1, '4:1 MUX + 출력 버퍼 (4셀)', 'mux2 세 개를 트리로 묶어 4입력 선택, 출력 버퍼', ['m0=mux2_1', 'm1=mux2_1', 'm2=mux2_1', 'b=buf_1'], ['m0.X>m2.A0', 'm1.X>m2.A1', 'm2.X>b.A']),
  circuit('fa5', 1, '전가산기 (XOR·AND·OR 게이트 5셀)', 'SUM = A⊕B⊕CIN, COUT = A·B + (A⊕B)·CIN 을 기본 게이트로 구성', ['p=xor2_1', 's=xor2_1', 'g=and2_1', 'c=and2_1', 'o=or2_1'], ['p.X>s.A', 'p.X>c.A', 'g.X>o.A', 'c.X>o.B']),

  circuit('dec24', 2, '2→4 디코더 + 인에이블 (6셀)', '입력 두 비트와 EN으로 4개 출력 중 하나만 1 — 반전 신호 둘이 AND3 셋과 NOR3 하나(EN 반전은 외부 입력)로 퍼짐', ['n0=inv_1', 'n1=inv_1', 'y0=and3_1', 'y1=and3_1', 'y2=and3_1', 'y3=nor3_1'], ['n1.Y>y0.A', 'n0.Y>y0.B', 'n1.Y>y1.A', 'n0.Y>y2.B', 'n1.Y>y3.A', 'n0.Y>y3.B']),
  circuit('xor8', 2, '8입력 XOR 패리티 트리 (7셀)', '8비트 패리티 — xor2를 3단 트리로 연결', ['x0=xor2_1', 'x1=xor2_1', 'x2=xor2_1', 'x3=xor2_1', 'y0=xor2_1', 'y1=xor2_1', 'z=xor2_1'],
    ['x0.X>y0.A', 'x1.X>y0.B', 'x2.X>y1.A', 'x3.X>y1.B', 'y0.X>z.A', 'y1.X>z.B']),
  circuit('alu1', 2, '1비트 ALU 슬라이스 + 출력 레지스터 (9셀)', 'AND·OR·XOR·덧셈 중 mux4로 고르고 DFF에 저장, 버퍼로 출력', ['g=and2_1', 'o=or2_1', 'p=xor2_1', 's=xor2_1', 'c=and2_1', 'k=or2_1', 'm=mux4_1', 'q=dfxtp_1', 'b=buf_1'],
    ['p.X>s.A', 'p.X>c.A', 'p.X>m.A2', 'g.X>m.A0', 'g.X>k.A', 'o.X>m.A1', 'c.X>k.B', 's.X>m.A3', 'm.X>q.D', 'q.Q>b.A']),
  circuit('add2', 2, '2비트 리플 캐리 가산기 (10셀)', '전가산기(XOR 2·AND 2·OR 1) 두 개를 캐리로 연결', ['p0=xor2_1', 's0=xor2_1', 'g0=and2_1', 'c0=and2_1', 'k1=or2_1', 'p1=xor2_1', 's1=xor2_1', 'g1=and2_1', 'c1=and2_1', 'k2=or2_1'],
    ['p0.X>s0.A', 'p0.X>c0.A', 'g0.X>k1.A', 'c0.X>k1.B', 'k1.X>s1.B', 'k1.X>c1.B', 'p1.X>s1.A', 'p1.X>c1.A', 'g1.X>k2.A', 'c1.X>k2.B']),
  circuit('cnt4', 2, '4비트 동기 카운터 (10셀)', 'DFF 4개 + 비트별 토글 조건(XOR)과 캐리(AND) — Q가 여러 곳으로 퍼지는 되먹임 구조', ['d0=dfxtp_1', 'd1=dfxtp_1', 'd2=dfxtp_1', 'd3=dfxtp_1', 'i0=inv_1', 'x1=xor2_1', 'x2=xor2_1', 'x3=xor2_1', 'a1=and2_1', 'a2=and2_1'],
    ['d0.Q>i0.A', 'i0.Y>d0.D', 'd0.Q>x1.B', 'd0.Q>a1.A', 'd1.Q>x1.A', 'd1.Q>a1.B', 'x1.X>d1.D', 'a1.X>x2.B', 'a1.X>a2.A', 'd2.Q>x2.A', 'd2.Q>a2.B', 'x2.X>d2.D', 'a2.X>x3.B', 'd3.Q>x3.A', 'x3.X>d3.D']),
  { id: 'mixed10', tier: 2, label: '혼합 로직 10셀 (기존 데모)', fn: 'NAND·INV·MUX·AND·XOR·NOR·OR·AOI·BUF를 섞은 고정 회로(넷 16개)', insts: INSTS, nets: NETS },
  // ---- 크기별 비교용 후보: 2단계 8·9·10셀, 3단계 20·30·40셀 (같은 크기를 구조가 다른 후보로 2개 이상) ----
  circuit('mux8', 2, '8:1 MUX 트리 + 출력 버퍼 (8셀)', 'mux2 7개를 3단 트리로 묶어 8입력 중 하나 선택, 출력 버퍼', ['m0=mux2_1', 'm1=mux2_1', 'm2=mux2_1', 'm3=mux2_1', 'n0=mux2_1', 'n1=mux2_1', 'o=mux2_1', 'b=buf_1'],
    ['m0.X>n0.A0', 'm1.X>n0.A1', 'm2.X>n1.A0', 'm3.X>n1.A1', 'n0.X>o.A0', 'n1.X>o.A1', 'o.X>b.A']),
  circuit('cmp2', 2, '2비트 크기 비교기 A>B / A≤B (8셀)', 'A>B = a1·~b1 + (a1 XNOR b1)·a0·~b0, 마지막 인버터로 A≤B', ['i1=inv_1', 'i0=inv_1', 't1=and2_1', 't0=and2_1', 'e1=xnor2_1', 't2=and2_1', 'gt=or2_1', 'ng=inv_1'],
    ['i1.Y>t1.B', 'i0.Y>t0.B', 't0.X>t2.B', 'e1.Y>t2.A', 't1.X>gt.A', 't2.X>gt.B', 'gt.X>ng.A']),
  circuit('cnt3tc', 2, '3비트 카운터 + 터미널 카운트 감지 (9셀)', 'DFF 3개 카운터에 Q0·Q1·Q2가 모두 1일 때를 AND3로 감지하고 버퍼로 출력', ['d0=dfxtp_1', 'd1=dfxtp_1', 'd2=dfxtp_1', 'i0=inv_1', 'x1=xor2_1', 'x2=xor2_1', 'a1=and2_1', 't=and3_1', 'b=buf_1'],
    ['d0.Q>i0.A', 'i0.Y>d0.D', 'd0.Q>x1.B', 'd0.Q>a1.A', 'd1.Q>x1.A', 'd1.Q>a1.B', 'x1.X>d1.D', 'a1.X>x2.B', 'd2.Q>x2.A', 'x2.X>d2.D', 'd0.Q>t.A', 'd1.Q>t.B', 'd2.Q>t.C', 't.X>b.A']),

  circuit('add4', 3, '4비트 리플 캐리 가산기 (20셀)', '게이트 수준 전가산기(XOR 2·AND 2·OR 1) 4개를 캐리로 연결 — 같은 구조가 4번 반복', adder(4).cells, adder(4).edges),
  circuit('cnt8', 3, '8비트 동기 카운터 (22셀)', 'DFF 8개 + 비트별 토글(XOR)과 캐리 체인(AND) — Q가 여러 곳으로 퍼지는 되먹임이 8비트로 확장', ...counterN(8)),
  circuit('regpar8', 3, '8비트 인에이블 레지스터 + 패리티 (23셀)', 'MUX2+DFF 8쌍으로 값을 유지하고, 8개 Q를 XOR 트리 3단(7개)으로 합쳐 패리티 생성', ...regPar8()),
  circuit('alu4', 3, '4비트 ALU (슬라이스 ×4, 36셀)', 'AND·OR·XOR·덧셈을 mux4로 고르는 1비트 슬라이스 9셀 × 4, 캐리로 연결, 슬라이스마다 출력 레지스터·버퍼', ...alu(4)),
  circuit('add8', 3, '8비트 리플 캐리 가산기 (40셀)', '게이트 수준 전가산기 8개를 캐리 체인으로 연결 — 캐리가 맨 끝까지 이어지는 긴 의존 구조', adder(8).cells, adder(8).edges),
  circuit('add8reg', 3, '8비트 가산기 + 출력 레지스터 (48셀)', '8비트 가산기(40셀)의 합 8비트를 DFF 8개에 저장 — 가산기 40셀 + DFF 8셀', ...adderReg(8)),
  circuit('cnt6buf', 3, '6비트 카운터 + 상위 4비트 출력 버퍼 (20셀)', '6비트 동기 카운터(DFF 6·XOR 5·AND 4·INV 1)에 상위 4비트 Q 버퍼 4개', ...counterN(6, 4)),
  circuit('add6', 3, '6비트 리플 캐리 가산기 (30셀)', '게이트 수준 전가산기 6개를 캐리 체인으로 연결', adder(6).cells, adder(6).edges),
  circuit('cnt10buf', 3, '10비트 카운터 + 상위 2비트 출력 버퍼 (30셀)', '10비트 동기 카운터(DFF 10·XOR 9·AND 8·INV 1)에 상위 2비트 Q 버퍼 2개', ...counterN(10, 2)),
  circuit('cnt12buf', 3, '12비트 카운터 + 상위 6비트 출력 버퍼 (40셀)', '12비트 동기 카운터(DFF 12·XOR 11·AND 10·INV 1)에 상위 6비트 Q 버퍼 6개', ...counterN(12, 6)),
]
const TIER_INFO = {
  1: { title: '복잡한 standard cell · 2~5셀', how: '전수 탐색', desc: '배치 가짓수가 24 ~ 311,040가지라 전부 평가해 정확한 최적을 구합니다.' },
  2: { title: '더 복잡한 standard cell · 6~10셀', how: 'SA', desc: '가짓수가 천만 ~ 수십조라 전수 탐색이 어렵습니다. SA로 찾고, 6셀은 전수 탐색으로 정답과 대조할 수 있습니다.' },
  3: { title: '매우 복잡한 standard cell · 20~50셀', how: 'SA', desc: '가짓수가 10^18 ~ 10^100 이상이라 전수 탐색은 불가능하고, 검증할 정답도 없습니다. 같은 SA 규칙(단계당 이동 40n)을 그대로 쓰며, 서로 다른 seed가 같은 답에 모이는지로 신뢰를 가늠합니다.' },
} as const

// 후보 회로가 실제 셀 데이터와 맞는지(셀·핀·핀 도형 존재) 점검한다. 문제가 없으면 null.
export function circuitIssue(data: SourceData, c: Circuit): string | null {
  for (const i of c.insts) if (!data[i.cell]?.info.size) return `${i.name}=${i.cell} 셀 데이터가 없음`
  for (const e of c.nets) for (const [k, pin] of [e.from, e.to] as const) {
    if (!data[c.insts[k].cell].info.pins.find(p => p.n === pin)?.rects.length) return `${c.insts[k].name}.${pin} 핀 도형이 없음 (${e.name})`
  }
  return null
}

const NET_COLORS = ['#b45f06', '#7F77DD', '#1D9E75', '#c0392b', '#378ADD', '#C0A02B', '#8e44ad', '#16a085']

type NRect = { cx: number; y1: number; y2: number } // normalised to the cell (0..1)
type Ctx = {
  n: number; insts: Inst[]; sites: number[]; W: number[]; nets: { name: string; s: number; d: number; sr: NRect[]; dr: NRect[] }[]
  tracks: number[]; rules: SaRules; w: SaWeights
}
type State = { order: number[]; flip: boolean[]; gaps: number[] }
type Route = { net: string; ax: number; ay: number; bx: number; by: number; t: number }

function met1Tracks(r: SaRules): number[] {
  const out: number[] = []
  if (r.m1Pitch <= r.m1Width) return out
  const clear = r.railHalf + (r.m1Pitch - r.m1Width)
  for (let y = r.m1Pitch / 2; y < r.row; y += r.m1Pitch) if (y - r.m1Width / 2 >= clear - 1e-9 && y + r.m1Width / 2 <= r.row - clear + 1e-9) out.push(round(y))
  return out
}

function buildCtx(data: SourceData, c: Circuit, rules: SaRules, w: SaWeights): Ctx | null {
  if (circuitIssue(data, c)) return null
  const norm = (cell: SourceCell, pin: string): NRect[] => {
    const [cw, ch] = cell.info.size!
    return (cell.info.pins.find(p => p.n === pin)?.rects ?? []).map(r => ({ cx: (r[1] + r[3]) / 2 / cw, y1: r[2] / ch, y2: r[4] / ch }))
  }
  const sites = c.insts.map(i => Math.round(data[i.cell].info.size![0] / SOURCE_SITE))
  const nets = c.nets.map(e => ({ name: e.name, s: e.from[0], d: e.to[0],
    sr: norm(data[c.insts[e.from[0]].cell], e.from[1]), dr: norm(data[c.insts[e.to[0]].cell], e.to[1]) }))
  return { n: c.insts.length, insts: c.insts, sites, W: sites.map(s => s * rules.site), nets, tracks: met1Tracks(rules), rules, w }
}

// Cost of one placement; when `routes` is given, also records each net's chosen route for drawing.
function evaluate(ctx: Ctx, st: State, X: number[], routes?: Route[]): number {
  const { n, W, rules, w, tracks } = ctx
  let x = 0
  for (let k = 0; k < n; k++) { const i = st.order[k]; X[i] = x; x += W[i] + (k < n - 1 ? st.gaps[k] * rules.site : 0) }
  let cost = w.area * x * rules.row
  if (!tracks.length) return Infinity
  for (const net of ctx.nets) {
    let best = Infinity, br: Route | null = null
    for (const a of net.sr) {
      const ax = X[net.s] + (st.flip[net.s] ? 1 - a.cx : a.cx) * W[net.s], ay1 = a.y1 * rules.row, ay2 = a.y2 * rules.row
      for (const b of net.dr) {
        const bx = X[net.d] + (st.flip[net.d] ? 1 - b.cx : b.cx) * W[net.d], by1 = b.y1 * rules.row, by2 = b.y2 * rules.row
        const h = Math.abs(ax - bx)
        for (const t of tracks) {
          const va = t < ay1 ? ay1 - t : t > ay2 ? t - ay2 : 0, vb = t < by1 ? by1 - t : t > by2 ? t - by2 : 0
          const segs = (va > 1e-6 ? 1 : 0) + (h > 1e-6 ? 1 : 0) + (vb > 1e-6 ? 1 : 0)
          const c = h + va + vb + w.bend * Math.max(0, segs - 1) + w.vertical * (va + vb)
          if (c < best) { best = c; if (routes) br = { net: net.name, ax, ay: Math.min(Math.max(t, ay1), ay2), bx, by: Math.min(Math.max(t, by1), by2), t } }
        }
      }
    }
    if (best === Infinity) return Infinity
    cost += best
    if (routes && br) routes.push(br)
  }
  return cost
}

function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}
const clone = (s: State): State => ({ order: [...s.order], flip: [...s.flip], gaps: [...s.gaps] })
const fact = (n: number): number => n <= 1 ? 1 : n * fact(n - 1)
const placementsOf = (n: number) => fact(n) * 2 ** n * (MAX_GAP + 1) ** Math.max(0, n - 1)

function permutations(n: number): number[][] {
  const out: number[][] = []
  const rec = (cur: number[], rest: number[]) => { if (!rest.length) { out.push(cur); return } rest.forEach((v, i) => rec([...cur, v], [...rest.slice(0, i), ...rest.slice(i + 1)])) }
  rec([], Array.from({ length: n }, (_, i) => i))
  return out
}

// One random neighbour: swap two cells, move one cell, mirror one cell, or widen/narrow one gap.
function neighbour(s: State, rnd: () => number): State {
  const t = clone(s), n = t.order.length
  const r = rnd()
  if (n > 1 && r < MOVE_P.swap) { const a = Math.floor(rnd() * n), b = Math.floor(rnd() * n); [t.order[a], t.order[b]] = [t.order[b], t.order[a]] }
  else if (n > 2 && r < MOVE_P.swap + MOVE_P.insert) { const a = Math.floor(rnd() * n), b = Math.floor(rnd() * n); const [v] = t.order.splice(a, 1); t.order.splice(b, 0, v) }
  else if (r < MOVE_P.swap + MOVE_P.insert + MOVE_P.flip || n < 2) { const i = Math.floor(rnd() * n); t.flip[i] = !t.flip[i] }
  else { const g = Math.floor(rnd() * (n - 1)); t.gaps[g] = Math.max(0, Math.min(MAX_GAP, t.gaps[g] + (rnd() < 0.5 ? -1 : 1))) }
  return t
}

// ---- SA가 아닌 방식: 스펙트럴 정렬 + 결정적 국소 개선 (무작위·온도·seed 없음) ----
export const ALT_WINDOW = 4 // 슬라이딩 윈도우 길이(윈도우 안 모든 순열을 시험)
export const ALT_MAX_PASSES = 40
export const ALT_POWER_ITERS = 20000
type AltResult = { state: State; ms: number; evals: number; passes: number }

// Fiedler 벡터(라플라시안 L = D − A 의 두 번째로 작은 고유벡터)를 거듭제곱법으로 구해 그 값 순서를 셀 순서로 쓴다.
function spectralOrder(ctx: Ctx): number[] {
  const n = ctx.n
  const adj: number[][] = Array.from({ length: n }, () => [])
  for (const e of ctx.nets) if (e.s !== e.d) { adj[e.s].push(e.d); adj[e.d].push(e.s) }
  const c = 2 * Math.max(1, ...adj.map(a => a.length)) + 1 // c·I − L 이 양의 준정부호가 되도록
  let v = Array.from({ length: n }, (_, i) => Math.sin(1.7 * i + 0.3)) // 고정 시작 벡터 → 항상 같은 결과
  for (let it = 0; it < ALT_POWER_ITERS; it++) {
    const mean = v.reduce((a, b) => a + b, 0) / n // 상수 벡터(고유값 0) 성분을 제거해 두 번째 고유벡터로 수렴
    const u = v.map(x => x - mean)
    const w = u.map((x, i) => (c - adj[i].length) * x + adj[i].reduce((a, j) => a + u[j], 0))
    const norm = Math.hypot(...w) || 1
    v = w.map(x => x / norm)
  }
  return Array.from({ length: n }, (_, i) => i).sort((a, b) => v[a] - v[b] || a - b)
}

async function spectralRefine(ctx: Ctx, cancel: Cancel): Promise<AltResult | null> {
  const n = ctx.n, X = new Array(n).fill(0), EPS = 1e-9
  let evals = 0, busy = 0
  const cost = (st: State) => { evals++; return evaluate(ctx, st, X) }
  const winPerms = permutations(Math.min(ALT_WINDOW, n))
  let t0 = performance.now()
  const cur: State = { order: spectralOrder(ctx), flip: new Array(n).fill(false), gaps: new Array(Math.max(0, n - 1)).fill(0) }
  let curC = cost(cur), passes = 0
  for (; passes < ALT_MAX_PASSES; passes++) {
    const before = curC
    // (a) 셀마다 N ↔ FN
    for (let i = 0; i < n; i++) { cur.flip[i] = !cur.flip[i]; const c = cost(cur); if (c < curC - EPS) curC = c; else cur.flip[i] = !cur.flip[i] }
    // (b) 셀 하나를 빼서 모든 위치에 넣어 보고 가장 좋은 위치로
    for (let v = 0; v < n; v++) {
      const rest = cur.order.filter(x => x !== v)
      let bestP = -1, bestC = curC
      for (let p = 0; p < n; p++) {
        const order = [...rest.slice(0, p), v, ...rest.slice(p)]
        const c = cost({ order, flip: cur.flip, gaps: cur.gaps })
        if (c < bestC - EPS) { bestC = c; bestP = p }
      }
      if (bestP >= 0) { cur.order = [...rest.slice(0, bestP), v, ...rest.slice(bestP)]; curC = bestC }
    }
    // (c) 길이 ALT_WINDOW 윈도우를 밀며 윈도우 안 모든 순열 시험
    const k = Math.min(ALT_WINDOW, n)
    for (let a = 0; a + k <= n; a++) {
      const seg = cur.order.slice(a, a + k)
      let bestPerm: number[] | null = null, bestC = curC
      for (const perm of winPerms) {
        const order = [...cur.order.slice(0, a), ...perm.map(i => seg[i]), ...cur.order.slice(a + k)]
        const c = cost({ order, flip: cur.flip, gaps: cur.gaps })
        if (c < bestC - EPS) { bestC = c; bestPerm = order }
      }
      if (bestPerm) { cur.order = bestPerm; curC = bestC }
    }
    busy += performance.now() - t0
    if (curC >= before - EPS) { passes++; break }
    await new Promise(r => setTimeout(r, 0)) // 화면이 멈추지 않게 양보. 양보한 시간은 계산 시간에 넣지 않는다.
    if (cancel.current) return null
    t0 = performance.now()
  }
  return { state: cur, ms: busy, evals, passes }
}

// ---- 부분집합 DP: 순서·방향을 "왼쪽에 놓인 셀의 집합"만으로 정확히 푼다 (n! → 2ⁿ·n) ----
// 정확한 것은 '프록시 모델'에서다: 핀마다 x 위치 하나(넷이 쓸 핀 도형의 중심), 간격 0, 넷 비용 = |x 차이| + K.
// K = 위치와 무관한 수직 이동·굴곡 항(핀 도형·트랙만으로 정해짐). 실제 모델은 거리에 따라 핀 도형을 바꿔 고를 수 있어
// DP 해를 실제 모델로 다시 평가하면 프록시 값보다 같거나 작다. 그래서 DP는 "프록시 모델의 정확한 최적"이고 실제 최적의 근사다.
export const MAX_DP_N = 23 // 2ⁿ 상태 × (비용 8B + 부모 1B + 컷 1B) — 23셀에서 약 80MB
type ProxyNet = { s: number; d: number; ka: number; kb: number; K: number }
type DpResult = { state: State; summary: Summary; proxy: number; ms: number; states: number }
const dpCache = new Map<string, DpResult>() // 규칙·가중치가 같으면 DP는 항상 같은 답이라 탭을 오가도 다시 계산하지 않는다
const proxyCache = new WeakMap<Ctx, ProxyNet[]>()
function proxyNets(ctx: Ctx): ProxyNet[] {
  const hit = proxyCache.get(ctx); if (hit) return hit
  const { rules, w, tracks } = ctx
  const out = ctx.nets.map(net => {
    let bestK = Infinity, bestOff = Infinity, ka = 0.5, kb = 0.5
    for (const a of net.sr) for (const b of net.dr) for (const t of tracks) {
      const ay1 = a.y1 * rules.row, ay2 = a.y2 * rules.row, by1 = b.y1 * rules.row, by2 = b.y2 * rules.row
      const va = t < ay1 ? ay1 - t : t > ay2 ? t - ay2 : 0, vb = t < by1 ? by1 - t : t > by2 ? t - by2 : 0
      const segs = (va > 1e-6 ? 1 : 0) + 1 + (vb > 1e-6 ? 1 : 0)
      const K = va + vb + w.bend * Math.max(0, segs - 1) + w.vertical * (va + vb)
      const off = Math.abs(a.cx - 0.5) + Math.abs(b.cx - 0.5) // 같은 K면 셀 가운데에 가까운 핀 도형
      if (K < bestK - 1e-9 || (Math.abs(K - bestK) <= 1e-9 && off < bestOff)) { bestK = K; bestOff = off; ka = a.cx; kb = b.cx }
    }
    return { s: net.s, d: net.d, ka, kb, K: bestK }
  })
  proxyCache.set(ctx, out)
  return out
}
// 프록시 모델에서의 비용 — DP의 최적값과 같은 잣대로 SA·스펙트럴 해를 잴 때 쓴다(DP 값 이하일 수 없다).
function proxyOf(ctx: Ctx, st: State): number {
  const X = new Array(ctx.n).fill(0)
  let x = 0
  for (let k = 0; k < ctx.n; k++) { const i = st.order[k]; X[i] = x; x += ctx.W[i] + (k < ctx.n - 1 ? st.gaps[k] * ctx.rules.site : 0) }
  let c = ctx.w.area * x * ctx.rules.row
  for (const e of proxyNets(ctx)) {
    const pa = X[e.s] + (st.flip[e.s] ? 1 - e.ka : e.ka) * ctx.W[e.s], pb = X[e.d] + (st.flip[e.d] ? 1 - e.kb : e.kb) * ctx.W[e.d]
    c += Math.abs(pa - pb) + e.K
  }
  return c
}

async function subsetDp(ctx: Ctx, cancel: Cancel, onProgress?: (done: number, total: number) => void): Promise<DpResult | null> {
  const n = ctx.n
  if (n > MAX_DP_N || n < 1) return null
  const nets = proxyNets(ctx)
  // 셀마다 붙은 넷: 상대 셀과, 이 셀 쪽 핀의 정규화된 x(0..1, N 방향 기준)
  const inc: { u: number; cx: number }[][] = Array.from({ length: n }, () => [])
  for (const e of nets) { inc[e.s].push({ u: e.d, cx: e.ka }); inc[e.d].push({ u: e.s, cx: e.kb }) }
  const size = 2 ** n, full = size - 1
  const dp = new Float64Array(size).fill(Infinity), par = new Uint8Array(size), cut = new Uint8Array(size)
  dp[0] = 0
  const t0 = performance.now()
  let busy = 0, mark = performance.now()
  for (let S = 0; S < full; S++) {
    const base = dp[S], cS = cut[S]
    for (let v = 0; v < n; v++) {
      const bit = 1 << v
      if (S & bit) continue
      const Wv = ctx.W[v], list = inc[v]
      let c0 = 0, c1 = 0, degS = 0
      for (let k = 0; k < list.length; k++) {
        const { u, cx } = list[k], o0 = cx * Wv, o1 = Wv - o0 // 이 셀의 왼쪽 가장자리에서 핀까지: N = o0, FN = o1
        if (S & (1 << u)) { degS++; c0 += o0; c1 += o1 } // 상대가 이미 왼쪽 → 이 셀이 오른쪽 끝점: 왼쪽 가장자리~핀
        else { c0 += Wv - o0; c1 += Wv - o1 } // 상대가 아직 안 놓임 → 이 셀이 왼쪽 끝점: 핀~오른쪽 가장자리
      }
      const f = c1 < c0 ? 1 : 0 // 방향은 셀마다 독립적으로 최선을 고른다
      const total = base + (f ? c1 : c0) + Wv * (cS - degS) // cS − degS = 이 셀 위를 지나가는 넷 수
      const T = S | bit
      if (total < dp[T]) { dp[T] = total; par[T] = v | (f << 5) }
      cut[T] = cS + list.length - 2 * degS
    }
    if ((S & 0xFFFF) === 0xFFFF) {
      busy += performance.now() - mark
      onProgress?.(S, full)
      await new Promise(r => setTimeout(r, 0))
      if (cancel.current) return null
      mark = performance.now()
    }
  }
  busy += performance.now() - mark
  void t0
  const order: number[] = [], flip = new Array(n).fill(false)
  for (let T = full; T; ) { const p = par[T], v = p & 31; order.unshift(v); flip[v] = (p >> 5) === 1; T ^= 1 << v }
  const state: State = { order, flip, gaps: new Array(Math.max(0, n - 1)).fill(0) }
  const width = ctx.W.reduce((a, b) => a + b, 0)
  const proxy = dp[full] + ctx.w.area * width * ctx.rules.row + nets.reduce((a, e) => a + e.K, 0)
  return { state, summary: summarize(ctx, state), proxy, ms: busy, states: size }
}

export const SA_ALPHA = 0.93
export const SA_FINAL_RATIO = 1e-4
const SA_T0_ACCEPT = 0.8 // 시작 온도: 평균적인 '나빠지는 이동'을 이 확률로 받아들이도록 정한다
const MOVE_P = { swap: 0.35, insert: 0.2, flip: 0.3 } // 나머지(0.15)는 간격 ±1
export const saStages = () => Math.ceil(Math.log(SA_FINAL_RATIO) / Math.log(SA_ALPHA))
export const saMovesPerStage = (n: number) => Math.max(100, 40 * n)
export const saMoves = (n: number) => saStages() * saMovesPerStage(n)
export const netCount = (n: number) => NETS.filter(e => e.from[0] < n && e.to[0] < n).length
export { placementsOf }

let benchSink = 0
// Measured time to evaluate one placement (all of its nets routed on their best track), in µs.
function benchCtx(ctx: Ctx, samples = 500): number {
  const n = ctx.n
  const rnd = mulberry32(n * 104729)
  const X = new Array(n).fill(0)
  let st: State = { order: Array.from({ length: n }, (_, i) => i), flip: new Array(n).fill(false), gaps: new Array(Math.max(0, n - 1)).fill(0) }
  const states: State[] = []
  for (let i = 0; i < samples; i++) { st = neighbour(st, rnd); states.push(st) }
  let sink = 0
  for (const s of states) sink += evaluate(ctx, s, X) // JIT warm-up
  // repeat until at least 25 ms has elapsed so timer resolution and GC noise stay small
  let evals = 0
  const t0 = performance.now()
  while (performance.now() - t0 < 25) { for (const s of states) sink += evaluate(ctx, s, X); evals += states.length }
  const us = (performance.now() - t0) * 1000 / evals
  benchSink = sink // keep the loop observable so it is not optimised away
  return us
}
export function benchPlacement(data: SourceData, n: number, rules: SaRules, w: SaWeights, samples = 500): number | null {
  const ctx = buildCtx(data, demoCircuit(n), rules, w)
  return ctx ? benchCtx(ctx, samples) : null
}

type SaTrace = { move: number; T: number; cur: number; best: number }
type SaResult = { seed: number; moves: number; accepted: number; ms: number; best: number; bestState: State; trace: SaTrace[] }
type ExResult = { key: string; total: number; ms: number; best: number; bestState: State; optimaCount: number }
type Live = { seed: number; stage: number; stages: number; T: number; cur: number; best: number; moves: number; trace: SaTrace[]; bestState: State }
type Cancel = { current: boolean }
type AltRow = { state: State; summary: Summary; ms: number; evals: number; passes: number }
type Summary = { cost: number; width: number; area: number; wl: number }
type BatchRow = { id: string; label: string; n: number; nets: number; method: string; summary: Summary | null; init: Summary | null; ms: number; extra: string }
type SavedRow = { id: string; sa: State; summary: Summary }
type SavedRun = { rows: SavedRow[]; complete?: boolean; previous?: SavedRow[]; best?: SavedRow[] }

// 가장 단순한 배치: 셀을 netlist에 적은 순서 그대로, 전부 N 방향, 간격 0
const initState = (n: number): State => ({ order: Array.from({ length: n }, (_, i) => i), flip: new Array(n).fill(false), gaps: new Array(Math.max(0, n - 1)).fill(0) })

function summarize(ctx: Ctx, st: State): Summary {
  const X = new Array(ctx.n).fill(0), routes: Route[] = []
  const cost = evaluate(ctx, st, X, routes)
  const width = st.order.reduce((s, i, k) => s + ctx.W[i] + (k < ctx.n - 1 ? st.gaps[k] * ctx.rules.site : 0), 0)
  const wl = routes.reduce((s, r) => s + Math.abs(r.ax - r.bx) + Math.abs(r.ay - r.t) + Math.abs(r.by - r.t), 0)
  return { cost, width, area: width * ctx.rules.row, wl }
}

// 한 번의 SA(무작위 출발). onStage는 화면 갱신용이고 UI가 멈추지 않게 가끔 양보한다.
async function annealOnce(ctx: Ctx, seed: number, cancel: Cancel, onStage?: (p: Live) => void, opts?: { start?: State; t0Scale?: number }): Promise<SaResult | null> {
  const X = new Array(ctx.n).fill(0)
  const rnd = mulberry32(seed * 7919)
  const order = Array.from({ length: ctx.n }, (_, i) => i)
  for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [order[i], order[j]] = [order[j], order[i]] }
  let cur: State = opts?.start ? clone(opts.start) : { order, flip: order.map(() => rnd() < 0.5), gaps: new Array(Math.max(0, ctx.n - 1)).fill(0) }
  let curC = evaluate(ctx, cur, X), best = clone(cur), bestC = curC
  // T0: an average uphill move is accepted with probability 0.8 at the start
  let up = 0, ups = 0
  for (let i = 0; i < 200; i++) { const d = evaluate(ctx, neighbour(cur, rnd), X) - curC; if (d > 0 && Number.isFinite(d)) { up += d; ups++ } }
  const T0 = (ups ? (up / ups) / Math.log(1 / SA_T0_ACCEPT) : 1) * (opts?.t0Scale ?? 1)
  const stages = saStages(), perStage = saMovesPerStage(ctx.n)
  let T = T0, moves = 0, accepted = 0, ms = 0
  const trace: SaTrace[] = []
  for (let stage = 0; stage < stages && !cancel.current; stage++) {
    const t0 = performance.now()
    for (let m = 0; m < perStage; m++) {
      const cand = neighbour(cur, rnd)
      const c = evaluate(ctx, cand, X)
      moves++
      if (c <= curC || rnd() < Math.exp(-(c - curC) / T)) { cur = cand; curC = c; accepted++; if (c < bestC) { bestC = c; best = clone(cand) } }
    }
    ms += performance.now() - t0
    trace.push({ move: moves, T, cur: curC, best: bestC })
    T *= SA_ALPHA
    if (stage % 4 === 0 || stage === stages - 1) {
      onStage?.({ seed, stage: stage + 1, stages, T, cur: curC, best: bestC, moves, trace: [...trace], bestState: clone(best) })
      await new Promise(r => setTimeout(r, 0))
    }
  }
  if (cancel.current) return null
  return { seed, moves, accepted, ms, best: bestC, bestState: best, trace }
}

// 모든 배치(순서 × N/FN × 간격)를 평가해 정확한 최적을 구한다.
async function exhaustiveSearch(ctx: Ctx, cancel: Cancel, onProgress?: (done: number, total: number, best: number) => void) {
  const perms = permutations(ctx.n), F = 2 ** ctx.n, G = (MAX_GAP + 1) ** Math.max(0, ctx.n - 1)
  const total = perms.length * F * G
  const X = new Array(ctx.n).fill(0)
  let best = Infinity, bestState: State | null = null, optima = 0, ms = 0, i = 0
  const st: State = { order: perms[0], flip: new Array(ctx.n).fill(false), gaps: new Array(Math.max(0, ctx.n - 1)).fill(0) }
  while (i < total && !cancel.current) {
    const t0 = performance.now()
    while (i < total && performance.now() - t0 < 40) {
      let r = i
      const g = r % G; r = (r - g) / G
      const f = r % F; r = (r - f) / F
      st.order = perms[r]
      for (let k = 0; k < ctx.n; k++) st.flip[k] = ((f >> k) & 1) === 1
      let gg = g
      for (let k = 0; k < ctx.n - 1; k++) { st.gaps[k] = gg % (MAX_GAP + 1); gg = Math.floor(gg / (MAX_GAP + 1)) }
      const c = evaluate(ctx, st, X)
      if (c < best - 1e-9) { best = c; bestState = clone(st); optima = 1 } else if (Math.abs(c - best) <= 1e-9) optima++
      i++
    }
    ms += performance.now() - t0
    onProgress?.(i, total, best)
    await new Promise(r => setTimeout(r, 0))
  }
  if (cancel.current || !bestState) return null
  return { total, ms, best, bestState, optima }
}

const compositionOf = (c: Circuit) => { const m = new Map<string, number>(); for (const i of c.insts) m.set(i.cell.replace(/_1$/, ''), (m.get(i.cell.replace(/_1$/, '')) ?? 0) + 1); return [...m].map(([k, v]) => `${k}${v > 1 ? '×' + v : ''}`).join(' · ') }
const fmtTime = (s: number) => !Number.isFinite(s) ? '—' : s < 0.001 ? '1 ms 미만' : s < 1 ? `${round(s * 1000)} ms` : s < 120 ? `${round(s)} 초` : s < 3600 ? `${round(s / 60)} 분` : s < 86400 * 2 ? `${round(s / 3600)} 시간` : s < 86400 * 365 ? `${round(s / 86400)} 일` : s / 86400 / 365 < 1e6 ? `${round(s / 86400 / 365)} 년` : `${fmtBig(s / 86400 / 365)} 년`

// tier=1: 5개 이하 탭(전수 탐색), tier=2: 10개 이하 탭(SA). 탭마다 한 단계만 보여 준다.
export default function CellSaExperiment({ data, rules, weights, tier }: { data: SourceData | null; rules: SaRules; weights: SaWeights; tier: 1 | 2 | 3 }) {
  const [candId, setCandId] = useState(() => CANDIDATES.find(c => c.tier === tier)!.id)
  const [seeds, setSeeds] = useState(tier === 3 ? 3 : 5)
  const [resultsRaw, setResults] = useState<SaResult[]>([])
  const [liveRaw, setLive] = useState<Live | null>(null)
  const [runKey, setRunKey] = useState('')
  const [ex, setEx] = useState<ExResult | null>(null)
  const [exLive, setExLive] = useState<{ done: number; total: number; best: number } | null>(null)
  const [view, setView] = useState<'sa' | 'ex'>('ex')
  const [batch, setBatch] = useState<{ tier: 1 | 2 | 3; rows: BatchRow[]; running: boolean; label: string } | null>(null)
  const [cmp, setCmp] = useState<{ tier: number; rows: CmpRow[]; running: boolean; label: string; previous: SavedRun | null } | null>(null)
  const [improve, setImprove] = useState<{ id: string; attempts: number; running: boolean } | null>(null)
  const [dp, setDp] = useState<Record<string, DpRow>>({})
  const [dpLive, setDpLive] = useState<{ label: string; done: number; total: number; idx: number; count: number } | null>(null)
  const [extra, setExtra] = useState<ExtraMap>({})
  const [extraLive, setExtraLive] = useState<{ id: string; label: string } | null>(null)
  const cancel = useRef<Cancel>({ current: false })
  const tierList = useMemo(() => CANDIDATES.filter(c => c.tier === tier), [tier])
  const cand = CANDIDATES.find(c => c.id === candId) ?? tierList[0]
  const n = cand.insts.length
  const issue = data ? circuitIssue(data, cand) : null
  const ctx = useMemo(() => data ? buildCtx(data, cand, rules, weights) : null, [data, cand, rules, weights])
  const key = `${cand.id}|${JSON.stringify(rules)}|${JSON.stringify(weights)}`
  // 후보를 바꾼 직후 한 번은 이전 후보의 결과가 state에 남아 있다 — 그 배치를 새 후보의 셀 목록에 그리면 인덱스가 어긋나 화면이 죽으므로, 실행한 후보·규칙의 결과만 보여 준다.
  const results = runKey === key ? resultsRaw : []
  const live = runKey === key ? liveRaw : null
  const running = !!live || !!exLive || !!batch?.running || !!cmp?.running || !!improve?.running || !!dpLive || !!extraLive
  // 후보마다 배치 1개 평가 시간(µs)을 재서 전수 탐색에 걸릴 시간을 추정한다(해당 단계 후보만, 한 번만 측정).
  const usPer = useMemo(() => {
    const m = new Map<string, number>()
    if (data) for (const c of tierList) { const x = buildCtx(data, c, rules, weights); if (x) m.set(c.id, benchCtx(x, 300)) }
    return m
  }, [data, tierList, rules, weights])

  useEffect(() => { cancel.current.current = true; setResults([]); setLive(null); setExLive(null); setView(tier === 1 ? 'ex' : 'sa') }, [candId, rules, weights, tier])
  useEffect(() => { setBatch(null); setCmp(null) }, [rules, weights])
  useEffect(() => () => { cancel.current.current = true }, [])

  const runSA = async () => {
    if (!ctx) return
    cancel.current = { current: false }
    const cc = cancel.current
    setRunKey(key); setResults([]); setView('sa')
    const out: SaResult[] = []
    for (let s = 1; s <= seeds && !cc.current; s++) {
      const r = await annealOnce(ctx, s, cc, setLive)
      if (!r) break
      out.push(r); setResults([...out])
    }
    setLive(null)
  }

  const runExhaustive = async () => {
    if (!ctx || ctx.n > MAX_EXHAUSTIVE_N) return
    cancel.current = { current: false }
    setRunKey(key); setView('ex')
    const r = await exhaustiveSearch(ctx, cancel.current, (done, total, best) => setExLive({ done, total, best }))
    if (r) setEx({ key, total: r.total, ms: r.ms, best: r.best, bestState: r.bestState, optimaCount: r.optima })
    setExLive(null)
  }

  // 같은 단계의 후보를 전부 돌려 비교한다: 1단계는 전수 탐색, 2단계는 SA(seed 3개 중 최선).
  const runBatch = async () => {
    if (!data) return
    cancel.current = { current: false }
    const cc = cancel.current
    const rows: BatchRow[] = []
    setBatch({ tier, rows, running: true, label: '' })
    for (const c of tierList) {
      if (cc.current) break
      setBatch({ tier, rows: [...rows], running: true, label: c.label })
      const x = buildCtx(data, c, rules, weights)
      if (!x) { rows.push({ id: c.id, label: c.label, n: c.insts.length, nets: c.nets.length, method: '—', summary: null, init: null, ms: 0, extra: circuitIssue(data, c) ?? '' }); continue }
      if (c.tier === 1) {
        const r = await exhaustiveSearch(x, cc)
        if (r) rows.push({ id: c.id, label: c.label, n: c.insts.length, nets: c.nets.length, method: `전수 ${fmtN(r.total)}가지`, summary: summarize(x, r.bestState), init: summarize(x, initState(x.n)), ms: r.ms, extra: `최적 배치 ${r.optima}개` })
      } else {
        let best: SaResult | null = null, ms = 0
        const batchSeeds = c.tier === 3 ? 1 : 3
        for (let s = 1; s <= batchSeeds && !cc.current; s++) {
          const r = await annealOnce(x, s, cc)
          if (r) { ms += r.ms; if (!best || r.best < best.best) best = r }
        }
        if (best) rows.push({ id: c.id, label: c.label, n: c.insts.length, nets: c.nets.length, method: `SA ${batchSeeds} seed`, summary: summarize(x, best.bestState), init: summarize(x, initState(x.n)), ms, extra: `전수 ${fmtTime(placementsOf(c.insts.length) * (usPer.get(c.id) ?? NaN) / 1e6)} 걸릴 규모` })
      }
    }
    setBatch({ tier, rows: [...rows], running: false, label: '' })
  }

  // 모든 후보의 기본 배치를 즉시 계산한다. SA 결과는 이후 후보별로 채운다.
  const cmpSeeds = tier === 3 ? 2 : 3
  const simpleRows = useMemo(() => {
    if (!data || tier === 1) return []
    return tierList.flatMap(c => {
      const x = buildCtx(data, c, rules, weights)
      if (!x) return []
      const init = initState(x.n)
      return [{ id: c.id, label: c.label, n: c.insts.length, nets: c.nets.length, ctx: x, init, initS: summarize(x, init) }]
    })
  }, [data, tier, tierList, rules, weights])
  const comparisonKey = `stdcell-sa-v1|${tier}|${JSON.stringify(rules)}|${JSON.stringify(weights)}`
  const [savedRun, setSavedRun] = useState<SavedRun | null>(null)
  const [loadedKey, setLoadedKey] = useState('')
  const autoStarted = useRef(false)
  const keyRef = useRef(comparisonKey)
  keyRef.current = comparisonKey
  useEffect(() => {
    autoStarted.current = false // 규칙·가중치가 바뀌면 새 조건의 저장 결과를 다시 확인하고, 없으면 자동 실행한다
    try {
      const raw = localStorage.getItem(comparisonKey)
      setSavedRun(raw ? JSON.parse(raw) as SavedRun : null)
    } catch { setSavedRun(null) }
    setLoadedKey(comparisonKey)
  }, [comparisonKey])
  const matchingSavedRun = loadedKey === comparisonKey ? savedRun : null

  // 새 실행이 시작될 때 직전 결과를 고정해 두고, 끝난 후보부터 비교한다.
  const runCompare = async () => {
    if (!data || tier === 1) return
    cancel.current = { current: false }
    const cc = cancel.current
    const resume = matchingSavedRun?.complete === false
    const previous: SavedRun | null = resume ? { rows: matchingSavedRun.previous ?? [], complete: true }
      : cmp?.rows.length ? { rows: cmp.rows.map(r => ({ id: r.id, sa: r.sa, summary: r.saS })), complete: true } : matchingSavedRun
    const rows: CmpRow[] = resume ? simpleRows.flatMap(r => {
      const saved = matchingSavedRun.rows.find(item => item.id === r.id)
      return saved ? [{ ...r, sa: saved.sa, saS: saved.summary, ms: 0, seeds: cmpSeeds }] : []
    }) : []
    const priorBest = matchingSavedRun?.best ?? matchingSavedRun?.rows ?? []
    const persist = (complete: boolean) => {
      const current = rows.map(r => ({ id: r.id, sa: r.sa, summary: r.saS }))
      const best = [...priorBest]
      for (const row of current) {
        const index = best.findIndex(item => item.id === row.id)
        if (index < 0) best.push(row)
        else if (row.summary.cost < best[index].summary.cost - 1e-9) best[index] = row
      }
      const saved: SavedRun = { rows: current, complete, previous: previous?.rows ?? [], best }
      try { localStorage.setItem(comparisonKey, JSON.stringify(saved)) } catch { /* storage can be unavailable */ }
      if (keyRef.current === comparisonKey) setSavedRun(saved) // 규칙을 바꿔 취소된 실행이 새 규칙 화면에 옛 결과를 덮어쓰지 않게
    }
    setCmp({ tier, rows, running: true, label: '', previous })
    const seedOffset = Math.floor(Math.random() * 1000000) + 1
    for (const c of tierList) {
      if (cc.current) break
      if (rows.some(r => r.id === c.id)) continue
      setCmp({ tier, rows: [...rows], running: true, label: c.label, previous })
      const x = buildCtx(data, c, rules, weights)
      if (!x) continue
      let best: SaResult | null = null, ms = 0
      for (let sd = 1; sd <= cmpSeeds && !cc.current; sd++) {
        const r = await annealOnce(x, seedOffset + sd, cc)
        if (r) { ms += r.ms; if (!best || r.best < best.best) best = r }
      }
      if (!best) continue
      const init = initState(x.n)
      rows.push({ id: c.id, label: c.label, n: c.insts.length, nets: c.nets.length, ctx: x, init, sa: best.bestState, initS: summarize(x, init), saS: summarize(x, best.bestState), ms, seeds: cmpSeeds })
      persist(false)
      setCmp({ tier, rows: [...rows], running: true, label: c.label, previous })
    }
    persist(!cc.current && rows.length === simpleRows.length)
    if (keyRef.current === comparisonKey) setCmp({ tier, rows: [...rows], running: false, label: '', previous })
  }
  const runUntilBetter = async (id: string) => {
    if (!data || tier === 1 || running) return
    const c = tierList.find(item => item.id === id)
    const x = c && buildCtx(data, c, rules, weights)
    if (!c || !x) return
    const oldRun = matchingSavedRun
    const bestSoFar = oldRun?.best?.find(item => item.id === id) ?? oldRun?.rows.find(item => item.id === id)
    const target = bestSoFar?.summary.cost ?? summarize(x, initState(x.n)).cost
    cancel.current = { current: false }
    const cc = cancel.current
    const seedOffset = Math.floor(Math.random() * 1000000) + 1
    setImprove({ id, attempts: 0, running: true })
    for (let attempt = 1; !cc.current; attempt++) {
      const result = await annealOnce(x, seedOffset + attempt, cc)
      if (!result) break
      const summary = summarize(x, result.bestState)
      if (summary.cost < target - 1e-9) {
        const found = { id, sa: result.bestState, summary }
        const current = (oldRun?.rows ?? []).filter(item => item.id !== id)
        current.push(found)
        const best = (oldRun?.best ?? oldRun?.rows ?? []).filter(item => item.id !== id)
        best.push(found)
        const saved: SavedRun = { rows: current, complete: current.length === simpleRows.length, previous: oldRun?.rows ?? [], best }
        try { localStorage.setItem(comparisonKey, JSON.stringify(saved)) } catch { /* storage can be unavailable */ }
        if (keyRef.current === comparisonKey) setSavedRun(saved)
        setCmp(null)
        setImprove({ id, attempts: attempt, running: false })
        return
      }
      setImprove({ id, attempts: attempt, running: true })
    }
    setImprove({ id, attempts: 0, running: false })
  }
  useEffect(() => {
    if (tier === 1 || !data || !simpleRows.length || loadedKey !== comparisonKey || (matchingSavedRun && matchingSavedRun.complete !== false) || autoStarted.current) return
    autoStarted.current = true
    void runCompare()
  }, [tier, data, simpleRows, loadedKey, comparisonKey, matchingSavedRun])

  // SA가 아닌 방식(스펙트럴 정렬 + 결정적 국소 개선)은 무작위가 없고 빨라서 모든 후보를 바로 계산한다. 규칙·가중치가 바뀌면 다시 계산한다.
  const [alt, setAlt] = useState<Record<string, AltRow>>({})
  useEffect(() => {
    if (tier === 1 || !simpleRows.length) return
    const cc: Cancel = { current: false }
    setAlt({})
    void (async () => {
      const out: Record<string, AltRow> = {}
      for (const r of simpleRows) {
        const res = await spectralRefine(r.ctx, cc)
        if (!res || cc.current) return
        out[r.id] = { state: res.state, summary: summarize(r.ctx, res.state), ms: res.ms, evals: res.evals, passes: res.passes }
        setAlt({ ...out })
      }
    })()
    return () => { cc.current = true }
  }, [tier, simpleRows])

  // ---- 정확해 DP, SA 보완 실험(seed 확대 · 스펙트럴 해에서 시작하는 하이브리드) ----
  const rwKey = `${JSON.stringify(rules)}|${JSON.stringify(weights)}`
  const extraKey = `stdcell-sa-extra-v1|${tier}|${rwKey}`
  const altRef = useRef(alt); altRef.current = alt
  const savedRef = useRef<SavedRun | null>(null); savedRef.current = matchingSavedRun
  const extraRef = useRef<ExtraMap>({})
  useEffect(() => {
    const next: Record<string, DpRow> = {}
    for (const r of simpleRows) { const hit = dpCache.get(`${r.id}|${rwKey}`); if (hit) next[r.id] = hit }
    setDp(next)
  }, [simpleRows, rwKey])
  useEffect(() => {
    let loaded: ExtraMap = {}
    try { const raw = localStorage.getItem(extraKey); if (raw) loaded = JSON.parse(raw) as ExtraMap } catch { /* storage can be unavailable */ }
    extraRef.current = loaded; setExtra(loaded)
  }, [extraKey])

  const runDp = async () => {
    if (tier === 1 || running) return
    cancel.current = { current: false }
    const cc = cancel.current
    const todo = simpleRows.filter(r => r.n <= MAX_DP_N && !dpCache.has(`${r.id}|${rwKey}`))
    for (let i = 0; i < todo.length && !cc.current; i++) {
      const r = todo[i]
      setDpLive({ label: r.label, done: 0, total: 1, idx: i + 1, count: todo.length })
      const res = await subsetDp(r.ctx, cc, (done, total) => setDpLive({ label: r.label, done, total, idx: i + 1, count: todo.length }))
      if (!res) break
      dpCache.set(`${r.id}|${rwKey}`, res)
      setDp(prev => ({ ...prev, [r.id]: res }))
    }
    setDpLive(null)
  }

  const putExtra = (id: string, kind: ExtraKind, res: ExtraRes) => {
    const next: ExtraMap = { ...extraRef.current, [id]: { ...extraRef.current[id], [kind]: res } }
    extraRef.current = next; setExtra(next)
    try { localStorage.setItem(extraKey, JSON.stringify(next)) } catch { /* storage can be unavailable */ }
  }
  // 보완 실험에서 더 낮은 비용이 나오면 이 후보의 '역대 최선'에 반영한다.
  const commitBest = (id: string, st: State, summary: Summary) => {
    const old = savedRef.current
    if (!old || keyRef.current !== comparisonKey) return
    const list = old.best ?? old.rows
    const prev = list.find(i => i.id === id)
    if (prev && summary.cost >= prev.summary.cost - 1e-9) return
    const bestList = list.filter(i => i.id !== id); bestList.push({ id, sa: st, summary })
    const saved: SavedRun = { ...old, best: bestList }
    try { localStorage.setItem(comparisonKey, JSON.stringify(saved)) } catch { /* storage can be unavailable */ }
    savedRef.current = saved
    setSavedRun(saved)
  }
  const execExtra = async (id: string, kind: ExtraKind, cc: Cancel) => {
    const r = simpleRows.find(x => x.id === id), a = altRef.current[id]
    if (!r || (kind === 'hybrid' && !a)) return
    const before = (savedRef.current?.best ?? savedRef.current?.rows ?? []).find(i => i.id === id)?.summary.cost ?? null
    const runs = extraRuns(kind, r.n), seedOffset = Math.floor(Math.random() * 1000000) + 1
    const costs: number[] = []
    let best: SaResult | null = null, ms = 0
    for (let k = 1; k <= runs && !cc.current; k++) {
      setExtraLive({ id, label: `${r.label} · ${EXTRA_LABEL[kind]} ${k}/${runs}` })
      const res = await annealOnce(r.ctx, seedOffset + k, cc, undefined, kind === 'hybrid' ? { start: a.state, t0Scale: HYBRID_T0 } : undefined)
      if (!res) break
      ms += res.ms; costs.push(res.best)
      if (!best || res.best < best.best) best = res
    }
    if (!best || !costs.length) return
    const summary = summarize(r.ctx, best.bestState)
    putExtra(id, kind, { kind, costs, state: best.bestState, summary, ms, before })
    if (kind === 'seeds') commitBest(id, best.bestState, summary) // 하이브리드는 SA가 아닌 별도 방식이라 'SA 역대 최선'에 합치지 않는다
  }
  const runExtra = async (id: string, kind: ExtraKind) => {
    if (!data || tier === 1 || running) return
    cancel.current = { current: false }
    await execExtra(id, kind, cancel.current)
    setExtraLive(null)
  }
  const runExtraBatch = async (kind: ExtraKind, ids: string[]) => {
    if (!data || tier === 1 || running) return
    cancel.current = { current: false }
    const cc = cancel.current
    for (const id of ids) { if (cc.current) break; await execExtra(id, kind, cc) }
    setExtraLive(null)
  }

  const exKnown = ex && ex.key === key ? ex : null
  const bestRun = results.length ? results.reduce((a, b) => b.best < a.best ? b : a) : null
  const hits = exKnown ? results.filter(r => Math.abs(r.best - exKnown.best) < 1e-6).length : results.filter(r => bestRun && Math.abs(r.best - bestRun.best) < 1e-6).length
  const shownState = view === 'ex' && exKnown ? exKnown.bestState : live?.bestState ?? bestRun?.bestState ?? exKnown?.bestState ?? null
  const shownTitle = view === 'ex' && exKnown ? '전수 탐색 최적' : live ? `SA 진행 중 · seed ${live.seed} 지금까지 최선` : bestRun ? `SA 최선 (seed ${bestRun.seed})` : exKnown ? '전수 탐색 최적' : ''
  const avgMs = results.length ? results.reduce((s, r) => s + r.ms, 0) / results.length : 0
  const avgMoves = results.length ? results.reduce((s, r) => s + r.moves, 0) / results.length : 0
  const usPerEval = results.length ? avgMs * 1000 / avgMoves : (usPer.get(cand.id) ?? null)
  const exEstSec = usPerEval ? placementsOf(n) * usPerEval / 1e6 : null
  const info = TIER_INFO[tier]

  return <div className="card" style={{ padding: 12, marginBottom: 12 }}>
    <div className="card-title" style={{ marginBottom: 6 }}><div><small className="kicker">CANDIDATE POOL · 실측</small><h3>{tier === 1 ? '복잡한 표준셀 후보군 (5개 이하)' : tier === 2 ? '더 복잡한 표준셀 후보군 (6~10개)' : '매우 복잡한 표준셀 후보군 (20~50개)'} — 배치·배선 탐색</h3></div></div>
    <p className="chip-note" style={{ margin: '0 0 8px' }}><b>{info.title}</b> — 후보 {tierList.length}개. {info.desc} 모든 셀·핀은 실제 sky130 hd이고, 내부 연결(드라이버→싱크)만 넷으로 셉니다. 클록·전원·외부 입력은 넷에 넣지 않았습니다.</p>
    {tier !== 1 && <CompareSection tier={tier} simpleRows={simpleRows} savedRun={matchingSavedRun} cmp={cmp} running={running || !data} improving={improve} alt={alt} dp={dp} dpLive={dpLive} extra={extra} extraLive={extraLive} seeds={cmpSeeds} onRun={runCompare} onImprove={runUntilBetter} onDp={runDp} onExtra={runExtra} onExtraBatch={runExtraBatch} onStop={() => { cancel.current.current = true }} onOpen={id => { if (!running) { setCandId(id); window.scrollTo?.({ top: 0 }) } }}/>} 
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(250px,1fr))', gap: 8, marginBottom: 10 }}>
      {tierList.map(c => { const on = c.id === cand.id, us = usPer.get(c.id)
        return <button key={c.id} type="button" disabled={running} onClick={() => setCandId(c.id)} style={{ textAlign: 'left', padding: 10, borderRadius: 8, cursor: running ? 'default' : 'pointer',
          border: `1.5px solid ${on ? '#7F77DD' : 'var(--border-strong)'}`, background: on ? 'var(--accent-soft)' : 'var(--surface)', color: 'var(--text)' }}>
          <b style={{ fontSize: 13 }}>{c.label}</b>
          <div style={{ fontSize: 11, margin: '3px 0', color: 'var(--text-secondary)' }}>{c.fn}</div>
          <div style={{ fontSize: 11 }}><b>{c.insts.length}셀 · 넷 {c.nets.length}</b> · 배치 {fmtBig(placementsOf(c.insts.length))}가지{us ? ` · 전수 약 ${fmtTime(placementsOf(c.insts.length) * us / 1e6)}` : ''}</div>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>{compositionOf(c)}</div>
        </button> })}
    </div>

    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'end', marginBottom: 8 }}>
      <span style={{ fontSize: 13 }}>선택: <b>{cand.label}</b></span>
      {tier === 1
        ? <><button type="button" className="active" disabled={!ctx || running} onClick={runExhaustive}>전수 탐색 (정확한 최적)</button>
          <button type="button" disabled={!ctx || running} onClick={runSA}>SA로도 풀어 비교</button></>
        : <><button type="button" className="active" disabled={!ctx || running} onClick={runSA}>SA 실행</button>
          <button type="button" disabled={!ctx || running || n > MAX_EXHAUSTIVE_N} onClick={runExhaustive} title={n > MAX_EXHAUSTIVE_N ? `${MAX_EXHAUSTIVE_N}셀까지만 전수 검증` : ''}>전수 탐색으로 검증</button></>}
      <label style={{ display: 'grid', gap: 3, fontSize: 12 }}>SA seed 수<select value={seeds} disabled={running} onChange={e => setSeeds(Number(e.target.value))}>{[1, 3, 5, 10].map(v => <option key={v} value={v}>{v}</option>)}</select></label>
      {tier === 1 && <button type="button" disabled={!data || running} onClick={runBatch}>이 단계 후보 전부 전수 탐색해 비교</button>}
      {running && <button type="button" onClick={() => { cancel.current.current = true }}>중지</button>}
    </div>
    {!data && <p className="chip-note">셀 데이터를 불러오는 중입니다.</p>}
    {data && issue && <p className="init-error">후보 회로 정의가 실제 셀 데이터와 맞지 않습니다 — {issue}</p>}
    {ctx && <>
      <div className="data-table"><table><thead><tr><th>회로 ({n}셀 · 넷 {ctx.nets.length}개)</th><th>탐색 공간</th></tr></thead><tbody><tr>
        <td style={{ fontSize: 11 }}>{cand.insts.map((it, i) => <span key={it.name} style={{ marginRight: 8 }}><code>{it.name}</code>={it.cell} ({ctx.sites[i]} site)</span>)}<br/>
          {cand.nets.map(e => <span key={e.name} style={{ marginRight: 8 }}>{e.name}: {cand.insts[e.from[0]].name}.{e.from[1]}→{cand.insts[e.to[0]].name}.{e.to[1]}</span>)}</td>
        <td style={{ fontSize: 12 }}>배치 {fmtBig(placementsOf(n))}가지 = {n}!·2<sup>{n}</sup>·3<sup>{n - 1}</sup><br/>배선은 넷마다 핀 사각형 × 트랙 {ctx.tracks.length}개 중 최선{exEstSec !== null && <><br/>전수 탐색 예상 <b>{fmtTime(exEstSec)}</b></>}</td>
      </tr></tbody></table></div>
      <p className="chip-note" style={{ margin: '6px 0 10px' }}>SA는 무작위 배치에서 시작해 이동(두 셀 교환 · 한 셀 옮기기 · 좌우 뒤집기 · 간격 ±1)을 반복합니다. 나빠지는 이동도 확률 e<sup>−Δ/T</sup>로 받아들이고, 온도 T를 단계마다 ×{SA_ALPHA}씩 낮춰 처음 온도의 {SA_FINAL_RATIO}배가 되면 멈춥니다. 비용 모델과 목표 규칙은 위의 2셀 실험과 같습니다.</p>

      {live && <div style={{ marginBottom: 10 }}>
        <div style={{ height: 8, borderRadius: 4, background: 'var(--surface-muted)', overflow: 'hidden' }}><div style={{ height: '100%', width: `${((live.seed - 1) + live.stage / live.stages) / seeds * 100}%`, background: '#7F77DD' }}/></div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, fontSize: 13, marginTop: 6 }}>
          <span>seed <b>{live.seed}</b>/{seeds}</span><span>단계 {live.stage}/{live.stages}</span><span>이동 {fmtN(live.moves)}</span><span>온도 T {live.T.toExponential(2)}</span>
          <span>현재 비용 {round(live.cur)}</span><span>지금까지 최선 <b>{round(live.best)}</b></span></div>
      </div>}
      {exLive && <div style={{ marginBottom: 10 }}>
        <div style={{ height: 8, borderRadius: 4, background: 'var(--surface-muted)', overflow: 'hidden' }}><div style={{ height: '100%', width: `${exLive.done / exLive.total * 100}%`, background: '#1D9E75' }}/></div>
        <div style={{ fontSize: 13, marginTop: 6 }}>전수 탐색 {fmtN(exLive.done)} / {fmtN(exLive.total)} 배치 · 지금까지 최선 <b>{round(exLive.best)}</b></div>
      </div>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))', gap: 10 }}>
        <div style={{ minWidth: 0 }}><small><b>비용 변화</b> (보라 = 현재, 초록 = 지금까지 최선{exKnown ? ', 점선 = 전수 최적' : ''})</small>
          <CostChart traces={live ? [...results.map(r => r.trace), live.trace] : results.map(r => r.trace)} optimum={exKnown?.best ?? null}/></div>
        <div style={{ minWidth: 0, gridColumn: '1 / -1' }}><small><b>{shownTitle || '실행 결과 배치'}</b>{shownState && !live ? ' — 초기 배치와 비교' : ''} (실제 비율 · 옆으로 스크롤)</small>{shownState ? (live ? <RowView ctx={ctx} st={shownState}/> : <LayoutPair ctx={ctx} init={initState(n)} sa={shownState}/>) : <p className="chip-note">{tier === 1 ? '전수 탐색' : 'SA'}을 실행하면 최선 배치가 여기에 그려집니다.</p>}</div>
      </div>

      {results.length > 0 && <div className="data-table" style={{ marginTop: 10 }}><table><thead><tr><th>seed</th><th>이동 수</th><th>수용률</th><th>계산 시간</th><th>최선 비용</th><th>{exKnown ? '전수 최적과 비교' : '다른 seed 최선과 비교'}</th></tr></thead><tbody>
        {results.map(r => { const ref = exKnown?.best ?? bestRun!.best; const ok = Math.abs(r.best - ref) < 1e-6
          return <tr key={r.seed}><td>{r.seed}</td><td>{fmtN(r.moves)}</td><td>{Math.round(r.accepted / r.moves * 100)}%</td><td>{round(r.ms)} ms</td><td><b>{round(r.best)}</b></td>
            <td style={{ color: ok ? '#1D9E75' : '#C0A02B', fontWeight: 700 }}>{ok ? (exKnown ? '전역 최적 찾음' : '최선과 같음') : `+${round((r.best / ref - 1) * 100)}%`}</td></tr> })}
      </tbody></table></div>}

      {exKnown && (() => { const sm = summarize(ctx, exKnown.bestState); return <p className="chip-note" style={{ marginTop: 8 }}><b>전수 탐색 ({n}셀):</b> 배치 {fmtN(exKnown.total)}가지를 {exKnown.ms < 1000 ? `${round(exKnown.ms)} ms` : `${round(exKnown.ms / 1000)} 초`}에 모두 평가 · 최적 비용 <b>{round(exKnown.best)}</b> · 폭 {round(sm.width)} µm × 높이 {rules.row} µm = {round(sm.area)} µm² · 배선 길이 합 {round(sm.wl)} µm (같은 비용의 최적 배치 {exKnown.optimaCount}개 — 좌우 대칭 등).</p> })()}

      {results.length > 0 && !live && <div className="card" style={{ padding: 10, marginTop: 10, borderLeft: `4px solid ${exKnown && hits === results.length ? '#1D9E75' : '#7F77DD'}` }}>
        <b style={{ fontSize: 13 }}>SA 결론 ({n}셀)</b>
        <p style={{ margin: '4px 0 0', fontSize: 12, lineHeight: 1.7 }}>
          SA는 seed {results.length}회 평균 <b>{fmtN(Math.round(avgMoves))}번 이동, {round(avgMs)} ms</b>(평가 1회 {usPerEval ? round(usPerEval) : '—'} µs)로 끝났습니다. {avgMoves >= placementsOf(n) ? <>가능한 배치는 {fmtBig(placementsOf(n))}가지뿐이라 <b>SA가 전체 배치 수보다 더 많이 평가</b>했습니다 — 이 크기에서는 전수 탐색이 더 빠르고 최적도 보장합니다.{' '}</> : <>배치 {fmtBig(placementsOf(n))}가지 중 {(() => { const r = avgMoves / placementsOf(n) * 100; return r < 0.01 ? r.toExponential(1) : round(r) })()}%만 평가했습니다.{' '}</>}
          {exKnown
            ? <>전수 탐색으로 확인한 전역 최적을 <b>{results.length}회 중 {hits}회</b> 찾았습니다.{hits < results.length ? ' 못 찾은 seed는 국소 최적에 머문 경우라 여러 seed 중 최선을 씁니다.' : ''}</>
            : <><b>{results.length}회 중 {hits}회</b>가 같은 최선 비용에 도달했습니다. 이 크기는 전수 탐색으로 확인할 수 없어 최적이라고 보장할 수는 없지만, 서로 다른 출발점에서 같은 답에 모이면 최적에 가깝다는 근거가 됩니다.</>}
          {!exKnown && exEstSec !== null && <> 같은 {n}셀을 전수 탐색하면 약 <b>{fmtTime(exEstSec)}</b> 걸립니다(평가 1회 실측 기반). SA는 그 대신 {round(avgMs)} ms였습니다.</>}
        </p></div>}
    </>}

    {tier !== 1 && <SaExplainer n={n} results={results} usPerEval={usPerEval}/>}
    {tier !== 1 && <PlacementMethodsExplainer window={ALT_WINDOW} maxPasses={ALT_MAX_PASSES} iterations={ALT_POWER_ITERS}/>}
    {tier !== 1 && <SubsetDpExplainer maxN={MAX_DP_N}/>}

    {batch && batch.rows.length + (batch.running ? 1 : 0) > 0 && <div style={{ marginTop: 14 }}>
      <b style={{ fontSize: 13 }}>{TIER_INFO[batch.tier].title} — 후보 비교 ({TIER_INFO[batch.tier].how}){batch.running ? ` · 진행 중: ${batch.label} (${batch.rows.length}/${CANDIDATES.filter(c => c.tier === batch.tier).length})` : ''}</b>
      <div className="data-table" style={{ marginTop: 6 }}><table><thead><tr><th>후보</th><th>셀</th><th>넷</th><th>방식</th><th>최선 비용</th><th>폭 × 높이 (µm)</th><th>면적 (µm²)</th><th>배선 길이 합 (µm)</th><th>비용: 초기 → SA</th><th>계산 시간</th><th>비고</th></tr></thead><tbody>
        {[...batch.rows].sort((a, b) => (a.summary?.area ?? Infinity) - (b.summary?.area ?? Infinity)).map(r => <tr key={r.id} style={{ cursor: 'pointer' }} onClick={() => { if (!running) setCandId(r.id) }}>
          <td><b>{r.label}</b></td><td>{r.n}</td><td>{r.nets}</td><td style={{ fontSize: 11 }}>{r.method}</td>
          <td>{r.summary ? round(r.summary.cost) : '—'}</td><td>{r.summary ? `${round(r.summary.width)} × ${rules.row}` : '—'}</td><td><b>{r.summary ? round(r.summary.area) : '—'}</b></td>
          <td>{r.summary ? round(r.summary.wl) : '—'}</td><td>{r.summary && r.init ? <>{round(r.init.cost)} → <b>{round(r.summary.cost)}</b> <span style={{ color: dTone(dPct(r.init.cost, r.summary.cost)), fontWeight: 700 }}>({dText(dPct(r.init.cost, r.summary.cost))})</span></> : '—'}</td><td>{r.ms < 1000 ? `${round(r.ms)} ms` : `${round(r.ms / 1000)} 초`}</td><td style={{ fontSize: 11 }}>{r.extra}</td></tr>)}
      </tbody></table></div>
      <p className="chip-note" style={{ marginTop: 6 }}>면적 작은 순. 행을 누르면 그 후보가 위에서 열립니다. 후보마다 셀 종류·연결이 달라 면적을 직접 비교하는 것은 "같은 규칙에서 얼마나 큰 셀이 되는가"의 가늠일 뿐, 같은 기능의 대안 구현끼리의 비교가 아닙니다. 넷은 서로 독립으로 가장 좋은 트랙을 골라 같은 트랙 공유 충돌은 검사하지 않았고, 규칙은 가상 PDK 값이라 DRC 통과 판정이 아닙니다.</p>
    </div>}
  </div>
}

// ---- 초기 배치(netlist 순서 그대로) vs SA 배치 비교 ----
const dPct = (a: number, b: number) => a > 0 ? (b / a - 1) * 100 : 0
const dTone = (v: number) => v < -0.05 ? '#1D9E75' : v > 0.05 ? '#C0392B' : 'var(--text-secondary)'
const dText = (v: number) => Math.abs(v) < 0.05 ? '0.0%' : `${v > 0 ? '+' : ''}${v.toFixed(1)}%`

// 같은 비용 모델·같은 축척으로 초기 배치와 SA 배치를 위아래로 그리고 지표를 비교한다.
function LayoutPair({ ctx, init, sa }: { ctx: Ctx; init: State; sa: State }) {
  const a = summarize(ctx, init), b = summarize(ctx, sa)
  const S = Math.max(6, Math.min(30, 1100 / Math.max(a.width, b.width)))
  const metrics: [string, number, number][] = [['비용 (면적항 + 배선)', a.cost, b.cost], ['폭 (µm)', a.width, b.width], ['면적 (µm²)', a.area, b.area], ['배선 길이 합 (µm)', a.wl, b.wl]]
  return <div>
    <div className="data-table"><table><thead><tr><th>지표 (낮을수록 좋음)</th><th>초기 배치</th><th>SA 배치</th><th>변화</th></tr></thead><tbody>
      {metrics.map(([k, x, y]) => { const d = dPct(x, y); return <tr key={k}><td>{k}</td><td>{round(x)}</td><td><b>{round(y)}</b></td><td style={{ color: dTone(d), fontWeight: 700 }}>{dText(d)}</td></tr> })}
    </tbody></table></div>
    <div style={{ margin: '8px 0 2px', fontSize: 12 }}><b>초기 배치</b> — 셀을 netlist에 적은 순서 그대로 한 줄에 놓고, 전부 N, 간격 0 · 넷은 가장 좋은 트랙으로 배선</div>
    <RowView ctx={ctx} st={init} S={S}/>
    <div style={{ margin: '8px 0 2px', fontSize: 12 }}><b style={{ color: '#1D9E75' }}>SA 배치</b> — SA가 순서·방향(N/FN)·간격을 바꿔 찾은 최선 · 같은 규칙·같은 비용 모델</div>
    <RowView ctx={ctx} st={sa} S={S}/>
  </div>
}

type CmpRow = { id: string; label: string; n: number; nets: number; ctx: Ctx; init: State; sa: State; initS: Summary; saS: Summary; ms: number; seeds: number }
type SimpleRow = Pick<CmpRow, 'id' | 'label' | 'n' | 'nets' | 'ctx' | 'init' | 'initS'>

// ---- 결과 해석: 후보마다의 SA 추천과 보완 실험, 탭 전체 성능 요약 ----
type ExtraKind = 'hybrid' | 'seeds'
type ExtraRes = { kind: ExtraKind; costs: number[]; state: State; summary: Summary; ms: number; before: number | null }
type ExtraMap = Record<string, Partial<Record<ExtraKind, ExtraRes>>>
type DpRow = DpResult
const HYBRID_T0 = 0.3 // 하이브리드 SA의 시작 온도 배율(스펙트럴 해의 구조를 한 번에 무너뜨리지 않도록 낮게)
const extraRuns = (kind: ExtraKind, n: number) => kind === 'hybrid' ? 3 : n >= 36 ? 4 : 6
const EXTRA_LABEL: Record<ExtraKind, string> = { hybrid: '스펙트럴 해에서 시작하는 SA(하이브리드)', seeds: 'SA seed 확대' }
const TOL = 0.5 // % — 이 안이면 같은 결과로 본다
const BIG_N = 36 // 이 셀 수부터 "큰 회로"로 묶는다(실측에서 SA의 seed 편차가 커지는 구간)

type Rec = { id: string; sa: State; summary: Summary }
type CandEval = {
  id: string; label: string; n: number; sa: Rec | null; alt: AltRow | null; dp: DpRow | null; spread: number | null
  seeds?: ExtraRes; hybrid?: ExtraRes; saProxyGap: number | null; altProxyGap: number | null
}

function adviceFor(e: CandEval): { notes: string[]; recommend: ExtraKind[] } {
  const notes: string[] = [], recommend: ExtraKind[] = []
  if (!e.sa) return { notes: ['SA 결과가 아직 없습니다 — 위의 "전체 후보 SA 새로 실행"을 먼저 끝내세요.'], recommend }
  const sa = e.sa.summary.cost
  if (e.saProxyGap !== null) {
    if (e.saProxyGap <= TOL) notes.push(`정확해(DP, 프록시 모델)와 ${round(e.saProxyGap)}% 차이 — SA가 사실상 최적에 도달했습니다.`)
    else { notes.push(`정확해(DP, 프록시 모델)보다 ${round(e.saProxyGap)}% 나쁩니다 — 더 탐색할 여지가 있습니다.`); recommend.push('seeds', 'hybrid') }
  }
  if (e.alt && e.alt.summary.cost < sa * (1 - TOL / 100)) {
    notes.push(`스펙트럴 + 다듬기가 SA 최선보다 ${round(-dPct(sa, e.alt.summary.cost))}% 낮은 비용입니다 — SA가 좋은 영역을 못 찾았습니다. 스펙트럴 해에서 SA를 시작(하이브리드)하거나 seed를 늘려 보세요.`)
    recommend.push('hybrid', 'seeds')
  }
  if (e.spread !== null && e.spread > 3) { notes.push(`직전·새 SA 실행이 ${round(e.spread)}% 달라 seed 편차가 큽니다 — seed를 늘려 분포를 확인하세요.`); recommend.push('seeds') }
  if (!notes.length && e.n >= BIG_N) { notes.push('seed 2개만 돌린 큰 회로입니다 — 추가 seed로 확인하는 것을 권장합니다.'); recommend.push('seeds') }
  if (!notes.length) notes.push('SA와 스펙트럴이 같은 값(0.5% 이내)에 수렴했습니다 — 추가 실험은 필요 없습니다.')
  // 보완 실험을 이미 돌렸다면 그 결과의 결론도 덧붙인다.
  if (e.seeds) {
    const cs = [...e.seeds.costs].sort((a, b) => a - b), spread = dPct(cs[0], cs[cs.length - 1])
    notes.push(`seed 확대 결과: 최저 ${round(cs[0])} ~ 최고 ${round(cs[cs.length - 1])} (편차 ${round(spread)}%)${e.alt && e.sa && e.sa.summary.cost > e.alt.summary.cost * (1 + TOL / 100) ? ' — seed를 늘려도 스펙트럴에 못 미칩니다' : e.alt ? ' — SA가 스펙트럴 수준에 도달했습니다' : ''}.`)
  }
  if (e.hybrid && e.alt && e.sa) {
    const h = e.hybrid.summary.cost, a = e.alt.summary.cost, s = e.sa.summary.cost
    notes.push(`하이브리드 결과 ${round(h)}: 스펙트럴 대비 ${dText(dPct(a, h))}, SA 최선 대비 ${dText(dPct(s, h))} — ${h < Math.min(a, s) * (1 - TOL / 100) ? '둘 중 더 좋은 쪽보다도 낮습니다. 이 후보에는 하이브리드를 쓰세요' : h < a * (1 - TOL / 100) ? '스펙트럴 해를 더 개선했습니다' : '스펙트럴 해에서 더 나아지지 않았습니다(이미 좋은 해이거나 국소 최적)'}.`)
  }
  return { notes, recommend: [...new Set(recommend)] }
}

function verdictOf(evals: CandEval[]) {
  const pairs = evals.filter(e => e.sa && e.alt)
  const rel = (e: CandEval) => dPct(e.sa!.summary.cost, e.alt!.summary.cost) // + 이면 스펙트럴이 더 나쁨
  const spWin = pairs.filter(e => rel(e) < -TOL), saWin = pairs.filter(e => rel(e) > TOL)
  const mean = (a: number[]) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null
  const sorted = pairs.map(rel).sort((a, b) => a - b)
  const median = sorted.length ? (sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2) : null
  const small = pairs.filter(e => e.n < BIG_N), large = pairs.filter(e => e.n >= BIG_N)
  const dpPairs = evals.filter(e => e.saProxyGap !== null && e.altProxyGap !== null)
  return { pairs, spWin, saWin, tie: pairs.length - spWin.length - saWin.length, mean: mean(sorted), median, meanSmall: mean(small.map(rel)), meanLarge: mean(large.map(rel)), nSmall: small.length, nLarge: large.length,
    dpN: dpPairs.length, dpSa: mean(dpPairs.map(e => e.saProxyGap!)), dpAlt: mean(dpPairs.map(e => e.altProxyGap!)) }
}

function PerfSummary({ tier, evals, seeds, running, onBatch }: { tier: 2 | 3; evals: CandEval[]; seeds: number; running: boolean; onBatch: (kind: ExtraKind, ids: string[]) => void }) {
  const v = verdictOf(evals)
  if (!v.pairs.length) return null
  const sgn = (x: number | null) => x === null ? '—' : dText(x)
  const lost = v.spWin // SA가 스펙트럴에게 진 후보 = seed·하이브리드로 풀어 볼 후보
  const seedTried = lost.filter(e => e.seeds), seedSolved = seedTried.filter(e => e.sa!.summary.cost <= e.alt!.summary.cost * (1 + TOL / 100))
  const hybTried = evals.filter(e => e.hybrid && e.alt && e.sa)
  const hybGain = hybTried.filter(e => e.hybrid!.summary.cost < e.alt!.summary.cost * (1 - TOL / 100))
  const hybBeatBoth = hybTried.filter(e => e.hybrid!.summary.cost < Math.min(e.alt!.summary.cost, e.sa!.summary.cost) * (1 - TOL / 100))
  let headline: string, tone = '#7F77DD'
  if (v.nSmall && v.nLarge && v.meanSmall !== null && v.meanLarge !== null && v.meanSmall > TOL && v.meanLarge < -TOL) { headline = `크기에 따라 갈립니다 — ${BIG_N}셀 미만은 SA, ${BIG_N}셀 이상은 스펙트럴 + 다듬기가 더 좋습니다.`; tone = '#C0A02B' }
  else if (v.saWin.length > v.spWin.length) { headline = 'SA가 더 좋은 후보가 더 많습니다.'; tone = '#1D9E75' }
  else if (v.spWin.length > v.saWin.length) { headline = '스펙트럴 + 다듬기가 더 좋은 후보가 더 많습니다.'; tone = '#7F77DD' }
  else headline = '두 방식의 결과가 비슷합니다.'
  const spreadOf = (r?: ExtraRes) => r && r.costs.length > 1 ? dPct(Math.min(...r.costs), Math.max(...r.costs)) : null
  const avgOf = (xs: (number | null)[]) => { const ys = xs.filter((x): x is number => x !== null); return ys.length ? ys.reduce((a, b) => a + b, 0) / ys.length : null }
  const hybSpread = avgOf(hybTried.map(e => spreadOf(e.hybrid))), seedSpread = avgOf(hybTried.map(e => spreadOf(e.seeds)))
  const lostIds = lost.map(e => e.id)
  const bigLost = lost.filter(e => e.n >= BIG_N)
  return <div className="card" style={{ padding: 12, margin: '0 0 10px', borderLeft: `4px solid ${tone}` }}>
    <small className="kicker">PERFORMANCE SUMMARY · 현재 성능 요약</small>
    <h3 style={{ margin: '2px 0 6px', fontSize: 15 }}>{tier === 3 ? '20개 이상' : '10개 이하'} 탭: {headline}</h3>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 8, marginBottom: 8 }}>
      <article className="card" style={{ padding: 8, margin: 0 }}><small>후보별 승패 (비용 기준)</small><div style={{ fontSize: 13 }}><b style={{ color: '#7F77DD' }}>스펙트럴 {v.spWin.length}</b> · 동률 {v.tie} · <b style={{ color: '#1D9E75' }}>SA {v.saWin.length}</b></div><small>{v.pairs.length}개 후보, ±{TOL}% 이내는 동률</small></article>
      <article className="card" style={{ padding: 8, margin: 0 }}><small>스펙트럴의 SA 대비 비용</small><div style={{ fontSize: 13 }}>평균 <b>{sgn(v.mean)}</b> · 중앙값 <b>{sgn(v.median)}</b></div><small>+ 이면 스펙트럴이 더 나쁨. 큰 승리 몇 건이 평균을 끌어내림</small></article>
      {v.nSmall > 0 && v.nLarge > 0 && <article className="card" style={{ padding: 8, margin: 0 }}><small>크기별 (스펙트럴 − SA)</small><div style={{ fontSize: 13 }}>{BIG_N}셀 미만 <b>{sgn(v.meanSmall)}</b> ({v.nSmall}개)<br/>{BIG_N}셀 이상 <b>{sgn(v.meanLarge)}</b> ({v.nLarge}개)</div></article>}
      {v.dpN > 0 && <article className="card" style={{ padding: 8, margin: 0 }}><small>정확해(DP) 대비 격차 · {v.dpN}개 후보</small><div style={{ fontSize: 13 }}>SA <b>{sgn(v.dpSa)}</b> · 스펙트럴 <b>{sgn(v.dpAlt)}</b></div><small>프록시 모델 기준, 0 이상이 정상</small></article>}
    </div>
    <p style={{ margin: '0 0 6px', fontSize: 12, lineHeight: 1.7 }}>
      <b>어느 방식이 나은가:</b> 이 표의 SA 값은 후보당 seed {seeds}개 중 최선(역대 최선 포함)이고 스펙트럴은 단일 결정적 결과입니다.{' '}
      {v.nLarge > 0 && v.meanLarge !== null && v.meanLarge < -TOL && <>{BIG_N}셀 이상에서는 스펙트럴이 평균 {sgn(v.meanLarge)} 더 낮은 비용이며 계산도 훨씬 빠릅니다(후보당 수백 ms). </>}
      {v.nSmall > 0 && v.meanSmall !== null && v.meanSmall > TOL && <>{BIG_N}셀 미만에서는 SA가 평균 {sgn(v.meanSmall)} 앞섭니다 — 스펙트럴은 국소 최적에 갇힙니다. </>}
      {v.nSmall > 0 && v.meanSmall !== null && Math.abs(v.meanSmall) <= TOL && <>{BIG_N}셀 미만에서는 두 방식이 같은 값에 모입니다. </>}
    </p>
    <p style={{ margin: '0 0 6px', fontSize: 12, lineHeight: 1.7 }}>
      <b>seed를 늘리면 해결되나:</b>{' '}
      {!lost.length ? <>SA가 스펙트럴에게 진 후보가 없어 seed를 늘릴 필요는 없습니다.</>
        : !seedTried.length ? <>SA가 스펙트럴에게 진 후보가 {lost.length}개({lost.map(e => `${e.n}셀`).join(', ')})입니다. <b>아직 seed 확대 실험을 하지 않았습니다</b> — 아래 버튼으로 확인할 수 있습니다.</>
          : <>SA가 진 {lost.length}개 중 {seedTried.length}개에서 seed를 늘려 봤고, <b>{seedSolved.length}개에서 SA가 스펙트럴을 따라잡았습니다</b>{seedSolved.length ? ` (${seedSolved.map(e => `${e.n}셀`).join(', ')})` : ''}.{' '}
            {seedTried.length > seedSolved.length ? <>나머지 {seedTried.length - seedSolved.length}개({seedTried.filter(e => !seedSolved.includes(e)).map(e => `${e.n}셀`).join(', ')})는 seed를 늘린 뒤에도 스펙트럴보다 나쁩니다 — 하이브리드(스펙트럴 해에서 시작)를 권장합니다. </> : <>seed 확대만으로 충분합니다. </>}
            {seedTried.length < lost.length && <>(미실험 {lost.length - seedTried.length}개)</>}</>}
    </p>
    <p style={{ margin: '0 0 6px', fontSize: 12, lineHeight: 1.7 }}>
      <b>하이브리드(스펙트럴 해에서 시작하는 SA):</b>{' '}
      {!hybTried.length ? <>아직 실험하지 않았습니다. 스펙트럴의 속도와 SA의 탈출 능력을 합치는 방식이라 가장 먼저 시도해 볼 만합니다.</>
        : <>실험한 {hybTried.length}개 중 {hybGain.length}개에서 스펙트럴 해보다 더 낮췄고, {hybBeatBoth.length}개에서는 SA·스펙트럴 중 더 좋은 쪽보다도 낮췄습니다.</>}
    </p>
    <div style={{ fontSize: 12, lineHeight: 1.7 }}><b>추천 해결 방안</b>
      <ol style={{ margin: '2px 0 6px 18px', padding: 0 }}>
        {bigLost.length > 0 || lost.length > 0
          ? <><li>SA가 진 후보({lost.length}개)에는 <b>seed 확대</b>와 <b>하이브리드</b>를 먼저 실행해 비교합니다{bigLost.length ? ` — 특히 ${BIG_N}셀 이상(${bigLost.length}개)은 seed ${seeds}개로는 부족합니다` : ''}.</li>
            <li>기본 흐름은 <b>스펙트럴로 먼저 푼 뒤(수백 ms) 그 해에서 SA를 시작</b>하는 것입니다.{hybSpread !== null && <> 실험에서 하이브리드 반복 결과의 편차는 평균 {round(hybSpread)}%{seedSpread !== null ? <>로, 무작위 출발 SA의 seed 편차 평균 {round(seedSpread)}%보다 작았습니다</> : <>였습니다</>}.</>}</li></>
          : <li>현재는 SA만으로 충분합니다. 스펙트럴은 빠른 초기해·검증용으로 함께 쓰세요.</li>}
        {v.saWin.length > 0 && <li>SA가 이긴 후보({v.saWin.length}개)는 스펙트럴이 더 나쁜 경우라 <b>SA를 유지</b>합니다. 이 후보들에서도 하이브리드가 이득인지는 후보 카드의 하이브리드 버튼으로 확인할 수 있습니다.</li>}
        {v.dpN > 0 && v.dpSa !== null && v.dpSa > TOL && <li>정확해(DP)와의 평균 격차가 SA {sgn(v.dpSa)}로 남아 있어 SA만으로는 최적에 닿지 못합니다.</li>}
      </ol>
    </div>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
      <button type="button" disabled={running || !lostIds.length} onClick={() => onBatch('seeds', lostIds)}>SA가 진 후보 {lostIds.length}개에 seed 확대 실험 일괄 실행</button>
      <button type="button" disabled={running || !lostIds.length} onClick={() => onBatch('hybrid', lostIds)}>SA가 진 후보 {lostIds.length}개에 하이브리드 일괄 실행</button>
    </div>
  </div>
}

type CompareProps = {
  tier: 2 | 3; simpleRows: SimpleRow[]; savedRun: SavedRun | null
  cmp: { tier: number; rows: CmpRow[]; running: boolean; label: string; previous: SavedRun | null } | null
  running: boolean; improving: { id: string; attempts: number; running: boolean } | null; alt: Record<string, AltRow>
  dp: Record<string, DpRow>; dpLive: { label: string; done: number; total: number; idx: number; count: number } | null
  extra: ExtraMap; extraLive: { id: string; label: string } | null
  seeds: number; onRun: () => void; onImprove: (id: string) => void; onStop: () => void; onOpen: (id: string) => void
  onDp: () => void; onExtra: (id: string, kind: ExtraKind) => void; onExtraBatch: (kind: ExtraKind, ids: string[]) => void
}

function CompareSection({ tier, simpleRows, savedRun, cmp, running, improving, alt, dp, dpLive, extra, extraLive, seeds, onRun, onImprove, onStop, onOpen, onDp, onExtra, onExtraBatch }: CompareProps) {
  const rows = [...simpleRows].sort((x, y) => x.n - y.n || x.label.localeCompare(y.label))
  const current = cmp?.tier === tier ? cmp.rows.map(r => ({ id: r.id, sa: r.sa, summary: r.saS })) : savedRun?.rows ?? []
  const previous = cmp?.tier === tier ? cmp.previous?.rows ?? [] : savedRun?.previous ?? []
  const best = savedRun?.best ?? savedRun?.rows ?? []
  const find = (list: { id: string; sa: State; summary: Summary }[], id: string) => list.find(r => r.id === id)
  const evals: CandEval[] = rows.map(r => {
    const sa = find(best, r.id) ?? find(current, r.id) ?? null, now = find(current, r.id), old = find(previous, r.id)
    const a = alt[r.id] ?? null, d = dp[r.id] ?? null, ex = extra[r.id]
    return { id: r.id, label: r.label, n: r.n, sa, alt: a, dp: d, spread: now && old ? Math.abs(dPct(old.summary.cost, now.summary.cost)) : null, seeds: ex?.seeds, hybrid: ex?.hybrid,
      saProxyGap: sa && d ? dPct(d.proxy, proxyOf(r.ctx, sa.sa)) : null, altProxyGap: a && d ? dPct(d.proxy, proxyOf(r.ctx, a.state)) : null }
  })
  const evalOf = (id: string) => evals.find(e => e.id === id)!
  const altMs = rows.reduce((sum, r) => sum + (alt[r.id]?.ms ?? 0), 0)
  const dpCount = rows.filter(r => r.n <= MAX_DP_N).length, dpDone = rows.filter(r => dp[r.id]).length
  return <div className="card" style={{ padding: 12, marginBottom: 12, borderLeft: '4px solid #1D9E75' }}>
    <div className="card-title" style={{ marginBottom: 6 }}><div><small className="kicker">전체 후보 · 기본 배치와 SA 비교</small><h3>{tier === 2 ? '10개 이하' : '20개 이상'} 후보 {rows.length}개 레이아웃</h3></div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}><button type="button" className="active" disabled={running || rows.length === 0} onClick={onRun}>전체 후보 SA 새로 실행 (후보당 seed {seeds}개)</button>
        <button type="button" disabled={running || !dpCount || dpDone === dpCount} onClick={onDp}>정확해 DP 실행 ({dpCount}개 후보 · ≤{MAX_DP_N}셀){dpDone ? ` · ${dpDone}/${dpCount} 완료` : ''}</button>
        {(cmp?.running || improving?.running || dpLive || extraLive) && <button type="button" onClick={onStop}>중지</button>}</div></div>
    <p className="chip-note" style={{ margin: '0 0 8px' }}>기본 방식은 회로에 적힌 셀 순서, N 방향, 간격 0으로 즉시 배치합니다. 저장된 결과가 없으면 전체 후보 SA를 자동 실행합니다. 새 실행 결과는 기본 방식·직전 SA·역대 최선과 비교합니다. 완료한 후보부터 이 브라우저에 저장하고, 중단되면 이어서 실행합니다.</p>
    {cmp?.running && cmp.tier === tier && <p className="chip-note" style={{ margin: '0 0 8px', color: '#C0A02B' }}>SA 진행 중: {cmp.label} ({cmp.rows.length}/{rows.length})</p>}
    {improving?.running && <p className="chip-note" style={{ margin: '0 0 8px', color: '#C0A02B' }}>더 나은 결과 탐색 중: {rows.find(r => r.id === improving.id)?.label} · SA {improving.attempts}회 완료 (위 중지 버튼으로 멈출 수 있습니다)</p>}
    {dpLive && <p className="chip-note" style={{ margin: '0 0 8px', color: '#C0A02B' }}>정확해 DP 계산 중 ({dpLive.idx}/{dpLive.count}): {dpLive.label} · {Math.round(dpLive.done / dpLive.total * 100)}%</p>}
    {extraLive && <p className="chip-note" style={{ margin: '0 0 8px', color: '#C0A02B' }}>보완 실험 진행 중: {extraLive.label}</p>}
    <PerfSummary tier={tier} evals={evals} seeds={seeds} running={running} onBatch={onExtraBatch}/>
    {rows.length > 0 && <>
      <div className="data-table"><table><thead><tr><th>후보</th><th>셀</th><th>기본 비용</th><th>직전 SA</th><th>새 SA</th><th>역대 최선</th><th>기본 대비</th><th>직전 대비</th><th>역대 최선 대비</th><th>스펙트럴+다듬기</th><th>SA 최선 대비</th><th>계산 시간</th><th>DP 정확해</th><th>SA의 DP 격차</th><th>스펙트럴의 DP 격차</th></tr></thead><tbody>
        {rows.map(r => { const now = find(current, r.id), old = find(previous, r.id), record = find(best, r.id), a = alt[r.id], ref = record ?? now, d = dp[r.id], e = evalOf(r.id)
          return <tr key={r.id} style={{ cursor: 'pointer' }} onClick={() => onOpen(r.id)}><td><b>{r.label}</b></td><td>{r.n}</td><td>{round(r.initS.cost)}</td>
            <td>{old ? round(old.summary.cost) : '—'}</td><td>{now ? <b>{round(now.summary.cost)}</b> : '실행 전'}</td><td>{record ? round(record.summary.cost) : '—'}</td>
            <td>{now ? <span style={{ color: dTone(dPct(r.initS.cost, now.summary.cost)) }}>{dText(dPct(r.initS.cost, now.summary.cost))}</span> : '—'}</td>
            <td>{now && old ? <span style={{ color: dTone(dPct(old.summary.cost, now.summary.cost)) }}>{dText(dPct(old.summary.cost, now.summary.cost))}</span> : '—'}</td>
            <td>{now && record ? <span style={{ color: dTone(dPct(record.summary.cost, now.summary.cost)) }}>{dText(dPct(record.summary.cost, now.summary.cost))}</span> : '—'}</td>
            <td>{a ? <b>{round(a.summary.cost)}</b> : '계산 중'}</td>
            <td>{a && ref ? <span style={{ color: dTone(dPct(ref.summary.cost, a.summary.cost)), fontWeight: 700 }}>{dText(dPct(ref.summary.cost, a.summary.cost))}</span> : '—'}</td>
            <td>{a ? `${round(a.ms)} ms` : '—'}</td>
            <td>{d ? <><b>{round(d.summary.cost)}</b><div style={{ fontSize: 10 }}>{d.ms < 1000 ? `${round(d.ms)} ms` : `${round(d.ms / 1000)} 초`}</div></> : r.n > MAX_DP_N ? <span style={{ fontSize: 11 }}>{r.n}셀 &gt; {MAX_DP_N}</span> : '—'}</td>
            <td>{e.saProxyGap !== null ? dText(e.saProxyGap) : '—'}</td><td>{e.altProxyGap !== null ? dText(e.altProxyGap) : '—'}</td></tr> })}
      </tbody></table></div>
      <p className="chip-note" style={{ margin: '6px 0 0' }}><b>스펙트럴 + 다듬기</b> 전체 계산 {round(altMs)} ms (무작위 없음 · seed 불필요 · 매번 같은 결과). "SA 최선 대비"가 음수(초록)면 SA보다 좋은 배치입니다. <b>DP 정확해</b>는 "왼쪽에 놓인 셀의 집합"만 상태로 쓰는 동적계획법의 결과로, 핀 위치를 핀 도형 중심 하나로 단순화한 <b>프록시 모델에서 정확한 최적</b>이고 열의 비용은 그 해를 실제 모델로 다시 잰 값입니다. "DP 격차"는 SA·스펙트럴 해를 같은 프록시 모델로 재서 DP 최적과 비교한 값이라 항상 0 이상입니다. 실제 모델은 거리에 따라 핀 도형을 바꿔 고를 수 있어 DP 해보다 SA 해가 실제 비용에서는 조금 낮을 수 있습니다.</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(360px,1fr))', gap: 12, marginTop: 12 }}>
        {rows.map(r => { const now = find(current, r.id), old = find(previous, r.id), record = find(best, r.id), a = alt[r.id], ref = record ?? now, d = dp[r.id], e = evalOf(r.id), adv = adviceFor(e), ex = extra[r.id]
          const scale = Math.max(6, Math.min(30, 1100 / Math.max(r.initS.width, now?.summary.width ?? 0, old?.summary.width ?? 0, record?.summary.width ?? 0, a?.summary.width ?? 0, d?.summary.width ?? 0)))
          const exRows = (['seeds', 'hybrid'] as ExtraKind[]).flatMap(k => ex?.[k] ? [ex[k]!] : [])
          return <article key={r.id} className="card" style={{ padding: 12, margin: 0, minWidth: 0, borderTop: '3px solid #1D9E75' }}>
            <b>{r.n}셀 · {r.label}</b>
            <div style={{ margin: '8px 0 2px', fontSize: 12 }}><b>기본 방식</b> · 비용 {round(r.initS.cost)} · 폭 {round(r.initS.width)} µm · 배선 {round(r.initS.wl)} µm</div>
            <RowView ctx={r.ctx} st={r.init} S={scale}/>
            {old && <><div style={{ margin: '8px 0 2px', fontSize: 12 }}><b>직전 SA</b> · 비용 {round(old.summary.cost)} · 폭 {round(old.summary.width)} µm · 배선 {round(old.summary.wl)} µm</div><RowView ctx={r.ctx} st={old.sa} S={scale}/></>}
            {record && (!now || JSON.stringify(record.sa) !== JSON.stringify(now.sa)) && <><div style={{ margin: '8px 0 2px', fontSize: 12 }}><b>역대 최선</b> · 비용 {round(record.summary.cost)} · 폭 {round(record.summary.width)} µm · 배선 {round(record.summary.wl)} µm</div><RowView ctx={r.ctx} st={record.sa} S={scale}/></>}
            {now ? <><div style={{ margin: '8px 0 2px', fontSize: 12 }}><b style={{ color: '#1D9E75' }}>새 SA</b> · 비용 {round(now.summary.cost)} · 폭 {round(now.summary.width)} µm · 배선 {round(now.summary.wl)} µm</div><RowView ctx={r.ctx} st={now.sa} S={scale}/>
              <p className="chip-note" style={{ margin: '6px 0 0' }}>기본 대비 비용 {dText(dPct(r.initS.cost, now.summary.cost))}{old ? ` · 직전 SA 대비 ${dText(dPct(old.summary.cost, now.summary.cost))}` : ''}</p></>
              : <p className="chip-note" style={{ margin: '6px 0 0' }}>SA 실행 전 · 기본 레이아웃 표시 중</p>}
            {a ? <><div style={{ margin: '8px 0 2px', fontSize: 12 }}><b style={{ color: '#7F77DD' }}>스펙트럴 + 다듬기 (SA 아님)</b> · 비용 {round(a.summary.cost)} · 폭 {round(a.summary.width)} µm · 배선 {round(a.summary.wl)} µm · {round(a.ms)} ms (평가 {fmtN(a.evals)}회, {a.passes}회 반복)</div><RowView ctx={r.ctx} st={a.state} S={scale}/>{ref && <p className="chip-note" style={{ margin: '6px 0 0' }}>SA 최선 대비 비용 {dText(dPct(ref.summary.cost, a.summary.cost))}</p>}</> : <p className="chip-note" style={{ margin: '6px 0 0' }}>스펙트럴 + 다듬기 계산 중…</p>}
            {d && <><div style={{ margin: '8px 0 2px', fontSize: 12 }}><b style={{ color: '#C0392B' }}>DP 정확해 (프록시 모델 최적)</b> · 실제 비용 {round(d.summary.cost)} (프록시 {round(d.proxy)}) · 폭 {round(d.summary.width)} µm · 배선 {round(d.summary.wl)} µm · {d.ms < 1000 ? `${round(d.ms)} ms` : `${round(d.ms / 1000)} 초`} (상태 {fmtN(d.states)}개)</div><RowView ctx={r.ctx} st={d.state} S={scale}/></>}
            <div style={{ marginTop: 10, padding: 8, borderRadius: 6, background: 'var(--surface-muted)', fontSize: 12, lineHeight: 1.6 }}>
              <b>SA 추천 · 보완 실험</b>
              <ul style={{ margin: '4px 0 6px 16px', padding: 0 }}>{adv.notes.map(t => <li key={t}>{t}</li>)}</ul>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <button type="button" className={adv.recommend.includes('seeds') ? 'active' : ''} disabled={running || !ref} onClick={() => onExtra(r.id, 'seeds')}>{EXTRA_LABEL.seeds} ({extraRuns('seeds', r.n)}개){adv.recommend.includes('seeds') ? ' · 추천' : ''}</button>
                <button type="button" className={adv.recommend.includes('hybrid') ? 'active' : ''} disabled={running || !a || !ref} onClick={() => onExtra(r.id, 'hybrid')}>{EXTRA_LABEL.hybrid} ({extraRuns('hybrid', r.n)}회){adv.recommend.includes('hybrid') ? ' · 추천' : ''}</button>
                <button type="button" disabled={running || !record} onClick={() => onImprove(r.id)}>이 후보에서 더 나은 배치 찾을 때까지 SA 반복</button></div>
              {exRows.length > 0 && <div className="data-table" style={{ marginTop: 6 }}><table><thead><tr><th>보완 실험</th><th>시도</th><th>최저</th><th>중앙값</th><th>최고</th><th>실험 전 SA 최선 대비</th><th>시간</th></tr></thead><tbody>
                {exRows.map(x => { const cs = [...x.costs].sort((p, q) => p - q), med = cs.length % 2 ? cs[(cs.length - 1) / 2] : (cs[cs.length / 2 - 1] + cs[cs.length / 2]) / 2
                  return <tr key={x.kind}><td>{EXTRA_LABEL[x.kind]}</td><td>{x.costs.length}</td><td><b>{round(cs[0])}</b></td><td>{round(med)}</td><td>{round(cs[cs.length - 1])}</td>
                    <td>{x.before !== null ? <span style={{ color: dTone(dPct(x.before, cs[0])), fontWeight: 700 }}>{dText(dPct(x.before, cs[0]))}</span> : '—'}</td><td>{x.ms < 1000 ? `${round(x.ms)} ms` : `${round(x.ms / 1000)} 초`}</td></tr> })}
              </tbody></table></div>}
              {exRows.length > 0 && <p className="chip-note" style={{ margin: '4px 0 0' }}>seed 확대의 최저 비용은 SA 역대 최선에 반영됩니다. 하이브리드는 SA와 다른 방식이라 합치지 않고 따로 비교합니다. 최저~최고 편차가 클수록 seed에 따라 결과가 갈린다는 뜻입니다.</p>}
            </div>
          </article> })}
      </div>
    </>}
  </div>
}

// ---- SA 구동 원리 설명 카드: 숫자는 위 코드의 상수와 사용자의 실제 실행 결과에서 계산한다 ----
function SaExplainer({ n, results, usPerEval }: { n: number; results: SaResult[]; usPerEval: number | null }) {
  const stages = saStages(), perStage = saMovesPerStage(n), moves = stages * perStage
  // 평균적인 '나빠지는 이동'의 수용 확률: T = T0·α^s, T0 = Δ̄/ln(1/p0) 이므로 p(s) = p0^(1/α^s)
  const acc = (s: number) => Math.pow(SA_T0_ACCEPT, 1 / Math.pow(SA_ALPHA, s))
  const freeze = Math.ceil(Math.log(Math.log(0.01) / Math.log(SA_T0_ACCEPT)) / Math.log(1 / SA_ALPHA))
  const probs = [0, 10, 20, 30, freeze, 60, 90, stages - 1].filter((s, i, a) => s < stages && a.indexOf(s) === i)
  const W = 380, H = 150, padL = 36, padB = 22, padT = 8, padR = 8
  const X = (s: number) => padL + s / (stages - 1) * (W - padL - padR), Y = (p: number) => padT + (1 - p) * (H - padT - padB)
  const pts = Array.from({ length: stages }, (_, s) => `${X(s)},${Y(acc(s))}`).join(' ')
  const tpts = Array.from({ length: stages }, (_, s) => `${X(s)},${Y(Math.pow(SA_ALPHA, s))}`).join(' ')
  const found = results.map(r => { const final = r.trace[r.trace.length - 1]?.best ?? r.best; const idx = r.trace.findIndex(t => t.best <= final + 1e-9); return { seed: r.seed, final, stage: idx + 1, of: r.trace.length } })
  const mono = { fontFamily: 'var(--font-mono)', fontSize: 11.5, lineHeight: 1.7, background: 'var(--surface-muted)', padding: 10, borderRadius: 6, margin: '6px 0', whiteSpace: 'pre-wrap' as const }
  return <div className="card" style={{ padding: 12, marginTop: 14 }}>
    <div className="card-title" style={{ marginBottom: 6 }}><div><small className="kicker">HOW SA WORKS · 이 실험의 실제 구현 기준</small><h3>SA가 실제로 어떻게 동작하나 — 이동 횟수는 어떻게 정해지나</h3></div></div>

    <b style={{ fontSize: 13 }}>1. 한 번의 SA (seed 1개)</b>
    <div style={mono}>{`1) 시작 배치: 셀 순서를 무작위로 섞고, 셀마다 N/FN을 50%로 정하고, 간격은 전부 0
2) 시작 온도 T0: 시작 배치에서 이동 200번을 시험해 '비용이 늘어난 이동'의 평균 증가량 Δ̄를 구하고
              T0 = Δ̄ / ln(1/${SA_T0_ACCEPT})  → 평균적인 나쁜 이동을 처음엔 ${SA_T0_ACCEPT * 100}% 확률로 받아들임
3) 단계(stage)를 ${stages}번 반복:
     온도 T를 고정한 채 이동을 (${n}셀 기준) ${fmtN(perStage)}번 시도
       - 이동 후보 하나를 만들어 비용을 계산
       - 비용이 같거나 낮으면 무조건 수용
       - 비용이 높아지면 확률 e^(-Δ/T)로 수용 (Δ = 늘어난 비용)
       - 수용했고 지금까지 최선보다 낮으면 '최선' 갱신
     단계가 끝나면 T ← T × ${SA_ALPHA}
4) 끝: 지금까지 찾은 최선 배치를 반환 (seed마다 따로 실행)`}</div>
    <p className="chip-note" style={{ margin: '0 0 12px' }}>온도가 높을 때는 나빠지는 이동도 자주 받아들여 국소 최적을 벗어나고, 식을수록 좋아지는 이동만 남아 한 곳에 정착합니다. seed는 난수 시작값이라 같은 seed는 늘 같은 결과를 냅니다.</p>

    <b style={{ fontSize: 13 }}>2. 이동 횟수는 이렇게 정합니다 — 고정된 예산 규칙</b>
    <div style={mono}>{`단계 수       = ceil( ln(${SA_FINAL_RATIO}) / ln(${SA_ALPHA}) ) = ${stages}      ← 온도가 처음의 ${SA_FINAL_RATIO}배가 될 때까지 ${SA_ALPHA}배씩 식히는 횟수
단계당 이동   = max(100, 40 × 셀 수 n)                    ← 셀 하나당 온도 한 단계에 평균 40번씩
총 이동       = 단계 수 × 단계당 이동 = ${stages} × ${fmtN(perStage)} = ${fmtN(moves)}  (선택한 후보 ${n}셀)
총 시간       ≈ 총 이동 × 평가 1회 시간${usPerEval ? ` (${round(usPerEval)} µs 실측) = ${round(moves * usPerEval / 1000)} ms / seed` : ''}`}</div>
    <div className="data-table"><table><thead><tr><th>셀 수 n</th><th>단계당 이동</th><th>총 이동</th><th>전체 배치 수 n!·2ⁿ·3ⁿ⁻¹</th><th>SA가 평가하는 비율</th></tr></thead><tbody>
      {[2, 4, 6, 8, 10, 15, 20, 30, 40, 50].concat([n]).filter((m, i, a) => a.indexOf(m) === i).sort((a, b) => a - b).map(m => { const mv = stages * saMovesPerStage(m), pl = placementsOf(m), r = mv / pl * 100
        return <tr key={m} style={{ background: m === n ? 'var(--accent-soft)' : undefined, fontWeight: m === n ? 700 : undefined }}><td>{m}{m === n ? ' ← 선택' : ''}</td><td>{fmtN(saMovesPerStage(m))}</td><td>{fmtN(mv)}</td><td>{fmtBig(pl)}</td>
          <td>{r >= 100 ? '전체보다 많음 → 전수가 더 빠름' : r >= 0.01 ? `${round(r)}%` : r.toExponential(1) + '%'}</td></tr> })}
    </tbody></table></div>
    <p className="chip-note" style={{ margin: '6px 0 12px' }}>총 이동은 셀 수에 <b>비례(선형)</b>로만 늘지만 배치 수는 <b>계승(n!)</b>으로 늡니다 — 그래서 셀이 많을수록 SA는 전체의 아주 작은 부분만 보고, 같은 답을 찾을 확률도 떨어집니다. 이 규칙은 진행 상황을 보고 조절하지 않으며, 최선이 더 안 나아져도 {stages}단계를 끝까지 돕니다.{n >= 20 ? ` ${n}셀은 배치가 ${fmtBig(placementsOf(n))}가지라 전수 탐색은 불가능하고, SA가 보는 비율은 사실상 0입니다. 결과가 seed마다 크게 다르면 seed를 늘리거나 단계당 이동 계수(40)를 키워야 합니다.` : ''}</p>

    <b style={{ fontSize: 13 }}>3. 온도와 수용 확률 — 왜 앞쪽에서 이미 거의 결정되나</b>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))', gap: 12, margin: '6px 0' }}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="단계별 온도와 평균 나쁜 이동의 수용 확률" style={{ width: '100%', color: 'var(--text)' }}>
        <line x1={padL} y1={H - padB} x2={W - padR} y2={H - padB} stroke="currentColor" opacity={0.3}/><line x1={padL} y1={padT} x2={padL} y2={H - padB} stroke="currentColor" opacity={0.3}/>
        <rect x={X(freeze)} y={padT} width={X(stages - 1) - X(freeze)} height={H - padT - padB} fill="#C0392B" opacity={0.07}/>
        <line x1={X(freeze)} y1={padT} x2={X(freeze)} y2={H - padB} stroke="#C0392B" strokeDasharray="4 3"/>
        <polyline points={tpts} fill="none" stroke="#888780" strokeDasharray="3 3" strokeWidth={1.4}/>
        <polyline points={pts} fill="none" stroke="#7F77DD" strokeWidth={2}/>
        <text x={padL - 4} y={Y(1) + 4} fontSize={9} textAnchor="end" fill="currentColor">100%</text><text x={padL - 4} y={Y(0) + 3} fontSize={9} textAnchor="end" fill="currentColor">0</text>
        <text x={padL} y={H - 6} fontSize={9} fill="currentColor">단계 0</text><text x={W - padR} y={H - 6} fontSize={9} textAnchor="end" fill="currentColor">{stages}</text>
        <text x={X(freeze) + 4} y={padT + 10} fontSize={9} fill="#C0392B">단계 {freeze} 이후 사실상 동결</text>
        <text x={X(8)} y={Y(acc(8)) - 6} fontSize={9} fill="#7F77DD">나쁜 이동 수용 확률</text><text x={X(8)} y={Y(Math.pow(SA_ALPHA, 8)) + 12} fontSize={9} fill="#888780">온도 T/T0</text>
      </svg>
      <div className="data-table"><table><thead><tr><th>단계</th><th>T / T0</th><th>평균 나쁜 이동을 받아들일 확률</th></tr></thead><tbody>
        {probs.map(s => <tr key={s}><td>{s + 1}</td><td>{Math.pow(SA_ALPHA, s) >= 0.01 ? round(Math.pow(SA_ALPHA, s)) : Math.pow(SA_ALPHA, s).toExponential(1)}</td><td>{acc(s) >= 0.001 ? `${round(acc(s) * 100)}%` : acc(s) < 1e-12 ? '≈ 0' : `${(acc(s) * 100).toExponential(1)}%`}</td></tr>)}
      </tbody></table></div>
    </div>
    <p className="chip-note" style={{ margin: '0 0 12px' }}>평균적인 나쁜 이동의 수용 확률은 p(s) = {SA_T0_ACCEPT}<sup>1/{SA_ALPHA}<sup>s</sup></sup> 입니다. {SA_T0_ACCEPT * 100}%에서 시작해 단계 {freeze}쯤 1% 아래로 떨어지고, 그 뒤로는 사실상 <b>좋아지는 이동만 받아들이는 탐욕 탐색</b>이 됩니다. 단계 {freeze}는 전체 {stages}단계의 {Math.round(freeze / stages * 100)}%입니다 — 실제 이동의 Δ는 제각각이라 이 값은 평균 기준의 가늠입니다.</p>

    <b style={{ fontSize: 13 }}>4. 이동의 종류 — 한 번에 하나만 바꿉니다</b>
    <div className="data-table"><table><thead><tr><th>확률</th><th>이동</th><th>바뀌는 것</th></tr></thead><tbody>
      <tr><td>{MOVE_P.swap * 100}%</td><td>두 셀 교환</td><td>셀 순서 — 사이에 낀 셀들의 x 좌표가 전부 밀림</td></tr>
      <tr><td>{MOVE_P.insert * 100}%</td><td>한 셀을 빼서 다른 자리에 삽입 (n &gt; 2)</td><td>셀 순서 — 사이 구간 전체가 한 칸씩 밀림</td></tr>
      <tr><td>{MOVE_P.flip * 100}%</td><td>한 셀 좌우 뒤집기 (N↔FN)</td><td>그 셀의 핀 x 위치만 반전</td></tr>
      <tr><td>{round((1 - MOVE_P.swap - MOVE_P.insert - MOVE_P.flip) * 100)}%</td><td>셀 사이 간격 하나 ±1 site (0~2로 제한)</td><td>그 뒤 셀들의 x 좌표가 평행 이동</td></tr>
    </tbody></table></div>

    <b style={{ display: 'block', fontSize: 13, margin: '12px 0 4px' }}>5. 비용 계산(평가 1회)이 하는 일</b>
    <div style={mono}>{`1) 순서·간격으로 각 셀의 x 좌표를 정함  →  면적 항 = 면적가중 × 폭 × 행 높이
2) 넷마다 (드라이버 핀 사각형 × 싱크 핀 사각형 × met1 트랙) 조합을 전부 시험해 가장 싼 하나를 고름
     비용 = 가로 + 세로 + 꺾임벌점 × (꺾임 수) + 세로가중 × 세로
3) 모든 넷의 최소 비용 + 면적 항 = 이 배치의 비용
→ 넷이 많을수록, 핀 사각형·트랙이 많을수록 평가 1회가 느려짐 (이동 횟수와 별개의 시간 요인)`}</div>

    <b style={{ fontSize: 13 }}>6. 이번 실행에서 실제로 본 것</b>
    {found.length === 0 ? <p className="chip-note" style={{ margin: '4px 0' }}>위에서 <b>SA 실행</b>을 누르면, seed마다 최종 최선 비용이 몇 단계에서 처음 나왔는지 여기에 계산됩니다.</p>
      : <><div className="data-table"><table><thead><tr><th>seed</th><th>최종 최선 비용</th><th>처음 나온 단계</th><th>그 뒤 개선 없이 돈 구간</th></tr></thead><tbody>
          {found.map(r => <tr key={r.seed}><td>{r.seed}</td><td><b>{round(r.final)}</b></td><td>{r.stage} / {r.of} ({Math.round(r.stage / r.of * 100)}%)</td><td>{r.of - r.stage}단계 ({Math.round((r.of - r.stage) / r.of * 100)}% — 이동 약 {fmtN((r.of - r.stage) * perStage)}번)</td></tr>)}
        </tbody></table></div>
        <p className="chip-note" style={{ margin: '6px 0 0' }}>최선이 처음 나온 단계는 대체로 동결 단계({freeze}) 근처이거나 그 뒤입니다. 뒤쪽 단계는 거의 개선을 만들지 못하므로 <b>"N단계 연속 개선이 없으면 중단"</b> 같은 조기 종료를 넣으면 시간을 크게 줄일 수 있습니다. 반대로 seed마다 최선 비용이 다르면 이동을 늘리는 것보다 <b>seed(출발점)를 늘리는 쪽</b>이 효과적입니다.</p></>}

    <b style={{ display: 'block', fontSize: 13, margin: '12px 0 4px' }}>7. 바꿔 볼 수 있는 조절값과 이 방식의 한계</b>
    <div className="data-table"><table><thead><tr><th>값</th><th>현재</th><th>바꾸면</th></tr></thead><tbody>
      <tr><td>냉각 비율 α (<code>SA_ALPHA</code>)</td><td>{SA_ALPHA}</td><td>크게(0.95) → 천천히 식어 단계 {Math.ceil(Math.log(SA_FINAL_RATIO) / Math.log(0.95))}, 품질↑·시간↑</td></tr>
      <tr><td>종료 온도 비율 (<code>SA_FINAL_RATIO</code>)</td><td>{SA_FINAL_RATIO}</td><td>1e-3 → 단계 {Math.ceil(Math.log(1e-3) / Math.log(SA_ALPHA))}으로 줄어 약 {Math.round((1 - Math.ceil(Math.log(1e-3) / Math.log(SA_ALPHA)) / stages) * 100)}% 절감</td></tr>
      <tr><td>단계당 이동 (<code>max(100, 40n)</code>)</td><td>{fmtN(perStage)} ({n}셀)</td><td>계수 40을 줄이면 시도 감소, 늘리면 단계당 탐색 증가</td></tr>
      <tr><td>seed 수</td><td>화면에서 선택</td><td>시간이 그대로 곱해짐 · 서로 다른 출발점에서 같은 답이면 신뢰↑</td></tr>
    </tbody></table></div>
    <p className="chip-note" style={{ margin: '6px 0 0' }}><b>한계:</b> 최적을 보장하지 않습니다(6셀은 전수 탐색과 대조해 확인할 수 있습니다). 재시작·재가열·적응형 스케줄은 없고, 넷은 서로 독립으로 가장 좋은 트랙을 골라 같은 트랙 공유 충돌은 검사하지 않습니다. 비용은 가상 규칙 기준이라 실제 DRC·기생값이 아닙니다.</p>
  </div>
}

function CostChart({ traces, optimum }: { traces: SaTrace[][]; optimum: number | null }) {
  const W = 360, H = 170, pad = 44
  const all = traces.flat()
  if (!all.length) return <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%' }} role="img" aria-label="SA 비용 변화 (아직 없음)"><text x={W / 2} y={H / 2} textAnchor="middle" fontSize={11} fill="currentColor" opacity={0.6}>SA 실행 전</text></svg>
  const maxMove = Math.max(...all.map(t => t.move)), vals = all.flatMap(t => [t.cur, t.best]).concat(optimum ?? [])
  const lo = Math.min(...vals), hi = Math.max(...vals)
  const X = (m: number) => pad + m / maxMove * (W - pad - 8), Y = (v: number) => H - 20 - (hi === lo ? 0.5 : (v - lo) / (hi - lo)) * (H - 34)
  return <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%' }} role="img" aria-label="SA 이동 수에 따른 현재 비용과 최선 비용">
    <line x1={pad} y1={H - 20} x2={W - 8} y2={H - 20} stroke="currentColor" opacity={0.3}/><line x1={pad} y1={8} x2={pad} y2={H - 20} stroke="currentColor" opacity={0.3}/>
    <text x={pad - 4} y={Y(hi) + 4} fontSize={9} textAnchor="end" fill="currentColor">{round(hi)}</text><text x={pad - 4} y={Y(lo) + 4} fontSize={9} textAnchor="end" fill="currentColor">{round(lo)}</text>
    <text x={W - 8} y={H - 6} fontSize={9} textAnchor="end" fill="currentColor">이동 {fmtN(maxMove)}</text>
    {optimum !== null && <line x1={pad} x2={W - 8} y1={Y(optimum)} y2={Y(optimum)} stroke="#1D9E75" strokeDasharray="4 3"/>}
    {traces.map((tr, i) => <g key={i} opacity={i === traces.length - 1 ? 1 : 0.35}>
      <polyline points={tr.map(t => `${X(t.move)},${Y(t.cur)}`).join(' ')} fill="none" stroke="#7F77DD" strokeWidth={1}/>
      <polyline points={tr.map(t => `${X(t.move)},${Y(t.best)}`).join(' ')} fill="none" stroke="#1D9E75" strokeWidth={1.6}/>
    </g>)}
  </svg>
}

function RowView({ ctx, st, S = 36 }: { ctx: Ctx; st: State; S?: number }) {
  const X = new Array(ctx.n).fill(0)
  const routes: Route[] = []
  evaluate(ctx, st, X, routes)
  const width = st.order.reduce((s, i, k) => s + ctx.W[i] + (k < ctx.n - 1 ? st.gaps[k] * ctx.rules.site : 0), 0)
  const pad = 10, row = ctx.rules.row // fixed px/µm keeps the true aspect ratio; wide rows scroll
  const px = (x: number) => pad + x * S, py = (y: number) => pad + (row - y) * S
  const VW = width * S + pad * 2, VH = row * S + pad * 2 + 12
  return <div style={{ overflowX: 'auto' }}><svg viewBox={`0 0 ${VW} ${VH}`} width={VW} height={VH} style={{ display: 'block', color: 'var(--text)' }} role="img" aria-label="배치된 셀과 넷 경로">
    {ctx.tracks.map(t => <line key={t} x1={px(0)} x2={px(width)} y1={py(t)} y2={py(t)} stroke="#378ADD" opacity={0.2}/>)}
    {st.order.map(i => <g key={i}>
      <rect x={px(X[i])} y={py(row)} width={ctx.W[i] * S} height={row * S} fill="#378ADD" fillOpacity={0.08} stroke="currentColor" strokeOpacity={0.5}/>
      {ctx.W[i] * S >= 22 && <text x={px(X[i] + ctx.W[i] / 2)} y={py(row) + 12} textAnchor="middle" fontSize={9} fontWeight={700} fill="currentColor">{ctx.insts[i].name}{st.flip[i] && ctx.W[i] * S >= 44 ? '·FN' : ''}</text>}
      {ctx.W[i] * S >= 30 && <text x={px(X[i] + ctx.W[i] / 2)} y={py(0) - 4} textAnchor="middle" fontSize={8} fill="currentColor" opacity={0.7}>{ctx.insts[i].cell.replace('_1', '')}</text>}
    </g>)}
    {routes.map((r, k) => <path key={r.net} d={`M ${px(r.ax)} ${py(r.ay)} V ${py(r.t)} H ${px(r.bx)} V ${py(r.by)}`} fill="none" stroke={NET_COLORS[k % NET_COLORS.length]} strokeWidth={1.8} opacity={0.85}><title>{r.net}</title></path>)}
    <text x={pad} y={row * S + pad * 2 + 8} fontSize={9} fill="currentColor">{round(width)} × {row} µm · 넷 {routes.length}개</text>
  </svg></div>
}

// 검증 스크립트(번들 후 node에서 DP·전수 탐색 비교)가 쓰는 내부 함수 모음
export const __lab = { buildCtx, evaluate, summarize, subsetDp, proxyOf, exhaustiveSearch, spectralRefine, annealOnce, initState }
