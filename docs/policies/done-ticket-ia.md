# Done Ticket Information Architecture

**Status**: Accepted (정책 문서, MVP 구현 보류)
**Date**: 2026-06
**Related**: PR #33 (Priority Model Split), `docs/policies/priority-lifecycle-v2.md`
**Implementation**: Phase β (β-1 / β-2 / β-3 단계별)

---

## TL;DR

Done 상태의 ticket 은 priority 가 아니라 **Outcome / Completion Date / Impact** 가 primary information 이어야 한다.

본 정책은 Phase β 의 구현 가이드:
- 신규 KV `cc-ticket-outcomes` 추가 (Outcome / Impact / Follow-up / Weekly Link)
- Jira `resolutiondate` 자동 fetch → Completion Date fallback
- Detail Panel Overview 안에 **status-aware Done 섹션** 추가 (별도 탭 없음)
- Outcome 은 **Hybrid (short summary + optional markdown detail)**, 필수 아님 (warn-only)

본 Phase β 완료 후에야 Phase α (Priority UI 축소) 적용 가능 — Policy v2 가 명시한 의존성과 일치.

---

## 1. AS-IS — 현재 Done Ticket UI 상태

### 1.1 TicketBoard

| 위치 | 노출 정보 | 특이사항 |
|---|---|---|
| 목록 row | status chip (emerald), ETA, type, assignee, project | 완료일 / 결과 정보 없음. Active 와 동일 layout |
| Detail Panel — Overview | 메타 (status, ETA, assignee, project, 요청 우선순위, Planning + Execution Priority) | Done 전용 섹션 없음 |
| Detail Panel — Ops | Gantt + role schedule + 검토 상태 | Done role 은 opacity 낮춤만 |
| Detail Panel — Activity | ActivityEntry log | "완료" 전환 event 별도 기록 없음 |
| Focus Mode | 동일 정보 | Action Items 만 빈 배열 |

### 1.2 Q2 Initiative
- 완료 count 집계만 (line 147)
- 카드 row 는 Active 와 동일 표시
- Outcome / 완료일 정보 없음

### 1.3 Owner Dashboard
- **Done ticket 완전 제외** (line 268-275)
- 액션 중심 view, "Recently Shipped" 같은 surface 없음

### 1.4 ETR Review
- Linked execution ticket 의 Done 으로 "상태 업데이트 필요" 트리거 (Phase A)
- Done ETR 자체는 status pill 만, outcome 없음

### 1.5 Weekly Note 연결
- `cc-weekly-notes` 가 `Record<ticketKey, WeeklyNote[]>` 으로 키 기반 직접 접근 가능
- `sourceWeek` 필드로 주차 식별 가능
- **그러나 reverse lookup UI 없음** — "이 ticket 이 N주차 weekly 에 나왔다" 표시 안 됨

### 1.6 Roadmap Initiative
- `linkedTickets: string[]` 으로 ticket 연결
- `objective`, `background` 필드 있음 — outcome 의미와 부분 겹침
- **Outcome / Impact 필드 자체 없음**

### 1.7 Transitions / Activity
- `lib/transitions.ts` 의 `lifecycle:completed` 정의됨
- **그러나 transition 시점 timestamp 별도 저장 안 됨**
- `ActivityVerb` 에 "completed" / "done_date" event 없음

### 1.8 Jira API
- 현재 FIELDS 배열에 **`resolutiondate` 미포함**
- Jira 가 자동으로 채우는 완료일을 fetch 안 함
- `expand=changelog` 미사용

---

## 2. Gap Analysis

