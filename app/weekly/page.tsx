/**
 * /weekly — Weekly 작성 가이드 (`/weekly-guide`) 로의 숏링크 redirect.
 * 서버 컴포넌트에서 `redirect()` 호출 → 308 Permanent Redirect.
 */
import { redirect } from "next/navigation";

export default function WeeklyShortlinkRedirect(): never {
  redirect("/weekly-guide");
}
