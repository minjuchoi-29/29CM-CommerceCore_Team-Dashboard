import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { canAccessDataSources } from "@/lib/auth/admin";

/**
 * 데이터 소스 섹션 서버 레이아웃 — 허용된 사용자만 진입 가능.
 * 비허용 사용자는 /forbidden 으로 redirect.
 */
export default async function DataSourcesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!canAccessDataSources(session?.user?.email)) {
    redirect("/forbidden");
  }
  return <>{children}</>;
}
