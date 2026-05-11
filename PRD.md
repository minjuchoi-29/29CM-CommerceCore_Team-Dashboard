# 29CM Commerce Core 팀 대시보드 — PRD

> **목적**: 이 문서를 기반으로 AI가 환경 설정 없이 기능·정책·UI 구성을 완전히 재현할 수 있도록 현재 구현을 정확하게 기술한다.  
> **대상**: Next.js 16 App Router (클라이언트 컴포넌트), Tailwind CSS, TypeScript  
> **범위**: `TicketBoard` 단일 페이지 애플리케이션 — 좌측 티켓 목록 + 우측 상세 패널

---

## 1. 개요 및 화면 구조

```
┌────────────────────────────────────────┬─────────────────────────────┐
│  좌측: 전체 과제 현황 패널 (flex-1)        │  우측: 티켓 상세 패널 (고정 너비) │
│                                        │  (티켓 선택 시에만 노출)         │
│  - 헤더 (제목 + JIRA Sync 버튼)          │  - 티켓 제목·메타정보             │
│  - 플래닝 탭 (4개)                       │  - 요구사항 출처 (ETR)            │
│  - 아젠다 미팅 서브뷰 토글               │  - 주요 내용 요약 (메모)           │
│  - 요약 카드 (4개 상태별 클릭 필터)        │  - 메모                           │
│  - 필터 (분기·레벨·프로젝트·상태 등)      │  - 플래닝 상태 (Design / Dev)     │
│  - 정렬·검색·티켓 추가 폼               │  - 작업별 일정 (Gantt)            │
│  - 티켓 목록 테이블                      │                                   │
└────────────────────────────────────────┴─────────────────────────────┘
```

- 우측 패널 너비: 기본 700px, 드래그 리사이즈 (최소 280px, 최대 700px)
- **펼치기(‹/›) 버튼**: 리사이즈 핸들 중앙에 위치. 클릭 시 좌측 패널을 `w-44`(티켓 번호만 노출) 로 축소하고 우측 패널이 `flex-1`을 차지. 접기 시 원래 상태 복원.

---

## 2. 데이터 타입

### 2-1. Ticket (Jira에서 로드)

```ts
type Ticket = {
  key: string;           // 예: "TM-1234"
  summary: string;       // 티켓 제목
  status: string;        // Jira 상태
  assignee: string;      // 담당자
  startDate?: string;    // YYYY-MM-DD
  eta: string;           // YYYY-MM-DD
  type: string;          // "Initiative" | "Epic" | "Dev"
  project: string;       // "TM" | "CMALL" | ...
  roles?: RoleSchedule[]; // 초기 Jira 데이터의 일정 (KV 우선)
  description?: string;
  requestDept?: string;
  requestPriority?: string;
  twoPagerUrl?: string;
  prdUrl?: string;
  parent?: string;
  healthCheck?: string;
  storyPoints?: number;
  bodyRequestDept?: string;
};
```

### 2-2. RoleSchedule (작업별 일정)

```ts
type RoleSchedule = {
  role: string;          // 역할명 (프리셋 또는 직접입력)
  person: string;        // 담당자명
  start: string;         // YYYY-MM-DD
  end: string;           // YYYY-MM-DD
  status: "완료" | "진행중" | "예정" | "미정" | "확인필요";
  detail?: string;       // 세부 작업명
  detailPerson?: string; // 세부 작업 담당자
  vacationDays?: number; // 기간 내 휴가 일수 (영업일 차감용)
};
```

### 2-3. 메모 관련

```ts
type MemoEntry = { text: string; author: string; date: string }; // 구버전 (폴백용)

type MemoVersion = {
  text: string;
  author: string;
  date: string; // "YYYY-MM-DD HH:mm"
  isAI?: boolean;
};
```

### 2-4. 플래닝·노트 관련

```ts
type PlanningNote = { text: string; author: string; date: string }; // "YYYY-MM-DD HH:mm"
type TrackState = "대기중" | "검토중" | "완료";

// planning[ticketKey] = { design: TrackState, dev: TrackState }
```

### 2-5. ETR (요구사항 출처)

