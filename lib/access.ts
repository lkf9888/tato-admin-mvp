/**
 * Who on a workspace's team may open what.
 *
 * Three roles. OWNER runs the account: the team, billing and payouts are
 * theirs alone, and everything else is open to them. ADMIN can do
 * everything else, on the pages they are given. VIEWER can open the pages
 * they are given and change nothing.
 *
 * Pages are the navigation's own entries -- what a person sees in the
 * sidebar is what is ticked when they are invited -- and each carries
 * the paths underneath it: its sub-pages and the API it calls. Paths that
 * belong to no page (sign-in, account settings, the shell's own counts)
 * are open to every signed-in member.
 *
 * No `server-only`: the shell filters its navigation with it, the team
 * form lists the pages, and the server enforces it on every request
 * (lib/auth.ts). One table, read the same way in all three places.
 */

export const ROLES = ["OWNER", "ADMIN", "VIEWER"] as const;
export type Role = (typeof ROLES)[number];

export function isRole(value: unknown): value is Role {
  return value === "OWNER" || value === "ADMIN" || value === "VIEWER";
}

type Section = {
  /** The nav href, which is also the key stored in `User.pageAccess`. */
  key: string;
  /** Page paths and API paths that belong to it, beyond the key itself. */
  prefixes: string[];
  ownerOnly?: boolean;
};

export const ACCESS_SECTIONS: Section[] = [
  { key: "/dashboard", prefixes: [] },
  { key: "/assistant", prefixes: ["/api/assistant"] },
  { key: "/messages", prefixes: ["/api/messages", "/agent", "/api/gmail-sync"] },
  { key: "/updates", prefixes: [] },
  { key: "/calendar", prefixes: ["/api/calendar"] },
  {
    key: "/orders",
    prefixes: ["/api/orders", "/api/exports/vehicle-orders", "/booking-requests", "/api/booking-requests"],
  },
  { key: "/imports", prefixes: ["/api/imports", "/api/turo-sync"] },
  { key: "/vehicles", prefixes: ["/api/vehicles"] },
  { key: "/vehicle-roi", prefixes: ["/rental-estimate", "/investment-ranking"] },
  { key: "/owners", prefixes: ["/api/owners", "/owner-statements", "/share-links", "/api/share-links"] },
  { key: "/direct-booking", prefixes: ["/api/direct-booking", "/rental-site", "/api/rental-site"] },
  { key: "/staff-schedule", prefixes: ["/api/staff-schedule"] },
  { key: "/contracts", prefixes: ["/api/contracts"] },
  { key: "/inspections", prefixes: ["/api/inspection"] },
  { key: "/photos", prefixes: ["/api/exports/attachments"] },
  { key: "/documents", prefixes: [] },
  { key: "/activity", prefixes: [] },
  { key: "/trash", prefixes: [] },
  { key: "/billing", prefixes: ["/api/billing"], ownerOnly: true },
  { key: "/payouts", prefixes: ["/api/stripe/connect"], ownerOnly: true },
  { key: "/invoices", prefixes: ["/api/invoices", "/invoice-print"] },
];

/** The keys a member can be given -- every section an owner does not keep. */
export const ASSIGNABLE_SECTIONS = ACCESS_SECTIONS.filter((section) => !section.ownerOnly).map((section) => section.key);

function matches(path: string, prefix: string) {
  return path === prefix || path.startsWith(`${prefix}/`) || path.startsWith(`${prefix}?`);
}

/** The section a path belongs to, or null for paths open to every member. */
export function sectionForPath(path: string): Section | null {
  let best: { section: Section; length: number } | null = null;
  for (const section of ACCESS_SECTIONS) {
    for (const prefix of [section.key, ...section.prefixes]) {
      if (matches(path, prefix) && (!best || prefix.length > best.length)) best = { section, length: prefix.length };
    }
  }
  return best?.section ?? null;
}

export type AccessUser = {
  role: string | null | undefined;
  pageAccess: string | null | undefined;
  vehicleScope?: string | null | undefined;
};

