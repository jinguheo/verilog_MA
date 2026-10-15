# vvirt SKILL 지원 현황 (자동 생성: examples/support_matrix.py)

상태는 인터프리터에 이름이 정의돼 있는지로 판정했다. 핵심 언어 목록은 흔히 쓰는 것을 골라 만든 것이며 SKILL 전체가 아니다.

## 요약
- 핵심 SKILL 언어(고른 199개): 지원 184개, 미지원 15개
- virtuoso-bridge 문서·예제가 LLM에게 쓰라고 하는 Cadence 함수 189개: 지원 45, 빈 껍데기 15, 미지원 129
- vvirt 정의 함수 325개 + 특수 형식 27개

## 핵심 언어 — 미지원과 사유
### 제어·함수: 24/24 지원
### 리스트: 49/49 지원
### 수치·비트: 48/48 지원
### 문자열·심볼: 25/25 지원
### 정규식: 4/5 지원
- `rexReplace` — [semantics] Cadence 정규식 그룹 문법이 Python re와 달라 같은 의미로 재현하기 어려움
### 속성·테이블·타입: 13/13 지원
### 입출력(workspace 안에서만): 15/15 지원
### 평가: 6/6 지원
### 배열·매크로: 0/7 지원
- `makeVector` — [parser] 배열 자료형(vector)과 a[i] 인덱스 구문이 파서에 없음 — 구현하려면 파서와 값 타입을 함께 확장해야 함
- `arrayref` — [parser] a[i] 인덱스 구문이 파서에 없음
- `setarray` — [parser] a[i]=v 대입 구문이 파서에 없음
- `vectorp` — [parser] vector 타입이 없어 항상 nil로 응답함(오해 소지) — 미지원으로 취급
- `declare` — [parser] 배열 선언 구문 없음
- `defmacro` — [evaluator] 평가기에 매크로 확장 단계가 없음 — backquote(`) 파싱·치환이 필요해 구현하지 않음
- `mprocedure` — [evaluator] 매크로 확장 단계 없음
### 호스트 실행·파일 변경: 0/7 지원
- `system` — [safety] 호스트 명령 실행 — 안전을 위해 의도적으로 제외
- `sh` — [safety] 호스트 명령 실행 — 의도적 제외
- `unix` — [safety] 호스트 명령 실행 — 의도적 제외
- `ipcBeginProcess` — [safety] 외부 프로세스 실행 — 의도적 제외
- `deleteFile` — [safety] 파일 삭제 — 의도적 제외
- `renameFile` — [safety] 파일 이동 — 의도적 제외
- `copyFile` — [safety] 호스트 파일 복사 — 의도적 제외

## 브리지가 참조하는 Cadence 함수 — 지원 안 되는 것과 사유
- **38개** [scope] Maestro(시뮬레이션 설정·실행) — 레이아웃 도구 범위 밖이라 구현하지 않음: `maeAddOutput`, `maeCloseResults`, `maeCloseSession`, `maeCreateNetlistForCorner`, `maeCreateTest`, `maeDeleteCorner`, `maeExportOutputView`, `maeGetAnalysis`, `maeGetCurrentRunMode`, `maeGetEnabledAnalysis`, `maeGetEnvOption`, `maeGetOutputValue`, `maeGetResultOutputs`, `maeGetResultTests` …
- **35개** [scope] ADE Assembler/Explorer 시뮬레이션 세션 — 범위 밖: `asiCloseSession`, `asiGetAnalogRunDir`, `asiGetCurrentAnalysisForm`, `asiGetCurrentSession`, `asiGetDesignVarList`, `asiGetHighPerformanceOptionVal`, `asiGetSession`, `asiGetSessionList`, `asiGetStatus`, `asiOpenSetup`, `asiRunSimulation`, `asiSetAnalysisFieldVal`, `asiSetDesignVarValue`, `asiSetHighPerformanceOptionVal` …
- **17개** [scope] GUI 폼·창 — 화면이 없음: `hiCreateMLTextField`, `hiFlushLogFile`, `hiFormApply`, `hiFormCancel`, `hiFormDone`, `hiFormList`, `hiGetCurrentForm`, `hiGetLogFileName`, `hiIsForm`, `hiIsFormDisplayed`, `hiReportDeselectAllItems`, `hiReportGetSelectedItems`, `hiReportSelectItem`, `hiSetCurrentForm` …
- **15개** [stub] 호출은 받지만 아무 일도 하지 않고 nil을 돌려줌(화면·GUI·환경 설정 함수): `cdfUpdateInstParam`, `envGetVal`, `envSetVal`, `hiCreateAppForm`, `hiCreateBooleanButton`, `hiCreateButton`, `hiCreateIntField`, `hiCreateLabel`, `hiCreateMenuItem`, `hiCreatePulldownMenu`, `hiInsertBannerMenu`, `hiRaiseWindow`, `hiRedraw`, `hiRegTimer` …
- **11개** [scope] 스키매틱 편집 — 범위 밖(레이아웃 전용): `schCheck`, `schCreateNetExpression`, `schCreatePin`, `schCreateWire`, `schCreateWireLabel`, `schGetEnv`, `schGetPinOrder`, `schPinListToSymbol`, `schSchemToPinList`, `schSetEnv`, `schSymbolToPinList`
- **9개** [todo] 미구현(구현 가능) — 사용 빈도가 낮아 보류: `cdsName`, `cdsParam`, `cdsTerm`, `dbFindOpenCellViewByName`, `ddGetObjDMSys`, `ddGetObjWritePath`, `ddMapGetFileViewType`, `ddReleaseObj`, `envIsVal`
- **8개** [todo] 라이브러리 카테고리 관리 — 사용 빈도가 낮아 미구현(구현 가능): `ddCatAddItem`, `ddCatClose`, `ddCatGetCatMembers`, `ddCatGetLibCats`, `ddCatOpen`, `ddCatOpenEx`, `ddCatRemove`, `ddCatSave`
- **5개** [model] 넷·단자·핀을 데이터 모델에 담지 않음 — 구현하려면 연결(connectivity) 모델 추가가 필요: `dbAddFigToNet`, `dbCreateInstTerm`, `dbCreateNet`, `dbCreatePin`, `dbCreateTerm`
- **2개** [scope] CDF(소자 파라미터 정의) — 범위 밖: `cdfGetCellCDF`, `cdfGetInstCDF`
- **2개** [model] bag/속성 직접 설정 모델이 없음: `dbOpenBag`, `dbSet`
- **1개** [model] 선(line) 도형 종류가 없음(path만 있음): `dbCreateLine`
- **1개** [todo] 미구현: `ocnPrint`

사유 분류: safety=호스트 안전을 위해 의도적 제외 · parser/evaluator=해석기 구조 한계 · semantics=의미를 같게 재현하기 어려움 · scope=레이아웃 도구 범위 밖 · model=데이터 모델에 없음 · stub=호출만 받고 동작 없음 · todo=구현 가능하나 미구현