```ts
type EtrTicketInfo = { key: string; summary?: string; requestDept?: string };

type TicketRequestInfo = {
  source: "자체발의" | "ELT" | "ETR";
  etrStatus?: "추가완료" | "추가필요";
  etrTickets?: EtrTicketInfo[];
};
```

---

## 3. 상수 및 설정값

### 3-1. 상태 색상 맵 (STATUS_COLOR)
| 상태 | 색상 |
|------|------|
| 론치완료 / 완료 / 배포완료 | green-100 / green-700 |
| 개발중 / In Progress | blue-100 / blue-700 |
| QA중 | purple-100 / purple-700 |
| 디자인완료 | purple-50 / purple-500 |
| 기획중 | orange-100 / orange-700 |
| 기획완료 | green-50 / green-600 |
| SUGGESTED / Backlog | gray-100 / gray-500 |
| HOLD / Postponed | yellow-100 / yellow-700 |
| 철회/반려/취소 | red-100 / red-600 |
| 준비중 | yellow-50 / yellow-600 |
| 디자인중 | purple-50 / purple-400 |

### 3-2. 역할 색상 맵 (ROLE_COLOR)
| 역할 | 색상 |
|------|------|
| 기획 | indigo-400 |
| 디자인 | violet-400 |
| BE-SP | blue-600 |
| BE-PP | blue-400 |
| BE-CE | blue-300 |
| BE-외주 / BE-메가존 | sky-600 |
| FE-CFE | cyan-500 |
| FE-DFE | cyan-400 |
| FE-외주 / FE-Sotatek | sky-400 |
| Mobile | teal-400 |
| QA | emerald-500 |
| DA | amber-500 |
| 배포 | rose-400 |
| CSE | teal-600 |
| **Kick-Off** | **indigo-600** |
| **Release** | **orange-500** |
| **Launch** | **green-600** |

### 3-3. 역할 프리셋
- **마일스톤** (MILESTONE_ROLES): `["Kick-Off", "Release", "Launch"]`
- **일반 팀 작업** (PRESET_ROLES): `["기획", "디자인", "BE-SP", "BE-PP", "BE-CE", "BE-메가존", "FE-CFE", "FE-DFE", "FE-Sotatek", "Mobile", "DA", "QA"]`
- 위 목록에 없으면 "직접입력" 커스텀 역할로 분류

### 3-4. 분기 분류 (하드코딩 키셋)
- `Y26Q1`: Q1 전용 티켓 키셋 (`Q1Q2_KEYS`에 없고 `Q2_KEYS`에도 없는 것)
- `Q1+Q2`: `Q1Q2_KEYS` — Q1에 시작해 Q2까지 이어지는 과제
- `Y26Q2`: `Q2_KEYS` — Q1Q2가 아닌 Q2 전용

### 3-5. 상태 그루핑
```
완료 상태 (DONE): 론치완료, 완료, 배포완료
진행중 상태: 개발중, In Progress, QA중
계획/대기 상태: SUGGESTED, Backlog, HOLD, Postponed, 기획중, 기획완료, 디자인완료, 준비중, 디자인중
```

### 3-6. 한국 공휴일 (KR_HOLIDAYS)
2025~2026년 국공휴일 하드코딩 (설날·추석 대체 포함). 영업일 계산에 사용.

### 3-7. 티켓 레벨 (type)
`["Initiative", "Epic", "Dev"]` — `TYPE_COLOR`로 색상 구분

### 3-8. 프로젝트 목록
`["TM", "CMALL", "M29CMCCF", "M29COMCO", "M29CMOD", "EF"]`

---

## 4. KV 스토어 키 구조

Upstash Redis (KV)를 팀 공유 저장소로 사용. 모든 키는 배치 조회(`/api/kv?keys=...`) 가능.

