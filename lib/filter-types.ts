/**
 * lib/filter-types.ts
 *
 * Jira Filter 기반 데이터 소스 관리 타입 정의
 *
 * KV 구조:
 *   cc-jira-filters     → Record<filterId, JiraFilter>       필터 레지스트리
 *   cc-filter-tickets   → FilterTicketsStore                 필터별 티켓 키 목록
 *   cc-ticket-sources   → TicketSourcesStore                 티켓별 소속 필터 목록
 */

// ── 필터 등록 정보 ────────────────────────────────────────────────────────────

/** 내부 관리 ID (Math.random + Date.now 기반 8자리) */
export type FilterId = string;

/** Jira Filter 등록 레코드 */
export interface JiraFilter {
  /** 내부 관리 ID */
  id: FilterId;
  /** Jira Filter 숫자 ID (URL의 filter=12345) */
  jiraFilterId: string;
  /** Jira에서 가져온 필터 이름 */
  name: string;
  /** Jira에서 가져온 JQL 표현식 */
  jql: string;
  /** 사용자 지정 레이블 (없으면 Jira name 사용) */
  label?: string;
  /** 등록 시각 (ISO 8601) */
  createdAt: string;
  /** 마지막 sync 시각 (ISO 8601, sync 전이면 null) */
  lastSyncAt: string | null;
  /** 마지막 sync로 가져온 티켓 수 */
  lastSyncCount: number | null;
  /** 마지막 sync 오류 메시지 (성공이면 null) */
  lastSyncError: string | null;
}

/** cc-jira-filters KV 값 */
export type JiraFiltersStore = Record<FilterId, JiraFilter>;

// ── 필터별 티켓 목록 ──────────────────────────────────────────────────────────

/** cc-filter-tickets KV 값: filterId → Jira 티켓 키 배열 */
export type FilterTicketsStore = Record<FilterId, string[]>;

// ── 티켓별 소속 필터 추적 ─────────────────────────────────────────────────────

/** 티켓이 특정 필터에 속하게 된 이력 엔트리 */
export interface TicketSourceEntry {
  /** 소속 필터 내부 ID */
  filterId: FilterId;
  /** 소속 필터 레이블 (스냅샷) */
  filterLabel: string;
  /** 최초 발견 시각 (ISO 8601) */
  addedAt: string;
}

/** cc-ticket-sources KV 값: Jira 티켓 키 → 소속 필터 엔트리 배열 */
export type TicketSourcesStore = Record<string, TicketSourceEntry[]>;

// ── Sync 결과 ─────────────────────────────────────────────────────────────────

export interface FilterSyncResult {
  filterId: FilterId;
  /** sync 완료 여부 */
  ok: boolean;
  /** sync된 티켓 키 목록 */
  ticketKeys: string[];
  /** TICKET_KEYS와 중복되는 티켓 수 (참고용) */
  overlapCount: number;
  /** 오류 메시지 (ok=false일 때) */
  error?: string;
}

// ── API 요청/응답 ─────────────────────────────────────────────────────────────

/** POST /api/jira-filters 요청 body */
export interface AddFilterRequest {
  /** Jira Filter URL 또는 숫자 ID */
  filterIdOrUrl: string;
  /** 사용자 지정 레이블 (선택) */
  label?: string;
}

/** GET /api/jira-filters?preview=1 or preview mode response */
export interface FilterPreview {
  jiraFilterId: string;
  name: string;
  jql: string;
  /** 예상 티켓 수 (Jira /search total) */
  estimatedCount: number;
}
