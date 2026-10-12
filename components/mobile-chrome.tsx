"use client";

import { MoreHorizontal, Plus, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";

import { cn } from "@/lib/utils";

/**
 * The phone's chrome, shared by every page that has one.
 *
 * The top bar (MobileNav) is 44px: the page's name on the left and the
 * page's own icon buttons on the right -- search, filters, ⋯, ＋. A page
 * puts them there with <MobilePageHeader>, which portals into two slots
 * the bar renders, so the buttons stay part of the page (its state, its
 * handlers) while sitting in the shell. Desktop never shows the bar.
 *
 * What does not fit in a row goes behind ⋯ (MobileActionSheet); the one
 * thing a page creates goes on the round ＋ above the tab bar
 * (MobileFab); a record tapped on a phone opens as a card from the
 * bottom (MobileSheet) rather than a page.
 */

type HeaderContent = { title: React.ReactNode | null; actions: React.ReactNode | null };

// One page's header at a time: the page that mounted last owns it. A
// store rather than portals into the bar's DOM -- a portal holds the
// element it found at mount, and a bar re-created by hydration left the
// buttons in a detached node, visible on one load and gone on the next.
let headerContent: HeaderContent = { title: null, actions: null };
let headerOwner: symbol | null = null;
const listeners = new Set<() => void>();

function setHeader(owner: symbol, content: HeaderContent | null) {
  if (content) {
    headerOwner = owner;
    headerContent = content;
  } else if (headerOwner === owner) {
    headerOwner = null;
    headerContent = { title: null, actions: null };
  } else {
    return;
  }
  listeners.forEach((listener) => listener());
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
const emptyHeader: HeaderContent = { title: null, actions: null };

/** What the current page has put in the top bar; for MobileNav. */
export function useMobileHeader() {
  return useSyncExternalStore(
    subscribe,
    () => headerContent,
    () => emptyHeader,
  );
}

/** Put a title and icon buttons in the phone's top bar while mounted. */
export function MobilePageHeader({ title, actions }: { title?: React.ReactNode; actions?: React.ReactNode }) {
  const owner = useRef(Symbol("mobile-header"));
  useLayoutEffect(() => {
    setHeader(owner.current, { title: title ?? null, actions: actions ?? null });
  });
  useEffect(() => {
    const id = owner.current;
    return () => setHeader(id, null);
  }, []);
  return null;
}

/**
 * An icon button for the phone's bars: 36px to the eye, at least 40px
 * to the thumb (the `hit-area` pseudo-element), so the row stays tight
 * without getting harder to hit.
 */
export function MobileIconButton({
  label,
  onClick,
  href,
  dot,
  count,
  active,
  className,
  children,
}: {
  label: string;
  onClick?: () => void;
  href?: string;
  /** A small mark that something is set, e.g. a filter. */
  dot?: boolean;
  count?: number;
  active?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  const classes = cn(
    "tap-compact hit-area relative flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[var(--ink)] transition active:bg-[var(--surface-muted)]",
    active && "bg-[var(--surface-muted)]",
    className,
  );
  const marks = (
    <>
      {count ? (
        <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--brand)] px-1 text-[10px] font-semibold leading-none text-white">
          {count}
        </span>
      ) : dot ? (
        <span aria-hidden className="absolute right-1.5 top-1.5 h-[7px] w-[7px] rounded-full bg-[var(--brand)]" />
      ) : null}
    </>
  );
  if (href) {
    return (
      <Link href={href} aria-label={label} title={label} className={classes}>
        {children}
        {marks}
      </Link>
    );
  }
  return (
    <button type="button" onClick={onClick} aria-label={label} title={label} className={classes}>
      {children}
      {marks}
    </button>
  );
}

export type MobileAction = {
  label: string;
  onClick?: () => void;
  href?: string;
  /** Opens in the browser rather than the app's router (a file, say). */
  external?: boolean;
  danger?: boolean;
  icon?: React.ReactNode;
  disabled?: boolean;
};

/** A sheet of actions rising from the bottom: what ⋯ and ＋ open. */
export function MobileActionSheet({
  open,
  onClose,
  title,
  actions,
  cancelLabel,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  actions: MobileAction[];
  cancelLabel: string;
}) {
  return (
    <MobileSheet open={open} onClose={onClose} label={title ?? cancelLabel}>
      {title ? <p className="px-1 pb-1 text-[12px] font-semibold text-[var(--ink-soft)]">{title}</p> : null}
      <ul className="overflow-hidden rounded-xl border border-[var(--line)]">
        {actions.map((action) => {
          const classes = cn(
            "tap-compact flex min-h-[48px] w-full items-center gap-3 px-4 text-left text-[15px] disabled:opacity-40",
            action.danger ? "text-[var(--bad-fg)]" : "text-[var(--ink)]",
          );
          const body = (
            <>
              {action.icon ? <span className="shrink-0 text-[var(--ink-soft)]">{action.icon}</span> : null}
              <span className="min-w-0 flex-1 truncate">{action.label}</span>
            </>
          );
          return (
            <li key={action.label} className="border-b border-[var(--line)] last:border-b-0">
              {action.href && !action.disabled ? (
                action.external ? (
                  <a href={action.href} className={classes} onClick={onClose}>
                    {body}
                  </a>
                ) : (
                  <Link href={action.href} className={classes} onClick={onClose}>
                    {body}
                  </Link>
                )
              ) : (
                <button
                  type="button"
                  disabled={action.disabled}
                  className={classes}
                  onClick={() => {
                    onClose();
                    action.onClick?.();
                  }}
                >
                  {body}
                </button>
              )}
            </li>
          );
        })}
      </ul>
      <button
        type="button"
        onClick={onClose}
        className="tap-compact mt-2 flex min-h-[48px] w-full items-center justify-center rounded-xl border border-[var(--line)] text-[15px] font-semibold text-[var(--ink)]"
      >
        {cancelLabel}
      </button>
    </MobileSheet>
  );
}

/** ⋯ in the top bar, opening a sheet of what did not fit. */
export function MobileMoreMenu({
  label,
  actions,
  cancelLabel,
}: {
  label: string;
  actions: MobileAction[];
  cancelLabel: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <MobileIconButton label={label} onClick={() => setOpen(true)} active={open}>
        <MoreHorizontal className="h-[19px] w-[19px]" aria-hidden />
      </MobileIconButton>
      <MobileActionSheet open={open} onClose={() => setOpen(false)} actions={actions} cancelLabel={cancelLabel} />
    </>
  );
}

/**
 * The round ＋ above the tab bar, right-hand side, where a thumb rests.
 * One action runs at once; several open a sheet to choose from.
 */
export function MobileFab({
  label,
  onClick,
  actions,
  cancelLabel,
}: {
  label: string;
  onClick?: () => void;
  actions?: MobileAction[];
  cancelLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        aria-label={label}
        title={label}
        onClick={() => (actions ? setOpen(true) : onClick?.())}
        className="tap-compact fixed right-4 z-30 flex h-[52px] w-[52px] items-center justify-center rounded-full bg-[var(--brand)] text-white shadow-[0_6px_16px_rgba(89,60,251,0.35)] transition active:scale-95 lg:hidden"
        style={{ bottom: "calc(env(safe-area-inset-bottom) + 52px + 16px)" }}
      >
        <Plus className="h-6 w-6" strokeWidth={2.2} aria-hidden />
      </button>
      {actions ? (
        <MobileActionSheet
          open={open}
          onClose={() => setOpen(false)}
          actions={actions}
          cancelLabel={cancelLabel ?? label}
        />
      ) : null}
    </>
  );
}

/**
 * A card from the bottom of the screen over a dimmed page. Closes on the
 * backdrop, Escape, the ✕ (when given a close label) or a pull down on
 * its handle. Phones only: on a desktop the same content belongs in a
 * dialog, so callers decide which to render.
 */
export function MobileSheet({
  open,
  onClose,
  label,
  closeLabel,
  children,
  className,
}: {
  open: boolean;
  onClose: () => void;
  label: string;
  closeLabel?: string;
  children: React.ReactNode;
  className?: string;
}) {
  const [dragY, setDragY] = useState(0);
  const start = useRef<number | null>(null);

  useEffect(() => {
    if (!open) return;
    const original = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = original;
      window.removeEventListener("keydown", onKey);
      setDragY(0);
    };
  }, [open, onClose]);

  if (!open) return null;
  return createPortal(
    <div role="dialog" aria-modal="true" aria-label={label} className="fixed inset-0 z-50 flex items-end justify-center">
      <button
        type="button"
        aria-label={closeLabel ?? label}
        onClick={onClose}
        className="tap-compact tato-fade-in absolute inset-0 bg-black/40"
      />
      <div
        className={cn(
          "tato-sheet-up relative flex max-h-[88dvh] w-full max-w-xl flex-col rounded-t-[18px] bg-[var(--surface)] px-4 pb-[calc(env(safe-area-inset-bottom)+16px)] shadow-[0_-8px_30px_rgba(0,0,0,0.18)]",
          className,
        )}
        style={dragY ? { transform: `translateY(${dragY}px)`, transition: "none" } : undefined}
      >
        <div
          className="flex shrink-0 cursor-grab touch-none justify-center pb-3 pt-2"
          onPointerDown={(event) => {
            start.current = event.clientY;
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            if (start.current !== null) setDragY(Math.max(0, event.clientY - start.current));
          }}
          onPointerUp={() => {
            if (start.current === null) return;
            start.current = null;
            if (dragY > 80) onClose();
            else setDragY(0);
          }}
          onPointerCancel={() => {
            start.current = null;
            setDragY(0);
          }}
        >
          <span aria-hidden className="h-1 w-9 rounded-full bg-[var(--line-strong)]" />
        </div>
        {closeLabel ? (
          <button
            type="button"
            onClick={onClose}
            aria-label={closeLabel}
            className="tap-compact hit-area absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-full bg-[var(--surface-muted)] text-[var(--ink)]"
          >
            <X className="h-4 w-4" strokeWidth={2.2} aria-hidden />
          </button>
        ) : null}
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