/**
 * The pages a member limited to some cars may have: the ones that show
 * one car at a time, each filtered to their cars. Everything that adds
 * up the whole fleet -- the dashboard, owners, messages, the site, the
 * staff schedule -- is closed to them rather than filtered page by page.
 */
export const SCOPED_SECTIONS = ["/calendar", "/orders", "/vehicles", "/photos", "/documents"];

/** The cars this member is limited to; null means the whole fleet. */
export function parseVehicleScope(value: string | null | undefined): string[] | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : null;
  } catch {
    return null;
  }
}

/**
 * The API paths a car-limited member may call, beyond those naming one
 * order or car (checked against their cars in lib/auth.ts): each of these
 * filters its answer to their cars. Anything else in their pages'
 * sections is refused, so an endpoint added later starts closed to them.
 */
const SCOPED_API_PREFIXES = [
  "/api/calendar/orders",
  "/api/calendar/service-records",
  "/api/orders/offline",
  "/api/orders/export",
  "/api/orders/bulk-payment",
  "/api/orders/parse-note",
  "/api/exports/attachments",
];

/** `/api/orders/<id>` and `/orders/<id>` name one order; these do not. */
const ORDER_COLLECTION_SEGMENTS = new Set([
  "offline",
  "export",
  "bulk-payment",
  "bulk-owner-sync",
  "parse-note",
  "recurring",
  "notes",
]);

/** The order or car a path names, if it names exactly one. */
export function objectInPath(path: string): { kind: "order" | "vehicle"; id: string } | null {
  const order = /^(?:\/api)?\/orders\/([^/?]+)/.exec(path);
  if (order && !ORDER_COLLECTION_SEGMENTS.has(order[1])) return { kind: "order", id: decodeURIComponent(order[1]) };
  const vehicle = /^(?:\/api)?\/vehicles\/([^/?]+)/.exec(path);
  if (vehicle) return { kind: "vehicle", id: decodeURIComponent(vehicle[1]) };
  return null;
}

/** Whether a car-limited member's request path is one built to serve them. */
export function scopedPathAllowed(path: string) {
  if (!path.startsWith("/api/")) return true;
  if (objectInPath(path)) return true;
  return SCOPED_API_PREFIXES.some((prefix) => matches(path, prefix));
}

export function userRole(user: AccessUser): Role {
  return isRole(user.role) ? user.role : "OWNER";
}

/** The sections this member was given; null means every one. */
export function parsePageAccess(value: string | null | undefined): string[] | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((key): key is string => typeof key === "string") : null;
  } catch {
    return null;
  }
}

/** Whether this member may use a section (a nav page and what is under it). */
export function canUseSection(user: AccessUser, key: string) {
  const role = userRole(user);
  if (role === "OWNER") return true;
  const section = ACCESS_SECTIONS.find((candidate) => candidate.key === key);
  if (!section || section.ownerOnly) return false;
  if (parseVehicleScope(user.vehicleScope) && !SCOPED_SECTIONS.includes(key)) return false;
  const allowed = parsePageAccess(user.pageAccess);
  return allowed === null || allowed.includes(key);
}

/** Whether this member may open this path at all. */
export function canOpenPath(user: AccessUser, path: string) {
  const section = sectionForPath(path);
  if (!section) return true;
  if (userRole(user) === "OWNER") return true;
  if (!canUseSection(user, section.key)) return false;
  return !parseVehicleScope(user.vehicleScope) || scopedPathAllowed(path);
}

/**
 * Viewers look and never change: inside any page's section, a request
 * that is not a read is refused. Outside every section -- their own
 * account settings, the language switch, signing out -- they act as
 * anyone does; the workspace-wide settings on that page check the role
 * themselves.
 */
export function canMakeRequest(user: AccessUser, path: string, method: string) {
  if (!canOpenPath(user, path)) return false;
  const upper = method.toUpperCase();
  const isRead = upper === "GET" || upper === "HEAD";
  if (userRole(user) === "VIEWER" && !isRead && sectionForPath(path)) return false;
  return true;
}

export function canManageTeam(user: AccessUser) {
  return userRole(user) === "OWNER";
}
