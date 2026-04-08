export default function Loading() {
  return (
    <div className="flex bg-gray-50 min-h-screen px-6 py-8">
      <div className="flex-1 min-w-0">
        <div className="mb-5">
          <div className="h-5 w-40 bg-gray-200 rounded animate-pulse" />
          <div className="h-3 w-52 bg-gray-100 rounded animate-pulse mt-2" />
        </div>

        {/* 요약 카드 스켈레톤 */}
        <div className="grid grid-cols-4 gap-3 mb-5">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="bg-white rounded-xl border border-gray-200 px-4 py-3">
              <div className="h-3 w-10 bg-gray-100 rounded animate-pulse" />
              <div className="h-7 w-8 bg-gray-200 rounded animate-pulse mt-2" />
            </div>
          ))}
        </div>

        {/* 티켓 목록 스켈레톤 */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-4 py-2.5 bg-gray-50 border-b border-gray-100">
            <div className="h-3 w-64 bg-gray-200 rounded animate-pulse" />
          </div>
          {[...Array(12)].map((_, i) => (
            <div key={i} className="flex items-center px-4 py-3 border-b border-gray-50 last:border-0 gap-4">
              <div className="h-3 w-20 bg-gray-100 rounded animate-pulse shrink-0" />
              <div className="h-3 flex-1 bg-gray-100 rounded animate-pulse" />
              <div className="h-3 w-12 bg-gray-100 rounded animate-pulse shrink-0" />
              <div className="h-3 w-12 bg-gray-100 rounded animate-pulse shrink-0" />
              <div className="h-5 w-16 bg-gray-100 rounded-full animate-pulse shrink-0" />
              <div className="h-3 w-20 bg-gray-100 rounded animate-pulse shrink-0" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
