# 29CM Commerce Core Team Dashboard — 작업 인수인계

> 갱신일: 2026-08-11 (KST)
>
> 기준 브랜치: `main`
>
> 기능 기준 커밋: `07936dd` (`fix: hide redundant milestone placeholders`)
>
> 운영 URL: <https://29cm-team-dashboard.vercel.app/>

## 1. 문서 사용 우선순위

1. 현재 `main` 코드와 테스트
2. 이 `HANDOFF.md`
3. `PRD.md`와 `docs/policies/*`

`PRD.md`에는 과거 화면 구조, 역할명, 동기화 정책이 일부 남아 있다. 최신 P1/P1-1 구현이나 이 문서와 충돌하면 현재 코드와 테스트를 기준으로 판단한다. PRD를 대규모로 먼저 고치지 말고, 다음 기능 범위를 확정한 뒤 관련 항목만 갱신한다.

## 2. 저장소와 배포 상태

- GitHub: <https://github.com/minjuchoi-29/29CM-CommerceCore_Team-Dashboard.git>
- 브랜치: `main`
- 기능 기준 커밋: `07936dd`
- 직전 주요 커밋:
  - `7b501dc` — 과거 Weekly 예정·오래된 진행 일정을 이력으로 분리
  - `4b41884` — 팀별 현재 단계와 세부 일정의 역할 정리
  - `059df71` — 상태 적응형 기본/집중 화면 보완
  - `a7fd9c8` — P1-1 lifecycle-aware dashboard view 도입
  - `6baa1aa` — P1 스프린트 프리플래닝 관리
- `07936dd` 운영 배포 검증 URL:
  - <https://29cm-team-dashboard-af8pb69mu-minjuchoi-6039s-projects.vercel.app>
- 운영 별칭 `https://29cm-team-dashboard.vercel.app/`이 위 배포를 가리키는 것을 확인했다.

## 3. 마지막 검증 결과

기능 기준 커밋 `07936dd`에서 다음을 통과했다.

- `npm test`: 일반 테스트 558건 통과
- stable identity 테스트: 45건 통과
- `npx tsc --noEmit`: 통과
- 변경 파일 ESLint: 오류·경고 없음
- `npm run build`: Next.js 16.2.2 프로덕션 빌드 통과
- Vercel 배포: Production / Ready
- 최근 1시간 Vercel error 로그: 없음
- 운영 브라우저 콘솔 error: 없음

로컬 빌드는 Upstash 환경변수가 없을 때 설정 경고가 보일 수 있다. 실제 값을 출력하거나 새 파일에 복사하지 말고, Vercel 프로젝트에 설정이 존재하는지만 확인한다.

## 4. 현재까지 완료된 주요 범위

### P1 프리플래닝

- 2주 단위 스프린트 상태 관리
- 예정 스프린트와 논의 메모 관리
- 진행 중·완료 과제는 플래닝 완료로 간주
- 기존 `cc-planning` 수동 값과 메모 보호
- 플래닝 대기 과제와 Weekly Sync 대상 분리
- 플래닝 티켓 갱신과 실행 과제 Weekly Sync 버튼 분리

### P1-1 상태 적응형 화면

- 플래닝 대기: 플래닝 상태, 예정 스프린트, 필요한 팀, 논의 메모 중심
- 진행 중: 최근 Weekly, 팀별 현재 단계, 세부 일정 중심
- 최근 완료: 완료 이후 Weekly·후속 조치 추적 중심
- 목록/기본보기/집중보기의 역할을 분리하고 중복 정보 축소
- 집중보기에서 전체 목록으로 직접 이동
- 티켓 복사는 아래 Markdown 형태를 사용
  - `[TM-2745](https://jira.team.musinsa.com/browse/TM-2745) · [페이먼츠] 무신사머니 케이뱅크 제휴통장 연동`

### Jira/Weekly 동기화

- Jira 본문의 현재 `Weekly 공유사항` 필드 우선
- 본문이 비어 있으면 description legacy Weekly 사용
- 현재 source가 없으면 Automation Bot 댓글의 과거 Weekly를 fallback/replay
- 완료 후 14일 동안 Weekly 추적
- 플래닝 대기 과제는 전체 Weekly Sync에서 제외
- 티켓 추가는 공용 KV 저장 성공 후 화면 반영하여 다른 사용자도 새로고침으로 확인 가능

### 일정 표시 최신화

