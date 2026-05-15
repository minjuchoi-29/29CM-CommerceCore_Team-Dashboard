import { auth } from "@/auth";
import { redirect } from "next/navigation";

/**
 * 담당자 대시보드 — Beta 공개 기능.
 * 로그인된 모든 사용자가 접근 가능.
 *
 * 접근 정책:
 * - 비로그인 → "/" 리디렉션 (루트 레이아웃의 auth 처리와 일치)
 * - 로그인 → 통과 (Beta 기능으로 전체 공개)
 *
 * TODO [OWNER-DASHBOARD]: 향후 admin-only 기능(leadership visibility, 내부 score 등)이
 * 추가되면 해당 기능만 내부에서 isAdminUser()로 별도 gate 처리.
 */
export default async function OwnerDashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user) {
    redirect("/");
  }
  return <>{children}</>;
}
