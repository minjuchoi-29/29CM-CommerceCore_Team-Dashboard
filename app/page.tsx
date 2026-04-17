import { auth } from "@/auth";
import TicketBoard from "./jira-tickets/TicketBoard";

export default async function HomePage() {
  const session = await auth();
  const userName = session?.user?.name ?? session?.user?.email ?? "알 수 없음";
  return <TicketBoard userName={userName} />;
}