- 같은 Weekly 작업은 최신 sourceWeek/lastSeenAt 기준으로 화면 중복 정리
- Release/Launch/Kick-Off는 최신 마일스톤 중심으로 노출
- 과거의 자동 `예정` 일정은 `과거 계획`으로 이력화
- 14일 넘게 새 Weekly에서 확인되지 않은 과거 자동 `진행중` 일정은 `이전 기록`으로 이력화
- 과거 완료 기간은 전체 흐름을 설명할 때 기본 일정에 유지
- 시작/종료일을 분리해 보이는 세부 일정 타임라인 적용
- 날짜가 확정된 마일스톤이 있으면, 같은 phase의 날짜·담당자·별도 설명이 없는 수동 미정 틀은 조회 화면에서 숨김
- 수동 일정의 저장 원본은 삭제·수정하지 않으며, 담당자나 별도 설명이 있으면 계속 노출

## 5. 운영 검증 사례

### TM-2771

운영 URL: <https://29cm-team-dashboard.vercel.app/?ticket=TM-2771&focus=1>

- 기본 일정:
  - `8/18~8/21 QA` 노출
  - `8/25~8/26 Release` 노출
  - 과거 `5/26 29CM 투입`과 `5/26~6/2 운영 자체 진행`은 숨김
  - 정보 없는 `날짜 미정 · 수동 Release` 중복은 숨김
- 이력 펼침:
  - `29CM 투입`은 `과거 계획`
  - `운영 자체 진행`은 `이전 기록`
  - 빈 수동 Release 중복은 펼침 상태에서도 표시하지 않음
- 저장 데이터 변경, Jira Sync, KV write는 실행하지 않았다.

### 기존 주요 회귀 확인 티켓

- `TM-2901`: 팀별 현재 단계와 세부 일정 중복·기간 표시
- `TM-2564`: 반복 QA 일정 정리
- `TM-2922`: Weekly 파싱과 일정 중복 정리
- `TM-2215`: Weekly 본문, 관련 문서와 Linked Work 밀도
- `TM-3375`: 본문 Weekly + Automation Bot 과거 댓글 replay

다음 작업에서 운영 데이터를 변경하지 않고, 위 티켓과 현재 대시보드의 플래닝 대기/최근 완료 표본을 다시 확인한다.

## 6. 데이터 보호 원칙

- `cc-schedules`의 `manual`, `imported`, `confirmed`, `manualLocked` 행을 Weekly 자동 병합으로 덮어쓰지 않는다.
- 수동 일정 중복 정리는 저장 데이터 삭제가 아니라 파생 조회 모델에서만 수행한다.
- `cc-planning`, `cc-planning-notes`, `cc-ticket-notes`, `cc-memos-v2` 기존/미래 필드를 부분 저장 과정에서 보존한다.
- Jira, Confluence, KV 데이터를 변경하는 테스트를 운영에서 실행하지 않는다.
- `Jira Sync`, `Weekly Sync`, 댓글 작성, 일정 저장 버튼은 명시적으로 필요한 검증이 아니면 누르지 않는다.
- 환경변수의 실제 값, OAuth 값, 토큰, 쿠키, 로컬 저장소 내용을 출력하거나 문서에 저장하지 않는다.

## 7. 팀명 정규화 정책

최종 화면 기본 표현:

- `PM`
- `Design`
- `BE - Pricing`
- `BE - Purchase`
- `FE - Commerce`

현재 의미 관계:

- Pricing = SP = 29CM Pricing BE
- Purchase = PP = 29CM Purchase BE
- CMFE = CFE = 29CM Commerce FE 하위
- DFE도 FE 하위지만 CFE와 동일 팀으로 임의 병합하지 않는다.
- App = Mobile
- 29CM Orders n Pricing = PM
- Commerce Design = Design
- 직접 입력한 팀명은 보존한다.

팀명 정규화는 화면 파생 모델에 우선 적용한다. 기존 KV 값을 일괄 마이그레이션하지 않는다.

## 8. 핵심 코드 위치

- `app/jira-tickets/TicketBoard.tsx`
  - 목록/기본/집중 화면, Weekly Sync, 일정 UI, 편집 상태
- `app/jira-tickets/TeamWorkstreamSummary.tsx`
  - 진행 중 과제의 팀별 현재 작업 요약
- `lib/team-workstreams.ts`
  - lifecycle과 팀별 현재/다음 작업 파생
- `lib/schedule-display.ts`
  - 일정 조회 중복 제거, 과거/이력/placeholder 분류
- `lib/weekly-parser.ts`
  - Weekly 내용을 phase, 작업, 팀, 담당자, 기간으로 파싱
- `lib/weekly-merge.ts`
  - 파싱 일정 저장 병합과 수동 데이터 보호
- `lib/weekly-targets.ts`
  - Weekly Sync 대상 정책
- `lib/weekly-source-selection.ts`
  - 현재 Weekly와 댓글 fallback 선택
- `lib/planning-helpers.ts`, `lib/preplanning.ts`
  - 기존 플래닝과 P1 프리플래닝 하위 호환