| KV 키 | 내용 | 타입 |
|-------|------|------|
| `cc-schedules` | 티켓키 → RoleSchedule[] | `Record<string, RoleSchedule[]>` |
| `cc-planning` | 티켓키 → { design, dev } | `Record<string, { design: TrackState, dev: TrackState }>` |
| `cc-memos` | 구버전 메모 (폴백용) | `Record<string, MemoEntry \| string>` |
| `cc-memos-v2` | 메모 버전 히스토리 | `Record<string, MemoVersion[]>` |
| `cc-planning-notes` | 플래닝 코멘트 | `Record<string, PlanningNote[]>` |
| `cc-ticket-notes` | 티켓 메모 노트 | `Record<string, PlanningNote[]>` |
| `cc-etr` | 요구사항 출처 | `Record<string, TicketRequestInfo>` |
| `cc-custom-keys` | 사용자 추가 티켓 키 목록 | `string[]` |
| `cc-custom-tickets` | 사용자 추가 티켓 전체 데이터 | `Ticket[]` |
| `cc-agenda` | 아젠다 미팅에 추가된 티켓 키 | `string[]` |

localStorage는 KV 장애 시 폴백으로 동일 키 이름으로 저장.

---

## 5. API 엔드포인트

| 메서드 | URL | 설명 |
|--------|-----|------|
| GET | `/api/jira-tickets` | 전체 티켓 배치 조회 (서버 12시간 캐시) |
| POST | `/api/jira-tickets/revalidate` | 서버 캐시 무효화 (강제 업데이트 시) |
| GET | `/api/jira-tickets/single?key=TM-xxx` | 단건 티켓 조회 (커스텀 추가·ETR 연결용) |
| GET | `/api/sheet-priorities` | 구글 시트 우선순위 조회 (30초 폴링) |
| POST | `/api/sheet-priorities` | 우선순위 일괄 갱신 |
| POST | `/api/sheet-append` | 시트 A열에 티켓 키 추가 |
| GET | `/api/kv?keys=k1,k2,...` | KV 배치 조회 |
| POST | `/api/kv` | KV 단건 저장 `{ key, value }` |
| GET | `/api/ai-summary?key=TM-xxx` | AI 자동 요약 생성 |

---

## 6. 데이터 로드 흐름

### 초기 로드 순서
1. **localStorage 캐시 확인** (`cc-tickets-v2`): 유효 시간 12시간. 유효하면 즉시 렌더.
2. **캐시 없음/만료**: `/api/jira-tickets` 호출 (20초 타임아웃).
3. **KV 배치 조회**: planning, schedules, memos, custom-keys 등 10개 키 동시 로드.
4. **커스텀 티켓 병합**: KV `cc-custom-tickets` 우선, 없으면 localStorage 폴백.
5. **시트 우선순위 로드**: `/api/sheet-priorities` + 30초 인터벌 폴링 + visibilitychange 이벤트.

### 강제 업데이트 (Jira Sync 버튼)
1. 서버 캐시 무효화 → `/api/jira-tickets` 재조회
2. KV에서 커스텀 키 목록 재조회 → 누락 티켓 단건 재조회
3. 시트에 없는 티켓 자동 추가 (`/api/sheet-append`)
4. 우선순위 재정렬 (완료 티켓 → "완료", 활성 티켓 → 1부터 순차 재번호)
5. KV의 planning·schedules·memos 갱신

### 자동 플래닝 완료 처리
KV 로드 완료 후 1회 실행: `개발중 / QA중 / 론치완료 / 완료 / 배포완료` 상태이면서 planning 미설정인 티켓은 design·dev 모두 "완료"로 자동 처리.

---

## 7. 좌측 패널 — 티켓 목록

### 7-1. 헤더
- 제목: "전체 과제 현황"
- 부제: "Sub Group: 29CM-P Commerce Core"
- 우측: JIRA 동기화 시각 표시 + "Jira Sync" 버튼 (로딩 중 스피너 + "Syncing…")
- 시트 연동 오류 시 "시트 권한 없음 — 재로그인 필요" 문구 표시

### 7-2. 플래닝 탭 (4개)
티켓을 플래닝 진행 단계로 분류하는 주요 탭.

| 탭 | 색상 | 포함 조건 |
|----|------|---------|
| 전체 | gray-800 | 모든 티켓 |
| 진행 중 | blue-600 | (design·dev 둘 다 "완료" OR JIRA active 상태) AND 티켓 미완료 |
| 플래닝 대기·검토 | amber-500 | 위 조건 불만족 AND 티켓 미완료 |
| 완료 | green-600 | 티켓 status가 완료 상태 (론치완료/완료/배포완료) |

