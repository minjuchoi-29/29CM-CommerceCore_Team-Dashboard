# Priority Lifecycle Policy v2

**Status**: Accepted (구현 보류)
**Date**: 2026-06
**Related PRs**: #33 (Priority Model Split — planning + execution)
**Implementation Plan**: Phase α (Done IA 정의 후 적용)

---

## TL;DR

Priority 는 **operational metadata** 이며 **시간이 지나면 정보 가치가 급격히 감소**한다.
Done 상태에서는 priority 보다 **outcome / completion date / impact** 같은 historical metadata 가 primary information 이어야 한다.

본 정책은 lifecycle stage 별 information hierarchy 를 정의하고,
Done state 의 신규 metadata slot 도입과 함께 priority UI 의 단계별 축소 정책을 명시한다.

---

## 1. AS-IS — 현재 상태 (PR #33 시점)

### 구현
- `planningPriority` + `executionPriority` 분리
- Detail Panel: 두 priority 모두 **항상** 노출
- Row UI: planningTab 기반 1개 컨텍스트 표시
- 완료 ticket 도 동일 weight 로 두 priority UI 노출
- KV 영구 저장 (`cc-planning-priorities`, `cc-execution-priorities`)

### 암묵적 가정
> Priority 는 ticket lifecycle 전반에 걸쳐 의미를 갖는다.

→ 본 정책에서 이 가정 자체가 잘못되었음을 확인.

---

## 2. 문제 정의

### 2.1 Priority 는 절대값이 아니다 — relative ordering signal
- **2026-03 의 P0** = 그 시점 backlog 의 상대 1순위
- **2026-08 의 P0** = 그 시점 backlog 의 상대 1순위
- 두 P0 의 절대적 중요도는 **비교 불가능**. baseline backlog 가 다르기 때문.
- 즉 priority 값은 **그 시점 의사결정 context 안에서만 의미를 가짐.**

### 2.2 Stage transition 시 정보 가치 sharp drop
- Backlog → 기획 시작: planning priority 의 ordering 기능 약화 (이미 "당겨졌음")
- 기획 → 실행 시작: planning priority 의 의미 거의 종료
- 실행 → 완료: execution priority 도 의미 종료
- 두 priority 모두 **operational metadata** — 의사결정 시점에만 유효

### 2.3 Done 상태의 UI 가치 ≈ 0
- "왜 P0 이었나" 는 done 시점에 무의미 (이미 끝남)
- 실제 needs: outcome, completion date, learning, impact
- Priority 는 retrospective 의사결정에 영향 없음

### 2.4 UI hierarchy mismatch
- Dashboard 의 detail panel 이 priority 를 outcome 과 동등 weight 로 노출
- → 사용자 시각 부하 + "어디를 봐야 하나" 모호함

---

## 3. Priority 의 수명 주기 — 5단계 모델

```
[T0] 생성 (Backlog 진입)
  ├ Planning Priority 생성 — 즉시 의미 충만
  ├ 매 planning cycle 마다 재평가 (변경 빈번)
  └ Execution Priority 미설정 (fallback to planning)

[T1] Active Planning (기획/디자인 중)
  ├ Planning Priority 의미 peak
  ├ Execution Priority 사전 설정 가능 (선제적)
  └ 가치 곡선: ━━━━━━━ (planning 최고)

[T2] Execution 시작 (개발/QA)
  ├ Planning Priority 의미 sharp drop ↓↓ (already triggered)
  ├ Execution Priority 의미 peak
  └ 가치 곡선: planning ──┐
                         └────── execution

[T3] 완료 직후 (week 1-4)
  ├ Execution Priority 의미 종료
  ├ Planning Priority 의미 이미 T1 부터 약화 → 0 수렴
  └ Outcome / learnings 의미 peak

[T4] 시간 경과 (weeks → months)
  ├ Priority 절대값 비교 불가 (baseline 사라짐)
  ├ Priority 의 정보 가치 = 0
  └ Outcome / impact / weekly summary 의미 지속
```

**핵심**: priority 는 **active 의사결정 슬라이딩 윈도우** 안에서만 의미. 윈도우 밖에선 trivia.

---

## 4. Done 상태 Priority 가치 분석

### 4.1 이론적 활용처

| 활용 | 평가 |
|---|---|
| Retrospective ("P0 이었는데 왜 늦었나") | 약함 — 이미 종료된 의사결정에 대한 사후 평가는 추정에 가까움 |
| Audit ("이 sprint 의 P1 개수") | 매우 약함 — Audit dashboard 가 별도 surface 가 적절 |
| Process metric ("P0 평균 cycle time") | 약함 — log/analytics 영역, ticket UI 노출 불필요 |
| 정렬 (완료 탭) | 거의 안 함 — 완료 후엔 보통 완료일 기준 정렬 |

### 4.2 PM 이 실제로 done 에서 보는 것

