import { NextResponse } from "next/server";
import priorities from "@/app/data/priorities.json";
import planning from "@/app/data/planning.json";

// 우선순위/플래닝 상태는 app/data/ 파일에서 읽습니다.
// 구글 시트 수정 후 Claude에게 "동기화해줘"라고 하면 자동으로 파일을 업데이트합니다.
// 플래닝 상태: 스프린트 대기중(기본값) → 검토중 → 플래닝 완료

export async function GET() {
  return NextResponse.json({ priorities, planning });
}
