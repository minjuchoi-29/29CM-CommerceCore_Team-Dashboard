// Phase 1: ETR ↔ TM 역참조 & 문서 통합 helpers.
// 저장 변경 없음 — cc-etr 구조 그대로 사용.

export type LinkedWork = {
  tmKey: string;
  summary: string;
  status: string;     // 보조 표시용 Execution Status — Origin(ETR) 상태를 덮어쓰지 않음
  level: string;      // Ticket.type: "Initiative" | "Epic" | "Dev" 등
  assignee?: string;
  confidence: "high";
};

export type DocType =
  | "PRD"
  | "Wiki"
  | "1Pager"
  | "2Pager"
  | "GoogleDoc"
  | "GoogleSheet"
  | "Other";

export type LinkedDoc = {
  url: string;
  title: string;
  type: DocType;
  source: { kind: "self" } | { kind: "tm"; tmKey: string };
};

type EtrInfoLike = {
  source?: "자체발의" | "ELT" | "ETR";
  etrTickets?: { key: string }[];
  wikiLinks?: { url: string; title: string }[];
};

type TicketLike = {
  key: string;
  summary: string;
  status: string;
  type: string;
  assignee?: string;
  twoPagerUrl?: string;
  prdUrl?: string;
};

export function buildEtrReverseMap(
  etrMap: Record<string, EtrInfoLike>,
  ticketByKey: Map<string, TicketLike>,
): Map<string, LinkedWork[]> {
  const result = new Map<string, LinkedWork[]>();
  for (const [tmKey, info] of Object.entries(etrMap)) {
    if (!info || info.source !== "ETR") continue;
    const tm = ticketByKey.get(tmKey);
    if (!tm) continue;
    for (const et of info.etrTickets ?? []) {
      const etKey = et?.key?.trim();
      if (!etKey) continue;
      const list = result.get(etKey) ?? [];
      if (list.some(w => w.tmKey === tmKey)) continue;
      list.push({
        tmKey,
        summary: tm.summary,
        status: tm.status,
        level: tm.type,
        assignee: tm.assignee || undefined,
        confidence: "high",
      });
      result.set(etKey, list);
    }
  }
  return result;
}

export function classifyDoc(url: string, title?: string): DocType {
  const u = (url ?? "").toLowerCase();
  const t = (title ?? "").toLowerCase();
  if (u.includes("docs.google.com/spreadsheets")) return "GoogleSheet";
  if (u.includes("docs.google.com/document"))    return "GoogleDoc";
  if (t.includes("2-pager") || t.includes("2pager")) return "2Pager";
  if (t.includes("1-pager") || t.includes("1pager")) return "1Pager";
  if (t.includes("prd") || u.includes("/prd"))   return "PRD";
  if (u.includes("wiki.") || u.includes("/wiki/") || u.includes("confluence")) return "Wiki";
  return "Other";
}

function fallbackTitle(url: string): string {
  try {
    const u = new URL(url);
    const last = u.pathname.split("/").filter(Boolean).pop();
    return decodeURIComponent(last || u.hostname);
  } catch {
    return url;
  }
}

function normalizeUrl(url: string): string {
  return url.trim().replace(/\/+$/, "").toLowerCase();
}

export function dedupeDocsByUrl(docs: LinkedDoc[]): LinkedDoc[] {
  const seen = new Map<string, LinkedDoc>();
  for (const d of docs) {
    if (!d.url) continue;
    const key = normalizeUrl(d.url);
    const existing = seen.get(key);
    if (!existing) {
      seen.set(key, d);
      continue;
    }
    // self 우선 — ETR 자체에 등록된 문서가 TM 경유 중복보다 신뢰도 높음
    if (existing.source.kind !== "self" && d.source.kind === "self") {
      seen.set(key, d);
    }
  }
  return Array.from(seen.values());
}

export function collectLinkedDocs(
  etrKey: string,
  reverseMap: Map<string, LinkedWork[]>,
  etrMap: Record<string, EtrInfoLike>,
  ticketByKey: Map<string, TicketLike>,
): LinkedDoc[] {
  const docs: LinkedDoc[] = [];

  const pushDoc = (
    url: string | undefined,
    title: string,
    source: LinkedDoc["source"],
  ) => {
    if (!url) return;
    docs.push({
      url,
      title: title || fallbackTitle(url),
      type: classifyDoc(url, title),
      source,
    });
  };

  // 1) ETR self docs (ticket fields + wikiLinks on the ETR key itself)
  const etrTicket = ticketByKey.get(etrKey);
  pushDoc(etrTicket?.twoPagerUrl, "2-Pager", { kind: "self" });
  pushDoc(etrTicket?.prdUrl, "PRD", { kind: "self" });
  for (const w of etrMap[etrKey]?.wikiLinks ?? []) {
    pushDoc(w?.url, w?.title ?? "", { kind: "self" });
  }

  // 2) Linked execution (TM) docs
  for (const lw of reverseMap.get(etrKey) ?? []) {
    const tm = ticketByKey.get(lw.tmKey);
    pushDoc(tm?.twoPagerUrl, "2-Pager", { kind: "tm", tmKey: lw.tmKey });
    pushDoc(tm?.prdUrl, "PRD", { kind: "tm", tmKey: lw.tmKey });
    for (const w of etrMap[lw.tmKey]?.wikiLinks ?? []) {
      pushDoc(w?.url, w?.title ?? "", { kind: "tm", tmKey: lw.tmKey });
    }
  }

  return dedupeDocsByUrl(docs);
}

// ─── Phase 2: ETR 검토 페이지용 derive helpers ─────────────────────────────

