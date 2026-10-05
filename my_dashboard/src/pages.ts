// 페이지 메타데이터 한 곳 관리: 사이드바 항목, 화면 제목, 한 줄 설명을 같이 둬서 이름이 어긋나지 않게 한다.
export type PageSection = 'overview' | 'runs' | 'experiments' | 'knowledge'

export interface PageMeta { id: string; label: string; icon: string; section: PageSection; title: string; subtitle: string }

export const SECTION_LABEL: Record<PageSection, string> = {
  overview: 'OVERVIEW',
  runs: 'EXECUTED RUNS',
  experiments: 'DESIGN & EXPERIMENTS',
  knowledge: 'KNOWLEDGE LAYER',
}

export const PAGES: PageMeta[] = [
  { id: 'pipeline', label: 'General RTL Pipeline', icon: '◈', section: 'overview', title: 'RTL Development Pipeline',
    subtitle: 'RTL 설계부터 검증·합성·배치배선까지 단계별 게이트 현황과 사용 도구를 보여줍니다.' },
  { id: 'sample', label: 'Sample Test 1', icon: '1', section: 'runs', title: 'Sample Test 1',
    subtitle: '첫 번째 샘플 설계의 개요·설계·검증·구현·문서를 탭별로 확인합니다.' },
  { id: 'sample2', label: 'Sample Test 2', icon: '2', section: 'runs', title: 'Sample Test 2',
    subtitle: '두 번째 샘플 설계의 개요·설계·검증·구현·문서를 탭별로 확인합니다.' },
  { id: 'sample3', label: 'Sample Test 3', icon: '3', section: 'runs', title: 'Sample Test 3 — Data Acquisition Subsystem',
    subtitle: '데이터 수집 서브시스템의 구조, RTL 권장안, 검증 계획과 실험 결과를 봅니다.' },
  { id: 'sample4', label: 'Sample Test 4', icon: '4', section: 'runs', title: 'Sample Test 4 — Multi-channel DAQ/DMA',
    subtitle: '다채널 DAQ/DMA 설계의 구조, 검증, 합성, 레이아웃 결과를 한곳에서 봅니다.' },
  { id: 'analog', label: 'Analog & Memory', icon: '∿', section: 'experiments', title: 'Analog & Memory Design',
    subtitle: 'ADC·SRAM 등 아날로그/메모리 IP의 선택 근거, PPA 실험 1~3, 물리 검증 진행 상황을 봅니다.' },
  { id: 'chipgame', label: 'AI Chip Tetris', icon: '▦', section: 'experiments', title: 'AI Chip Tetris',
    subtitle: '블록을 칩 floorplan에 직접 쌓아 보며 AI 배치 전략과 사람 배치를 비교합니다.' },
  { id: 'macrogame', label: 'Macro Tetris', icon: '▣', section: 'experiments', title: 'Macro Tetris',
    subtitle: 'daq_subsystem의 chan_top macro 8개를 쌓아 보며 floorplan 후보와 표준셀 공간을 확인합니다.' },
  { id: 'macroarea', label: 'Macro Area Tetris', icon: '⤡', section: 'experiments', title: 'Macro Area Tetris',
    subtitle: 'macro 위치와 모양을 바꿔 die 면적을 줄일 수 있는지, 실제 OpenLane 결과와 함께 탐색합니다.' },
  { id: 'stdcells', label: 'Standard Cells', icon: '▤', section: 'experiments', title: 'Standard Cells — sky130A PDK',
    subtitle: 'sky130A 표준셀 라이브러리와 PDK 변경·복잡한 표준셀 실험을 정리합니다.' },
  { id: 'knowledge', label: 'Knowledge DB', icon: 'K', section: 'knowledge', title: 'Knowledge DB Overview',
    subtitle: '설계 지식 소스(스펙, 코드, 도구 문서)의 연결 상태를 확인합니다.' },
  { id: 'tools', label: 'Tool Comparison', icon: 'T', section: 'knowledge', title: 'EDA Tool Comparison',
    subtitle: 'EDA 도구별 역할과 장단점을 비교합니다.' },
]

export const pageMeta = (id: string): PageMeta | undefined => PAGES.find(p => p.id === id)
