import { cn } from "@/lib/utils";

/**
 * Loading placeholders shaped like the page that is coming: a calendar
 * grid for the calendar, rows for the order list, tiles for photos. A
 * placeholder in the right shape makes the wait read as "almost there"
 * and keeps the page from jumping when it arrives. Each page's
 * `loading.tsx` composes these; app/(admin)/loading.tsx is the fallback.
 * No progress bar here: NavigationOptimizer draws the only one.
 */

export function Bar({ className }: { className?: string }) {
  return <div className={cn("rounded bg-[var(--accent-soft-strong)] motion-safe:animate-pulse", className)} />;
}

function Soft({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return <div className={cn("rounded bg-[var(--surface-muted)] motion-safe:animate-pulse", className)} style={style} />;
}

function Card({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn("rounded-lg border border-[var(--line)] bg-white p-3 sm:p-4", className)}>{children}</div>;
}

function Header({ actions = 1 }: { actions?: number }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="space-y-2">
        <Bar className="h-6 w-40" />
        <Soft className="h-3.5 w-64 max-w-[60vw]" />
      </div>
      <div className="hidden gap-2 sm:flex">
        {Array.from({ length: actions }, (_, index) => (
          <Bar key={index} className="h-9 w-24" />
        ))}
      </div>
    </div>
  );
}

/** A row of filters above a list: search, a couple of selects, dates. */
function Filters({ count = 4 }: { count?: number }) {
  return (
    <Card>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        {Array.from({ length: count }, (_, index) => (
          <Soft key={index} className="h-9" />
        ))}
      </div>
    </Card>
  );
}

/** Dashboard: metric cards, then two panels. */
export function DashboardSkeleton() {
  return (
    <div className="space-y-4">
      <Header actions={0} />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[0, 1, 2, 3].map((index) => (
          <Card key={index}>
            <Soft className="h-3.5 w-20" />
            <Bar className="mt-3 h-7 w-24" />
          </Card>
        ))}
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        {[0, 1].map((index) => (
          <Card key={index}>
            <Bar className="h-4 w-32" />
            <div className="mt-4 space-y-2.5">
              {[0, 1, 2, 3].map((row) => (
                <Soft key={row} className="h-9" />
              ))}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

/** Calendar: a toolbar and a grid of car rows across days. */
export function CalendarSkeleton() {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex gap-2">
          <Bar className="h-9 w-9" />
          <Bar className="h-9 w-32" />
          <Bar className="h-9 w-9" />
        </div>
        <Bar className="h-9 w-28" />
      </div>
      <Card className="overflow-hidden p-0 sm:p-0">
        <div className="grid grid-cols-[7rem_repeat(7,minmax(0,1fr))] border-b border-[var(--line)]">
          <div className="p-2" />
          {Array.from({ length: 7 }, (_, index) => (
            <div key={index} className="border-l border-[var(--line)] p-2">
              <Soft className="mx-auto h-3.5 w-8" />
            </div>
          ))}
        </div>
        {Array.from({ length: 7 }, (_, row) => (
          <div key={row} className="grid grid-cols-[7rem_repeat(7,minmax(0,1fr))] border-b border-[var(--line)] last:border-b-0">
            <div className="space-y-1.5 p-2">
              <Bar className="h-3.5 w-20" />
              <Soft className="h-3 w-14" />
            </div>
            <div className="relative col-span-7 h-14">
              {/* A trip or two per car, at staggered spots, so it reads as a timeline. */}
              <Soft
                className="absolute top-3 h-8"
                style={{ left: `${(row * 37) % 60}%`, width: `${22 + ((row * 13) % 25)}%` }}
              />
            </div>
          </div>
        ))}
      </Card>
    </div>
  );
}

/** A filtered list: orders, activity, trash. */
export function ListSkeleton({ rows = 8, filters = 4 }: { rows?: number; filters?: number }) {
  return (
    <div className="space-y-3">
      <Header />
      {filters ? <Filters count={filters} /> : null}
      <Card className="p-0 sm:p-0">
        {Array.from({ length: rows }, (_, index) => (
          <div key={index} className="flex items-center gap-3 border-b border-[var(--line)] px-3 py-3 last:border-b-0 sm:px-4">
            <Soft className="h-9 w-9 shrink-0 rounded-md" />
            <div className="min-w-0 flex-1 space-y-1.5">
              <Bar className="h-3.5 w-2/5" />
              <Soft className="h-3 w-3/5" />
            </div>
            <Bar className="hidden h-4 w-16 sm:block" />
          </div>
        ))}
      </Card>
    </div>
  );
}

/** Cards in a grid: vehicles, owners. */
export function CardGridSkeleton({ cards = 6 }: { cards?: number }) {
  return (
    <div className="space-y-3">
      <Header />
      <Soft className="h-11 rounded-lg" />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: cards }, (_, index) => (
          <Card key={index}>
            <div className="flex items-center gap-3">
              <Soft className="h-12 w-16 shrink-0 rounded-md" />
              <div className="flex-1 space-y-1.5">
                <Bar className="h-4 w-3/5" />
                <Soft className="h-3 w-2/5" />
              </div>
            </div>
            <div className="mt-4 grid grid-cols-3 gap-2">
              {[0, 1, 2].map((cell) => (
                <Soft key={cell} className="h-8" />
              ))}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

/** Thumbnails: photos and documents. */
export function TileGridSkeleton({ tiles = 12 }: { tiles?: number }) {
  return (
    <div className="space-y-3">
      <Header />
      <Filters count={2} />
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
        {Array.from({ length: tiles }, (_, index) => (
          <Soft key={index} className="aspect-square rounded-md" />
        ))}
      </div>
    </div>
  );
}

/** One record: an order's page -- a summary, then panels side by side. */
export function DetailSkeleton() {
  return (
    <div className="space-y-3">
      <Bar className="h-4 w-20" />
      <Card>
        <Bar className="h-6 w-56 max-w-full" />
        <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
          {[0, 1, 2, 3].map((index) => (
            <div key={index} className="space-y-1.5">
              <Soft className="h-3 w-16" />
              <Bar className="h-4 w-24" />
            </div>
          ))}
        </div>
      </Card>
      <div className="grid gap-3 lg:grid-cols-2">
        {[0, 1, 2, 3].map((index) => (
          <Card key={index}>
            <Bar className="h-4 w-28" />
            <div className="mt-3 space-y-2">
              {[0, 1, 2].map((row) => (
                <Soft key={row} className="h-8" />
              ))}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