- `tests/schedule-display.test.ts`, `tests/team-workstreams.test.ts`
  - 이번 일정/팀 요약 주요 회귀 테스트

## 9. 다음 작업 권장 순서

### P1-2A — 코드 수정 전 UI/UX 진단

1. 목록/기본/집중보기에서 현재 lifecycle별 정보 위계를 다시 캡처한다.
2. 플래닝 대기, 진행 중, 최근 완료 티켓을 각각 2~3개 표본으로 선정한다.
3. 다음 중복과 조작성 문제를 우선 진단한다.
   - 집중보기 `세부 일정 > 편집`을 누르면 편집 상태로 바뀌지만, `focus=1` 화면에서 편집 폼이 보이지 않는 것으로 관찰됨. 코드와 운영 화면을 재확인한다.
   - 기본보기와 집중보기의 Weekly/팀별 단계/세부 일정 중복
   - 목록의 작은 글자와 과도한 badge/tag
   - 플래닝 완료 과제에 불필요한 플래닝 상세 노출
   - 최근 완료 과제의 Weekly 추적 종료와 후속 조치 표현
4. 변경 전 라이트 모드 이미지 시안을 먼저 제시하고 사용자 승인을 받는다.
5. 승인 후 최소 단위로 구현하고 lifecycle별 표본을 운영 전 검증한다.

### P1-2B — 라이트 전용 디자인 정리

- 현재 남아 있는 AI풍 보라색/인디고 중심 색조를 중립적인 프로페셔널 툴 톤으로 교체
- 본문과 표의 기본 글자 크기 상향
- badge는 상태/필터 가치가 있는 항목만 유지
- light 화면 정리가 승인된 뒤에만 다음을 제거
  - 다크모드 전환 UI
  - `ThemeProvider`의 테마 상태 저장
  - `data-theme="dark"` 및 dark 전용 스타일

다크모드 제거는 아직 완료되지 않았다. 현재 `app/components/ThemeProvider.tsx`, `app/components/SidebarNav.tsx`, `app/globals.css`, `app/layout.tsx`, `lib/theme.ts` 등에 관련 코드가 남아 있다.

## 10. 집 노트북에서 안전하게 시작하는 절차

1. 현재 폴더와 Git/GitHub CLI 설치·인증을 확인한다.
2. 저장소가 없으면 clone하고, 있으면 기존 변경부터 확인한다.
3. 기존 변경이 있으면 삭제, reset, checkout, 덮어쓰기를 하지 않고 먼저 보고한다.
4. 안전할 때만 `git fetch origin`, `git pull --ff-only origin main`을 실행한다.
5. `main`과 `origin/main` 일치, 깨끗한 작업 디렉터리, `07936dd` 포함 여부를 확인한다.
6. `AGENTS.md`, 이 문서, `PRD.md`, 관련 정책 문서를 읽는다.
7. `node_modules/next/dist/docs/`에서 변경하려는 Next.js 기능의 현재 문서를 읽는다.
8. 환경변수는 이름과 설정 존재 여부만 확인하고 실제 값은 출력하지 않는다.
9. 바로 코드를 수정하지 말고 P1-2A 진단과 라이트 이미지 시안부터 시작한다.

금지:

- `git reset --hard`
- `git clean`
- 강제 pull/push
- 기존 변경 삭제
- 비밀값 출력/파일 저장
- 승인 전 UI 구현
- 검증 목적의 Jira/KV 데이터 변경

## 11. 환경 정보

- Package manager: npm (`package-lock.json` 기준)
- 현재 검증 Node.js: `v24.14.0`
- `package.json`에는 Node engine이 고정되어 있지 않다.
- Framework: Next.js 16.2.2 / React 19.2.4 / TypeScript 5 / Tailwind CSS 4
- 로컬 실행: `npm run dev`
- 검증:
  - `npm test`
  - `npx tsc --noEmit`
  - 변경 파일 ESLint
  - `npm run build`

환경변수 이름만:

- `AUTH_SECRET`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `JIRA_EMAIL`
- `JIRA_API_TOKEN`
- `JIRA_DRY_RUN`
- `KV_REST_API_URL`
- `KV_REST_API_TOKEN`
- `GEMINI_API_KEY`
- `CRON_SECRET`
- `ADMIN_ONLY_EMAILS`
- `NEXT_PUBLIC_ADMIN_ONLY_EMAILS`
- `ROADMAP_ALLOWED_EMAILS`
- `NEXT_PUBLIC_ROADMAP_ALLOWED_EMAILS`
- `RESOURCE_ALLOWED_EMAILS`
- `REPORTS_ALLOWED_EMAILS`
- `DATA_SOURCES_ALLOWED_EMAILS`

실제 값은 Git, HANDOFF, 프롬프트에 포함하지 않는다.