| 카테고리 | 현재 | 부족 |
|---|---|---|
| 시간 정보 | startDate, ETA (planned) | ❌ **Completion Date (actual)** |
| 결과 | 없음 | ❌ **Outcome / Impact / 비즈니스 결과** |
| 회고 | 없음 | ❌ **Learnings / 회고 메모** |
| 컨텍스트 docs | 사전 문서 (PRD / 2-Pager) | 회고 / 출시 보고서 link (Linked Docs 활용) |
| 주차 컨텍스트 | sourceWeek 데이터 보유 | ❌ **reverse lookup UI** |
| Follow-up | 없음 | ❌ **출시 후 follow-up action** (outcome detail markdown 으로 통합) |
| 시각 강조 | emerald status chip | ❌ **완료 일자 chip** |
| 집계 | Q2 의 "완료 N건" | ❌ **"이번 주 출시 N건" Owner Dashboard 카드** (β-3) |
| Audit | 없음 | ❌ **status 가 Done 된 시점 timestamp** |

---

## 3. Done 상태에서 PM 이 실제로 봐야 하는 정보

(우선순위 ↓)

| Tier | 정보 | 출처 |
|---|---|---|
| **Primary** | Completion Date (실제 완료일) | Jira `resolutiondate` 자동 + 사용자 override |
| **Primary** | Outcome (성과 요약) | 수동 입력 — Hybrid (short + markdown detail) |
| **Primary** | Owner | 기존 `Ticket.assignee` 그대로 |
| **Secondary** | Impact (비즈니스 임팩트) | 수동 입력 — 짧은 텍스트 |
| **Secondary** | Weekly Summary link | `cc-weekly-notes[ticketKey]` 자동 매칭 + 사용자 변경 가능 |
| **Secondary** | Follow-up Actions | Outcome detail markdown 안에 inline list |
| **Tertiary** | Linked Docs (회고 보고서 포함) | 기존 PR-A/B/C 의 LinkedDoc 시스템 활용 (별도 retroDocUrl 만들지 않음) |
| **Tertiary** | Status transition timestamp | transitions snapshot (자동, derive) |
| **(보존만)** | Priority History (Plan + Exec) | KV 유지, UI 노출 안 함 (Phase α 의 Policy 1) |

---

## 4. Priority Lifecycle Policy v2 와의 관계

### 의존성 명시

```
[현재] Done Detail Panel
  ├ Status chip (emerald)
  ├ ETA / 메타
  └ Planning Priority + Execution Priority (PR #33)

[Phase β 완료 시점]
  ├ ✨ Completion Date
  ├ ✨ Outcome (Hybrid)
  ├ ✨ Impact
  ├ ✨ Weekly Summary link
  ├ Status chip / 메타
  └ Planning + Execution Priority (여전히 노출, β 단계에선 변경 없음)

[Phase α 적용 시점]
  ├ Completion Date / Outcome / Impact / Weekly (Primary)
  ├ Status chip / 메타 (Secondary)
  └ Priority — UI 숨김 (KV 보존, Option C)
```

→ **Phase β 가 Phase α 의 전제 조건.** Outcome / Impact 슬롯이 채워지기 전 priority 만 숨기면 정보 밀도 손실.

### Policy v2 매핑

| Policy v2 항목 | 본 Phase β 에서 대응 |
|---|---|
| Policy 1 — Priority Operational only | Phase α 에서 적용 (Phase β 의존) |
| Policy 2 — Execution dim Planning | Phase α 적용 |
| **Policy 3 — Done 신규 metadata slot** | **본 Phase β 의 핵심** |
| Policy 4 — 재평가 cadence | 코드 변경 없음 (운영 정책) |
| Policy 5 — Q2 priority 배지 제거 | Phase α 적용 |
| Policy 6 — Priority freshness | Phase γ (별도) |

---

## 5. 데이터 모델 결정

### KV 구조 — 신규 키 `cc-ticket-outcomes`

```ts
type TicketOutcome = {
  // 시간
  completedAt?: string;       // ISO date — 수동 또는 Jira fallback
  completedAtSource?: "jira" | "manual";

  // 결과 (Hybrid)
  outcomeSummary?: string;    // 짧은 1-2줄 요약 (필수 입력 시 시작점)
  outcomeDetail?: string;     // optional markdown (다중 줄 + bullet + link)

  // 임팩트
  impact?: string;            // 비즈니스 임팩트 (짧은 텍스트, 필요시 markdown)

  // 주차 link
  weeklyLink?: {
    sourceWeek: string;       // "2026-06-02" 등
    auto: boolean;            // true = cc-weekly-notes 자동 매칭, false = 사용자 override
  };

  // 메타
  updatedAt: string;
  updatedBy?: string;
};

// KV value shape
type TicketOutcomesMap = Record<ticketKey, TicketOutcome>;
```

