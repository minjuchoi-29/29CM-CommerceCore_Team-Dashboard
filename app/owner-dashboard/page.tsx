import { auth } from "@/auth";
import OwnerDashboard from "./OwnerDashboard";

export default async function OwnerDashboardPage() {
  const session = await auth();
  const userEmail = session?.user?.email ?? "";
  const userName = session?.user?.name ?? session?.user?.email ?? "알 수 없음";
  return <OwnerDashboard userEmail={userEmail} userName={userName} />;
}
