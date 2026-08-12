export type JiraTicketLink = {
  key: string;
};

export type JiraLinkedTicketCandidate = {
  key: string;
  jiraLinks?: JiraTicketLink[];
};

export interface LinkedTicketRegistryEntry {
  key: string;
  linkedFrom: string[];
  addedAt: string;
  lastSeenAt: string;
  reason: "etr-link";
}

export type LinkedTicketRegistry = Record<string, LinkedTicketRegistryEntry>;

export type LinkedTicketDiscovery = {
  keys: string[];
  linkedFromByKey: Record<string, string[]>;
};

const JIRA_KEY_RE = /^[A-Z][A-Z0-9_]*-\d+$/;

function isEtrKey(key: string): boolean {
  return key.startsWith("ETR-");
}

/** ETR↔실행 티켓 관계만 한 단계 확장한다. */
export function discoverEtrLinkedTicketKeys(
  tickets: JiraLinkedTicketCandidate[],
  managedKeys: Set<string>,
  limit = 100,
): LinkedTicketDiscovery {
  const keys: string[] = [];
  const seen = new Set<string>();
  const linkedFromByKey: Record<string, string[]> = {};

  for (const ticket of tickets) {
    if (!JIRA_KEY_RE.test(ticket.key)) continue;
    for (const link of ticket.jiraLinks ?? []) {
      const linkedKey = link.key?.trim().toUpperCase();
      if (!JIRA_KEY_RE.test(linkedKey) || linkedKey === ticket.key) continue;
      // ETR-ETR, 일반-일반 링크는 대시보드 관리 범위를 자동 확장하지 않는다.
      if (isEtrKey(ticket.key) === isEtrKey(linkedKey)) continue;

      const sources = linkedFromByKey[linkedKey] ?? [];
      if (!sources.includes(ticket.key)) linkedFromByKey[linkedKey] = [...sources, ticket.key];
      if (managedKeys.has(linkedKey) || seen.has(linkedKey)) continue;
      seen.add(linkedKey);
      keys.push(linkedKey);
      if (keys.length >= limit) return { keys, linkedFromByKey };
    }
  }
  return { keys, linkedFromByKey };
}

export function mergeLinkedTicketRegistry(
  current: LinkedTicketRegistry,
  linkedFromByKey: Record<string, string[]>,
  now: string,
): LinkedTicketRegistry {
  const next = { ...current };
  for (const [key, linkedFrom] of Object.entries(linkedFromByKey)) {
    const existing = current[key];
    next[key] = {
      key,
      linkedFrom: [...new Set([...(existing?.linkedFrom ?? []), ...linkedFrom])],
      addedAt: existing?.addedAt ?? now,
      lastSeenAt: now,
      reason: "etr-link",
    };
  }
  return next;
}

export function linkedTicketSourceLabel(entry: LinkedTicketRegistryEntry | undefined): string | null {
  if (!entry || entry.linkedFrom.length === 0) return null;
  const first = entry.linkedFrom[0];
  return entry.linkedFrom.length === 1
    ? `${first} 연결`
    : `${first} 외 ${entry.linkedFrom.length - 1}개 연결`;
}
