import { NextResponse } from "next/server";
import priorities from "@/app/data/priorities.json";

// 우선순위는 app/data/priorities.json에서 읽습니다.
// 구글 시트 수정 후 Claude에게 "우선순위 동기화해줘"라고 하면 자동으로 파일을 업데이트합니다.

export async function GET() {
  return NextResponse.json({ priorities });
}
