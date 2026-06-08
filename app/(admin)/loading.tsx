export default function AdminLoading() {
  return (
    <div className="space-y-4">
      <div className="h-1 overflow-hidden rounded bg-neutral-200">
        <div className="h-full w-1/3 animate-[tato-route-progress_1.05s_ease-in-out_infinite] bg-neutral-950" />
      </div>
      <div className="rounded-lg border border-neutral-200 bg-white p-4">
        <div className="h-7 w-56 animate-pulse rounded bg-neutral-200" />
        <div className="mt-3 h-4 w-80 max-w-full animate-pulse rounded bg-neutral-100" />
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        {[0, 1, 2].map((item) => (
          <div key={item} className="rounded-lg border border-neutral-200 bg-white p-4">
            <div className="h-4 w-24 animate-pulse rounded bg-neutral-100" />
            <div className="mt-4 h-8 w-20 animate-pulse rounded bg-neutral-200" />
          </div>
        ))}
      </div>
      <div className="rounded-lg border border-neutral-200 bg-white p-4">
        <div className="space-y-3">
          {[0, 1, 2, 3, 4].map((item) => (
            <div key={item} className="h-10 animate-pulse rounded bg-neutral-100" />
          ))}
        </div>
      </div>
    </div>
  );
}