1. **Completion date** — 언제 끝났는지
2. **Owner** — 누가 담당했는지
3. **Outcome** — 어떤 결과 / impact
4. **Linked docs** — 관련 PRD / 보고서
5. **Weekly summary** — 어느 weekly note 에서 다뤘는지
6. **Next steps** — follow-up action

→ Priority 는 이 목록 **어디에도 없음**.

### 4.3 결론
**완료 ticket 에서 priority 는 secondary at best, noise at worst.**

---

## 5. Priority 분류 — Operational vs Historical

| 카테고리 | 정의 | 예시 |
|---|---|---|
| **Operational** | 현재 의사결정에 영향 | Priority, ETA, Status, Owner |
| **Historical** | 이미 결정된 사실 / 결과 | Completion date, Outcome, Impact, Learnings |

**Priority 는 100% Operational.** Done 상태에서는 **Historical 도 못 됨** — "당시 이걸 우선했었다" 는 retrospective audit 의 trivia 수준 정보일 뿐.

Dashboard 가 priority 를 **historical metadata 자리에 두면 information architecture 가 무너짐.**

---

## 6. Priority History 옵션 비교 (4-way)

### A. Done 에서도 priority full visibility 유지

| 장 | 단 |
|---|---|
| Continuity (다른 stage 와 동일 UI) | Noise — 의미 없는 숫자 노출 |
| 학습 곡선 0 | Outcome/impact 가 부각되지 않음 |
| | T4 시점엔 정보 가치 0 인 값을 prominently 표시 |

### B. Collapsed history (1줄 요약 박스)

| 장 | 단 |
|---|---|
| 적당한 절충 | 여전히 화면 공간 차지 |
| Data loss 없음 (UI 만 축소) | 의미 없는 정보를 살짝 숨긴 것 |

### C. 완전 숨김 (Done 에서 priority UI 없음, KV 데이터는 보존) ★

| 장 | 단 |
|---|---|
| Clean focus on outcome | Edge case — sprint 중 완료 ticket priority 보고 싶을 때 (드물지만 있음) |
| Outcome / completion 강조 가능 | "사라진 것" 학습 필요 (1회) |
| Information architecture 명확 | |

### D. Audit-only (KV 보존, UI footer 한 줄 또는 expandable)

| 장 | 단 |
|---|---|
| C 의 장점 유지 | 약간의 복잡도 (expandable state) |
| Edge case 의 expand 옵션 제공 | UI 가 다양 |
| Audit 가능성 보존 | |

**권장: C (완전 숨김) — 명확성 우선.**

Edge case (sprint 회고 시 완료 ticket priority 확인) 는 KV API 로 직접 접근 가능. UI 에 default 노출 불필요.

대안 **D** (footer 한 줄) 도 합리. **A/B** 는 information architecture 원칙에 부합 안 함.

---

## 7. Dashboard Information Architecture 제안

### 7.1 Stage 별 정보 hierarchy

#### Planning Stage (Backlog, 기획중, 디자인중, 준비중)
```
Primary  ━━━━━ Planning Priority
              Status / Owner
              ETA (planned)
Secondary ──── Execution Priority (사전 설정, dim/muted)
              Source (ETR/ELT/자체발의)
              Linked Docs (PRD, 2-Pager)
Tertiary  · · · 요청 우선순위 (Jira)
              Story Points
              Health Check
```

#### Execution Stage (개발중, QA중)
```
Primary  ━━━━━ Execution Priority
              Status / Owner
              ETA + Health (지연 여부)
Secondary ──── Planning Priority (이력, dim/muted, read-only feel)
              Action Items (Phase A action strip)
              Linked Work / Linked Docs / Jira Web Links
Tertiary  · · · 요청 우선순위 (Jira)
              Source 카드
```

#### Done Stage (완료, 배포완료, 론치완료, 철회, 종료)
```
Primary  ━━━━━ Completion Date (Jira completion 또는 수동)
              Outcome / Result (수동 입력, 신규 필드)
              Owner
Secondary ──── Weekly Summary link (Phase 2 weekly note 통합 시)
              Linked Docs (회고 PRD)
              Status (배포완료 vs 철회 vs 종료)
Tertiary  · · · Priority History — UI 없음 (KV 보존)
              요청 우선순위 (Jira)
```

### 7.2 Cross-cutting 원칙

1. **Primary** = 사용자 의사결정의 첫 5초 시야
2. **Secondary** = 의사결정 보강 정보 (필요 시 시선 이동)
3. **Tertiary** = audit / reference (보통 보지 않음)

Done 의 Primary 가 priority 가 아닌 것이 핵심.

---

## 8. 정책 결정 (Policy v2)

### Policy 1 — Priority 는 Operational Metadata 로만 취급
- KV 보존, UI 노출은 stage 별 분기
- Done 상태 → priority UI 완전 숨김 (Option C)

