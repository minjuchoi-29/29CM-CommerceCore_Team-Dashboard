import type { WeeklyNote } from "@/lib/weekly-types";

/**
 * Weekly note 저장소는 주차별 이력을 append-only로 보존한다.
 * 화면에서는 같은 유형의 같은 문장이 여러 주차에 반복돼도 최신 한 건만 보여준다.
 */
export function normalizeWeeklyNoteContent(content: string): string {
  return content
    .normalize("NFKC")
    .trim()
    .replace(/^[\-*•·▪▫]+\s*/, "")
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("ko-KR");
}

export function dedupeWeeklyNotesForDisplay(notes: readonly WeeklyNote[]): WeeklyNote[] {
  const latestByContent = new Map<string, { note: WeeklyNote; index: number }>();

  notes.forEach((note, index) => {
    const normalizedContent = normalizeWeeklyNoteContent(note.content);
    const key = `${note.type}::${normalizedContent}`;

    // weekly-merge는 기존 배열을 유지하고 새 주차를 뒤에 append한다.
    // 같은 문장이 반복되면 뒤에 있는 최신 주차의 상태와 메타데이터를 사용한다.
    latestByContent.set(key, { note, index });
  });

  return [...latestByContent.values()]
    .sort((a, b) => a.index - b.index)
    .map(({ note }) => note);
}

export function selectOpenWeeklyNotesForDisplay(notes: readonly WeeklyNote[]): WeeklyNote[] {
  return dedupeWeeklyNotesForDisplay(notes).filter(note => note.status === "open");
}
