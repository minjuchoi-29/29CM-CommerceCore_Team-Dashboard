import type {
  TeamWorkItem,
  TeamWorkstream,
  TeamWorkstreamView,
} from "@/lib/team-workstreams";

type PlanningNote = {
  text: string;
  author: string;
  date: string;
};

type TeamWorkstreamSummaryProps = {
  view: TeamWorkstreamView;
  planningNotes?: PlanningNote[];
  compact?: boolean;
};

const LIFECYCLE_META = {
  planning: {
    title: "프리플래닝",
    description: "예정 스프린트와 필요한 팀의 검토 상태를 확인합니다.",
    badge: "플래닝 대기",
    accent: "#315b91",
  },
  active: {
    title: "팀별 현재 단계",
    description: "Weekly에서 읽은 실제 일정의 팀·단계·상태를 함께 보여줍니다.",
    badge: "진행 중",
    accent: "#315b91",
  },
  recently_completed: {
    title: "완료·후속 상태",
    description: "완료 후 14일 동안 마지막 Weekly와 남은 확인 일정을 추적합니다.",
    badge: "최근 완료",
    accent: "#24735d",
  },
  completed: {
    title: "완료 기록",
    description: "Weekly 추적 기간이 지난 과제입니다.",
    badge: "추적 종료",
    accent: "#68748a",
  },
} as const;

const STATUS_STYLE: Record<string, { color: string; background: string; border: string }> = {
  완료: { color: "#24735d", background: "#eaf6f1", border: "#b9dfd0" },
  진행중: { color: "#315b91", background: "#eaf1fa", border: "#bdd0e8" },
  검토중: { color: "#315b91", background: "#eaf1fa", border: "#bdd0e8" },
  예정: { color: "#936520", background: "#fff5e5", border: "#e8ca98" },
  대기중: { color: "#68748a", background: "#f3f5f8", border: "#d8dee8" },
  미정: { color: "#68748a", background: "#f3f5f8", border: "#d8dee8" },
  확인필요: { color: "#9b4c3f", background: "#fff0ed", border: "#e8c2ba" },
  대상아님: { color: "#7b8698", background: "#f5f7fa", border: "#dde2eb" },
};

function statusStyle(status: string) {
  return STATUS_STYLE[status] ?? STATUS_STYLE.미정;
}

function formatDate(value?: string): string {
  if (!value) return "";
  const match = value.match(/^\d{4}-(\d{2})-(\d{2})$/);
  if (!match) return value;
  return `${Number(match[1])}/${Number(match[2])}`;
}

function dateRange(item: TeamWorkItem): string {
  const start = formatDate(item.start);
  const end = formatDate(item.end);
  if (start && end) return start === end ? start : `${start}~${end}`;
  if (start) return `${start}~`;
  return end || "미정";
}

function teamLabel(team: TeamWorkstream): string {
  return team.parentTeam ? `${team.parentTeam} / ${team.label}` : team.label;
}

function rawAliasLabel(team: TeamWorkstream): string | null {
  const canonicalLabels = new Set([team.label, team.parentTeam].filter(Boolean));
  const aliases = team.rawLabels.filter(label => !canonicalLabels.has(label));
  return aliases.length > 0 ? aliases.join(" · ") : null;
}

function StatusBadge({ status, phase }: { status: string; phase?: string }) {
  const style = statusStyle(status);
  return (
    <span
      className="inline-flex shrink-0 items-center rounded-md border px-1.5 py-0.5 text-[10px] font-semibold"
      style={{ color: style.color, background: style.background, borderColor: style.border }}
    >
      {phase ? `${phase} · ${status}` : status}
    </span>
  );
}

function WorkItemRow({ item }: { item: TeamWorkItem }) {
  return (
    <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-2 border-t py-2 first:border-t-0" style={{ borderColor: "var(--border)" }}>
      <StatusBadge status={item.status} phase={item.phase} />
      <div className="min-w-0">
        <p className="text-[12px] leading-relaxed" style={{ color: "var(--text-secondary)" }}>{item.detail}</p>
        {item.person ? <p className="mt-0.5 text-[10px]" style={{ color: "var(--text-muted)" }}>담당 {item.person}</p> : null}
      </div>
      <span className="whitespace-nowrap text-[10px]" style={{ color: "var(--text-muted)" }}>{dateRange(item)}</span>
    </div>
  );
}

function TeamRow({ team, planning }: { team: TeamWorkstream; planning: boolean }) {
  const alias = rawAliasLabel(team);
  const visibleItems = team.items.slice(0, 3);
  const hiddenItems = team.items.slice(3);
  return (
    <div className="grid gap-2 border-t py-2.5 first:border-t-0 md:grid-cols-[100px_minmax(0,1fr)]" style={{ borderColor: "var(--border)" }}>
      <div>
        <p className="text-[12px] font-semibold" style={{ color: "var(--text-primary)" }}>{teamLabel(team)}</p>
        {alias ? <p className="mt-0.5 text-[9.5px] leading-snug" style={{ color: "var(--text-muted)" }}>원문 {alias}</p> : null}
      </div>
      <div className="min-w-0">
        {planning ? (
          <div className="flex items-center justify-between gap-2">
            <StatusBadge status={team.planningState ?? "대기중"} />
            <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>팀별 플래닝 상태</span>
          </div>
        ) : team.items.length > 0 ? (
          <>
            {visibleItems.map((item, index) => <WorkItemRow key={`${item.role}-${item.start}-${item.end}-${index}`} item={item} />)}
            {hiddenItems.length > 0 ? (
              <details className="border-t pt-2" style={{ borderColor: "var(--border)" }}>
                <summary className="cursor-pointer text-[10.5px] font-medium" style={{ color: "#315b91" }}>
                  추가 일정 {hiddenItems.length}개 보기
                </summary>
                <div className="mt-1">
                  {hiddenItems.map((item, index) => <WorkItemRow key={`${item.role}-${item.start}-${item.end}-hidden-${index}`} item={item} />)}
                </div>
              </details>
            ) : null}
          </>
        ) : (
          <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>등록된 작업별 일정이 없습니다.</p>
        )}
      </div>
    </div>
  );
}

