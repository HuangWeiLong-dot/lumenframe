// 通用骨架块：复用 index.css 现有的 @keyframes shimmer
export function ShimmerBlock({ className = '', style }) {
  return (
    <div
      className={`relative overflow-hidden bg-zinc-200 ${className}`}
      style={style}
    >
      <div
        className="absolute inset-0"
        style={{
          background: 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.5) 50%, transparent 100%)',
          animation: 'shimmer 1.5s infinite',
        }}
      />
    </div>
  )
}

// 详情页头部骨架：与真实头部 1:1 对齐宽度/间距/flex，保证数据到达零跳动
export function DetailHeaderSkeleton() {
  return (
    <section className="relative mt-6 flex flex-col items-center gap-5 sm:mt-8 sm:flex-row sm:items-stretch sm:gap-8">
      {/* 海报骨架：w-32 sm:w-48，2:3 */}
      <ShimmerBlock className="h-48 w-32 shrink-0 self-center shadow-md ring-1 ring-black/5 sm:h-72 sm:w-48 sm:self-start" />
      <div className="min-w-0 w-full flex-1 text-center sm:flex sm:flex-col sm:text-left">
        {/* 标题 */}
        <ShimmerBlock className="mx-auto h-8 w-3/4 sm:mx-0 sm:w-2/3" />
        {/* original title */}
        <ShimmerBlock className="mx-auto mt-2 h-4 w-1/2 sm:mx-0 sm:w-1/3" />
        {/* 元信息行 */}
        <div className="mt-3 flex flex-wrap items-center justify-center gap-x-2.5 gap-y-1 sm:justify-start">
          <ShimmerBlock className="h-4 w-12" />
          <ShimmerBlock className="h-4 w-16" />
          <ShimmerBlock className="h-4 w-20" />
        </div>
        {/* 评分卡片 + My Score + Watched */}
        <div className="mt-4 flex flex-col items-center gap-3 sm:mt-auto sm:flex-row sm:items-end sm:justify-between">
          {/* 评分 chips：5 个 min-w-[68px] */}
          <div className="flex flex-wrap items-stretch justify-center gap-2 sm:justify-start">
            {[0, 1, 2, 3, 4].map((i) => (
              <ShimmerBlock key={i} className="h-12 min-w-[68px]" />
            ))}
          </div>
          {/* My Score + Watched 按钮 */}
          <div className="flex flex-col items-center gap-2">
            <ShimmerBlock className="h-4 w-24" />
            <div className="flex flex-wrap items-center justify-center gap-2">
              <ShimmerBlock className="h-9 min-w-[120px]" />
              <ShimmerBlock className="h-9 min-w-[120px]" />
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

// 评分区骨架：movie 已到位但 ratings 未到
export function RatingsSkeleton() {
  return (
    <div className="flex flex-wrap items-stretch justify-center gap-2 sm:justify-start">
      {[0, 1, 2, 3, 4].map((i) => (
        <ShimmerBlock key={i} className="h-12 min-w-[68px]" />
      ))}
    </div>
  )
}

// 技术参数区骨架
export function SpecsSkeleton() {
  return (
    <dl className="mt-5 grid grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-2">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="flex gap-2 text-sm">
          <ShimmerBlock className="h-4 w-16 shrink-0" />
          <ShimmerBlock className="h-4 w-32" />
        </div>
      ))}
    </dl>
  )
}
