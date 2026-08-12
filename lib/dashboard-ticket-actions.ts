import { getTicketViewLifecycle } from "./weekly-targets";

export const MANAGED_TICKET_KEY_PATTERN = /^[A-Z][A-Z0-9]*-\d+$/;

export type ManagedTicketArea = "planning" | "active" | "done" | "etr";

export type ManagedTicketSummary = {
  key: string;
  project?: string;
  status: string;
  statusCategory?: string;
  resolutionDate?: string;
  updatedAt?: string;
};

export type ManagedTicketDestination = {
  area: ManagedTicketArea;
  label: string;
  href: string;
};

export function parseManagedTicketKeys(input: string): string[] {
  return [...new Set(
    input
      .split(/[\s,]+/)
      .map(value => value.trim().toUpperCase())
      .filter(Boolean),
  )];
}

export function invalidManagedTicketKeys(keys: string[]): string[] {
  return keys.filter(key => !MANAGED_TICKET_KEY_PATTERN.test(key));
}

export function getManagedTicketArea(ticket: ManagedTicketSummary): ManagedTicketArea {
  if (ticket.project === "ETR" || ticket.key.startsWith("ETR-")) return "etr";

  const lifecycle = getTicketViewLifecycle(ticket);
  if (lifecycle === "active") return "active";
  if (lifecycle === "planning") return "planning";
  return "done";
}

export function getManagedTicketAreaLabel(area: ManagedTicketArea): string {
  if (area === "etr") return "ETR 검토";
  if (area === "active") return "진행 중";
  if (area === "planning") return "플래닝 대기·검토";
  return "완료";
}

export function getManagedTicketDestination(ticket: ManagedTicketSummary): ManagedTicketDestination {
  const area = getManagedTicketArea(ticket);
  const key = encodeURIComponent(ticket.key);
  if (area === "etr") {
    return { area, label: getManagedTicketAreaLabel(area), href: `/etr-review?key=${key}` };
  }

  const label = getManagedTicketAreaLabel(area);
  const lifecycle = getTicketViewLifecycle(ticket);
  // 대시보드의 완료 탭은 완료 후 추적 기간 안의 티켓만 보여준다.
  // 오래된 완료·중단 티켓은 분류 의미는 "완료"로 유지하되, 추가 직후 보이지 않는 일을 막기 위해 전체 탭으로 연다.
  const destinationTab = area === "done" && lifecycle !== "recently_completed" ? "전체" : label;
  return {
    area,
    label,
    href: `/?ticket=${key}&ptab=${encodeURIComponent(destinationTab)}`,
  };
}

export function filterTicketsByManagedArea<T extends ManagedTicketSummary>(
  tickets: T[],
  area: ManagedTicketArea | "all",
): T[] {
  if (area === "all") return tickets;
  return tickets.filter(ticket => getManagedTicketArea(ticket) === area);
}
