const STATUS_COLOR: Record<string, string> = {
  "개발중": "bg-blue-100 text-blue-700",
  "기획완료": "bg-green-100 text-green-700",
  "디자인완료": "bg-purple-100 text-purple-700",
  "디자인중": "bg-purple-50 text-purple-500",
  "준비중": "bg-yellow-100 text-yellow-700",
  "기획중": "bg-orange-100 text-orange-700",
  "SUGGESTED": "bg-gray-100 text-gray-500",
};

const initiatives = [
  { title: "[채널] 최저가 노출 개편 - 네이버EP (Q1 연장)", owner: "백수지", category: "네이버EP", status: "개발중", eta: "2026-04-10", jira: "TM-1869" },
  { title: "[리뷰] 신고 프로세스 개선 - 사유 인지/정지 해제 (Q1 연장)", owner: "백수지", category: "리뷰", status: "개발중", eta: "2026-05-10", jira: "TM-1886" },
  { title: "[결제] 제휴카드 도입 (Q1 연장)", owner: "정유민", category: "제휴/결제", status: "개발중", eta: "2026-04-27", jira: "TM-1846" },
  { title: "[결제] 교환 배송비 결제 시스템화 (Q1 연장)", owner: "좌예슬", category: "기본기강화", status: "개발중", eta: "2026-04-30", jira: "TM-1871" },
  { title: "[티켓] 지정좌석예매 좌석배치도 UX 개선", owner: "양유주", category: "티켓 내재화", status: "개발중", eta: "2026-04-30", jira: "TM-2815" },
  { title: "[쿠폰] 파트너 쿠폰 대시보드 제공", owner: "양유주", category: "Growth: 쿠폰/할인", status: "개발중", eta: "2026-06-30", jira: "TM-1241" },
  { title: "[정산] 무신사트레이딩 합병 대응 - 물류/ERP 연동", owner: "윤정오", category: "컴플라이언스", status: "준비중", eta: "2026-05-01", jira: "TM-2817" },
  { title: "[쿠폰] 쿠폰 발급 트래픽 병목 개선 - 이구위크 대응", owner: "윤정오", category: "Engineering OKR", status: "기획완료", eta: "2026-05-15", jira: "TM-2513" },
  { title: "[쿠폰] 카테고리 첫구매 쿠폰 로직 고도화 - 이구위크", owner: "양유주", category: "Growth: 쿠폰/할인", status: "준비중", eta: "2026-05-30", jira: "TM-2726" },
  { title: "[쿠폰] 브랜드 첫구매 쿠폰 기능 도입 및 모듈화 - 이구위크", owner: "양유주", category: "Growth: 쿠폰/할인", status: "준비중", eta: "2026-05-15", jira: "TM-2727" },
  { title: "[쿠폰] 브랜드 장바구니 쿠폰 셀프서브", owner: "양유주", category: "Growth: 쿠폰/할인", status: "디자인완료", eta: "-", jira: "-" },
  { title: "[쿠폰] 기획전 참여형 쿠폰 파트너 셀프서브 구축", owner: "양유주", category: "Parity/밀도 개선", status: "디자인중", eta: "-", jira: "-" },
  { title: "[채널] 단위가격 표시제 적용 - 네이버EP", owner: "백수지", category: "네이버 EP", status: "디자인완료", eta: "-", jira: "-" },
  { title: "[채널] 네이버EP 매핑율 향상 Phase 2", owner: "백수지", category: "네이버 EP", status: "준비중", eta: "-", jira: "TM-2762" },
  { title: "[파트너] 파트너 대시보드 리뉴얼 (Q1 연장)", owner: "김다운", category: "파트너", status: "디자인중", eta: "2026-04-30", jira: "TM-2755" },
  { title: "[파트너] 큐레이터 상품 시딩 캠페인 - 무료주문 생성", owner: "정유민", category: "파트너", status: "기획완료", eta: "2026-05-29", jira: "TM-2746" },
  { title: "[결제] 케이뱅크 할인혜택 넛징", owner: "정유민", category: "제휴/결제", status: "준비중", eta: "2026-07-20", jira: "TM-2745" },
  { title: "[AI] AI 기반 어뷰징 리뷰 탐지 및 처리 자동화", owner: "백수지", category: "리뷰", status: "기획완료", eta: "-", jira: "-" },
  { title: "[AI] PDP AI 리뷰 요약 도입", owner: "백수지", category: "리뷰", status: "SUGGESTED", eta: "-", jira: "-" },
  { title: "[AI] AI 가상 착장 도입", owner: "백수지", category: "AI", status: "기획중", eta: "-", jira: "-" },
  { title: "[장바구니] 타겟형 할인 넛지 - 장바구니 쿠폰 추천", owner: "정유민", category: "장바구니/넛지", status: "디자인완료", eta: "-", jira: "-" },
  { title: "[장바구니] 타겟형 할인 넛지 - 결제할인 추천", owner: "정유민", category: "장바구니/넛지", status: "기획완료", eta: "-", jira: "-" },
  { title: "[장바구니] 결제 CTA 최대 할인가 가시화", owner: "정유민", category: "장바구니/넛지", status: "디자인완료", eta: "-", jira: "-" },
  { title: "[장바구니] 할인 UX 고도화 Phase 2 (가격하락/품절임박)", owner: "정유민", category: "장바구니/넛지", status: "디자인완료", eta: "-", jira: "-" },
  { title: "[클레임] N회차 교환 로직 개선", owner: "좌예슬", category: "주문/클레임", status: "SUGGESTED", eta: "-", jira: "TM-2770" },
  { title: "[클레임] 리콜 프로세스 시스템화", owner: "좌예슬", category: "주문/클레임", status: "SUGGESTED", eta: "-", jira: "-" },
  { title: "[클레임] 무배당발 빠른 교환 도입", owner: "좌예슬", category: "주문/클레임", status: "SUGGESTED", eta: "-", jira: "-" },
  { title: "[클레임] 무료교환 설정 프로세스 도입", owner: "좌예슬", category: "주문/클레임", status: "SUGGESTED", eta: "-", jira: "-" },
  { title: "[클레임] 상품 준비중 취소 기능 도입", owner: "좌예슬", category: "주문/클레임", status: "SUGGESTED", eta: "-", jira: "-" },
  { title: "[CS] AI 챗봇 진입점 A/B 테스트", owner: "좌예슬", category: "CS", status: "SUGGESTED", eta: "-", jira: "TM-2751" },
  { title: "[CS] CS 상담 CRM 도입 - Salesforce", owner: "좌예슬", category: "CS", status: "SUGGESTED", eta: "-", jira: "TM-2779" },
  { title: "[CS] CS 상담사 Agent Workspace 도입", owner: "좌예슬", category: "CS", status: "SUGGESTED", eta: "-", jira: "TM-2753" },
  { title: "[파트너] 매입 상품 수기 재고 차감 - 나이키 반출 대응", owner: "좌예슬", category: "주문/클레임", status: "SUGGESTED", eta: "-", jira: "TM-2853" },
  { title: "[채널] 폐쇄링크 기획전 고도화", owner: "최민주", category: "폐쇄링크", status: "준비중", eta: "-", jira: "-" },
  { title: "[카탈로그] 표준카테고리 미매칭 상품 매핑", owner: "백수지", category: "카탈로그", status: "준비중", eta: "-", jira: "TM-2758" },
  { title: "[할인] 할인/수수료 자동화 시스템 구축", owner: "양유주", category: "Growth: 쿠폰/할인", status: "준비중", eta: "-", jira: "-" },
  { title: "[파트너] 상품그룹 셀프 서브 구축", owner: "정유민", category: "파트너", status: "디자인완료", eta: "-", jira: "-" },
];

