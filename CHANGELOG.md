# Changelog

## v0.14.3 - 2026-04-18

- Redesigned the CSV import workspace so the flow reads top-to-bottom as four numbered steps (download, check quota, upload + map, run) with a dedicated how-to strip at the top of the page.
- Collapsed the previous two-column layout into a compact main column for the upload, mapping and import actions plus a tighter right-rail quota card, eliminating the confusing 0/1/2/3 ordering that mixed billing and upload steps side-by-side.
- Dimmed the mapping and import cards until a file is uploaded, moved the field-mapping dropdowns into a 2-column grid, and replaced the oversized card titles and padding with tighter type so the whole page fits without scrolling on standard screens.

## v0.14.2 - 2026-04-18

- Ranked the Vehicle ROI cards by `每公里净收益` (net revenue per kilometre) from highest to lowest, with vehicles missing distance data falling to the bottom, and added a visible `#N` rank badge to each card.
- Rebuilt the ROI card layout as a single-column stack so each vehicle block gets the full width, eliminating the cramped side-by-side rendering where currency strings were overlapping on standard monitors.
- Fixed text overlap inside the monthly-revenue breakdown by switching the six-month grid to a label-left / value-right stacked row, tightening the headline sizes, and applying `tabular-nums` so currency figures align cleanly.

## v0.14.1 - 2026-04-18

- Fixed a production boot crash where `prisma/bootstrap-admins.ts` and `prisma/bootstrap-workspaces.ts` could not resolve the `server-only` module under `tsx`, causing Railway containers to exit on every start and healthchecks to fail.
- Dropped the `server-only` directive from `lib/workspaces.ts` since the file is only pulled in from server contexts (Next server components, server actions, and the deploy-time bootstrap scripts).

## v0.14.0 - 2026-04-18

- Redesigned the entire app visual language to feel closer to Turo: white/gray surfaces instead of warm ivory, Turo-purple `#593cfb` accent replacing coral, and tighter corner radii across admin and renter-facing pages.
- Replaced the Arial 13px body type with an Inter-first stack at 14px for a more direct, modern reading experience and dropped the decorative orange/green radial gradients from the page background.
- Swept hardcoded warm color literals and oversized `rounded-[2rem]`/`rounded-3xl` pill shapes out of cards, modals, login/register hero panels, FullCalendar toolbars, and the direct-booking surfaces so the whole admin reads as one cohesive gray/white system.
- Introduced workspace multi-tenancy: new `Workspace` model plus nullable `workspaceId` foreign keys on users, owners, vehicles, orders, import batches, share links, and activity logs, with `requireCurrentWorkspace` gating all workspace-scoped admin queries.
- Added a `bootstrap-workspaces` deploy step that backfills pre-existing rows into a shared default workspace so live data keeps showing up for current admins after the schema rollout.

## v0.13.2 - 2026-04-18

- Added a Railway production startup guard that refuses to boot if no persistent volume is attached, if the volume is mounted anywhere other than `/app/data`, or if `DATABASE_URL` points outside the mounted volume.
- Prevented silent fallbacks to a fresh empty SQLite file on redeploys, so misconfigured Railway deploys now fail loudly instead of appearing to wipe vehicle and order data.

## v0.13.1 - 2026-04-18

- Fixed the quota-selection import flow so `Import selected vehicles` no longer immediately reopens the quota modal after a valid subset has been chosen.
- Disabled the modal import action while the billing re-check is still running, preventing stale quota state from retriggering the popup.
- Closed the quota modal automatically after a successful CSV import and reset it when a new CSV file is chosen.

## v0.13.0 - 2026-04-18

- Fixed a critical gap where Stripe direct-booking payments completed but were never written to the Order table; the webhook now persists paid bookings idempotently and auto-refunds late-detected conflicts.
- Required `SESSION_SECRET` in production and rejected the insecure development fallback so admin cookies can no longer be forged on misconfigured deploys.
- Hardened CSV date parsing to accept 12h/24h/slash formats and interpret wall-clock times in a configurable `CSV_IMPORT_TIMEZONE` (default `America/Vancouver`), eliminating silent timezone drift on UTC servers.
- Expanded middleware protection to `/billing`, `/direct-booking`, and `/vehicle-roi`, and bound share-link access cookies to the current password hash so rotating the password revokes previously unlocked sessions.
- Redesigned the direct-booking admin card into a denser single-column layout: price inputs now span the full card width instead of getting squeezed into a narrow side column.

## v0.12.0 - 2026-04-17

- Replaced the renter-facing direct-booking date inputs with a custom calendar picker that disables occupied dates before the renter can choose them.
- Added client-side range blocking so pickup and return dates can no longer be selected if they would overlap an existing booking window.
- Kept the server-side checkout conflict guard in place, so both the UI and Stripe checkout now protect against overlapping reservations.

## v0.11.1 - 2026-04-17

