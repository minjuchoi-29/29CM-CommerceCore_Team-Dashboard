import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { isAdminUser } from "@/lib/auth/admin";

/**
 * 담당자 대시보드 — 관리자 전용 실험 기능.
 * 현재는 ADMIN_ONLY_EMAILS에 포함된 사용자에게만 노출.
 * TODO [OWNER-DASHBOARD]: 팀 전체 공개 시 레이아웃 가드 제거 또는 권한 분리
 */
export default async function OwnerDashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!isAdminUser(session?.user?.email)) {
    redirect("/forbidden");
  }
  return <>{children}</>;
}
