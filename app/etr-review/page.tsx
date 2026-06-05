import { auth } from "@/auth";
import EtrReviewBoard from "./EtrReviewBoard";

export default async function EtrReviewPage() {
  const session = await auth();
  const userName = session?.user?.name ?? session?.user?.email ?? "알 수 없음";
  return <EtrReviewBoard userName={userName} />;
}