### Policy 2 — Execution Stage 에서 Planning 은 dim/muted
- 두 priority 모두 노출하되 visual hierarchy 로 컨텍스트 명확
- Planning Stage 에서도 동일 패턴 — Execution 이 dim

### Policy 3 — Done Stage 에 신규 metadata slot 도입 (별도 PR)
신규 필드 (Phase β):
- `outcome` — 사용자 입력 (텍스트 또는 markdown)
- `completionDate` — Jira API + 수동 override
- `weeklyNoteLink` — 관련 weekly summary 자동 link
- 기존 owner / linked docs 강화

### Policy 4 — Priority 재평가 cadence 명문화 (운영 정책)
- Weekly sync 에서 planning priority 재평가 기대
- Stage transition (planning → execution) 시 execution priority 명시 설정 권장
- 이건 process 차원, 코드 영향 없음

### Policy 5 — Q2 Initiative / Roadmap surface 의 priority 표시 검토
- 완료 ticket 의 priority 배지 제거 (information architecture 일관성)
- 단, sprint 중 active ticket 은 표시 유지

### Policy 6 — Priority freshness indicator (장기, Phase γ)
- 마지막 priority 변경 timestamp 추적
- N주 이상 변경 없는 priority 는 시각적 dim ("stale")
- weekly sync 에서 review 유도
- 운영 흐름 충분히 검토 후 진행

---

## 9. 단계별 실행 계획

### 의존성
**Phase α (priority UI 축소) 는 Phase β (Done IA) 가 선행되어야 한다.**

이유: Done 상태에서 priority 를 먼저 숨기면, 그 자리를 채울 outcome/impact 가 없어 정보 밀도가 오히려 낮아짐. 정보 가치 손실은 사용자 경험 후퇴.

### 실행 순서

| 순서 | Phase | 내용 | 상태 |
|---|---|---|---|
| 1 | β-pre | JIRA_DRY_RUN 운영 전환 (Phase B-2 검증) | 진행 예정 |
| 2 | β | Done Ticket Information Architecture 설계 + 구현 | β-pre 검증 후 |
| 3 | α | Priority Lifecycle UX 적용 (본 정책 기반) | β 완료 후 |
| 4 | γ | Priority freshness indicator (장기) | α 안정화 후 검토 |

### Phase α (Priority UI 적용) — 구현 시 작업 범위

- TicketBoard Detail Panel 의 priority section 을 status 기반 분기
- 완료 ticket: priority section UI 숨김 (KV 데이터 보존)
- Execution Stage: Planning Priority dim/muted
- Q2 Initiative: 완료 ticket 의 P 배지 제거
- 예상 LOC: ~+60 / -15 (Done IA 작업과 묶일 가능성 있음)
- 회귀 위험: 낮음 (UI 만, 데이터 무손실)

### Phase β (Done IA) — 별도 설계 문서 예정

- `docs/policies/done-ticket-ia.md` (예정)
- Outcome / Completion Date / Weekly link 필드 정의
- KV 키 신규 또는 기존 `cc-ticket-notes` 확장 검토
- UI 신규 섹션
- Q2 Initiative / Owner Dashboard 통합 고려

---

## 10. 권장 의사결정 요약

| 항목 | 권장 | 근거 |
|---|---|---|
| **완료 ticket priority** | **숨김 (Option C)** | Information architecture 원칙 |
| **Execution stage Planning** | **dim/muted (Option B)** | 컨텍스트 명확 + 유연성 보존 |
| **신규 done metadata** | **별도 PR (Phase β)** | scope 분리, 의사결정 추가 필요 |
| **Q2 priority 배지** | **완료 ticket 만 제거** | 일관성 |
| **Priority freshness** | **Phase γ — 별도 검토** | 운영 흐름 검증 필요 |

---

## 11. Open Questions (Phase β / γ 설계 시 결정)

1. Outcome 입력 형식 — plain text / markdown / structured (impact metric, learning, link)?
2. Completion date 의 source 우선순위 — Jira completion field / 수동 / 둘 다?
3. Weekly summary 와 ticket 의 자동 link 알고리즘
4. Done 상태에서 priority 데이터 API 접근 경로 (audit 용)
5. Priority freshness 의 staleness 임계값 (N 주?)
6. Stage transition 자동화 — execution 시작 시 planning priority 자동 archive?

---

## 12. Change History

| Date | Version | 변경 |
|---|---|---|
| 2026-06 | v2 | 정책 채택, 구현 보류 (Done IA 선행 필요) |
| | (TBD) | Phase β 적용 후 v3 검토 — 실제 운영 데이터 기반 조정 |

---

## Related Documents

- PR #33 — Priority Model Split (planning + execution 분리 구현)
- 향후: `docs/policies/done-ticket-ia.md` — Done Ticket Information Architecture (작성 예정)