각 탭에 건수 표시. 탭 전환 시 필터 즉시 적용.

### 7-3. 아젠다 미팅 서브뷰
- 아젠다에 티켓이 1개 이상일 때만 토글 버튼 노출 (orange 배경)
- "플래닝 현황" / "🗓 아젠다 미팅" 버튼으로 전환
- 아젠다 미팅 뷰: 아젠다에 추가된 티켓만 별도 패널로 표시, 각 행에서 플래닝 상태(Design/Dev) 즉시 수정 가능
- "미팅 종료 ✕": 아젠다 초기화 + 미팅 뷰 종료

### 7-4. 요약 카드 (4개)
`전체 / 완료 / 진행중 / 계획·대기` — 클릭 시 해당 상태 탭 필터 토글 (다시 클릭 시 "전체"로 복귀). `preFiltered` 기준 건수 표시.

### 7-5. 필터 패널

| 필터명 | 값 목록 | 동작 |
|--------|---------|------|
| 분기 | Y26Q1, Q1+Q2, Y26Q2 | 다중 선택, 하드코딩 키셋 기반 |
| 레벨 | Initiative, Epic, Dev | 다중 선택 (ticket.type) |
| 프로젝트 | TM, CMALL, M29CMCCF, M29COMCO, M29CMOD, EF | 다중 선택 |
| 상태 | 론치완료/완료, 개발중, QA중, SUGGESTED, HOLD/Postponed, 기타 | 다중 선택 (그루핑 matchStatus) |
| 담당자 | 티켓에서 자동 추출 (가나다순) | 다중 선택 |
| 도메인 | summary `[도메인명]` 파싱, "기타"는 맨 뒤 | 다중 선택 |
| 대상 | summary `[29CM]` 또는 `[29Connect]` 파싱 | 다중 선택 |

필터 파이프라인: 분기 → 플래닝탭 → 레벨 → 담당자 → 도메인 → 대상 → 프로젝트 → 상태 → 검색 → statusTab (AND 조건).

### 7-6. 정렬
| 키 | 표시명 | 동작 |
|----|--------|------|
| default | 등록순 | 정렬 없음 (원래 순서 유지) |
| priority | 우선순위 P1↑ | `priorities[key]` 숫자 오름차순 (없으면 999) |
| startDate | 시작일순 | `ticket.startDate` 오름차순 (없으면 맨 뒤) |
| **eta** | **ETA순** | **`ticket.eta` 오름차순 — 기본 정렬** |

### 7-7. 검색
- 입력: 티켓 번호 · 제목 · 담당자 (부분 일치, 대소문자 무관)
- 실시간 필터 적용

### 7-8. 티켓 추가
- 입력 형식: `TM-1234` 단건 또는 `TM-1234, TM-5678` 다중 (쉼표/공백 구분)
- Enter 또는 "추가" 버튼으로 제출
- 유효성 검사: 정규식 `^[A-Z][A-Z0-9]*-\d+$`
- 중복 검사: 기존 티켓 또는 customKeys에 있으면 오류, 해당 행으로 스크롤 + 3초간 amber 하이라이트
- 정상 추가 시: 3초간 emerald 하이라이트 + 해당 행으로 스크롤 + 플래닝탭 "플래닝 대기·검토"로 전환
- 다중 추가 시: `N/M 추가 중…` 진행 표시
- 완료 상태 티켓 추가 시: planning design·dev 자동 "완료" 처리
- 추가 직후 메모 없으면 AI 요약 자동 1회 생성

### 7-9. 티켓 목록 테이블

**헤더 컬럼**: (아젠다) | 순번 | 티켓 번호 | 제목 | 타입 | 프로젝트 | 담당자 | 상태 | 시작일 | ETA | (삭제)