### 결정 근거

| 결정 | 이유 |
|---|---|
| **신규 KV 키** (cc-ticket-outcomes) | 기존 `cc-ticket-notes` (free-form) / `cc-memos-v2` (narrative) 와 의미적 분리. 마이그레이션 0 |
| **Hybrid summary + detail** | 짧은 입력 진입 장벽 낮춤 + 상세 필요 시 markdown 으로 확장 |
| **completedAt source 추적** | Jira 자동 fetch 와 사용자 override 구분 (audit 가능) |
| **Follow-up 별도 필드 없음** | `outcomeDetail` markdown 안에 inline `- [ ] follow-up` 형태로 자유롭게 — overengineering 회피 |
| **`retroDocUrl` 없음** | 기존 LinkedDoc 시스템 (PR-A/B/C) 으로 통합 — 회고 보고서도 동일 surface 에 추가 |
| **`weeklyLink.auto` flag** | 자동 매칭 결과를 사용자가 변경한 경우 표시. 추후 자동 매칭 알고리즘 개선 시 영향 추적 가능 |

### Jira API 변경

`app/api/jira-tickets/route.ts` FIELDS 배열에 `resolutiondate` 추가:
```diff
  fields: [
    "summary", "status", "assignee", "reporter", "issuetype", "project",
-   "duedate", "priority", "parent", "issuelinks",
+   "duedate", "resolutiondate", "priority", "parent", "issuelinks",
    "customfield_10015", "customfield_10036", "customfield_10067",
    "customfield_10070", "customfield_10071", "customfield_14402",
  ]
```

→ `Ticket` type 에 `resolutionDate?: string` 추가.

→ `completedAt` 우선순위: 사용자 입력 (`completedAtSource: "manual"`) > Jira `resolutionDate` (자동 fallback).

---

## 6. UI 정책 결정

### Detail Panel Overview — status-aware Done 섹션 (인플레이스)

**별도 탭 (Outcome) 만들지 않음.** Overview 탭 안에서 status 가 Done 일 때만 노출되는 섹션 추가.

#### Layout (Done ticket 의 경우)

```
┌────────────────────────────────────────────────────┐
│ Header — Key / Summary / Status chip               │
├────────────────────────────────────────────────────┤
│ 🏁 출시 정보                                          │
│   완료일: 2026-05-28 (Jira)                          │
│   Outcome: [Summary 한 줄 표시]                       │
│   [▼ Detail 펼치기]                                   │
│   Impact: [Short text]                              │
│   주차: 2026-06-02 weekly note ↗                     │
│   [Outcome 수정] 버튼                                │
├────────────────────────────────────────────────────┤
│ 메타 정보 (status, ETA, assignee, project, ...)      │
│ Planning Priority + Execution Priority (PR #33 그대로) │
│ Linked Docs (회고 보고서도 여기에)                     │
│ Action Items (Done 시 빈 배열, 섹션 자체 숨김 권장)   │
└────────────────────────────────────────────────────┘
```

#### Outcome 미입력 시 UI

```
🏁 출시 정보
   완료일: 2026-05-28 (Jira)
   ⚠️ Outcome 미입력 — [+ Outcome 입력]
   주차: 2026-06-02 weekly note ↗
```

**Warn-only** (필수 아님). Done 처리 자체는 막지 않음.

#### Active ticket (Done 아닌 status)
- 신규 출시 정보 섹션 **자체 미노출**
- 기존 UI 그대로

### Outcome 입력 컴포넌트

- 짧은 input (summary, 1-2 줄)
- `[+ Detail 추가]` 토글 → markdown textarea 노출
- 저장: KV write (`cc-ticket-outcomes`)
- 변경 사항 자동 저장 (debounce 1초) + saved indicator

### Weekly Link 자동 매칭

