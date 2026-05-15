export type RoadmapInitiative = {
  id: string;
  title: string;
  description?: string;
  year: number;
  startMonth?: string; // YYYY-MM
  endMonth?: string;   // YYYY-MM
  targetQuarters: Array<"Q1" | "Q2" | "Q3" | "Q4">;
  status: "계획 중" | "진행 중" | "모니터링" | "완료" | "보류";
  priority: "높음" | "중간" | "낮음";
  pressure: "높음" | "중간" | "낮음";
  objective?: string;
  background?: string;
  capacityMemo?: string;
  bottleneck?: string;
  isFutureQueue?: boolean;
  futureMemo?: string;
  linkedTickets: string[];
  owner?: string;
  tags?: string[];
  createdAt: string;
  updatedAt: string;
};

export const SAMPLE_INITIATIVES: RoadmapInitiative[] = [
  {
    id: "init-1",
    title: "Commerce Core 구조개선",
    description: "코어 커머스 레이어 안정성 및 확장성 강화",
    year: 2026,
    startMonth: "2026-01",
    endMonth: "2026-06",
    targetQuarters: ["Q1", "Q2"],
    status: "진행 중",
    priority: "높음",
    pressure: "높음",
    objective: "커머스 코어 시스템의 기술 부채를 해소하고 확장 가능한 구조로 전환",
    bottleneck: "BE-SP 리소스 과부하",
    linkedTickets: [],
    owner: "최민주",
    tags: ["구조개선", "기술부채"],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: "init-2",
    title: "Claim 정책 통합",
    year: 2026,
    startMonth: "2026-02",
    endMonth: "2026-04",
    targetQuarters: ["Q1", "Q2"],
    status: "진행 중",
    priority: "높음",
    pressure: "중간",
    objective: "분산된 Claim 정책을 단일 기준으로 통합하여 운영 효율 향상",
    linkedTickets: [],
    owner: "백수지",
    tags: ["Claim", "정책"],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: "init-3",
    title: "Seller Ops 개선",
    year: 2026,
    startMonth: "2026-03",
    endMonth: "2026-08",
    targetQuarters: ["Q2", "Q3"],
    status: "계획 중",
    priority: "중간",
    pressure: "낮음",
    objective: "셀러 운영 효율성 향상을 위한 어드민 도구 고도화",
    linkedTickets: [],
    owner: "정유민",
    tags: ["Seller", "Ops"],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: "init-4",
    title: "Global Foundation 강화",
    year: 2026,
    startMonth: "2026-06",
    endMonth: "2026-12",
    targetQuarters: ["Q3", "Q4"],
    status: "계획 중",
    priority: "중간",
    pressure: "낮음",
    objective: "글로벌 진출을 위한 기반 인프라 구축",
    isFutureQueue: false,
    linkedTickets: [],
    owner: "좌예슬",
    tags: ["Global", "인프라"],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: "init-5",
    title: "Data 기반 의사결정 고도화",
    year: 2026,
    startMonth: "2026-07",
    endMonth: "2026-12",
    targetQuarters: ["Q3", "Q4"],
    status: "계획 중",
    priority: "낮음",
    pressure: "낮음",
    objective: "데이터 파이프라인 및 대시보드 고도화로 의사결정 속도 향상",
    isFutureQueue: true,
    futureMemo: "H2 리소스 확보 후 착수 예정",
    linkedTickets: [],
    owner: "양유주",
    tags: ["Data", "Analytics"],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
];