**각 행**:
- 행 클릭: 우측 상세 패널 열기/닫기 토글
- 선택된 행: `bg-indigo-50`
- 새로 추가된 행: `bg-emerald-50` + 3초 후 해제
- 중복 행: `bg-amber-50` + `ring-1 ring-amber-200` + 3초 후 해제
- 아젠다 버튼(🗓): 플래닝 미완료·미완료 티켓만 표시. 활성 시 opacity-100, 비활성 시 opacity-20
- 순번: 필터 결과 내 1-based 인덱스
- 티켓 번호: Jira 링크 (새 탭)
- 우선순위 배지: `P1`, `P2` 등 — amber 배경
- 플래닝 배지: Design/Dev 미완료 시 상태 표시 (대기: gray, 검토중: 각각 violet/blue)
- 상태 배지: STATUS_COLOR 적용 rounded-full
- 삭제(×) 버튼: 목록에서 제거 + KV·localStorage 동기화 + 우선순위 재정렬

**마일스톤 서브 행** (메인 행 아래):
- 해당 티켓 `schedules[key]`에서 MILESTONE_ROLES 필터링, `end`가 있는 것만 표시
- 칩 표시: `● 킥오프 · [detail] 4/1` (컬러 도트 + 한국어 이름 + 세부작업 + 날짜)
- 완료 마일스톤: opacity-40 + ✓
- 펼치기 모드(isDetailExpanded)에서는 숨김

**펼치기 모드 목록**: 티켓 번호만 세로로 나열 (`w-44`, font-mono)

---

## 8. 우측 패널 — 티켓 상세

### 8-1. 헤더
- 티켓 제목 (text-base font-bold)
- Design/Dev 플래닝 미완료 시 상태 배지 (대기: gray, 검토중: violet/blue)
- 우측: 닫기(×) 버튼

### 8-2. 메타 정보 그리드
| 항목 | 표시 |
|------|------|
| 티켓 번호 | Jira 링크 |
| 상태 | STATUS_COLOR 배지 |
| 담당자 | 텍스트 |
| 타입 | TYPE_COLOR 배지 |
| 프로젝트 | 텍스트 |
| 시작일 | formatDateWithDay |
| ETA | formatDateWithDay |
| storyPoints | 있을 때만 |
| healthCheck | HealthBadge 컴포넌트 (그린/옐로우/레드 컬러 도트) |
| 2-Pager URL / PRD URL | 링크 버튼 |
| parent | 있을 때만 표시 |
| requestDept / requestPriority / bodyRequestDept | 있을 때만 |

### 8-3. 요구사항 출처 (ETR)

**3가지 소스 선택**: 자체발의 / ELT / ETR

- **자체발의/ELT**: 선택 즉시 저장
- **ETR 선택 시**:
  - 상태 드롭다운: "추가필요" / "추가완료"
  - ETR 티켓 입력 (JIRA 키 형식) → 추가 시 단건 조회 → summary·requestDept 가져와서 표시
  - 연결된 ETR 티켓 목록: key + summary + requestDept + 삭제(×)
  - 입력 유효성: 정규식 + 중복 방지

### 8-4. 주요 내용 요약 (메모)
- **현재 버전 표시**: 작성자 + 날짜 + 텍스트
- **AI 요약 버튼**: 로딩 중 스피너. 생성 성공 시 memoHistory에 `isAI: true`로 저장
- **편집 버튼**: textarea 열림. 저장 시 memoHistory에 새 버전 추가 (author = userName)
- **버전 히스토리**: "기록 보기/닫기" 토글. 버전 목록 (날짜·작성자·AI 여부·내용 앞부분). 접힘 기본.
- **메모 없을 때**: "입력" 버튼으로 편집 모드 진입

### 8-5. 메모 (티켓 노트)
- 구분선 위에 별도 섹션
- 노트 목록: 날짜·작성자·텍스트. 삭제 버튼.
- 입력 폼: 텍스트 입력 + Enter 또는 "추가" 버튼
- KV `cc-ticket-notes`에 저장

### 8-6. 플래닝 상태

**Design 트랙 / Dev 트랙** (각각 독립):

상태: `대기중` → `검토중` → `완료`

