# HANDOFF — 29CM Commerce Core Team Dashboard (v2)

> **경고**: 이 문서는 지금까지 Claude 세션에서 실제로 작업 · 검증 · 관찰한 사실을 정직하게 정리합니다. 다음 태그로 각 항목의 근거를 명시합니다:
>
> - **[확인됨]** — 이번 세션에서 실제 코드 read / git 명령 / 명령어 실행으로 검증됨
> - **[대화기록]** — 이번 세션의 사용자 발언 / Slack 메시지 등에서 확인. 코드로 재검증 안 함
> - **[추정]** — 코드나 대화의 부분 정보로부터 추론. 충분한 근거 없음
> - **[확인 필요]** — Codex 가 실제 코드 · 서비스 · Jira 접근으로 검증해야 함
> - **[미확인]** — 이번 세션에서 조사 안 함. 정상/비정상 모두 판단 불가
>
> **자체 비판**: 이번 세션에서 Claude 는 **production URL 을 단 한 번도 실제 열어본 적이 없습니다**. PR merged + Vercel green 은 "빌드 통과" 일 뿐 runtime 정상 동작 확인이 아닙니다. 여러 항목에서 "정상 동작 ✓" 로 쓰기 쉬웠던 것들을 이 문서는 정확한 태그로 재분류합니다.
>
> **문서 작성일**: 2026-07-06
> **작성 세션**: `session_01GEzTLnivBUBnz6SadBVs1R`
> **Main HEAD 시점**: `54134eb…` (PR #57 merged)

---

## 1. 프로젝트 개요

| 항목 | 값 | 태그 |
|---|---|---|
| Framework | Next.js `16.2.2`, React `19.2.4` | **[확인됨]** — package.json |
| Package manager | npm (`package-lock.json` 존재) | **[확인됨]** |
| Node.js 버전 | — | **[확인 필요]** — package.json engines 미지정, .nvmrc 없음 |
| Production URL | `https://29cm-team-dashboard.vercel.app` | **[대화기록]** — Slack 스레드 텍스트에서 확인. Claude 세션에서 실제 접속 안 함 |
| Vercel 프로젝트 | `minjuchoi-6039s-projects/29cm-team-dashboard` | **[확인됨]** — GitHub commit status target_url 도메인 |
| GitHub 저장소 | `minjuchoi-29/29CM-CommerceCore_Team-Dashboard` | **[확인됨]** |
| 기본 브랜치 | `main` | **[확인됨]** |
| Claude 지정 작업 브랜치 | `claude/team-dashboard-commerce-7YnMk` | **[확인됨]** |

### 도메인 화이트리스트
```ts
// auth.ts:4
const ALLOWED_DOMAINS = ["29cm.co.kr", "musinsa.com"]
```
**[확인됨]**

### 주요 사용자
- **[추정]**: PM / PD / BE / FE / QA / 배포 담당 — Weekly 템플릿 라벨과 auth 도메인으로부터 역추론. 실제 활성 사용자 role 분포 미확인
- **[확인 필요]**: 이번 세션 사용자는 minju.choi@29cm.co.kr (dashboard 소유자로 추정)

### Weekly / Sprint Preplanning 운영 방식
- **[대화기록 / 부분 근거]**: Slack 스레드에서 Minju 가 "진척상황 화요일 오전 11시 미팅 전 모두 포함해서 업데이트 해주시기 바라요" 라고 언급. 이는 **업데이트 마감 시점** 언급이지 Weekly Meeting 자체의 시간·주기·참여자를 확정하는 정보가 아님
- **[확인 필요]**: Weekly Meeting 정확한 시간·주기·참여자
- **[확인됨]**: Sprint Preplanning 관련 Confluence 문서 2건이 사이드바 "퀵 링크" 에 등록됨 (Engineering x Product, Design x Product)
- **[확인 필요]**: 실제 Preplanning 진행 방식 · 산출물

### 스케줄러
```json
// vercel.json
{ "crons": [{ "path": "/api/cron/daily-refresh", "schedule": "0 0 * * *" }] }
```
**[확인됨]** — 매일 00:00 UTC 실행

---

## 2. 지금까지 구현한 주요 기능 — **가장 재검토가 필요한 섹션**

> ⚠️ **비판**: v1 원본에서 "✓ 정상 동작" 을 남발했음. 실제로는 대부분 **"PR merged + build success"** 까지만 확인했지 **runtime 확인** 이 아님.

### 2-1. 전체 과제 현황 (`/jira-tickets`)

| 항목 | 태그 |
|---|---|
| 파일 존재 (`app/jira-tickets/TicketBoard.tsx` 11,561 LOC) | **[확인됨]** |
| 관련 seed (`app/jira-tickets/tickets-data.ts` 149 티켓) | **[확인됨]** — grep count |
| 데이터 source (Jira REST + KV 20+ keys) | **[확인됨]** — grep 결과 |
| **runtime 정상 동작** | **[미확인]** — 이번 세션에서 브라우저로 열어본 적 없음 |

**알려진 한계** **[확인됨]**:
- 단일 파일 11K LOC — 유지보수 부담. GanttChart / renderWeeklySyncTrace / renderLinkedWork / WeeklySyncSummary 등 여러 하위 컴포넌트가 모두 이 파일 안
- eslint baseline 9~10 error (setState in effect / relativeTime purity) 존재. 이번 세션에서 PR 마다 baseline 무변동 원칙 준수

### 2-2. Jira Sync 버튼

| 항목 | 태그 |
|---|---|
| 버튼 위치 (`TicketBoard.tsx:5680` `onClick={forceRefresh}`) | **[확인됨]** — grep line 5680 |
| `forceRefresh` 함수 (line 1982) 호출 체인 | **[확인됨]** — 직접 read |
| **runtime 클릭 결과** | **[미확인]** |

### 2-3. Weekly Sync

| 항목 | 태그 |
|---|---|
| Orchestration 위치 (`TicketBoard.tsx:2048-2200`) | **[확인됨]** |
| /api/jira-weekly-source (581 LOC) 정책 v6 | **[확인됨]** |
| /api/weekly-sync (200 LOC) | **[확인됨]** |
| **실제 동작 상태**: 세션 중 사용자 보고로 **적용 22 / 스킵 91 (81% 실패율)** 로 관측됨 | **[대화기록]** |

> ⚠️ **비판**: Weekly Sync 는 **정상 동작 중이 아님**. 세션 중 관측된 skip 81% 는 시스템의 명백한 문제 상태. v1 에서 "mechanically 정상" 이라 쓴 것은 misleading.

### 2-4. 변화 보기 (Weekly Sync Trace / Detected Sources)

| 항목 | 태그 |
|---|---|
| `renderWeeklySyncTrace` (line 2663+) 코드 존재 | **[확인됨]** |
| `WeeklySyncSummary` (line 11109+) 코드 존재 | **[확인됨]** |
| PR #48 / #52 / #1 (PR-Multi-1) 코드 존재 | **[확인됨]** — commit history |
| **runtime 정상 렌더 확인** | **[미확인]** |

### 2-5. 일정 변경 후보 (Update Candidates)

| 항목 | 태그 |
|---|---|
| 생성 로직 (`weekly-merge.ts:283-298`) | **[확인됨]** — read |
| KV `cc-update-candidates` | **[확인됨]** — grep |
| **UI review 흐름** | **[미확인]** |

### 2-6~2-11. 담당자별 일정 / 리소스 / 월별 / ETR / 담당자 대시보드 / 리포트 / 데이터 소스

| 페이지 | 파일 LOC 확인 | 코드 내용 read | Runtime |
|---|---|---|---|
| `/resources` (484 LOC) | **[확인됨]** | **[미확인]** | **[미확인]** |
| `/monthly` (529 LOC) | **[확인됨]** | **[미확인]** | **[미확인]** |
| `/etr-review` (8 LOC + EtrReviewBoard) | **[확인됨]** | **[미확인]** | **[미확인]** |
| `/owner-dashboard` (9 LOC) | **[확인됨]** | **[미확인]** | **[미확인]** |
| `/reports` (38 LOC) | **[확인됨]** | **[미확인]** | **[미확인]** |
| `/data-sources` (11 LOC) | **[확인됨]** | **[미확인]** | **[미확인]** |
| `/roadmap` (1477 LOC) | **[확인됨]** | **[미확인]** | **[미확인]** |
| `/q2-initiative` (305 LOC) | **[확인됨]** | **[미확인]** | **[미확인]** |

> ⚠️ **비판**: 위 8개 페이지에 대해 v1 에서 "정상 동작 [확인 필요]" 로 표기했지만 실제로는 **파일 존재 확인 외 아무것도 안 함**. 정상 여부 판단 불가.

### 2-12. Weekly 작성 가이드 (`/weekly-guide`, `/weekly`)

| 항목 | 태그 |
|---|---|
| PR #54 / #55 / #56 merged (SHA `04a3b73`/`f77040e`/`c2fd160`) | **[확인됨]** — git log |
| 파일 존재 (`app/weekly-guide/page.tsx`, `CopyTemplateButton.tsx`, `app/weekly/page.tsx`) | **[확인됨]** — 이번 세션에서 내가 작성 |
| build success · Vercel preview success | **[확인됨]** |
| **Production 접속 · 사용자 렌더 확인** | **[미확인]** — 사용자가 이후 "Weekly Sync 버튼이 어디 있냐" 라고 물어본 것으로 봐 완전한 확인 미완료 가능성 |

### 2-13. Light Mode Toggle

| 항목 | 태그 |
|---|---|
| PR #53 merged (SHA `9739cd8`) | **[확인됨]** |
| Toggle 코드 (SidebarNav.tsx:493-530) 재활성화 | **[확인됨]** — 내가 직접 수정 |
| ThemeProvider console log 1회 출력 | **[확인됨]** — 내가 직접 추가 |
| **Production 클릭 · 렌더 확인** | **[미확인]** |
| Light Mode 시인성 이슈 (hardcoded rgba 16건) | **[추정]** — grep 결과 개수 확인. 실제 시각 결함 미확인 |

---

## 3. Jira 데이터 흐름 (실제 코드 기준)

```
Jira REST API
  │  GET /rest/api/3/issue/{key}?fields=description,updated,customfield_10625
  │  GET /rest/api/3/issue/{key}/comment?orderBy=-created&maxResults=20
  ▼
[STEP 1] fetchWithTimeout — route.ts:181-189   [확인됨]
  ★ 결함: timeout 이 headers 단계만 보호. body read 무방비 (§9-B 참조)
▼
[STEP 2] adfToText — route.ts:34-75            [확인됨]
  ★ 결함: expand/nestedExpand 의 attrs.title 미렌더 (§8-A P1 후보)
  mention/emoji/status/inlineCard/date 의 attrs 도 무시
▼
[STEP 3] extractWeeklySection — route.ts:161-177   [확인됨]
  WEEKLY_HEADER_RE (line 154) 미매치 시 section=""
  WEEKLY_STOP_PATTERNS (line 157-159) 헤더 직후 매치 시 section=""
▼
[STEP 4] Comment marker 탐색 — route.ts:344-360   [확인됨]
  isAutomationAuthor (line 113-124)
  WEEKLY_COMMENT_MARKER_RE (line 111)
  ★ PR-Multi-1 후: break 제거, markedCommentList[] 로 누적
▼
[STEP 5] pick = descCandidate ?? commentCandidate   [확인됨] — line 432
  ★ customfield_10625 는 fetch + debug 만, pick 제외 (v5)
▼
[STEP 6] Detected Sources 배열 — route.ts:432-490   [확인됨] — PR-Multi-1
▼
[STEP 7] parseWeekly — lib/weekly-parser.ts:797   [부분 확인됨]
▼
[STEP 8] KV write + 응답 — route.ts:448-515   [확인됨]

--- Client orchestration ---

[STEP 9] TicketBoard.forceRefresh — TicketBoard.tsx:1982   [확인됨]
  ★ Weekly Sync 는 void async IIFE (line 2052) fire-and-forget
  ★ 4단계 silent skip: DONE_FOR_WEEKLY / hidden / !srcRes.ok / !foundMarker
▼
[STEP 10] /api/weekly-sync — weekly-sync/route.ts:31   [확인됨]
  parseWeekly → mergeWeeklySync → KV write 4곳
▼
[STEP 11] cc-weekly-sync-meta read-modify-write   [확인됨] — PR #52
▼
[STEP 12] 화면 표시 (GanttChart, WeeklySyncSummary, Trace card)
```

각 단계의 실패 조건은 코드 분석 기반 **[확인됨 (분기 논리)] / [추정 (실패 빈도)]**.

---

## 4. Weekly 선택 정책 (v6, route.ts:363-432)

### 규칙 요약 **[확인됨]**

1. **Description 우선**: `WEEKLY_HEADER_RE` 매치 + stop 패턴까지의 텍스트가 non-empty 면 description 선택
2. **Fallback: 최신 오토봇 comment**: description 미매치 시 `-created` 정렬 첫 marker comment
3. **customfield_10625 는 pick 제외** (v5 정책 유지, route.ts:435 주석 명시)

### 헤더 인식 예 **[확인됨]** — `tests/weekly-header-prefix.test.ts` 검증됨
- **매치**: `Weekly 공유사항`, `21주차 Weekly 공유사항`, `이번주/금주/this week/current week Weekly 공유사항`, 앞에 `* / # / [ / 🧭` 장식 허용
- **미매치 (의도)**: `이번주의 Weekly 공유사항`, `다음주 Weekly 공유사항`, `Weekly Update` 등 영문 변형, mid-line

### Automation Bot 식별 **[확인됨]** — route.ts:113-124
```ts
n.includes("automation") || /\bbot\b/.test(n) || n.includes("atlassian")
  || n.includes("자동 생성") || n.includes("자동생성")
```
displayName 기반. 특정 accountId 사용 안 함.

### 여러 주차 처리 **[확인됨]**
- **description**: 헤더 첫 매치 이후 stop 패턴까지 1건만
- **comment**: `-created` 최신순 20건 회수 후 marker 있는 것들 전부 (PR-Multi-1). 단 `commentCandidate = markedCommentList[0]` — pick 은 여전히 1건만

### 화면의 "source: comment" 의미 **[확인됨 (로직) / 추정 (원인)]**
- `pick.source === "comment"` = description Weekly 섹션 미인식 신호
- **원인은 코드상 R-α (adfToText 결함), R-β (regex 미매치), R-γ (stop 패턴 절단) 3가지 카테고리 중 하나**. TM-2746 은 이 중 어느 것인지 세션 종료까지 확정 안 됨 (§8-A)

### Detected Sources vs Selected Source **[확인됨]** — 내가 직접 작성 (PR-Multi-1)
- **Detected**: 후보 시각화 전용. description 있음 + qualifying comment N건 모두 노출
- **Selected**: 실제 sync 된 1건

---

## 5. 일정 파싱 정책 — **v1 에서 크게 부풀림, 재작성 필요**

| 항목 | 태그 |
|---|---|
| `SECTION_ALIASES` (weekly-parser.ts:333-341) | **[확인됨]** — 직접 read |
| `STATUS_KEYWORDS` (line 420-445) | **[확인됨]** |
| `SchedulePhase` 타입 (`"Kick-Off"|"기획"|"디자인"|"개발"|"QA"|"Release"|"Launch"|"기타"`) | **[확인됨]** |
| `MILESTONE_PHASES = {Launch, Release, Kick-Off}` (line 31) | **[확인됨]** |
| **날짜 형식 (MM/DD 등) 인식 상세 regex** | **[미확인]** — parser 1070 LOC 중 관련 부분 안 읽음 |
| **담당자 (assignee) 추출 로직** | **[미확인]** |
| **하나의 줄에 여러 일정 처리** | **[미확인]** |
| stableTaskId 계산식 `${ticketKey}::${phase}::${semanticSlug}` | **[확인됨]** — 주석. 실제 계산 함수 로직은 안 읽음 |
| **"다음주" 같은 상대 표현 처리** | **[추정]** — status keyword 목록에 없으니 fallback 될 것이라는 이론적 추론. 실제 fallback 동작 미확인 |
| **파싱 실패 시 UI 표시** | **[확인됨]** — TicketBoard.tsx:2886+ amber diagnostic 존재 확인 |

> ⚠️ **비판**: v1 §5 의 절반 이상은 코드 미독. Codex 가 `lib/weekly-parser.ts` (1070 LOC) 전수 read 필요.

---

## 6. 병합 및 수동 보호 정책

| 항목 | 태그 |
|---|---|
| KV 저장 위치 (cc-schedules / cc-weekly-notes / cc-update-candidates / cc-weekly-sync-meta / cc-weekly-source-text) | **[확인됨]** — grep 결과 |
| outcome 5종 (appended/idempotent/updated/candidates_only/manual_guard) | **[확인됨]** — weekly-merge.ts:189-333 read |
| `canAutoApplyToRow` 로직 (source: manual/imported/confirmed → false) | **[확인됨]** — line 141-145 |
| idempotent 조건 (5개 필드 same) | **[확인됨]** — line 239-245 |
| autoApply 조건 (`!isLocked && !isManualProtected && conflicts.length <= 1`) | **[확인됨]** — line 281 |
| Candidate id = `buildCandidateId(ticketKey, key, field, sourceWeek)` | **[확인됨]** |
| **후보 승인/거절 시 실제 동작** | **[미확인]** — TicketBoard 의 candidate 처리 UI/API 흐름 미조사 |
| **PM 이 UI 에서 입력 시 source="manual" 저장 여부** | **[미확인]** |
| **legacy row 마이그레이션 상태** | **[미확인]** |
| **중복 row 생성 이슈 존재 여부** | **[추정]** — 이론상 stableTaskId unstable 시 발생 가능. 실제 재현 사례 미확인 |

---

## 7. 일정 시각화

| 항목 | 태그 |
|---|---|
| GanttChart 위치 (`TicketBoard.tsx:472+`) | **[확인됨]** — grep |
| 데이터 모델 (RoleSchedule + ExtendedSchedule + ScheduleSourceMeta) | **[확인됨]** — weekly-types.ts read |
| ticketKey → cc-schedules 매핑 | **[확인됨]** |
| Row identity: stableTaskId → mergeKey fallback | **[확인됨]** |
| **타임존 처리** | **[추정]** — client-side 렌더링만 확인. timezone 관련 코드 미조사 |
| **알려진 표시 오류 원인** | **[추정]** — 3개 후보 (stableTaskId 중복 / silent skip stale / placeholder drift) 모두 이론적 추론 |

---

## 8. 지금까지 해결하지 못한 문제

### 8-A. TM-2746 본문 Weekly 인식 실패 — **세션 종료까지 root cause 미확정**

| 서술 | 태그 |
|---|---|
| Detection 후보 시각화 (PR-Multi-1) 추가 | **[확인됨]** |
| Sync 상태 가시성 (PR #52) 추가 | **[확인됨]** |
| `descriptionLength=448`, `descriptionWeeklyHeaderMatched=null`, `descCandidate=null` 등 debug 수치 | **[대화기록]** — 사용자가 텍스트로 전달. Claude 가 API 호출로 회수한 게 아님 |
| **"가장 유력 원인: customfield_10625 에 실제 LIVE Weekly"** | **[추정]** — 세션 마지막까지 확인 안 됨. v1 에서 "가장 유력" 이라 쓴 것은 과장 |
| "expand.attrs.title" 후보 | **[추정]** — 사전 분석에서 P1 이라 썼지만 debug 응답 미회수 |
| **결론: root cause 미확정 상태로 세션 종료** | **[비판]** |

> ⚠️ **정직한 정리**: TM-2746 은 세션 내내 조사만 하고 원인 확정도 못 함. Detection 후보 시각화 · Sync 가시성 개선은 **진단 도구를 만든 것**이지 **문제 해결이 아님**.

### 8-B. 오토봇 지난 Weekly 선택

| 항목 | 태그 |
|---|---|
| Multi-source Merge 보류 (사용자 forbid) | **[대화기록]** |
| PR-Multi-1 로 Detection 후보 시각화만 | **[확인됨]** |
| `markedCommentList[0]` 만 pick (여전) | **[확인됨]** |

> ⚠️ **비판**: 이 시스템은 **여러 주차 comment 를 통합해서 스케줄로 반영할 능력이 없음**. 마지막 주차 comment 1건만 사용.

### 8-C. Weekly → 일정 변환 (파서)

| 항목 | 태그 |
|---|---|
| PR #50 STATUS/SECTION 확장 | **[확인됨]** — commit `dcbc6bb` |
| PR #46 comment source v6 | **[확인됨]** — commit `9c187a8` |
| 배포 후에도 TM-2745/56/46 schedule items = 0 | **[대화기록]** — 사용자 보고 |
| **개선 여부 재확인** | **[미확인]** — 세션에서 재확인 안 함. **skip 91/22 상 파싱까지 도달 못 한 티켓이 대다수** 인 것으로 추정 |

### 8-D. 작업별 · 담당자별 시각화

| 항목 | 태그 |
|---|---|
| `/resources` 페이지 파일 존재 (484 LOC) | **[확인됨]** |
| **시각화 정확성** | **[미확인]** — 코드 read 안 함 |

> ⚠️ **비판**: v1 에서 "성공한 범위: 페이지 자체는 구현됨" 이라 썼는데 **파일 존재는 성공이 아님**.

### 8-E. 자동 파싱과 수동 일정 병합

| 항목 | 태그 |
|---|---|
| `canAutoApplyToRow` / `manual_guard` outcome | **[확인됨]** |
| **legacy row 마이그레이션** | **[미확인]** |
| **PM UI 가 source="manual" 저장하는지** | **[미확인]** |
| **실제 사용자 워크플로에서 정책 발동** | **[미확인]** |

---

## 9. 실패했던 접근 방법 — **v1 에서 실패를 성공처럼 포장한 부분 있음**

### 9-A. `?discover=fields` production 차단
- **[확인됨]** — route.ts:226. production 은 404. dev 만 사용 가능

### 9-B. `fetchWithTimeout` body-read timeout 확장
- **[확인됨]** (분석) — line 181-189 로직상 body read 시 signal abort 미작동
- **미진행 이유**: 사용자가 "timeout 문제는 이번 분석 범위 제외" 명시
- ⚠️ **비판**: 원인 분석까지만 하고 **수정 안 함**. **TM-2746 hang 원인이 여전히 잠재**. Codex 가 P0 로 다뤄야 함

### 9-C. TM-2746 stop 패턴 확정 진단
- **[비판]**: 세션 종료까지 debug 응답 회수 실패. **실패한 접근이 아니라 정보 수집 미완료**

### 9-D. Multi-source Merge (PR-Multi-2)
- **[대화기록]** — 사용자 명시적 forbid
- 재시도 안 되는 이유: 사용자 결정 + candidate/statusHistory/stale 위험

### 9-E. `customfield_10625` 재도입 검토
- **[대화기록]** — 옵션 A/B/C/D/E 제시했으나 사용자 결정 없음
- ⚠️ **비판**: 옵션 나열만 하고 결정·실행 없음. 실제 해결책 아님

### 9-F. Weekly Guide 문구 대규모 수정 금지
- **[대화기록]** — 사용자 원칙
- ⚠️ **비판**: 이건 "실패 접근" 이 아니라 "금지 사항". v1 §9 배치는 부적절

---

## 10. 대표 Jira 티켓 — **거의 모두 미검증**

| 티켓 | 태그 |
|---|---|
| TM-2745 (오토봇 코멘트 · description 인식 실패) | **[대화기록]** — 사용자 언급. 실제 상태 미검증 |
| TM-2756 | **[대화기록]** — 동상 |
| TM-2746 (본문+댓글 · description detection 실패, 핵심 케이스) | **[대화기록]** — 사용자 제공 debug 텍스트만 |
| TM-3032 (20/21/22주차 comment · customfield=null) | **[대화기록 / 코드 주석]** — route.ts:389 주석 인용. 실제 티켓 미확인 |
| TM-2031 (초기 seed) | **[확인됨]** — commit `9b49346 feat: 티켓 추가 TM-2031` |

> ⚠️ **비판**: 대표 티켓 리스트를 **테스트 재현 가이드로 신뢰하면 안 됨**. Codex 가 Jira 접근 후 리스트 갱신 필요.

---

## 11. 환경 설정

### 환경변수 (이름과 목적, 값 제외)

| 이름 | 목적 | 태그 |
|---|---|---|
| `JIRA_EMAIL` | Jira REST API Basic auth 이메일 | **[확인됨]** — route.ts:209 |
| `JIRA_API_TOKEN` | Jira REST API Basic auth token | **[확인됨]** |
| `JIRA_DRY_RUN` | (있으면) Jira 쓰기 skip | **[추정]** — 사용 위치 미조사 |
| `AUTH_SECRET` | NextAuth JWT secret | **[확인됨]** — auth.ts |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google OAuth | **[확인됨]** |
| `KV_REST_API_URL` / `KV_REST_API_TOKEN` | Upstash Redis REST | **[확인됨]** — grep + `@upstash/redis` package |
| `GEMINI_API_KEY` | AI Summary (`/api/ai-summary`) | **[확인됨 (env 이름)] / [추정 (사용 상세)]** |
| `CRON_SECRET` | Vercel cron 인증 | **[확인됨]** |
| `ADMIN_ONLY_EMAILS` | 관리자 메뉴 화이트리스트 | **[확인됨 (env 이름)] / [추정 (동작)]** |
| `REPORTS_ALLOWED_EMAILS` / `RESOURCE_ALLOWED_EMAILS` / `ROADMAP_ALLOWED_EMAILS` / `DATA_SOURCES_ALLOWED_EMAILS` | 페이지별 화이트리스트 | **[확인됨 (env 이름)] / [추정 (실제 게이팅 로직)]** |

**값 보관**: **[추정]** — Vercel Environment Variables (관례). 로컬은 `.env.local` (`.gitignore` 예상)

### 외부 저장소
- **Upstash Redis (KV)**: **[확인됨]** — 20+ `cc-*` keys
- **Google Sheets**: **[확인됨 (scope)] / [미확인 (실제 사용 위치)]**

### Jira 인증
- REST API v3, Basic auth, host `https://musinsa-oneteam.atlassian.net` — **[확인됨]** — route.ts:8, 218

### 명령어 **[확인됨]** — package.json

```bash
npm install
npm run dev
npm run lint
npm run build
npm test                              # tsx --test tests/*.test.ts + weekly-stable-identity.test.ts
npx tsc --noEmit                      # (별도 script 없음)
```

### 배포
- **Preview**: PR 시 Vercel 자동 — **[확인됨]** — commit status 로 확인
- **Production**: main 머지 시 자동 — **[확인됨]**
- **Cron**: 매일 00:00 UTC `POST /api/cron/daily-refresh` — **[확인됨]** — vercel.json

### Node.js 버전
**[확인 필요]** — 진짜 모름. package.json engines 없음, .nvmrc 없음. Next.js 16.2 요구사항 참조 필요

---

## 12. Git 이력

### 브랜치
- `main` — production auto-deploy | **[확인됨]**
- `claude/team-dashboard-commerce-7YnMk` — Claude 세션 브랜치 (재사용) | **[확인됨]**

### Merged PR 목록 (최신순, `git log --oneline` 확인)

| PR | Commit | 제목 | 태그 |
|---|---|---|---|
| #57 | `54134eb` | feat(quick-links): 2026 H2 Commerce Core | **[확인됨]** |
| #56 | `c2fd160` | feat(guide): Weekly 템플릿 라벨 정정 | **[확인됨]** |
| #55 | `f77040e` | feat(guide): Weekly 작성 포맷 복사 버튼 | **[확인됨]** |
| #54 | `04a3b73` | feat(guide): Weekly 작성 가이드 페이지 + 사이드바 | **[확인됨]** |
| #53 | `9739cd8` | feat(theme): Re-enable Light Mode toggle | **[확인됨]** |
| #52 | `24b67ed` | feat(weekly-sync): Sync 상태 가시성 (PR-Sync-Visibility) | **[확인됨]** |
| #1 | `a17aac7` | feat(weekly-source): Detection 후보 노출 (PR-Multi-1) | **[확인됨]** |
| #47 | `93367d4` | feat(weekly-source): WEEKLY_HEADER_RE prefix 추가 (v6.1) | **[확인됨]** |
| #51 | `2d7f75d` | feat(ui): Linked Work 섹션 (B5.1) | **[확인됨]** |
| #46 | `9c187a8` | fix(weekly-sync): Comment-source schedule sync 대상 (v6) | **[확인됨]** |
| #50 | `dcbc6bb` | fix(weekly-parser): no-marker fallback + STATUS/SECTION | **[확인됨]** |
| #48 | `5971e6d` | feat(ui): "최근 Sync 결과" + Source Preview (B3) | **[확인됨]** |
| #45 | `95f0d17` | feat(search): Global Search Deep-link | **[확인됨]** |
| #39 | `5025107` | feat(weekly): Weekly Sync Visibility (초기) | **[확인됨]** |
| #38 | `c4d6cef` | feat(schedule): Reconciliation Phase 1 | **[확인됨]** |

### Weekly 기능 최초 도입
- **[추정]**: `9b49346 feat: 티켓 추가 TM-2031` — 이번에 조사한 git log 범위에서 가장 오래된 커밋. **그 이전 히스토리 미확인**
- 파서 도입 · 병합 도입 커밋 — **[미확인]**

### 최근 정상 동작 확인된 버전
- **[비판]**: v1 에서 "정상 동작 확인" 이라 썼지만 실제로는 **build success + Vercel preview green** 만 확인. runtime 미확인
- 정확한 표기: "최근 build/deploy 통과된 버전" = `54134eb…` (main HEAD, PR #57)

---

## 13. Codex 조사 권장 순서

기존 사실 + 실패 경험 우선. **새 해결책 추측 금지**.

### Phase 1 — 코드 지도 파악 (읽기)
1. `AGENTS.md` — 프로젝트 규칙 (Next.js 16 breaking changes 주의)
2. `PRD.md` — 초기 요구사항
3. `app/layout.tsx` — provider · auth
4. `app/components/SidebarNav.tsx` — 라우팅 지도
5. `app/jira-tickets/TicketBoard.tsx` (11,561 LOC) — `forceRefresh` (1982+) / `renderWeeklySyncTrace` (2663+) / `GanttChart` (472+) / `WeeklySyncSummary` (11109+) 부터

### Phase 2 — Weekly 파이프라인 코드 순회
1. `app/api/jira-weekly-source/route.ts` (581 LOC)
2. `app/api/weekly-sync/route.ts` (200 LOC)
3. `lib/weekly-parser.ts` (1070 LOC) — Claude 세션에서 **부분만 read**. Codex 는 전수 필요
4. `lib/weekly-merge.ts` (410 LOC)
5. `lib/weekly-types.ts` (283 LOC)
6. `lib/weekly-ast.ts` (520 LOC) — Claude 세션에서 read 안 함

### Phase 3 — 실제 데이터 회수 (Codex 환경에서 가능하다면)
1. **TM-2746 debug 응답 회수** — §8-A root cause 확정 필수. `descriptionAdfNodeTypes` / `weeklyCustomFieldHasValue` / `weeklyCustomFieldPreview` / `titlesAndPanels` 확인
2. `cc-weekly-sync-meta` KV dump — no_marker/src_error/sync_error 사유별 분포 (PR #52 이후)
3. `cc-schedules` KV dump — stableTaskId 중복 여부

### Phase 4 — 미결 P0 항목
1. **TM-2746 root cause 확정** → customfield_10625 재도입 여부 결정 (사용자 결정 필요)
2. **`fetchWithTimeout` body-read timeout 확장** (§9-B) — TM-2746 hang 원인 가능성. 세션에서 미진행
3. `/resources` `/monthly` `/roadmap` `/reports` `/etr-review` 실동작 검증 — 이번 세션에서 미확인
4. Light Mode hardcoded `rgba(255,255,255,...)` overlay 16건 (PR-Light-2 후보) — 사용자 결정 대기

### Phase 5 — 정책 문서화
1. Weekly 정책 v6 별도 마크다운 정리 (route.ts:363-393 주석 확장판)
2. PR-Multi-2 (multi-source merge) 진행 여부 결정 문서화

### 절대 하지 말 것
- 사용자 명시적 요청 없이 리팩터링
- Multi-source Merge 구현 (사용자 forbid)
- Weekly Sync policy 변경 (v6 결정)
- Theme / Sidebar 구조 변경
- 사용자 확인 없이 main 직접 commit/push/merge

---

## 종합 비판 (v2 신규 섹션)

### 이 문서를 신뢰하는 방법

- **[확인됨]** 태그가 붙은 항목: 코드 · git · 파일 존재 사실. 신뢰 가능
- **[대화기록]** 태그: 사용자 발언 · Slack 텍스트. Codex 는 재검증 필요
- **[추정]** / **[확인 필요]** / **[미확인]** 태그: 재조사 필수. Claude 세션에서 근거 부족

### v1 원본의 3가지 큰 결함

1. **"정상 동작 ✓" 남발**: 사이드바에 있는 8개 페이지 중 6개는 **파일 존재 확인 외 아무것도 안 함**. 정확한 표기는 **[코드 존재 확인] / [runtime 미검증]**
2. **TM-2746 을 "가장 유력 원인 파악됨" 처럼 포장**: 실제로는 세션 종료까지 **원인 미확정**. Detection 후보 시각화 · Sync visibility 는 **진단 도구지 문제 해결이 아님**
3. **PR merged 를 "기능 동작 확인" 과 동일시**: build success · Vercel preview green 은 **컴파일 통과** 이상의 의미가 아님

### 이번 세션의 실제 성과 (정직한 요약)

**신규 기능 · 문서**:
- Weekly 작성 가이드 페이지 (`/weekly-guide` + `/weekly` redirect) — 정적 문서
- Weekly 작성 포맷 복사 버튼
- Quick Links H2 문서 1건 추가
- Light Mode 토글 재활성화 (기존 dead code unblock)
- Weekly Sync 관측성 개선 (배지 + skip 사유 KV persist) — **진단 도구**
- Detection 후보 시각화 (PR-Multi-1) — **진단 도구**

**해결한 근본 문제**: **없음.** TM-2746 detection 실패 · skip 81% 문제 모두 미해결.

**진단 도구 활용 여부**: 세션 종료까지 사용자가 debug 응답 회수 → root cause 확정 못 함.

### Codex 에게

- 이 HANDOFF 를 **"검증된 사실 문서"** 로 보지 말 것. **"이 세션에서 시도된 것과 미해결로 남은 것 목록"** 으로 볼 것
- §8-A (TM-2746) 는 여전히 open. 첫 작업으로 사용자에게 debug 응답 회수 요청 필요
- §9-B (fetchWithTimeout body-read timeout) 는 분석만 됨. Codex 가 P0 로 코드 수정 진행 검토
- §2 의 각 페이지 · 기능은 **모두 브라우저로 열어 실제 동작 확인 후** 이 문서를 갱신할 것

---

_문서 작성 세션: `session_01GEzTLnivBUBnz6SadBVs1R`_
_Main HEAD 시점: `54134eb` (2026-07-06)_
