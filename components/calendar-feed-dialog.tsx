"use client";

import { useEffect, useState } from "react";

import { SearchableSelect } from "@/components/searchable-select";
import { cn } from "@/lib/utils";

type Feed = {
  id: string;
  token: string;
  vehicleId: string | null;
  vehicleLabel: string | null;
  label: string;
  lastReadAt: string | null;
};

/**
 * Subscription URLs for the calendar.
 *
 * Outbound only. Turo publishes no iCal feed, so there is nothing to
 * import; what this answers is an owner or a driver wanting the
 * schedule in the calendar app they already have open, without an
 * account here.
 */
export function CalendarFeedDialog({
  labels,
  vehicleOptions,
  onClose,
}: {
  labels: {
    title: string;
    subtitle: string;
    scope: string;
    wholeFleet: string;
    create: string;
    creating: string;
    copy: string;
    copied: string;
    revoke: string;
    revokeConfirm: string;
    empty: string;
    neverRead: string;
    lastRead: string;
    failed: string;
    close: string;
    hint: string;
  };
  vehicleOptions: Array<{ id: string; label: string; plateNumber?: string | null }>;
  onClose: () => void;
}) {
  const [feeds, setFeeds] = useState<Feed[]>([]);
  const [scope, setScope] = useState("all");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const load = async () => {
    try {
      const response = await fetch("/api/calendar/feeds");
      if (!response.ok) throw new Error(String(response.status));
      const data = (await response.json()) as { feeds?: Feed[] };
      setFeeds(data.feeds ?? []);
    } catch {
      setError(labels.failed);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const urlFor = (feed: Feed) =>
    `${typeof window === "undefined" ? "" : window.location.origin}/api/calendar/ical/${feed.token}.ics`;

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/calendar/feeds", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vehicleId: scope === "all" ? null : scope }),
      });
      if (!response.ok) throw new Error(String(response.status));
      await load();
    } catch {
      setError(labels.failed);
    } finally {
      setBusy(false);
    }
  }

  async function copy(feed: Feed) {
    const url = urlFor(feed);
    try {
      await navigator.clipboard.writeText(url);
      setCopiedId(feed.id);
      window.setTimeout(() => setCopiedId(null), 2000);
    } catch {
      // Clipboard access is blocked in plenty of contexts; showing the
      // URL beats appearing to do nothing.
      window.prompt(labels.copy, url);
    }
  }

  async function revoke(feed: Feed) {
    if (!window.confirm(labels.revokeConfirm)) return;
    try {
      const response = await fetch(`/api/calendar/feeds/${feed.id}`, { method: "DELETE" });
      if (!response.ok) throw new Error(String(response.status));
      setFeeds((current) => current.filter((item) => item.id !== feed.id));
    } catch {
      setError(labels.failed);
    }
  }

  return (
    <div className="fixed inset-0 z-[85] flex items-end justify-center bg-[var(--ink)]/40 backdrop-blur-sm sm:items-center sm:p-4">
      <button type="button" aria-label={labels.close} className="absolute inset-0" onClick={onClose} />
      <div className="relative flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-2xl border border-[var(--line)] bg-white shadow-2xl sm:max-h-[90vh] sm:w-[min(40rem,calc(100vw-2rem))] sm:rounded-lg">
        <div className="flex items-center justify-between gap-3 border-b border-[var(--line)] px-4 py-3">
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold text-[var(--ink)]">{labels.title}</h2>
            <p className="mt-0.5 text-xs text-[color:var(--ink-soft)]">{labels.subtitle}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={labels.close}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-[var(--line)] bg-white"
          >
            ×
          </button>
        </div>

        <div className="grid gap-3 overflow-y-auto p-4">
          <div className="flex flex-wrap items-end gap-2">
            <label className="grid min-w-[12rem] flex-1 gap-1 text-[11px] font-semibold text-[color:var(--ink-soft)]">
              {labels.scope}
              <SearchableSelect
                value={scope}
                onChange={setScope}
                options={[
                  { value: "all", label: labels.wholeFleet },
                  ...vehicleOptions.map((vehicle) => ({
                    value: vehicle.id,
                    label: vehicle.plateNumber || vehicle.label,
                  })),
                ]}
              />
            </label>
            <button
              type="button"
              onClick={() => void create()}
              disabled={busy}
              className="inline-flex h-9 items-center rounded-md bg-[var(--accent)] px-3.5 text-[12px] font-semibold text-white disabled:opacity-50"
            >
              {busy ? labels.creating : labels.create}
            </button>
          </div>

          <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[11.5px] text-amber-900">
            {labels.hint}
          </p>

          {error ? (
            <p className="rounded-md bg-rose-50 px-3 py-2 text-[12px] text-rose-700">{error}</p>
          ) : null}

          {feeds.length === 0 ? (
            <p className="rounded-md border border-dashed border-[var(--line)] px-3 py-6 text-center text-[12px] text-[color:var(--ink-soft)]">
              {labels.empty}
            </p>
          ) : (
            <ul className="grid gap-2">
              {feeds.map((feed) => (
                <li
                  key={feed.id}
                  className="rounded-md border border-[var(--line)] bg-white px-3 py-2"
                >
                  <p className="text-[12px] font-semibold text-[var(--ink)]">
                    {feed.vehicleLabel ?? labels.wholeFleet}
                  </p>
                  <p className="mt-0.5 truncate font-mono text-[10.5px] text-[color:var(--ink-soft)]">
                    {urlFor(feed)}
                  </p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
                    <button
                      type="button"
                      onClick={() => void copy(feed)}
                      className="text-[11px] font-semibold text-[var(--accent)]"
                    >
                      {copiedId === feed.id ? labels.copied : labels.copy}
                    </button>
                    <button
                      type="button"
                      onClick={() => void revoke(feed)}
                      className="text-[11px] font-semibold text-rose-600"
                    >
                      {labels.revoke}
                    </button>
                    <span className="text-[10.5px] text-[color:var(--ink-soft)]/80">
                      {feed.lastReadAt
                        ? `${labels.lastRead} ${new Date(feed.lastReadAt).toLocaleString()}`
                        : labels.neverRead}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
