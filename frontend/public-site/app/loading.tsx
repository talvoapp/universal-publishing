/**
 * Global loading state (shown during route transitions with suspense).
 */

export default function Loading() {
  return (
    <div className="max-w-6xl mx-auto px-4 py-12">
      <div className="animate-pulse space-y-6">
        <div className="h-12 bg-slate-200 rounded w-2/3 mx-auto" />
        <div className="h-6 bg-slate-200 rounded w-1/2 mx-auto" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-12">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="space-y-3">
              <div className="aspect-[2/3] bg-slate-200 rounded-xl" />
              <div className="h-4 bg-slate-200 rounded w-3/4" />
              <div className="h-3 bg-slate-200 rounded w-1/2" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}