```ts
// 자동 매칭 로직 (β-2 구현)
function suggestWeeklyLink(ticketKey: string, weeklyNotes: WeeklyNotesMap): string | null {
  const notes = weeklyNotes[ticketKey] ?? [];
  if (notes.length === 0) return null;
  // 가장 최근 (sourceWeek desc) note 의 sourceWeek 반환
  return notes.sort((a, b) => b.sourceWeek.localeCompare(a.sourceWeek))[0].sourceWeek;
}
```

- KV 의 `weeklyLink.auto: true` 가 default
- 사용자가 변경 시 `auto: false` 로 토글
- UI: `2026-06-02 weekly note ↗` 클릭 시 weekly note view 로 deep-link (해당 surface 존재 시)

---

## 7. MVP 범위

### 포함 (Phase β-1 + β-2)

✅ 신규 KV `cc-ticket-outcomes` + 마이그레이션 없음
✅ Jira `resolutiondate` fetch + `Ticket.resolutionDate` 추가
✅ `lib/outcomes.ts` 신규 helper (`getCompletedAt`, `getWeeklyLinkSuggestion`, etc.)
✅ Detail Panel Overview 의 status-aware Done 섹션
✅ Outcome 입력 UI (Hybrid: summary + optional markdown detail)
✅ Weekly link 자동 매칭 + 사용자 변경
✅ Outcome 미입력 시 warn-only badge
✅ Linked Docs 와 통합 (회고 보고서 추가 surface)
✅ 단위 테스트 (`tests/outcomes.test.ts`)

### 포함하지 않음 (별도 PR — β-3 또는 Phase γ)

❌ Owner Dashboard "Recently Shipped" 카드 → **별도 PR (β-3)**
❌ Owner Dashboard "Missing Outcome" 카운터 → **별도 PR (β-3)**
❌ Q2 / Roadmap initiative outcome rollup → **Phase γ**
❌ Weekly digest of Done tickets 페이지 → **Phase γ**
❌ 별도 Outcome 탭 (이번 정책에서는 보류)
❌ `retroDocUrl` 별도 필드 (Linked Docs 통합 사용)
❌ Follow-up structured field (outcome detail markdown 안에 포함)
❌ Outcome 필수 입력 강제 (warn-only 정책 유지)
❌ Priority UI 축소 (Phase α — 별도 PR)

---

## 8. Non-goals

이 정책 / Phase β 에서 **명시적으로 다루지 않는** 영역:

1. **자동 outcome 생성 (AI summary)** — 별도 영역, 추후 검토
2. **Jira custom field 신설** — Dashboard KV 로 충분
3. **출시 retrospective 워크플로 자동화** — 별도 시스템
4. **Outcome 검색 / 필터** — Phase γ 또는 별도
5. **Done ticket 의 audit log UI** — transitions snapshot 활용은 Phase γ
6. **Multi-author outcome 협업** — 단일 author 우선
7. **버전 history (outcome 변경 history)** — single latest value, audit 불필요
8. **알림 (outcome 미입력 시 Slack 등)** — 별도 통합 작업

---

## 9. 구현 Phase

### Phase β-1 — Backend / Data (작은 PR)

**변경 파일**
- `app/api/kv/route.ts` — `cc-ticket-outcomes` VALID_KEYS 추가
- `lib/outcomes.ts` (신규) — type 정의 + helper
  - `TicketOutcome` type
  - `getCompletedAt(outcome, ticket)` (manual > jira fallback)
  - `getOutcomeStatus(outcome)`: "filled" | "summary-only" | "empty"
  - `getWeeklyLinkSuggestion(ticketKey, weeklyNotes)`
- `app/api/jira-tickets/route.ts` — FIELDS 에 `resolutiondate` 추가
- `app/jira-tickets/TicketBoard.tsx` Ticket type — `resolutionDate?: string` 추가
- `tests/outcomes.test.ts` (신규) — helper unit test

**예상 LOC: +180 / -3**
**회귀 위험: 매우 낮음** — UI 변경 없음, 신규 데이터만

