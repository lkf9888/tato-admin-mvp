"use client";

import { useEffect, useState } from "react";

/**
 * Says the app is working whenever it is waiting on the server, on every
 * admin page at once: a save, an import, a sync, a slow list.
 *
 * It watches `fetch` itself rather than asking each button to report:
 * API calls, server actions (Next posts those with fetch) and exports all
 * pass through it, so a page written later is covered without doing
 * anything. Page navigation is left to NavigationOptimizer, and
 * background polling (session checks, nav counts) is not "waiting".
 *
 * - after 300ms: the bar along the top
 * - a change still going after 5s: "still working, don't refresh"
 * - a change in flight: leaving or reloading the page asks first,
 *   since that is exactly what someone who thinks it froze does
 */

const SHOW_AFTER_MS = 300;
const REASSURE_AFTER_MS = 5000;

/** Polls and beacons that run on their own; nobody is waiting on them. */
const BACKGROUND = ["/api/auth/session", "/api/messages/counts", "/api/recent-orders", "/api/health"];

type Tracked = { id: number; mutating: boolean; startedAt: number };

const listeners = new Set<(requests: Tracked[]) => void>();
let inFlight: Tracked[] = [];
let nextId = 1;

function publish() {
  for (const listener of listeners) listener(inFlight);
}

function describe(input: RequestInfo | URL, init?: RequestInit) {
  const request = input instanceof Request ? input : null;
  const url = new URL(request ? request.url : String(input), window.location.href);
  const method = (init?.method ?? request?.method ?? "GET").toUpperCase();
  const headers = new Headers(init?.headers ?? request?.headers);
  return { url, method, headers, keepalive: Boolean(init?.keepalive ?? request?.keepalive) };
}

function shouldTrack(input: RequestInfo | URL, init?: RequestInit) {
  try {
    const { url, method, headers, keepalive } = describe(input, init);
    if (url.origin !== window.location.origin || keepalive) return null;
    if (BACKGROUND.some((path) => url.pathname === path)) return null;
    const isAction = headers.has("next-action");
    // A navigation, prefetch or refresh of the page (React Server Components).
    if (!isAction && (headers.has("rsc") || headers.has("next-router-prefetch"))) return null;
    return { mutating: isAction || (method !== "GET" && method !== "HEAD") };
  } catch {
    return null;
  }
}

function install() {
  const marker = window as unknown as { __tatoFetchWatched?: boolean };
  if (marker.__tatoFetchWatched) return;
  marker.__tatoFetchWatched = true;
  const original = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const track = shouldTrack(input, init);
    if (!track) return original(input, init);
    const entry: Tracked = { id: nextId++, mutating: track.mutating, startedAt: Date.now() };
    inFlight = [...inFlight, entry];
    publish();
    return original(input, init).finally(() => {
      inFlight = inFlight.filter((item) => item.id !== entry.id);
      publish();
    });
  };
}

export function ActivityIndicator({ stillWorking }: { stillWorking: string }) {
  const [requests, setRequests] = useState<Tracked[]>([]);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    install();
    listeners.add(setRequests);
    setRequests(inFlight);
    return () => {
      listeners.delete(setRequests);
    };
  }, []);

  // A clock only while something is in flight, to cross the two thresholds.
  useEffect(() => {
    if (requests.length === 0) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [requests.length]);

  const mutating = requests.some((request) => request.mutating);
  useEffect(() => {
    if (!mutating) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // Older browsers need a value to show the prompt at all.
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [mutating]);

  const oldest = requests.reduce((min, request) => Math.min(min, request.startedAt), Infinity);
  const waited = requests.length ? now - oldest : 0;
  const showBar = waited >= SHOW_AFTER_MS;
  const reassure = requests.some((request) => request.mutating && now - request.startedAt >= REASSURE_AFTER_MS);

  return (
    <>
      {showBar ? (
        <div
          aria-hidden
          className="pointer-events-none fixed inset-x-0 top-0 z-[91] h-1 overflow-hidden bg-[var(--accent-soft-strong)]/70"
        >
          <div className="h-full w-1/3 animate-[tato-route-progress_1.05s_ease-in-out_infinite] bg-[var(--accent)] motion-reduce:w-full motion-reduce:animate-none" />
        </div>
      ) : null}
      {reassure ? (
        <div
          role="status"
          className="tato-fade-in pointer-events-none fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+88px)] z-[91] flex justify-center px-4 lg:bottom-6"
        >
          <span className="flex items-center gap-2 rounded-full bg-[var(--ink)] px-3.5 py-2 text-[12px] font-medium text-white shadow-lg">
            <span
              aria-hidden
              className="h-3.5 w-3.5 rounded-full border-2 border-white/30 border-t-white motion-safe:animate-spin"
            />
            {stillWorking}
          </span>
        </div>
      ) : null}
    </>
  );
}