const JIRA_BASE = "https://jira.team.musinsa.com/browse/";

export default function Home() {
  const owners = [...new Set(initiatives.map((i) => i.owner))].sort();

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 px-8 py-5">
        <div className="max-w-7xl mx-auto">
          <h1 className="text-xl font-bold text-gray-900">29CM Commerce Core</h1>
          <p className="text-sm text-gray-500 mt-1">2026 Q2 Initiative Dashboard</p>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-8 py-8">
        {/* 요약 카드 */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
          {[
            { label: "전체", count: initiatives.length, color: "text-gray-900" },
            { label: "개발중", count: initiatives.filter((i) => i.status === "개발중").length, color: "text-blue-600" },
            { label: "준비/기획/디자인", count: initiatives.filter((i) => ["준비중","기획완료","기획중","디자인완료","디자인중"].includes(i.status)).length, color: "text-green-600" },
            { label: "SUGGESTED", count: initiatives.filter((i) => i.status === "SUGGESTED").length, color: "text-gray-400" },
          ].map((s) => (
            <div key={s.label} className="bg-white rounded-xl border border-gray-200 px-5 py-4">
              <p className="text-sm text-gray-500">{s.label}</p>
              <p className={`text-2xl font-bold mt-1 ${s.color}`}>{s.count}</p>
            </div>
          ))}
        </div>

        {/* 오너별 그룹 */}
        {owners.map((owner) => {
          const items = initiatives.filter((i) => i.owner === owner);
          return (
            <div key={owner} className="mb-8">
              <h2 className="text-base font-semibold text-gray-700 mb-3">
                {owner}
                <span className="ml-2 text-sm font-normal text-gray-400">{items.length}건</span>
              </h2>
              <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 bg-gray-50 text-gray-500 text-xs">
                      <th className="text-left px-4 py-3 font-medium w-1/2">Initiative</th>
                      <th className="text-left px-4 py-3 font-medium">카테고리</th>
                      <th className="text-left px-4 py-3 font-medium">상태</th>
                      <th className="text-left px-4 py-3 font-medium">ETA</th>
                      <th className="text-left px-4 py-3 font-medium">JIRA</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item, idx) => (
                      <tr key={idx} className="border-b border-gray-50 last:border-0 hover:bg-gray-50 transition-colors">
                        <td className="px-4 py-3 text-gray-800 font-medium">{item.title}</td>
                        <td className="px-4 py-3 text-gray-500">{item.category}</td>
                        <td className="px-4 py-3">
                          <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLOR[item.status] ?? "bg-gray-100 text-gray-500"}`}>
                            {item.status}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-gray-500">{item.eta}</td>
                        <td className="px-4 py-3">
                          {item.jira !== "-" ? (
                            <a href={`${JIRA_BASE}${item.jira}`} target="_blank" rel="noopener noreferrer"
                              className="text-blue-500 hover:underline font-mono text-xs">
                              {item.jira}
                            </a>
                          ) : (
                            <span className="text-gray-300">-</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })}
      </main>
    </div>
  );
}