- 각 상태를 버튼으로 직접 선택 (토글이 아닌 3-way 버튼)
- KV `cc-planning`에 저장
- **플래닝 코멘트**: 토글 가능 섹션. 코멘트 목록 + 입력 폼 + 삭제 버튼. KV `cc-planning-notes` 저장.
- design·dev 모두 "완료"이면 플래닝 섹션 접힘 기본 (`planningOpen = false`)

### 8-7. 플래닝 상태 (상단 뱃지 조건)
- design·dev 중 하나라도 "완료"가 아니면 헤더에 배지 표시
- "검토중"이면 각각 violet/blue 배지, 그 외엔 gray

### 8-8. 작업별 일정 (Gantt Chart)

#### 헤더
- "작업별 일정" + 우측 "편집" 버튼
- 플래닝 완료 + 일정 없음: "플래닝이 완료됐어요. 작업별 일정을 입력해주세요." 배너 + "일정 입력" 버튼

#### 완료 티켓 정책 (status가 론치완료/완료/배포완료)
- **요약 보기 (기본)**: Kick-Off / Release / Launch 역할만 표시. `fitToContent=true` (가장 이른 시작월부터 표시).
- **전체 보기 버튼**: 전체 역할 표시. `fitToContent=true` (완료 티켓은 항상). "이전 완료 일정" 섹션 없이 플랫하게 전체 표시.
- **요약/전체 전환 배너**: "✅ 론치 완료 — 킥오프·배포·론치 일정만 요약 표시" + "전체 보기"/"요약 보기" 버튼

#### 펼치기(‹/›) 모드에서 Gantt
- `extendedView=true`: 과거 6개월 + 미래 2개월 타임라인
- `forceShowPastDone=true`: "이전 완료 일정" 자동 펼침
- 완료 티켓은 여전히 `ticketDone=true` → 플랫 표시

#### GanttChart 컴포넌트 props
```ts
{
  roles?: RoleSchedule[];
  forceShowPastDone?: boolean;  // 패널 펼치기 시 이전완료 강제 오픈
  extendedView?: boolean;       // 과거 6개월 + 미래 2개월
  fitToContent?: boolean;       // viewStart = 가장 이른 시작월
  ticketDone?: boolean;         // 완료 티켓: isPastDone 비활성 (플랫)
  onEditRow?: (r: RoleSchedule) => void;  // 행별 수정 바로가기
}
```

---

## 9. Gantt Chart 렌더링 상세

### 9-1. 타임라인 범위 계산

**viewStart** (월 1일 기준):
- `extendedView`: 오늘로부터 6개월 전 1일
- `fitToContent` + roles에 start 있음: 가장 이른 role 시작월 1일
- 기본: 이번 달 1일

**viewEnd**:
- 기본 종료: 오늘 기준 +3개월 말일
- `extendedView`: 오늘 기준 +2개월 말일
- roles 중 end가 viewEnd를 초과하면 해당 end의 다음 달 말일로 확장

**월 헤더**: viewStart ~ viewEnd 범위의 월 레이블을 `left: pct(월1일)%`로 절대 위치

**오늘 표시**: `📍 M/D(요일)` — 빨간 텍스트, 배경 bg-red-50, border-red-100. roles 있을 때만 표시.

### 9-2. 바 렌더링 정책

**barWidth 계산**:
- 시작: `max(viewStart, new Date(start))`
- 종료: `min(viewEnd, new Date(end + "T23:59:59"))` — 하루 끝으로 계산해 1일짜리도 표시
- 너비 = `max(0.3%, (eMs - sMs) / span * 100%)`
- 결과 0이면 바 미표시

**상태별 바 스타일**:
- 완료: `opacity-40`
- 예정: `opacity-60`
- 확인필요: `opacity-50 border border-purple-300`
- 진행중·기타: 기본

**특수 상태 바 영역**:
- 미정: 바 대신 "기간 산정중" 이탤릭 텍스트 (gray-400)
- 확인필요 + start 없음: 바 대신 "PM 확인 필요" 이탤릭 텍스트 (purple-400)

**오늘 구분선**: 모든 바 영역에 `left: todayPct%`, 빨간 1px 세로선 (z-10)