export default function TeamWorkstreamSummary({
  view,
  planningNotes = [],
  compact = false,
}: TeamWorkstreamSummaryProps) {
  const meta = LIFECYCLE_META[view.lifecycle];
  const isPlanning = view.lifecycle === "planning";
  const recentNotes = planningNotes.slice(-2).reverse();

  return (
    <section
      className={`rounded-xl ${compact ? "p-3" : "p-4"}`}
      style={{ background: "var(--bg-canvas)", border: "1px solid var(--border-2)", borderTop: `3px solid ${meta.accent}` }}
      aria-label={meta.title}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-[13px] font-semibold" style={{ color: "var(--text-primary)" }}>{meta.title}</h3>
          <p className="mt-0.5 text-[10.5px] leading-relaxed" style={{ color: "var(--text-muted)" }}>{meta.description}</p>
        </div>
        <span className="shrink-0 rounded-md border px-2 py-1 text-[10px] font-semibold" style={{ color: meta.accent, borderColor: `${meta.accent}55`, background: `${meta.accent}0d` }}>
          {meta.badge}
        </span>
      </div>

      {isPlanning ? (
        <div className="mt-3 grid grid-cols-2 gap-2">
          <div className="rounded-lg border px-3 py-2" style={{ borderColor: "var(--border)", background: "var(--bg-overlay)" }}>
            <p className="text-[9.5px]" style={{ color: "var(--text-muted)" }}>플래닝 상태</p>
            <p className="mt-0.5 text-[12px] font-semibold" style={{ color: "var(--text-primary)" }}>{view.preplanningStatus}</p>
          </div>
          <div className="rounded-lg border px-3 py-2" style={{ borderColor: "var(--border)", background: "var(--bg-overlay)" }}>
            <p className="text-[9.5px]" style={{ color: "var(--text-muted)" }}>예정 스프린트</p>
            <p className="mt-0.5 text-[12px] font-semibold" style={{ color: "var(--text-primary)" }}>{view.targetSprint || "미정"}</p>
          </div>
        </div>
      ) : view.lifecycle === "recently_completed" ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <span className="rounded-md border px-2 py-1 text-[10px]" style={{ color: "#24735d", borderColor: "#b9dfd0", background: "#eaf6f1" }}>
            완료 {view.completedDaysAgo ?? 0}일 경과
          </span>
          <span className="rounded-md border px-2 py-1 text-[10px]" style={{ color: "#536078", borderColor: "#d6deea", background: "#edf2f8" }}>
            Weekly 추적 {view.trackingDaysRemaining ?? 0}일 남음
          </span>
        </div>
      ) : null}

      <div className="mt-3">
        <div className="flex items-center justify-between gap-2 pb-1.5">
          <p className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
            {isPlanning
              ? "필요한 팀"
              : view.lifecycle === "recently_completed"
                ? "완료·후속 일정"
                : "팀별 실행 상태"}
          </p>
          <span className="text-[9.5px]" style={{ color: "var(--text-muted)" }}>{view.teams.length}개 팀</span>
        </div>
        {view.teams.length > 0 ? (
          <div>
            {view.teams.map(team => <TeamRow key={team.key} team={team} planning={isPlanning} />)}
          </div>
        ) : (
          <div className="rounded-lg border px-3 py-3 text-[11px]" style={{ borderColor: "var(--border)", background: "var(--bg-overlay)", color: "var(--text-muted)" }}>
            {isPlanning ? "필요한 팀이 아직 선택되지 않았습니다." : "표시할 작업별 일정이 없습니다."}
          </div>
        )}
      </div>

      {isPlanning && recentNotes.length > 0 ? (
        <div className="mt-3 border-t pt-3" style={{ borderColor: "var(--border)" }}>
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>최근 논의 메모</p>
            <span className="text-[9.5px]" style={{ color: "var(--text-muted)" }}>{planningNotes.length}건</span>
          </div>
          <div className="space-y-2">
            {recentNotes.map((note, index) => (
              <div key={`${note.date}-${index}`} className="rounded-lg border px-3 py-2" style={{ borderColor: "var(--border)", background: "var(--bg-overlay)" }}>
                <div className="flex items-center justify-between gap-2 text-[9.5px]" style={{ color: "var(--text-muted)" }}>
                  <span>{note.author}</span><span>{note.date}</span>
                </div>
                <p className="mt-1 whitespace-pre-wrap text-[11px] leading-relaxed" style={{ color: "var(--text-secondary)" }}>{note.text}</p>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}