- Hardened production startup so deploys no longer run Prisma with `--accept-data-loss`, preventing version updates from silently wiping live vehicle and order data.
- Added an automatic SQLite backup step before production schema sync, making Railway redeploys safer when a persisted volume is attached.
- Updated deployment guidance to clarify that production deploys now preserve data and will fail safely instead of applying destructive schema changes.

## v0.11.0 - 2026-04-17

- Added a per-vehicle direct-booking deposit field so admins can charge a fixed security deposit together with rental price and insurance.
- Updated the public reservation quote and Stripe checkout flow so renters now pay `rental + insurance + deposit`.
- Exposed the new deposit amount on both the admin booking setup page and the renter-facing booking page.

## v0.10.1 - 2026-04-17

- Fixed direct-booking preview links to use the current live request domain instead of a stale or placeholder app URL, preventing `Open booking page` from landing on Railway's `Not Found` placeholder.

## v0.10.0 - 2026-04-17

- Added a quota-aware CSV import selection flow so admins can choose which new vehicles from an over-limit CSV should be imported within the currently available quota.
- Updated billing import checks to return the detected new-vehicle list, remaining available vehicle slots, and the projected fleet size based on the chosen subset.
- Scoped stale Turo-order replacement to only the vehicles included in the current import, preventing partial vehicle imports from wiping unrelated vehicle history.

## v0.9.1 - 2026-04-17

- Fixed direct-booking action buttons rendering as dark pills without visible labels by correcting the global CSS layer ordering and explicitly setting button text color on the new booking surfaces.

## v0.9.0 - 2026-04-17

- Added a new `在线预定 / Direct Booking` admin workspace for configuring vehicle-level public booking pages, share links, daily pricing, and insurance fees.
- Added a renter-facing public reservation page per vehicle at `/reserve/[vehicleId]` with a first-pass quote builder, blocked-date visibility, and a Stripe-ready checkout entry.
- Added persisted direct-booking vehicle settings in Prisma so each imported vehicle can be toggled on for public booking independently.

## v0.8.0 - 2026-04-12

- Added a new `车辆投资回报分析 / Vehicle ROI` workspace in the left navigation so admins can review return metrics per vehicle.
- Added vehicle ROI calculations based on imported order history: monthly earnings, net earnings per kilometre from CSV distance data, and annualized return based on manually entered purchase price.
- Added persistent `purchasePrice` support for vehicles, including inline save controls on the ROI page and purchase price inputs on the vehicle management page.

## v0.7.0 - 2026-04-12

- Restyled the orders page to match the newer Turo-inspired design system with warmer surfaces, stronger typography, and cleaner spacing.
- Rebuilt the offline-order creation form, booking search block, and order cards so the page feels more like one operations workspace instead of stacked utility cards.
- Added bilingual section titles and supporting copy for the refreshed orders workspace while preserving the existing search, update, delete, and edit flows.

## v0.6.0 - 2026-04-12

- Reworked the calendar page to feel closer to a Turo-style control room with a stronger toolbar, warmer filters, and a tighter timeline surface.
- Restyled the vehicle timeline table with softer ivory surfaces, clearer weekday headers, alternating row treatment, and more deliberate booking bars.
- Upgraded the booking inspector, manual-order modal, export modal, and owner share calendar header so the calendar flow now reads as one cohesive operating interface.

## v0.5.0 - 2026-04-12

- Refreshed the TATO UI with a more Turo-inspired visual direction: warmer ivory surfaces, darker ink panels, softer coral accents, and more spacious rounded layouts.
- Restyled the login and register pages to feel closer to Turo's brand rhythm with a stronger poster-style hero and cleaner auth panel.
- Updated the admin shell, status badges, metric cards, and global surfaces so the dashboard feels more cohesive across pages.

## v0.4.0 - 2026-04-11

- Added support for a billing-bypass admin account for testing, so one designated admin can import CSV files without quota enforcement.
- Added automatic startup provisioning for the billing-bypass admin account through environment variables on Railway or other production deployments.
- Documented how to configure free-slot coupons and a debug admin account in production.

## v0.3.0 - 2026-04-11

- Added a dedicated `购买额度 / Buy Quota` page in the admin sidebar for managing listing capacity separately from CSV imports.
- Added coupon support with two paths: Stripe promotion codes for discounts and internal free-quota codes that instantly add bonus vehicle slots.
- Updated CSV import over-limit prompts so they send admins to the quota page instead of starting Stripe from inside the import modal.
- Extended workspace billing to track bonus quota and coupon redemptions in Prisma.

## v0.2.0 - 2026-04-10

- Restored the app back to the correct `TATO / Turo` branding after mixed `Harborline` content was removed.
- Cleaned the main branch so stray listing pages and listing-specific Prisma schema no longer ship with the Turo admin app.
- Kept the Turo core flows in place: vehicle calendar, CSV import, offline orders, owner share links, and Stripe vehicle-slot billing.
- Created a backup branch for the mixed code before cleanup: `codex/backup-harborline-mix-20260410`.

## v0.1.0 - 2026-03-28

- Initial local MVP for the Turo admin backend.
- Added vehicles, owners, orders, calendar, CSV import, and owner share pages.
