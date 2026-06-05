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

export const DOC_TYPE_META: Record<DocType, { icon: string; label: string; color: string }> = {
  PRD:         { icon: "📄", label: "PRD",          color: "#60a5fa" },
  Wiki:        { icon: "🗂",  label: "Wiki",         color: "#a78bfa" },
  "1Pager":    { icon: "🗒",  label: "1-Pager",      color: "#34d399" },
  "2Pager":    { icon: "📑", label: "2-Pager",      color: "#34d399" },
  GoogleDoc:   { icon: "📝", label: "Google Docs",  color: "#60a5fa" },
  GoogleSheet: { icon: "📊", label: "Google Sheet", color: "#10b981" },
  Other:       { icon: "🔗", label: "Link",         color: "#94a3b8" },
};
