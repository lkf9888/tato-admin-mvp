/**
 * Mobile-only top bar for the admin shell. Used to host a slide-in
 * drawer wrapped around the desktop sidebar; that role moved to
 * `BottomTabBar` (iOS-style bottom navigation + More sheet) in
 * v0.18.0, so all this component does now is render a sticky
 * branding header. Kept as a server-renderable component so the brand
 * copy stays static and there's no JS cost for the top bar itself.
 */
export function MobileNav({
  brandTitle,
  brandKicker,
}: {
  brandTitle: string;
  brandKicker: string;
}) {
  return (
    <header className="sticky top-0 z-30 flex items-center justify-between border-b border-[var(--line)] bg-[var(--surface)]/95 px-4 pt-safe pb-3 backdrop-blur lg:hidden">
      <div>
        <p className="text-[10px] uppercase tracking-[0.32em] text-[var(--ink-soft)]">
          {brandKicker}
        </p>
        <p className="font-serif text-xl font-semibold leading-none text-[var(--ink)]">
          {brandTitle}
        </p>
      </div>
    </header>
  );
}
