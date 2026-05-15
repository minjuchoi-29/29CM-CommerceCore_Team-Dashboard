export type ActivityVerb =
  | "eta_changed"
  | "status_changed"
  | "hidden"
  | "unhidden"
  | "roadmap_linked"
  | "roadmap_unlinked"
  | "schedule_updated"
  | "planning_updated"
  | "memo_updated"
  | "note_added";

export type ActivityEntry = {
  id: string;            // uuid or timestamp-based
  verb: ActivityVerb;
  ticketKey?: string;
  roadmapId?: string;
  actor: string;         // email or display name
  at: string;            // ISO timestamp
  meta?: Record<string, unknown>; // e.g. { from: "2026-05-01", to: "2026-06-01" }
};

/** Append a new activity entry to a list (in-memory, call before persisting) */
export function appendActivity(
  existing: ActivityEntry[],
  entry: Omit<ActivityEntry, "id">
): ActivityEntry[] {
  const newEntry: ActivityEntry = {
    ...entry,
    id: `act-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
  };
  // keep last 200 entries per context
  return [newEntry, ...existing].slice(0, 200);
}

export function getTicketActivities(
  activities: ActivityEntry[],
  ticketKey: string
): ActivityEntry[] {
  return activities.filter((a) => a.ticketKey === ticketKey);
}

export function getRoadmapActivities(
  activities: ActivityEntry[],
  roadmapId: string
): ActivityEntry[] {
  return activities.filter((a) => a.roadmapId === roadmapId);
}

/** KV key for storing activities */
export const ACTIVITY_KV_KEY = "cc-activity-log";
