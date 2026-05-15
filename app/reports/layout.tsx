import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { canAccessReports } from "@/lib/auth/admin";

/**
 * 보고서 섹션 서버 레이아웃 — 허용된 사용자만 진입 가능.
 * 비허용 사용자는 /forbidden 으로 redirect.
 */
export default async function ReportsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!canAccessReports(session?.user?.email)) {
    redirect("/forbidden");
  }
  return <>{children}</>;
}
