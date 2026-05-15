import { HealthStatus } from "@/lib/types";

export type HealthInput = {
  reviewNeeded: number;
  overdue: number;      // ETA-overdue tickets
  unscheduled: number;  // tickets with no schedule at all
  blocked: number;      // schedules with 확인필요 status
  total: number;        // total visible tickets
};

export type HealthResult = {
  status: HealthStatus;
  score: number;        // 0-100, higher = healthier
  reasons: string[];
};

export function computeHealth(input: HealthInput): HealthResult {
  const { reviewNeeded, overdue, unscheduled, blocked, total } = input;
  const reasons: string[] = [];
  let penalty = 0;

  if (total === 0) return { status: "Healthy", score: 100, reasons: [] };

  // Blocked conditions (hard blockers)
  if (reviewNeeded > 0) {
    penalty += reviewNeeded * 15;
    reasons.push(`검토필요 ${reviewNeeded}건`);
  }
  if (overdue > 0) {
    penalty += overdue * 20;
    reasons.push(`ETA 초과 ${overdue}건`);
  }
  if (blocked > 0) {
    penalty += blocked * 10;
    reasons.push(`확인필요 ${blocked}건`);
  }
  if (unscheduled > 0) {
    penalty += unscheduled * 5;
    reasons.push(`일정 미정 ${unscheduled}건`);
  }

  const score = Math.max(0, Math.min(100, 100 - penalty));

  let status: HealthStatus;
  if (reviewNeeded > 0 || overdue > 2) {
    status = "Blocked";
  } else if (score < 70) {
    status = "At Risk";
  } else {
    status = "Healthy";
  }

  return { status, score, reasons };
}
