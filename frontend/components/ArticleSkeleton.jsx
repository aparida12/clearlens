"use client";

function SkeletonBar({ className = "" }) {
  return <div className={`shimmer-bar ${className}`} aria-hidden="true" />;
}

export default function ArticleSkeleton() {
  return (
    <article className="mx-auto w-full max-w-[1160px] px-4 pb-16 pt-8 sm:px-6 lg:px-8">
      <div className="article-header-enter mb-8 space-y-4">
        <SkeletonBar className="h-4 w-28" />
        <SkeletonBar className="h-16 w-full max-w-[720px]" />
        <SkeletonBar className="h-6 w-full max-w-[640px]" />
        <SkeletonBar className="h-10 w-full max-w-[760px]" />
      </div>

      <div className="article-body-enter mb-5 bg-[var(--bg-2)] px-5 py-[14px]">
        <SkeletonBar className="h-3 w-32" />
        <SkeletonBar className="mt-4 h-1.5 w-full" />
        <div className="mt-3 flex items-center justify-between">
          <SkeletonBar className="h-3 w-12" />
          <SkeletonBar className="h-3 w-12" />
        </div>
      </div>

      <div className="article-body-enter mb-8 flex flex-wrap gap-2">
        <SkeletonBar className="h-6 w-20" />
        <SkeletonBar className="h-6 w-24" />
        <SkeletonBar className="h-6 w-16" />
      </div>

      <section className="article-body-enter mx-auto mb-3 w-full max-w-[800px] space-y-5">
        <SkeletonBar className="h-6 w-full" />
        <SkeletonBar className="h-6 w-[82%]" />
        <SkeletonBar className="h-6 w-full" />
        <SkeletonBar className="h-6 w-[78%]" />
        <SkeletonBar className="h-6 w-full" />
        <SkeletonBar className="h-6 w-[86%]" />
        <SkeletonBar className="h-6 w-full" />
        <SkeletonBar className="h-6 w-[80%]" />
      </section>

      <div className="article-late-enter relative mx-auto mb-8 mt-8 w-full max-w-[980px] border-b border-[var(--ink)] border-t-[3px] border-t-[var(--ink)] py-5">
        <SkeletonBar className="h-8 w-full max-w-[780px]" />
      </div>

      <section className="article-late-enter mx-auto mt-8 w-full max-w-[980px] border-[0.5px] border-[var(--rule)] border-l-[3px] border-l-[var(--accent-blue)] bg-[var(--white)] px-6 py-5">
        <SkeletonBar className="h-3 w-48" />
        <div className="mt-4 space-y-3">
          <SkeletonBar className="h-4 w-full" />
          <SkeletonBar className="h-4 w-[90%]" />
          <SkeletonBar className="h-4 w-[84%]" />
        </div>
      </section>
    </article>
  );
}
