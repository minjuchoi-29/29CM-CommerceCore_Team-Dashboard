import type { Metadata } from "next";
import DataSourcesPage from "./DataSourcesPage";

export const metadata: Metadata = {
  title: "데이터 소스 | 29CM Commerce Core",
  description: "Jira Filter 기반 티켓 데이터 소스를 관리합니다.",
};

export default function Page() {
  return <DataSourcesPage />;
}