export type EtrSource = "filter" | "manual" | "filter+manual";

export type SourceFlags = {
  isManual?: boolean;
  sourceFilters?: string[];
};

/**
 * Ticket 의 source 분류.
 * - isManual && sourceFilters.length > 0 → "filter+manual"
 * - isManual                             → "manual"
 * - sourceFilters.length > 0             → "filter"
 * - 둘 다 없으면 "manual" 로 안전 처리 (이론상 발생 안 함)
 */
export function deriveSource(t: SourceFlags): EtrSource {
  const fromFilter = (t.sourceFilters?.length ?? 0) > 0;
  if (t.isManual && fromFilter) return "filter+manual";
  if (t.isManual) return "manual";
  if (fromFilter) return "filter";
  return "manual";
}

export const SOURCE_LABEL: Record<EtrSource, string> = {
  filter:          "Filter",
  manual:          "Manual",
  "filter+manual": "Filter + Manual",
};

/**
 * Linked Work 요약 — 연결 수 + 대표 status.
 * 대표 status 결정 우선순위(가장 진행된 단계):
 *   완료/론치완료/배포완료 > QA중 > 개발중 > 디자인중 > 기획중 > 그 외 첫 번째 status
 * 미연결이면 count=0, representativeStatus=null.
 */
export function deriveLinkedWorkSummary(
  linkedWork: LinkedWork[],
): { count: number; representativeStatus: string | null } {
  if (linkedWork.length === 0) return { count: 0, representativeStatus: null };
  const STAGE_PRIORITY = [
    "론치완료", "완료", "배포완료", "개발완료",
    "QA중",
    "개발중", "In Progress",
    "디자인완료", "디자인중",
    "기획완료", "기획중",
    "준비중",
  ];
  for (const s of STAGE_PRIORITY) {
    if (linkedWork.some(w => w.status === s)) {
      return { count: linkedWork.length, representativeStatus: s };
    }
  }
  return { count: linkedWork.length, representativeStatus: linkedWork[0].status || null };
}

/**
 * Linked Docs 존재 여부 — collectLinkedDocs 호출 비용 없이 빠르게 판단.
 */
export function hasDocs(
  etrKey: string,
  reverseMap: Map<string, LinkedWork[]>,
  etrMap: Record<string, EtrInfoLike>,
  ticketByKey: Map<string, TicketLike>,
): boolean {
  const self = ticketByKey.get(etrKey);
  if (self?.twoPagerUrl || self?.prdUrl) return true;
  if ((etrMap[etrKey]?.wikiLinks?.length ?? 0) > 0) return true;
  for (const lw of reverseMap.get(etrKey) ?? []) {
    const tm = ticketByKey.get(lw.tmKey);
    if (tm?.twoPagerUrl || tm?.prdUrl) return true;
    if ((etrMap[lw.tmKey]?.wikiLinks?.length ?? 0) > 0) return true;
  }
  return false;
}

// ─── ETR 검토 필터 정의 ────────────────────────────────────────────────────

export type EtrReviewFilterKey =
  | "needsAction"      // 처리 필요: 실행 티켓 없음 AND (검토대기 OR 검토중)
  | "all"              // 전체 요청
  | "noLinkedWork"     // 실행 티켓 없음 (linkedWorkCount === 0)
  | "hasLinkedWork"    // 실행 연결됨 (linkedWorkCount > 0)
  | "reviewed"         // 검토 완료 — 검토완료-우선착수, 검토완료-백로그 등
  | "closed";          // 종결/제외 — 완료, 반려, 중단, 미진행

export const ETR_REVIEW_FILTER_LABEL: Record<EtrReviewFilterKey, string> = {
  needsAction:    "처리 필요",
  all:            "전체 요청",
  noLinkedWork:   "실행 티켓 없음",
  hasLinkedWork:  "실행 연결됨",
  reviewed:       "검토 완료",
  closed:         "종결/제외",
};

const STATUS_REVIEW_PENDING = new Set<string>([
  "검토대기", "Tech 검토 대기 중", "Tech 검토대기", "검토 대기",
  "검토중", "Tech 검토중", "Tech 검토 중", "검토 중",
  "Open", "To Do",
]);

const STATUS_REVIEWED = new Set<string>([
  "검토완료-우선착수", "검토완료-백로그",
  "검토완료", "검토 완료",
  "백로그", "Backlog",
]);

const STATUS_CLOSED = new Set<string>([
  "완료", "Done", "Closed",
  "반려", "철회/반려/취소",
  "중단", "미진행",
  "Won't Do", "Cancelled",
]);

export function isReviewPending(status: string): boolean {
  return STATUS_REVIEW_PENDING.has(status);
}
export function isReviewed(status: string): boolean {
  return STATUS_REVIEWED.has(status);
}
export function isClosed(status: string): boolean {
  return STATUS_CLOSED.has(status);
}

export const DOC_TYPE_META: Record<DocType, { icon: string; label: string; color: string }> = {
  PRD:         { icon: "📄", label: "PRD",          color: "#60a5fa" },
  Wiki:        { icon: "🗂",  label: "Wiki",         color: "#a78bfa" },
  "1Pager":    { icon: "🗒",  label: "1-Pager",      color: "#34d399" },
  "2Pager":    { icon: "📑", label: "2-Pager",      color: "#34d399" },
  GoogleDoc:   { icon: "📝", label: "Google Docs",  color: "#60a5fa" },
  GoogleSheet: { icon: "📊", label: "Google Sheet", color: "#10b981" },
  Other:       { icon: "🔗", label: "Link",         color: "#94a3b8" },
};
