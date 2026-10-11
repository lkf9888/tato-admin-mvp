import Link from "next/link";

/** The two halves of guest messaging: the conversations, and the library
 *  of what may be said in them. Links, so each half has its own URL and
 *  the library page does not load every thread. */
export function GuestMessagesTabs({
  active,
  labels,
}: {
  active: "messages" | "library";
  labels: { messages: string; library: string };
}) {
  const tab = (key: "messages" | "library", href: string, label: string) => (
    <Link
      href={href}
      aria-current={active === key ? "page" : undefined}
      className={`tap-press rounded-full px-3.5 py-1.5 text-[13px] font-semibold transition ${
        active === key
          ? "bg-[var(--ink)] text-[var(--surface)]"
          : "text-[var(--ink-mid)] hover:bg-[var(--surface-muted)] hover:text-[var(--ink)]"
      }`}
    >
      {label}
    </Link>
  );
  return (
    <nav className="flex items-center gap-1" aria-label={`${labels.messages} / ${labels.library}`}>
      {tab("messages", "/messages", labels.messages)}
      {tab("library", "/messages/ai-templates", labels.library)}
    </nav>
  );
}