### 9-3. 좌측 컬럼 (w-48, 고정)
```
[컬러 도트 w-2 h-2] [role명 w-20] [담당자명]
  └ [세부작업명] [· 세부담당자]  ← 있을 때만
```
- Milestone 역할(Kick-Off·Release·Launch): `text-indigo-500 font-semibold`
- 일반 역할: `text-gray-400`

### 9-4. 우측 컬럼
```
[바 영역 flex-1] [상태텍스트 w-16] [기한초과 배지?] [시작확인 배지?] [✏️ 버튼?]
[날짜범위 텍스트] [영업일수] [(-N휴가)]
```

**기한 초과**: end < 오늘 AND status ≠ "완료" → `기한 초과` 빨간 배지 + 호버 툴팁
**시작 확인**: start < 오늘 AND status = "예정" → `시작 확인` 주황 배지 + 호버 툴팁 (기한초과 없을 때만)

**영업일 표시**:
- `calcWorkingDays(start, end)` — 주말·공휴일 제외
- vacationDays > 0이면: `{net}영업일` + `(-{vac}휴가)` (orange-400)

**✏️ 수정 버튼**:
- `onEditRow` prop 있을 때만 렌더
- 행 호버 시 노출 (`opacity-0 group-hover/ganttrow:opacity-100`)
- 클릭 시 해당 행 포커스로 편집 모드 진입

### 9-5. 이전 완료 일정 섹션

조건: `!fitToContent && !ticketDone` 이고 status="완료" && end < viewStart인 항목  
- `▸ 이전 완료 일정 N건` 토글 버튼 (클릭 시 ▾ 로 전환)
- `forceShowPastDone=true`이면 항상 펼침
- 펼쳐진 상태: CSS Grid `gridTemplateColumns: "auto auto auto 1fr"` — role / 담당자 / 날짜·영업일 / 세부작업 4열 정렬

### 9-6. 행 정렬 (Gantt 내)
시작일 오름차순 → 동일 시 종료일 오름차순 → 날짜 없으면 맨 뒤

---

## 10. 작업별 일정 편집 폼

### 10-1. 진입
- "편집" 버튼: 전체 역할 목록을 편집 모드로 전환
- Gantt 행의 "✏️" 버튼: 편집 모드 진입 + 해당 행으로 자동 스크롤 + 파란 하이라이트 (`bg-indigo-50 ring-2 ring-indigo-300`)
- **초기 정렬**: 시작일 오름차순 (오래된 순)

### 10-2. 편집 헤더
- "오래된 순" / "최신순" 정렬 버튼
- 취소 / 저장 버튼 (상단)

### 10-3. 각 행 구성
```
[역할 select] [직접입력 input?] [담당자 input] [상태 select] [× 삭제]
  └ [세부작업명 input] [세부담당자 input]  ← 프리셋 역할일 때만
[시작일 input] ~ [종료일 input] [영업일 계산] | [휴가일수 input (optional)]
```

**역할 select 옵션 그룹**:
- 마일스톤: Kick-Off, Release, Launch
- 팀 작업: PRESET_ROLES
- 직접입력 (커스텀)

**상태 select 옵션**: `["확인필요", "미정", "예정", "진행중", "완료"]`

**세부작업·세부담당자**: 프리셋 역할(직접입력 아닐 때)만 노출 (들여쓰기 `└` 스타일)

**휴가 일수 입력**: 숫자 입력, 0이면 미표시. 표시 시 orange 배경 박스로 구분.

**영업일 계산**: start·end 입력 시 실시간 계산 표시 (vacationDays 반영)

### 10-4. 유효성 검사 (저장 시)
- role, person 필수
- status ≠ "미정"·"확인필요"이면 start·end 필수
- 실패 시 `필수 항목을 입력해주세요: [항목명, ...]` 에러 표시

### 10-5. 하단 버튼
- 취소 / 저장 (상단과 동일, 하단에도 배치)
- "+ 항목 추가" 버튼 (기본값: role="기획", status="예정")

### 10-6. 저장
- `cc-schedules` KV 갱신
- 편집 모드 종료

---

## 11. 영업일 계산 정책