### Phase β-2 — Detail UI (중간 PR)

**변경 파일**
- `app/jira-tickets/TicketBoard.tsx`
  - outcomes state + KV load
  - setOutcome 핸들러 (debounced save)
  - Detail Panel Overview 안에 status-aware Done 섹션 신규 컴포넌트
  - Outcome 입력 컴포넌트 (`OutcomeEditor`)
  - Weekly link auto-suggest UI
  - 미입력 warn badge

**예상 LOC: +300 / -20**
**회귀 위험: 중간** — UI 신규 섹션 추가, 기존 Detail layout 영향 검토 필요

### Phase β-3 — Owner Dashboard 통합 (별도 PR)

**변경 파일**
- `app/owner-dashboard/OwnerDashboard.tsx`
  - Done filter 해제 (또는 별도 surface 추가)
  - "이번 주 출시" 카드 (sourceWeek 기준 aggregation)
  - "Missing Outcome" 카드 (Owner 본인 ticket 중 outcome 미입력 카운트)

**예상 LOC: +120 / -10**
**회귀 위험: 낮음** — Owner Dashboard 의 기존 액션 view 미변경

### 후속 (Phase γ)

- Q2 / Roadmap initiative outcome aggregation
- Weekly digest page (필요 시)
- Outcome 검색 / 필터
- Priority UI 축소 (Phase α 적용)

---

## 10. Open Questions — 보류 항목

본 정책에서 결정 보류된 사항 (β-2/β-3 구현 시 또는 운영 후 결정):

### Q-DEFER-1: Outcome 미입력 강제 강도
- 현재 결정: **warn-only**
- 보류: 일정 기간 운영 후 missing outcome 비율 보고 → 더 강한 nudging 필요한지 검토

### Q-DEFER-2: Multi-author 협업
- 현재 결정: single author (마지막 수정자)
- 보류: 향후 outcome 협업 needs 발생 시 별도 PR

### Q-DEFER-3: Outcome 검색 인덱싱
- 현재 결정: TicketBoard 의 search 가 summary/key/assignee 만 검색 (PR #28~32 유지)
- 보류: outcome 검색 needs 발생 시 search.ts 확장

### Q-DEFER-4: Weekly digest page 신규
- 현재 결정: 본 Phase β 미포함
- 보류: Owner Dashboard "Recently Shipped" 카드 사용 패턴 보고 결정

### Q-DEFER-5: Priority UI 축소 시기
- 현재 결정: Phase β 완료 후 Phase α 진행
- 보류: β-2 production 운영 N주 안정화 확인 후 Phase α PR

### Q-DEFER-6: Outcome 자동 sync (Jira → Dashboard)
- 현재 결정: 수동 입력만
- 보류: Jira 에 outcome custom field 도입 결정 시 양방향 sync 검토

### Q-DEFER-7: Q2 / Roadmap rollup 알고리즘
- 현재 결정: Phase γ 별도
- 보류: initiative 별 ticket outcome 집계 방식 (sum / latest / curated) — 운영 정책 결정 후

### Q-DEFER-8: completedAt 자동 fallback 시 transitions snapshot 활용
- 현재 결정: Jira `resolutiondate` 만 자동 fallback
- 보류: Jira `resolutiondate` 없는 경우 transitions snapshot 으로 derive 검토

---

## 11. Change History

| Date | Version | 변경 |
|---|---|---|
| 2026-06 | v1 | 정책 채택. 구현 phase β-1 / β-2 / β-3 분리. MVP 범위 확정 |
| | (TBD) | β-1 + β-2 운영 후 v2 검토 — 실제 사용 데이터 기반 조정 |

---

## Related Documents

- `docs/policies/priority-lifecycle-v2.md` — Priority Lifecycle Policy v2 (본 정책의 선행 결정)
- PR #33 — Priority Model Split 구현
- (예정) `app/api/kv/route.ts` — `cc-ticket-outcomes` 추가
- (예정) `lib/outcomes.ts` — outcome helper
- (예정) `tests/outcomes.test.ts` — 단위 테스트