```
calcWorkingDays(start, end):
  start ~ end 기간의 월~금 중 KR_HOLIDAYS에 없는 날 카운트 (start·end 포함)

표시:
  - vacationDays = 0: "{total}영업일"
  - vacationDays > 0: "{total - vacationDays}영업일  (-{vacationDays}휴가)"
```

---

## 12. 우선순위 관리 (구글 시트 연동)

- 구글 시트 B열에 `P1`, `P2` ... 또는 `"완료"` 저장
- **자동 재정렬**: 완료 티켓은 B열 → "완료", 활성 티켓은 현재 순서 유지하며 1부터 재번호
- 티켓 삭제 시: 삭제 티켓보다 높은 번호는 -1씩 당김
- 30초 폴링 + 탭 복귀(visibilitychange)로 갱신
- 오류 시: "시트 권한 없음 — 재로그인 필요" 표시

---

## 13. AI 요약

- 티켓 추가 직후 메모 없으면 `/api/ai-summary?key=TM-xxx` 자동 호출
- 수동 재생성 버튼 (상세 패널 메모 섹션)
- 저장 시 `isAI: true`로 `cc-memos-v2`에 버전 추가
- 작성자: "AI 자동 요약"
- 로딩 중 스피너 표시

---

## 14. 메모 버전 관리

- `cc-memos-v2`: `Record<string, MemoVersion[]>` — 배열 마지막 항목이 현재 버전
- `cc-memos`: 구버전 폴백 (text·author·date 또는 plain string)
- `getCurrentMemo(key)`: v2 우선, 없으면 v1 폴백
- 버전 히스토리: 상세 패널에서 접기/펼치기 토글. 각 버전에 날짜·작성자·AI 여부 표시.

---

## 15. 아젠다 미팅 기능

- 각 티켓 행 좌측 🗓 버튼 (플래닝 미완료 + 미완료 티켓만): 클릭 시 `cc-agenda`에 키 추가/제거
- 아젠다 > 0이면 상단에 "미팅 모드" 배너 등장
- 아젠다 뷰 전환 시: 아젠다 티켓만 별도 패널에 표시, Design/Dev 상태 버튼 즉시 수정 가능
- "미팅 종료 ✕": 아젠다 초기화 + KV 저장

---

## 16. 헬스 체크 배지 (HealthBadge)

`healthCheck` 필드 텍스트를 파싱:
- 그린/green/정상/good/ok 포함 → 초록 도트 + bg-green-50
- 옐로우/yellow/주의/warning/caution 포함 → 노란 도트 + bg-yellow-50
- 레드/red/위험/danger/critical/bad 포함 → 빨간 도트 + bg-red-50
- 기타 → 회색 도트

---

## 17. 요약 카드 도메인·대상 파싱

**도메인**: `summary`에서 `[29CM]` 또는 `[29Connect]` 제거 후 첫 번째 `[...]` 값 추출. 없으면 "기타".  
**대상**: `summary` 앞의 `[29CM]` 또는 `[29Connect]` 값. 해당 없으면 null.

---

## 18. 주요 UX 정책

| 정책 | 내용 |
|------|------|
| 티켓 선택 토글 | 동일 티켓 클릭 시 상세 패널 닫힘 |
| 상세 패널 변경 초기화 | 티켓 변경 시 editMode·memoEditMode·historyOpen·showFullDoneSchedule 등 초기화 |
| 새 티켓 스크롤 | 추가 후 100ms 딜레이로 해당 행 scrollIntoView |
| 중복 티켓 스크롤 | 중복 감지 시 해당 행으로 스크롤 + 3초 하이라이트 |
| 편집 모드 포커스 | Gantt ✏️ 클릭 → 편집 모드 후 80ms 딜레이로 해당 행 scrollIntoView |
| API 타임아웃 | 모든 API 호출 20초 AbortController |
| 로컬 캐시 TTL | 티켓 캐시 12시간 (`cc-tickets-v2`) |
| 시트 폴링 | 30초 인터벌 + visibilitychange |
| race condition 방어 | dedupedTickets으로 키 기준 중복 제거 |
| 패널 detail-panel 이벤트 | `selected` 변경 시 `CustomEvent("detail-panel")` dispatch |
